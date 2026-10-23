import "server-only";
import { z } from "zod";
import { SpendError, type RunSpend } from "../ai/run-spend";
import { CLOCK_SKEW_MS, SETTLEMENT_WINDOW_MS, spendDetail } from "../ai/live-run";
import {
  beginAgencyOperation, cancelOperation, createOperationSpend, finishOperation, heartbeatOperation, readOperation, readOperationProgress,
  watchOperationCancellation, type OperationCandidate, type OperationOutcome, type OperationProgress, type OperationRun,
} from "../builder/operation-server";
import type { OperationStatus } from "../builder/operation-contract";
import { AGENCY_KIND_POLICY, AgencyError, taskContext, taskDigest, type AgencyTask } from "./task";
import { runTaskLoop, type AgencyTool, type LoopFailure, type LoopOutcome, type ModelPort, type ToolContext } from "./loop";
import { runSpecialist, type SpecialistParent, type SpecialistSpec } from "./specialist";

/**
 * The lead workflow for one agency task step, on the existing operation:
 * begin (or replay) the step -> spend through its fenced run -> one bounded
 * lead loop that delegates to specialists only for standard-scale work ->
 * finish once with an explicit outcome. Refresh/reconnect reads the recorded
 * state (readAgencyTask) and never launches the step again.
 * Server-side flag: MAKEBORNE_AGENCY_TASKS=on (off by default; nothing is
 * qualified yet, so resolveAgencyTask refuses every kind regardless).
 */
export function agencyTasksEnabled(env: Record<string, string | undefined> = process.env) { return env.MAKEBORNE_AGENCY_TASKS === "on"; }

export type AgencyLeadSpec<R> = Readonly<{
  system: string; result: z.ZodType<R>; resultDescription: string;
  /** Present for tasks that change the project: the candidate is saved only at the task's expected revision. */
  apply?: (result: R, task: AgencyTask) => Extract<OperationCandidate, { expectedVersion: number }>;
  /** Extra content blocks after the objective in the first message (a reviewer's labelled images). */
  content?: readonly unknown[];
  /** For data results: the server-side form stored on the run (e.g. a review grounded against its request). */
  finalize?: (result: R, task: AgencyTask) => unknown;
}>;
export type AgencyRunDeps = Readonly<{
  model: ModelPort; tools: Readonly<Record<string, AgencyTool>>; readInput: (index: number) => Promise<string>;
  specialists?: readonly SpecialistSpec[]; platformDeadline: number;
  heartbeatMs?: number; pollMs?: number; maxSpecialistCalls?: number;
  /** Limits for this one step inside the task's ceiling (a multi-step task keeps room for its later steps). */
  stage?: Readonly<{ credits: number; providerMicrousd: number }>;
}>;
export type AgencyRunOutcome = Readonly<{
  replayed: boolean; status: OperationStatus | null; outcome: string; charged: number; code?: string; message: string;
}>;

const MESSAGES: Record<string, string> = {
  result: "Done.", saved: "Done. The change was saved as a new version.",
  incomplete: "This step reached its limit. Your saved work is safe and you can continue it.",
  failed: "This step could not finish. You were not charged for it.",
  cancelled: "Stopped. You were charged only for confirmed work.",
  expired: "This step ran out of time. Any result is kept for recovery, without a charge.",
  conflict: "The project changed while this ran, so nothing was applied. The result is kept for review, without a charge.",
  save_failed: "The result could not be saved. It is kept for recovery, without a charge.",
  recovery_pending: "Checking this request's saved result and credit charge. Use its status before retrying.",
};
const customerMessage = (outcome: string) => MESSAGES[outcome] ?? "This request has a recorded result. Check its status.";

/** Settlement's chargeable amount. On feature/model-routing RunSpend adds chargeableMicrousd (confirmed minus absorbed); use it when present. */
export function chargeableMicrousd(spend: RunSpend): number {
  const routed = (spend as RunSpend & { chargeableMicrousd?: number }).chargeableMicrousd;
  return typeof routed === "number" ? routed : spend.confirmedMicrousd;
}

function recorded(status: OperationStatus, replayed: boolean): AgencyRunOutcome {
  const result = status.result;
  const outcome = !result ? "recovery_pending" : status.operation.cancelRequested ? "cancelled" : result.code === "OPERATION_EXPIRED" ? "expired"
    : result.code ? "failed" : result.data !== undefined ? "result" : result.version !== undefined && result.changed ? "saved" : "incomplete";
  return { replayed, status, outcome, charged: result?.charged ?? 0, ...(result?.code ? { code: result.code } : {}), message: customerMessage(outcome) };
}

function leadPrompt(task: AgencyTask) {
  const inputs = task.inputs.map((input, index) => `${index}. ${input.kind} ${input.id}${input.version ? ` (version ${input.version})` : ""}`);
  return [`Objective: ${task.objective}`, inputs.length ? `Inputs (read with read_input):\n${inputs.join("\n")}` : "No inputs."].join("\n\n");
}

function delegateTool(specs: readonly SpecialistSpec[], parent: () => SpecialistParent, limit: number): AgencyTool {
  const names = specs.map(spec => spec.name) as [string, ...string[]];
  let used = 0;
  const args = z.object({ specialist: z.enum(names), objective: z.string().trim().min(1).max(1000), inputs: z.array(z.number().int().min(0).max(49)).max(10) }).strict();
  return Object.freeze({
    name: "delegate", effect: "read" as const, args: args as z.ZodType<unknown>,
    description: `Ask one bounded specialist for typed data, only when the objective needs it. It sees only the inputs you list. Specialists: ${specs.map(spec => `${spec.name} (${spec.purpose})`).join("; ")}.`,
    async run(value: unknown, context: ToolContext) {
      const request = args.parse(value);
      if (++used > limit) return { ok: false, code: "SPECIALIST_LIMIT" };
      const spec = specs.find(item => item.name === request.specialist)!;
      const material = await Promise.all(request.inputs.map(index => context.readInput(index)));
      const outcome = await runSpecialist(spec, { objective: request.objective, context: material }, parent());
      if (!outcome.ok && outcome.code === "CANCELLED") throw new SpendError("CANCELLED", "This request was stopped.");
      return outcome.ok ? { ok: true, result: outcome.result } : { ok: false, code: outcome.code };
    },
  });
}

const INCOMPLETE: ReadonlySet<LoopFailure> = new Set(["RUN_BUDGET", "HOLD_EXPIRED", "MAX_TURNS"]);

export async function runAgencyTask<R>(task: AgencyTask, lead: AgencyLeadSpec<R>, deps: AgencyRunDeps): Promise<AgencyRunOutcome> {
  // Refusals that need no record happen before any operation, run or hold.
  const tools = task.permittedTools.map(name => deps.tools[name]);
  if (tools.some((tool, index) => !tool || tool.name !== task.permittedTools[index] || tool.name === "delegate" || tool.name === "submit_result"))
    throw new AgencyError("AGENCY_TOOL_REFUSED", "One of the requested tools is not available for this task.", 400);
  const { run, status } = await beginAgencyOperation({ actor: task.actorId, workspaceId: task.workspaceId, artifactId: task.artifactId, kind: task.kind,
    effort: task.settings.effort, expectedVersion: task.expectedRevision, ceiling: task.ceilings.customerCredits,
    providerCapMicrousd: Math.min(task.ceilings.providerMicrousd, deps.stage?.providerMicrousd ?? Infinity), stageCap: deps.stage?.credits,
    context: taskContext(task), digest: taskDigest(task), actionKey: task.actionKey, stepKey: task.stepKey });
  // A duplicate request (same action and step) gets the stored outcome and makes no call.
  if (!run) return recorded(status, true);
  return executeStep(task, lead, deps, run);
}

async function executeStep<R>(task: AgencyTask, lead: AgencyLeadSpec<R>, deps: AgencyRunDeps, run: OperationRun): Promise<AgencyRunOutcome> {
  const spend = createOperationSpend(run, deps.platformDeadline);
  const controller = new AbortController();
  const stopWatch = watchOperationCancellation(run, spend, controller, deps.pollMs);
  let progress: Record<string, unknown> = { stage: "started", turn: 0 };
  const stop = (code: "CANCELLED" | "HOLD_EXPIRED" | "SPEND_UNAVAILABLE", message: string) => {
    if (code === "CANCELLED") spend.cancel();
    const error = new SpendError(code, message);
    controller.abort(error);
    return error;
  };
  // Durable heartbeat: progress, Stop and (only within the hold/operation bounds) a renewed lease.
  const beat = async (renew: boolean) => {
    let state;
    try { state = await heartbeatOperation(run, progress, renew, AbortSignal.timeout(3000)); }
    catch { throw stop("SPEND_UNAVAILABLE", "The operation could not be checked; the worker stopped."); }
    if (!state.active) throw stop(state.cancelRequested ? "CANCELLED" : "HOLD_EXPIRED", state.cancelRequested ? "This request was stopped." : "This step can no longer run.");
    if (state.renewed) spend.extendDeadline(Math.min(deps.platformDeadline, state.expiresAt - SETTLEMENT_WINDOW_MS - CLOCK_SKEW_MS));
  };
  let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => { timer = setTimeout(() => void beat(true).then(() => { if (!disposed && !controller.signal.aborted) schedule(); }, () => undefined), deps.heartbeatMs ?? 30_000); timer.unref?.(); };
  schedule();
  const context: ToolContext = Object.freeze({ readInput: deps.readInput, signal: controller.signal, spend });
  const tools = task.permittedTools.map(name => deps.tools[name]);
  const parent: SpecialistParent = Object.freeze({ spend, signal: controller.signal, model: deps.model, tools, context, beforeDraft: () => beat(false) });
  const specialists = task.scale === "standard" && AGENCY_KIND_POLICY[task.kind].specialists ? deps.specialists ?? [] : [];
  let outcome: LoopOutcome<R>;
  try {
    outcome = await runTaskLoop({ system: lead.system, prompt: lead.content?.length ? [{ type: "text", text: leadPrompt(task) }, ...lead.content] : leadPrompt(task), result: lead.result, resultDescription: lead.resultDescription,
      tools: specialists.length ? [...tools, delegateTool(specialists, () => parent, deps.maxSpecialistCalls ?? 3)] : tools,
      maxTurns: task.settings.maxTurns, maxOutputTokens: task.settings.maxOutputTokens, spend, signal: controller.signal, model: deps.model, context,
      beforeDraft: () => beat(false), onTurn: turn => { progress = { stage: "working", turn }; } });
  } catch {
    outcome = { ok: false, code: "PROVIDER_FAILED", turns: 0 };
  } finally {
    disposed = true; if (timer) clearTimeout(timer); stopWatch();
  }
  const detail: Record<string, unknown> = { ...spendDetail(spend), chargeableMicrousd: chargeableMicrousd(spend), turns: outcome.turns,
    // Unknown-usage attempts, for operators to reconcile against the provider ledger (ids, not names).
    uncertainCalls: spend.calls.filter(call => call.actualMicrousd === null).slice(0, 20).map(call => call.id),
    ...(outcome.ok ? { finished: true } : { code: outcome.code }) };
  let name: OperationOutcome = "failed", candidate: OperationCandidate | undefined;
  if (outcome.ok) {
    if (lead.apply) { name = "saved"; candidate = lead.apply(outcome.result, task); }
    // A finalizer that throws ends the step as failed (no charge) instead of leaving the run open.
    else { try { candidate = { data: lead.finalize ? lead.finalize(outcome.result, task) : outcome.result }; name = "result"; } catch { candidate = undefined; } }
  } else if (INCOMPLETE.has(outcome.code)) name = "incomplete";
  try {
    const finalization = await finishOperation(run, chargeableMicrousd(spend), name, detail, candidate);
    return { replayed: false, status: finalization, outcome: finalization.outcome, charged: finalization.charged,
      ...(finalization.result?.code ? { code: finalization.result.code } : !outcome.ok ? { code: outcome.code } : {}), message: customerMessage(finalization.outcome) };
  } catch {
    // The finish may have committed: read it back instead of guessing what was charged.
    try {
      const status = await readOperation({ actor: run.actor, workspaceId: run.workspaceId, artifactId: run.artifactId, id: run.operation.id });
      if (status.result?.runId === run.id) return recorded(status, false);
    } catch { /* fall through */ }
    return { replayed: false, status: null, outcome: "recovery_pending", charged: 0, code: "OPERATION_RECOVERY_PENDING", message: customerMessage("recovery_pending") };
  }
}

export type AgencyProgressView = Readonly<{
  operation: OperationProgress["operation"]; runs: OperationProgress["runs"];
  inProgressCalls: number; uncertainCalls: number; message: string;
}>;
/** Truthful Stop text: an attempt already sent cannot be recalled, but it adds no charge beyond its confirmed cost. */
export function stopMessage(progress: OperationProgress): string {
  if (!progress.operation.cancelRequested) return "This task had already finished, so nothing was stopped.";
  if (progress.calls.inProgress > 0) return "Stopped. No new work will start. A step that was already running will finish or time out; you won't be charged beyond its confirmed cost.";
  if (progress.operation.reservedCredits > 0) return "Stopping. No new work will start while the current step closes.";
  return "Stopped. You were charged only for confirmed work.";
}
const view = (progress: OperationProgress, message: string): AgencyProgressView => Object.freeze({ operation: progress.operation, runs: progress.runs,
  inProgressCalls: progress.calls.inProgress, uncertainCalls: progress.calls.uncertain, message });

export async function stopAgencyTask(input: { actor: string; workspaceId: string; artifactId: string; id: string; expectedRevision?: number }): Promise<AgencyProgressView> {
  await cancelOperation(input);
  const progress = await readOperationProgress(input);
  return view(progress, stopMessage(progress));
}

/** Refresh/reconnect: recorded state only. Never begins or repeats a step. */
export async function readAgencyTask(input: { actor: string; workspaceId: string; artifactId: string; id: string }): Promise<AgencyProgressView & { result: OperationStatus["result"] }> {
  const status = await readOperation(input);
  const progress = await readOperationProgress(input);
  const message = progress.operation.cancelRequested ? stopMessage(progress) : status.result ? recorded(status, false).message
    : progress.operation.reservedCredits > 0 ? "Working. This step is still running." : "Ready to continue.";
  return { ...view(progress, message), result: status.result };
}

import type { z } from "zod";
import { RunSpend, SpendError, type CallTicket, type SpendGate } from "../ai/run-spend";
import { runTaskLoop, type AgencyTool, type ModelPort, type ToolContext } from "./loop";

/**
 * A bounded specialist sub-task inside the lead's operation step.
 * - Spending: a child view of the parent RunSpend. Its cap is at most the
 *   parent's remaining allowance (times maxShare); every paid attempt is
 *   reserved through the parent, so it reaches the same gate, operation, run,
 *   fence and credit hold. No new operation, authorization or hold exists.
 * - Permissions: only tools the parent was granted AND the spec names.
 * - Context: only what the lead passes (bounded bytes); no project access.
 * - Output: data validated server-side by the spec's schema. A specialist
 *   cannot publish or write the project; the lead decides what to apply.
 */
export type SpecialistSpec<R = unknown> = Readonly<{
  name: string; purpose: string; system: string; result: z.ZodType<R>; resultDescription: string;
  tools: readonly string[]; maxTurns: number; maxOutputTokens: number;
  /** Absolute provider ceiling for one invocation (microUSD). */
  capMicrousd: number;
  /** Largest share of the parent's remaining allowance one invocation may take, in (0, 1]. */
  maxShare: number;
  maxContextBytes: number;
}>;
export type SpecialistSpend = { confirmedMicrousd: number; uncertainMicrousd: number; calls: number };
export type SpecialistOutcome<R> = { ok: true; result: R; spend: SpecialistSpend } | { ok: false; code: string; spend: SpecialistSpend };
export type SpecialistParent = Readonly<{
  spend: RunSpend; signal: AbortSignal; model: ModelPort; tools: readonly AgencyTool[]; context: ToolContext; beforeDraft?: () => Promise<void>;
}>;

/** A spending view that can only lower the parent's limits and records every call in the parent. */
export function childSpend(parent: RunSpend, capMicrousd: number): RunSpend {
  const cap = Math.max(0, Math.min(Math.floor(capMicrousd), parent.remainingMicrousd));
  const tickets = new Map<string, CallTicket>();
  const gate: SpendGate = {
    async begin(call) { tickets.set(call.id, await parent.begin(call.provider, call.model, call.boundMicrousd)); },
    async finish(id, outcome) {
      const ticket = tickets.get(id);
      if (!ticket) throw new SpendError("SPEND_UNAVAILABLE", "A specialist call was not recorded by its parent.");
      tickets.delete(id);
      await parent.finish(ticket, outcome);
    },
  };
  return new RunSpend({ run: parent.run, gate, providerCapMicrousd: cap, customerCapMicrousd: null, deadline: parent.deadline });
}

const usage = (spend: RunSpend): SpecialistSpend => ({ confirmedMicrousd: spend.confirmedMicrousd, uncertainMicrousd: spend.uncertainMicrousd, calls: spend.calls.length });
const none: SpecialistSpend = { confirmedMicrousd: 0, uncertainMicrousd: 0, calls: 0 };

export async function runSpecialist<R>(spec: SpecialistSpec<R>, request: { objective: string; context: readonly string[] }, parent: SpecialistParent): Promise<SpecialistOutcome<R>> {
  if (!(spec.maxShare > 0 && spec.maxShare <= 1) || !Number.isSafeInteger(spec.maxTurns) || spec.maxTurns < 1 || spec.maxTurns > 6
    || !Number.isSafeInteger(spec.capMicrousd) || spec.capMicrousd <= 0 || !Number.isSafeInteger(spec.maxOutputTokens) || spec.maxOutputTokens < 1)
    return { ok: false, code: "SPECIALIST_INVALID", spend: none };
  const granted = new Map(parent.tools.map(tool => [tool.name, tool] as const));
  if (spec.tools.some(name => !granted.has(name))) return { ok: false, code: "SPECIALIST_TOOL_REFUSED", spend: none };
  const bytes = request.context.reduce((total, item) => total + Buffer.byteLength(item, "utf8"), Buffer.byteLength(request.objective, "utf8"));
  if (bytes > spec.maxContextBytes) return { ok: false, code: "SPECIALIST_CONTEXT_TOO_LARGE", spend: none };
  if (parent.signal.aborted || parent.spend.stopped === "CANCELLED") return { ok: false, code: "CANCELLED", spend: none };
  const cap = Math.min(spec.capMicrousd, Math.floor(parent.spend.remainingMicrousd * spec.maxShare));
  if (cap <= 0) return { ok: false, code: "SPECIALIST_NO_ALLOWANCE", spend: none };
  const spend = childSpend(parent.spend, cap);
  const prompt = [`Objective: ${request.objective}`, ...request.context.map((item, index) => `<context index="${index + 1}">\n${item}\n</context>`)].join("\n\n");
  const outcome = await runTaskLoop({ system: spec.system, prompt, tools: spec.tools.map(name => granted.get(name)!), result: spec.result,
    resultDescription: spec.resultDescription, maxTurns: spec.maxTurns, maxOutputTokens: spec.maxOutputTokens, spend, signal: parent.signal,
    model: parent.model, context: Object.freeze({ ...parent.context, spend }), beforeDraft: parent.beforeDraft, maxInvalid: 1 });
  // A stop inside the child is a stop of the parent's step.
  if (spend.stopped === "CANCELLED") parent.spend.cancel();
  return outcome.ok ? { ok: true, result: outcome.result, spend: usage(spend) } : { ok: false, code: outcome.code, spend: usage(spend) };
}

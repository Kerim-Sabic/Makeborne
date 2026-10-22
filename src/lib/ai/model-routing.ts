import type { EffortLevel } from "../routing/effort";
import { textPrice } from "./prices";
import type { RunSpend } from "./run-spend";

/**
 * Model routing for the builder's text stages (website build/edit/review, plan, book/deck).
 *
 * Deterministic rules only: no paid classifier call. A stage is put in a task class from what the
 * server already knows (operation stage, whether the project is empty, the request text and its
 * visual-edit target reference, attachments, an approved plan, the effort level). Each class maps
 * to a model:
 *
 * - MAKEBORNE_MODEL_ROUTING unset or "off" (the default): every class uses the builder model
 *   (MAKEBORNE_BUILDER_MODEL, else claude-opus-5-5): today's behaviour exactly. The class is still
 *   computed and recorded, so receipts and telemetry say what a stage was.
 * - "on": a class uses its per-class override MAKEBORNE_ROUTE_<CLASS> (e.g.
 *   MAKEBORNE_ROUTE_TARGETED_EDIT=claude-sonnet-5-5), else its qualified default in QUALIFIED_ROUTES,
 *   else the builder model. Only classes that did not lose measurable quality in qualification have
 *   a default (docs/release-review/model-routing-20261022.md).
 *
 * A stage routed to a model other than the builder model runs as an attempt that may escalate once
 * to the builder model inside the same durable operation, hold and RunSpend (runRouted below).
 * Pure: no SDK, database or server-only imports (offline checks load it directly).
 */
export const TASK_CLASSES = ["new-site", "redesign", "edit", "targeted-edit", "continuation", "review", "plan", "document-new", "document-edit"] as const;
export type TaskClass = typeof TASK_CLASSES[number];
export type RouteStage = "build" | "continuation" | "review" | "plan" | "document";

/** Text models whose request surface matches the builder's (adaptive thinking with progress updates,
 * effort low..max, eager tool input streaming, 5-minute caching). Anything else is never routed to. */
export const ROUTABLE_MODELS = Object.freeze(["claude-opus-5-5", "claude-sonnet-5-5"]);
export const MODEL_LABELS: Readonly<Record<string, string>> = Object.freeze({ "claude-opus-5-5": "Claude Opus 5.5", "claude-sonnet-5-5": "Claude Sonnet 5.5", "claude-haiku-5-5": "Claude Haiku 5.5" });
export const modelLabel = (model: string) => MODEL_LABELS[model] ?? model;
export const CLASS_LABELS: Readonly<Record<TaskClass, string>> = Object.freeze({
  "new-site": "new website", redesign: "large redesign", edit: "edit", "targeted-edit": "targeted edit", continuation: "continuation",
  review: "design review", plan: "plan", "document-new": "new document", "document-edit": "document edit",
});

/**
 * Qualified defaults when routing is on. Empty until a class passes qualification on its planned samples
 * without losing measurable quality; see the record cited above. Overrides still apply per class.
 */
export const QUALIFIED_ROUTES: Readonly<Partial<Record<TaskClass, string>>> = Object.freeze({});

/** A routed attempt may spend at most this share of the stage's allowance, so an escalation always keeps
 * the rest (at Sonnet's half price, 50% buys the same tokens the primary model would get at 100%). */
export const ROUTED_BUDGET_SHARE = 0.5;
/** A single-pass routed attempt (edits, reviews, documents, plans) ends by this share of the stage's time. */
export const ROUTED_TIME_SHARE = 0.6;
/** No escalation starts with less than this time left (it would be cut off) or this share of the allowance. */
export const MIN_ESCALATION_MS = 90_000;
export const MIN_ESCALATION_SHARE = 0.25;

export type RouteInput = {
  stage: RouteStage;
  /** The customer's message for this stage (build stages), never stored or logged. */
  request?: string;
  /** Editable files in the project before the stage (0: a first build). */
  files?: number;
  /** Document stage: the document is empty (a first build). */
  emptyDocument?: boolean;
  effort: EffortLevel;
  attachments?: number;
  /** The build follows an approved plan. */
  plan?: boolean;
};
export type ModelRoute = {
  class: TaskClass;
  /** The model this stage runs on first. */
  model: string;
  /** The model it escalates to once, or null when it already runs on the builder model. */
  escalation: string | null;
  /** Deterministic explanation (rule names and sizes only; never request text). */
  reason: string;
  routing: "on" | "off";
};

const TARGET_REFERENCE = /(?:^|[\s(])[\w./-]+\.(?:tsx|ts|css|html|json|svg|md) \(line \d+\)/;
const LARGE_CHANGE = /\b(?:re-?design|rebuild|start (?:over|again)|from scratch|over-?haul|revamp|re-?style|rewrite (?:the |my )?(?:whole|entire|site|website|page)|whole (?:site|website)|entire (?:site|website|page)|every (?:page|section)|all (?:the )?(?:pages|sections)|new (?:look|design|theme|layout|style|pages?|sections?)|add (?:a |an |two |three |some )?(?:new )?(?:pages?|sections?)|completely|multi-?page|landing page for)\b/i;
/** Longest request treated as a targeted edit without a picked element; with one, up to TARGETED_WITH_PICK. */
export const TARGETED_CHARS = 600;
export const TARGETED_WITH_PICK = 1500;

/** The task class of one stage, by fixed rules (first match wins). */
export function classifyStage(input: RouteInput): { class: TaskClass; reason: string } {
  if (input.stage === "review") return { class: "review", reason: "design review stage" };
  if (input.stage === "plan") return { class: "plan", reason: "plan stage" };
  if (input.stage === "continuation") return { class: "continuation", reason: "automatic continuation of a stopped stage" };
  if (input.stage === "document") return input.emptyDocument ? { class: "document-new", reason: "empty document" } : { class: "document-edit", reason: "existing document" };
  const request = input.request ?? "", length = request.trim().length;
  if (!input.files) return { class: "new-site", reason: "empty project" };
  if (input.plan) return { class: "redesign", reason: "approved plan" };
  if (LARGE_CHANGE.test(request)) return { class: "redesign", reason: "large-change wording" };
  if (input.effort === "super_high" || input.effort === "ultra") return { class: "edit", reason: `${input.effort} effort` };
  if (input.attachments) return { class: "edit", reason: `${input.attachments} attachment${input.attachments === 1 ? "" : "s"}` };
  const picked = TARGET_REFERENCE.test(request);
  if (picked && length <= TARGETED_WITH_PICK) return { class: "targeted-edit", reason: `visual-edit target, ${length} characters` };
  if (length <= TARGETED_CHARS) return { class: "targeted-edit", reason: `short request, ${length} characters` };
  return { class: "edit", reason: `${length}-character request` };
}

const envName = (taskClass: TaskClass) => `MAKEBORNE_ROUTE_${taskClass.toUpperCase().replace(/-/g, "_")}`;
const warned = new Set<string>();
function warnOnce(message: string) { if (!warned.has(message)) { warned.add(message); console.error(message); } }

/** The builder model (routing off, and the escalation target when on). */
export const primaryModel = (env: Record<string, string | undefined> = process.env) => env.MAKEBORNE_BUILDER_MODEL || "claude-opus-5-5";
export function routingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = (env.MAKEBORNE_MODEL_ROUTING ?? "").trim().toLowerCase();
  if (raw === "on") return true;
  if (raw && raw !== "off") warnOnce(`Ignoring MAKEBORNE_MODEL_ROUTING "${raw}": use on or off. Routing stays off.`);
  return false;
}

/** Routes one stage. An override naming an unpriced or non-routable model is ignored (the builder model runs). */
export function routeStage(input: RouteInput, env: Record<string, string | undefined> = process.env): ModelRoute {
  const { class: taskClass, reason } = classifyStage(input);
  const primary = primaryModel(env);
  if (!routingEnabled(env)) return { class: taskClass, model: primary, escalation: null, reason, routing: "off" };
  const override = env[envName(taskClass)]?.trim();
  let model = override || QUALIFIED_ROUTES[taskClass] || primary;
  if (model !== primary) {
    let priced = true;
    try { textPrice(model); } catch { priced = false; }
    if (!priced || !ROUTABLE_MODELS.includes(model)) {
      warnOnce(`Ignoring ${override ? envName(taskClass) : "the qualified route"} "${model}" for ${taskClass}: it is not a priced, routable builder model (${ROUTABLE_MODELS.join(", ")}).`);
      model = primary;
    }
  }
  return { class: taskClass, model, escalation: model === primary ? null : primary, reason: `${reason}${override ? `; ${envName(taskClass)}` : model === primary ? "" : "; qualified route"}`, routing: "on" };
}

/** Every model a route may call (the routed model and its escalation), for fail-closed price checks. */
export const routeModels = (route: ModelRoute) => [route.model, ...(route.escalation ? [route.escalation] : [])];

/* ---------- Escalation ---------- */

export type RouteAttempt = { model: string; escalated: boolean; outcome: "ok" | "failed" | "error"; reason: string | null; providerMicrousd: number; ms: number };
export type RouteRecord = { class: TaskClass; models: string[]; escalation: string | null; absorbedMicrousd: number; attempts: RouteAttempt[] };
/** The stream event that tells the client (receipt) which model a stage ran on. No prompt content. */
export type RouteEvent = { type: "route"; stage: RouteStage; class: TaskClass; label: string; model: string; modelLabel: string; escalated: boolean; reason: string };

/** Errors that may be retried once on the primary model: refusals, provider HTTP errors and malformed
 * output. Spending controls (cancel, time, budget, overrun, paused or unavailable spending) never are. */
export function escalatableError(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "REFUSED") return "refusal";
  if (["CANCELLED", "HOLD_EXPIRED", "RUN_BUDGET", "OVERRUN", "PROVIDER_LIMIT", "PROVIDER_DISABLED", "SPEND_UNAVAILABLE", "UNPRICED_MODEL"].includes(String(code))) return null;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return `provider ${status}`;
  if (code === "UNSUPPORTED_AI_CONFIG") return "unsupported request on the routed model";
  if ((error as { name?: unknown } | null)?.name === "AbortError") return null;
  return error instanceof Error ? "incomplete output" : null;
}

export type RoutedRun<R> = {
  route: ModelRoute;
  stage: RouteStage;
  spend: RunSpend;
  /** Epoch ms the stage must end by (the attempt deadline is derived from it). */
  deadline: number;
  /** Single-pass stages give a routed attempt only ROUTED_TIME_SHARE of the time; multi-stage builds (new site,
   * redesign, continuation) keep the full time because their unfinished work is continued, not escalated. */
  singlePass: boolean;
  signal: AbortSignal;
  emit: (event: RouteEvent | { type: "status"; message: string }) => void;
  /** Runs the stage on `model`, ending by `deadline`. */
  attempt: (model: string, deadline: number) => Promise<R>;
  /** Why a completed attempt failed its gates (escalate), or null when it is acceptable. */
  failed: (result: R) => Promise<string | null> | string | null;
  /** Puts the working copy back to the state before the first attempt (and tells the client). */
  reset: () => void;
  now?: () => number;
};

/**
 * Runs one stage on its routed model; when that attempt fails its gates, is refused or hits a provider error,
 * resets the working copy and runs the stage once more on the primary model, inside the same RunSpend (so the
 * same operation, fence, hold and caps). At most one escalation per stage. The failed attempt's confirmed cost
 * is absorbed (never charged); it still counts against the run's provider and customer limits, so the shown
 * maximum stays an upper bound. A stage on the primary model runs exactly as before (one attempt, no caps).
 */
export async function runRouted<R>(run: RoutedRun<R>): Promise<{ result: R; record: RouteRecord }> {
  const now = run.now ?? Date.now;
  const { route, spend } = run;
  const record: RouteRecord = { class: route.class, models: [route.model], escalation: null, absorbedMicrousd: 0, attempts: [] };
  const announce = (model: string, escalated: boolean, reason: string) => run.emit({ type: "route", stage: run.stage, class: route.class, label: CLASS_LABELS[route.class], model, modelLabel: modelLabel(model), escalated, reason: reason.slice(0, 200) });
  const timed = async (model: string, escalated: boolean, deadline: number) => {
    const started = now(), before = spend.providerMicrousd;
    try {
      const result = await run.attempt(model, deadline);
      return { result, error: null as unknown, ms: now() - started, providerMicrousd: spend.providerMicrousd - before };
    } catch (error) {
      return { result: null as R | null, error, ms: now() - started, providerMicrousd: spend.providerMicrousd - before };
    }
  };
  announce(route.model, false, route.reason);
  if (!route.escalation) {
    const only = await timed(route.model, false, run.deadline);
    record.attempts.push({ model: route.model, escalated: false, outcome: only.error ? "error" : "ok", reason: null, providerMicrousd: only.providerMicrousd, ms: only.ms });
    if (only.error) throw Object.assign(only.error as object, { route: record });
    return { result: only.result as R, record };
  }

  const confirmedBefore = spend.confirmedMicrousd;
  const startedAt = now();
  const attemptDeadline = run.singlePass ? Math.min(run.deadline, startedAt + Math.floor((run.deadline - startedAt) * ROUTED_TIME_SHARE)) : run.deadline;
  spend.capAttempt(spend.providerMicrousd + spend.pendingMicrousd + Math.floor(spend.remainingMicrousd * ROUTED_BUDGET_SHARE));
  let first;
  try { first = await timed(route.model, false, attemptDeadline); } finally { spend.capAttempt(null); }
  let why: string | null = first.error ? escalatableError(first.error) : await run.failed(first.result as R);
  record.attempts.push({ model: route.model, escalated: false, outcome: first.error ? "error" : why ? "failed" : "ok", reason: why, providerMicrousd: first.providerMicrousd, ms: first.ms });
  if (!why) {
    if (first.error) throw Object.assign(first.error as object, { route: record });
    return { result: first.result as R, record };
  }
  // Escalate only when the primary model can still do the work: not stopped, enough time and budget left.
  const blocked = run.signal.aborted ? "cancelled" : spend.stopped ? `run ${spend.stopped.toLowerCase()}`
    : run.deadline - now() < MIN_ESCALATION_MS ? "too little time left" : spend.remainingMicrousd < spend.allowanceMicrousd * MIN_ESCALATION_SHARE ? "too little budget left" : null;
  if (blocked) {
    record.attempts[0].reason = `${why}; not escalated: ${blocked}`;
    why = null;
    if (first.error) throw Object.assign(first.error as object, { route: record });
    return { result: first.result as R, record };
  }
  const absorbed = Math.max(0, spend.confirmedMicrousd - confirmedBefore);
  spend.absorb(absorbed);
  record.absorbedMicrousd = absorbed;
  record.escalation = why;
  record.models.push(route.escalation);
  run.reset();
  run.emit({ type: "status", message: `Retrying this step with ${modelLabel(route.escalation)}…` });
  announce(route.escalation, true, `escalated: ${why}`);
  const second = await timed(route.escalation, true, run.deadline);
  record.attempts.push({ model: route.escalation, escalated: true, outcome: second.error ? "error" : "ok", reason: null, providerMicrousd: second.providerMicrousd, ms: second.ms });
  if (second.error) throw Object.assign(second.error as object, { route: record });
  return { result: second.result as R, record };
}

/** The durable and logged form of a route record (models, class, reasons and amounts; no prompt content). */
export function routeDetail(record: RouteRecord | null | undefined) {
  if (!record) return null;
  return { class: record.class, models: record.models, escalation: record.escalation ? record.escalation.slice(0, 120) : null, absorbedMicrousd: record.absorbedMicrousd,
    attempts: record.attempts.map(item => ({ model: item.model, outcome: item.outcome, reason: item.reason?.slice(0, 120) ?? null, providerMicrousd: item.providerMicrousd, ms: item.ms })) };
}

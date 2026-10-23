import type { EffortLevel } from "../routing/effort";
import { CAPABILITY_CONFIG_VERSION, capabilityIssue, textCapabilities } from "./prices";
import type { RunSpend } from "./run-spend";
import type { TaskContract } from "../builder/task-contract";
import { ACCEPTANCE_CONTRACT, DOCUMENT_STAGE_CHECKS, WEBSITE_STAGE_CHECKS, inLoop, failedIds, uncheckedIds, type CheckId, type CheckResult, type RequiredChecks } from "../builder/acceptance";
import { looksLikeCopyEdit, withoutQuoted } from "./copy-edit";

/**
 * Model routing for the builder's text stages (website build/edit/review, plan, book/deck): a versioned,
 * deterministic policy. No paid classifier call; no routing on prompt length, industry or a model's self-confidence.
 *
 * Modes (MAKEBORNE_MODEL_ROUTING):
 * - off (default): every stage runs exactly as before: the builder model (MAKEBORNE_BUILDER_MODEL, else
 *   claude-opus-5-5), one attempt, today's first-step rule. A decision is still computed and recorded.
 * - shadow: the same execution as off; the decision the policy would take in "on" is recorded alongside
 *   (durable operation detail and an ai_model_route log line). No extra paid call.
 * - on: the decision executes: model, first-step rule, budget and time allocation, at most one targeted repair and
 *   at most one evidence-justified escalation per operation (counts read back from the durable operation runs),
 *   then accept, preserve the valid work, or stop.
 *
 * A class routes below the builder model only with an explicit MAKEBORNE_ROUTE_<CLASS> override or a qualified default
 * in QUALIFIED_ROUTES (none: docs/release-review/model-routing-20261022.md), and only when the signals allow it: not for
 * high design demand (even with low code complexity), high functional complexity, security or business risk (even in a
 * short request), missing information, missing verification, prior failure evidence, a large context, or too little
 * budget or time. Models come from the capability registry in prices.ts: unknown, unpriced or unsupported combinations
 * are rejected before any reservation. Pure: no SDK, database or server-only imports.
 *
 * v3 adds the copy-edit class (replace, correct or remove existing content with values the customer names; its result
 * is checked without a model in ./copy-edit.ts), a per-class effort (MAKEBORNE_ROUTE_<CLASS>_EFFORT, lower only), an
 * escalation that runs at the requested effort, and model-specific guidance for the cheaper models. The research and the
 * candidate cells still to qualify are in docs/ai/MODEL_ORCHESTRATOR.md.
 */
export const ROUTING_POLICY_VERSION = "routing-policy-v3-20261023";
export const TASK_CLASSES = ["new-site", "redesign", "edit", "targeted-edit", "copy-edit", "continuation", "review", "plan", "document-new", "document-edit"] as const;
export type TaskClass = typeof TASK_CLASSES[number];
export type RouteStage = "build" | "continuation" | "review" | "plan" | "document";
export type RoutingMode = "off" | "shadow" | "on";
export type Intensity = "low" | "medium" | "high" | "xhigh" | "max";

export const CLASS_LABELS: Readonly<Record<TaskClass, string>> = Object.freeze({
  "new-site": "new website", redesign: "large redesign", edit: "edit", "targeted-edit": "targeted edit", "copy-edit": "copy edit", continuation: "continuation",
  review: "design review", plan: "plan", "document-new": "new document", "document-edit": "document edit",
});
/** Qualified route-down defaults when routing is on. Empty: no class qualified (see the record cited above). */
export const QUALIFIED_ROUTES: Readonly<Partial<Record<TaskClass, string>>> = Object.freeze({});
/** The cells the next qualification measures, per class: never executed unless set as overrides (MAKEBORNE_ROUTE_<CLASS>
 * and MAKEBORNE_ROUTE_<CLASS>_EFFORT) or moved into QUALIFIED_ROUTES after a passing record. */
export const CANDIDATE_CELLS: Readonly<Partial<Record<TaskClass, readonly { model: string; effort: Intensity }[]>>> = Object.freeze({
  "copy-edit": [{ model: "claude-haiku-5-5", effort: "medium" }, { model: "claude-haiku-5-5", effort: "low" }],
  "targeted-edit": [{ model: "claude-opus-5-5", effort: "low" }, { model: "claude-sonnet-5-5", effort: "medium" }],
  review: [{ model: "claude-opus-5-5", effort: "low" }],
  plan: [{ model: "claude-opus-5-5", effort: "low" }],
});
/** Classes whose unfinished work is saved and continued by the next stage (no repair; escalation only on a hard failure). */
export const MULTI_STAGE_CLASSES: ReadonlySet<string> = new Set(["new-site", "redesign", "continuation"]);

/* ---------- First-step rule (30b147f): the first step must produce a recoverable project within a bounded share ---------- */

export type FirstStepRule = { rule: string; effort: Intensity | "policy"; maxOutputTokens: number | null };
/** Today's rule: the steps that run while the project is empty use effort low (no extra output cap). */
export const FIRST_STEP_LOW: FirstStepRule = Object.freeze({ rule: "first-step-low-v1", effort: "low", maxOutputTokens: null });
/** The alternative under qualification: the requested intensity, with the first step capped to a bounded output share. */
export const FIRST_STEP_CAPPED: FirstStepRule = Object.freeze({ rule: "first-step-capped-v1", effort: "policy", maxOutputTokens: 24_000 });
/** The rule "on" uses unless MAKEBORNE_ROUTE_FIRST_STEP=low|capped says otherwise (decided from the measurement in the record). */
export const FIRST_STEP_ON: FirstStepRule = FIRST_STEP_LOW;

/* ---------- Allocation and limits ---------- */

/** A routed initial attempt may spend at most this share of the stage's allowance, a repair this much more; the rest stays for an escalation. */
export const ALLOCATION = Object.freeze({ routedInitialShare: 0.4, repairShare: 0.15, initialShareWithRepairOnly: 0.75, initialTimeShare: 0.5, repairTimeShare: 0.2 });
/** No escalation starts with less than this time left (it would be cut off) or this share of the allowance. */
export const MIN_ESCALATION_MS = 90_000;
export const MIN_ESCALATION_SHARE = 0.25;
/** At most one targeted repair and one escalation per operation. */
export const OPERATION_LIMITS = Object.freeze({ repairs: 1, escalations: 1 });

/* ---------- Signals ---------- */

export type PriorRoute = { repairs: number; escalations: number; signatures: string[]; interrupted: number };
export type RouteInput = {
  stage: RouteStage;
  artifact?: "website" | "book" | "deck";
  /** The customer's message for this stage (read for signals; never stored or logged). */
  request?: string;
  /** Editable files before the stage (0: a first build) and their total bytes. */
  files?: number;
  projectBytes?: number;
  emptyDocument?: boolean;
  effort: EffortLevel;
  attachments?: number;
  plan?: boolean;
  /** Which finish checks can run for this stage (missing verification blocks routing down and is never a pass). */
  verification?: { compile: boolean; contrast: boolean };
  /** Durable routing state of the operation's earlier runs (restarts and continuations). */
  previous?: PriorRoute | null;
  /** Parent job ids and the input revision the stage was admitted on. */
  operation?: { id: string | null; runId: string | null; revision: number | null };
  allowanceMicrousd?: number;
  deadlineMs?: number;
  /** The task contract (src/lib/builder/task-contract.ts): its scope and acceptance checks are inputs; its limits can only lower the policy's. */
  contract?: Pick<TaskContract, "version" | "acceptance" | "scope" | "checks" | "limits">;
};
export type RouteSignals = {
  artifact: "website" | "book" | "deck"; empty: boolean; files: number; contextTokens: number;
  affectedScope: "picked-element" | "named-part" | "unscoped" | "whole-project";
  functionalComplexity: "low" | "medium" | "high"; designDemand: "low" | "medium" | "high";
  risk: "low" | "high"; missingInformation: boolean; verificationAvailable: boolean;
  priorFailure: boolean; budgetLow: boolean; deadlineShort: boolean;
};

const TARGET_REFERENCE = /(?:^|[\s(])[\w./-]+\.(?:tsx|ts|css|html|json|svg|md) \(line \d+\)/;
const LARGE_CHANGE = /\b(?:re-?design|rebuild|start (?:over|again)|from scratch|over-?haul|revamp|re-?style|rewrite (?:the |my )?(?:whole|entire|site|website|page)|whole (?:site|website)|entire (?:site|website|page)|every (?:page|section)|all (?:the )?(?:pages|sections)|new (?:look|design|theme|layout|style|pages?)|add (?:a |an |two |three |some )?(?:new )?pages?|completely|multi-?page)\b/i;
const NAMED_PART = /\b(?:the|this|that|our|my) (?:[\w-]+ ){0,2}(?:button|heading|headline|title|link|footer|header|nav(?:igation)?|menu|section|card|cards|form|table|list|line|label|text|copy|paragraph|banner|strip|icon|logo|image|photo|price|prices|hours)\b/i;
const DESIGN_WORDS = /\b(?:design|look|looks|feel|style|styling|colou?rs?|palette|font|fonts|typography|type ?face|layout|spacing|whitespace|hero|visual|beautiful|elegant|modern|premium|brand|branding|logo|animation|animate|motion|theme|aesthetic|imagery|illustration|editorial|bolder|warmer|cooler|darker|lighter)\b/i;
const FUNCTION_WORDS = /\b(?:form|validation|validate|booking|book(?:ing)? system|reserv\w+|checkout|cart|basket|payment|pay|subscribe|login|log in|sign ?in|sign ?up|account|search|filter|sort|calculator|quiz|api|integration|webhook|database|dynamic|interactive|logic|state|toggle|tabs?|accordion|carousel|slider|map|calendar|countdown|dark mode|language switch|translation|multi-?language)\b/i;
const RISK_WORDS = /\b(?:password|passcode|credential|secret|token|api ?key|auth\w*|security|secure|privacy|gdpr|cookie consent|personal data|medical|health claim|diagnos\w+|legal|terms|contract|refund|invoice|bank|iban|card number|credit card|stripe|paypal|price|prices|pricing|fee|fees|discount|guarantee|insurance|tax|admin)\b/i;
const MISSING_WORDS = /\b(?:placeholder|tbd|to be confirmed|later|i(?:'| wi)ll send|not sure|don'?t know|unknown|fill in)\b/i;

/** The task class of one stage, by fixed rules (first match wins). Prompt length is not a rule. */
export function classifyStage(input: RouteInput): { class: TaskClass; codes: string[] } {
  if (input.stage === "review") return { class: "review", codes: ["STAGE_REVIEW"] };
  if (input.stage === "plan") return { class: "plan", codes: ["STAGE_PLAN"] };
  if (input.stage === "continuation") return { class: "continuation", codes: ["STAGE_CONTINUATION"] };
  if (input.stage === "document") return input.emptyDocument ? { class: "document-new", codes: ["DOCUMENT_EMPTY"] } : { class: "document-edit", codes: ["DOCUMENT_EXISTING"] };
  const request = input.request ?? "";
  if (!input.files) return { class: "new-site", codes: ["PROJECT_EMPTY"] };
  if (input.plan) return { class: "redesign", codes: ["APPROVED_PLAN"] };
  if (LARGE_CHANGE.test(request)) return { class: "redesign", codes: ["SCOPE_WHOLE_PROJECT"] };
  if (input.attachments) return { class: "edit", codes: ["ATTACHMENTS"] };
  // Named values to put in, take out or correct, with no design or behaviour change (the quoted words themselves don't count).
  if (looksLikeCopyEdit(request) && !DESIGN_WORDS.test(withoutQuoted(request)) && !FUNCTION_WORDS.test(withoutQuoted(request))) return { class: "copy-edit", codes: ["SCOPE_EXPLICIT_VALUES"] };
  if (TARGET_REFERENCE.test(request)) return { class: "targeted-edit", codes: ["SCOPE_PICKED_ELEMENT"] };
  if (NAMED_PART.test(request)) return { class: "targeted-edit", codes: ["SCOPE_NAMED_PART"] };
  return { class: "edit", codes: ["SCOPE_UNSCOPED"] };
}

/** Website stages run without the thinking progress notes on models that lack them (agent.ts); plans and documents need them. */
const needsUpdates = (stage: RouteStage) => stage === "plan" || stage === "document";

/** Price words are content in a copy edit (the new amount is checked exactly), not a business-risk change of logic. */
const PRICE_WORDS = /\b(?:price|prices|pricing|fee|fees|discount)\b/gi;

export function routeSignals(input: RouteInput, taskClass: TaskClass): RouteSignals {
  // A copy edit is judged by what it asks for, not by the words it wants on the page.
  const request = taskClass === "copy-edit" ? withoutQuoted(input.request ?? "") : input.request ?? "", files = input.files ?? 0;
  const artifact = input.artifact ?? (input.stage === "document" ? "book" : "website");
  const design = ["new-site", "redesign", "review", "document-new"].includes(taskClass) || DESIGN_WORDS.test(request) || Boolean(input.attachments) ? "high" : taskClass === "edit" || taskClass === "document-edit" ? "medium" : "low";
  const functional = FUNCTION_WORDS.test(request) || input.plan ? "high" : taskClass === "edit" || taskClass === "new-site" || taskClass === "redesign" ? "medium" : "low";
  const verificationAvailable = artifact !== "website" || input.stage === "plan" || Boolean(input.verification?.compile && input.verification?.contrast);
  const previous = input.previous;
  return {
    artifact, empty: artifact === "website" ? files === 0 : Boolean(input.emptyDocument), files,
    contextTokens: Math.ceil((input.projectBytes ?? 0) / 3.5) + Math.ceil(request.length / 3.5),
    affectedScope: taskClass === "redesign" || taskClass === "new-site" ? "whole-project" : input.contract?.scope.kind === "element" || TARGET_REFERENCE.test(request) ? "picked-element"
      : input.contract?.scope.kind === "files" || NAMED_PART.test(request) ? "named-part" : "unscoped",
    functionalComplexity: functional, designDemand: design, risk: RISK_WORDS.test(taskClass === "copy-edit" ? request.replace(PRICE_WORDS, " ") : request) ? "high" : "low", missingInformation: MISSING_WORDS.test(request),
    verificationAvailable, priorFailure: Boolean(previous && (previous.escalations > 0 || previous.signatures.length > 0 || previous.interrupted > 0)),
    budgetLow: input.allowanceMicrousd !== undefined && input.allowanceMicrousd < 300_000, deadlineShort: input.deadlineMs !== undefined && input.deadlineMs < 150_000,
  };
}

/* ---------- Decision ---------- */

export type RoutingDecision = {
  policyVersion: typeof ROUTING_POLICY_VERSION; capabilityConfigVersion: string; mode: RoutingMode;
  parent: { operationId: string | null; runId: string | null; stage: RouteStage }; inputRevision: number | null;
  taskRole: "website-builder" | "document-builder" | "planner";
  class: TaskClass; reasonCodes: string[]; signals: RouteSignals;
  /** The model and intensity the stage executes with first. */
  model: string; effort: Intensity; firstStep: FirstStepRule;
  /** Models the capability registry accepts for this stage. */
  eligibleModels: string[];
  tools: { files: boolean; images: boolean; concept: boolean; webSearch: false };
  context: { selection: "project-snapshot" | "document-snapshot" | "brief-and-project"; files: number; estimatedTokens: number };
  /** The acceptance checks this stage is held to (the task contract's when given), and the subset the builder loop can establish:
   * the state machine accepts on that subset; the rest are recorded as deferred to the site verifier, never as passed. */
  requiredChecks: RequiredChecks; inLoopChecks: CheckId[]; deferredChecks: string[];
  allocation: { initialShare: number; repairShare: number; initialTimeShare: number; repairTimeShare: number };
  limits: { repairs: number; escalations: number };
  /** The model a failed attempt escalates to, once (null: none), and the effort it runs at (the requested one). */
  escalation: string | null;
  escalationEffort: Intensity;
  fallback: "preserve-valid-work" | "stop";
  /** In shadow mode: what "on" would execute. */
  shadow: { model: string; escalation: string | null; firstStep: string; reasonCodes: string[] } | null;
  /** Kept for readers of the first version: deterministic explanation (codes only). */
  reason: string;
  routing: RoutingMode;
};
/** Earlier name of the decision type. */
export type ModelRoute = RoutingDecision;

const INTENSITY: Readonly<Record<EffortLevel, Intensity>> = Object.freeze({ light: "low", medium: "medium", high: "high", super_high: "xhigh", ultra: "max" });
const INTENSITY_RANK: Readonly<Record<Intensity, number>> = Object.freeze({ low: 0, medium: 1, high: 2, xhigh: 3, max: 4 });
const envName = (taskClass: TaskClass) => `MAKEBORNE_ROUTE_${taskClass.toUpperCase().replace(/-/g, "_")}`;
const warned = new Set<string>();
function warnOnce(message: string) { if (!warned.has(message)) { warned.add(message); console.error(message); } }

/** The builder model (routing off, shadow, and the escalation target when on). */
export const primaryModel = (env: Record<string, string | undefined> = process.env) => env.MAKEBORNE_BUILDER_MODEL || "claude-opus-5-5";
export function routingMode(env: Record<string, string | undefined> = process.env): RoutingMode {
  const raw = (env.MAKEBORNE_MODEL_ROUTING ?? "").trim().toLowerCase();
  if (raw === "on" || raw === "shadow") return raw;
  if (raw && raw !== "off") warnOnce(`Ignoring MAKEBORNE_MODEL_ROUTING "${raw}": use off, shadow or on. Routing stays off.`);
  return "off";
}
/** Earlier boolean accessor: true only in "on". */
export const routingEnabled = (env: Record<string, string | undefined> = process.env) => routingMode(env) === "on";

/** The "on" plan for a stage (also what shadow records). */
function onPlan(input: RouteInput, taskClass: TaskClass, signals: RouteSignals, effort: Intensity, env: Record<string, string | undefined>) {
  const primary = primaryModel(env), codes: string[] = [];
  const override = env[envName(taskClass)]?.trim();
  let model = override || QUALIFIED_ROUTES[taskClass] || primary;
  if (model !== primary) {
    codes.push(override ? "OVERRIDE" : "QUALIFIED_ROUTE");
    const issue = capabilityIssue(model, { effort, vision: Boolean(input.attachments) || input.stage === "review", taskClass, requireQualified: !override, thinkingDisplayUpdates: needsUpdates(input.stage) });
    const blocks = [
      issue ? `CAPABILITY_REJECTED` : null,
      signals.designDemand === "high" ? "DESIGN_DEMAND_HIGH" : null, signals.functionalComplexity === "high" ? "FUNCTIONAL_COMPLEXITY_HIGH" : null,
      signals.risk === "high" ? "RISK_HIGH" : null, signals.missingInformation ? "MISSING_INFORMATION" : null,
      signals.verificationAvailable ? null : "VERIFICATION_MISSING", signals.priorFailure ? "PRIOR_FAILURE" : null,
      signals.contextTokens > 200_000 ? "CONTEXT_LARGE" : null, input.effort === "super_high" || input.effort === "ultra" ? "EFFORT_DEEP" : null, signals.budgetLow ? "BUDGET_LOW" : null, signals.deadlineShort ? "DEADLINE_SHORT" : null,
    ].filter((code): code is string => Boolean(code));
    if (issue) warnOnce(`Not routing ${taskClass} to "${model}": ${issue}.`);
    if (blocks.length) { codes.push(...blocks, "KEPT_ON_BUILDER_MODEL"); model = primary; } else codes.push("ROUTED_DOWN");
  } else codes.push(taskClass in QUALIFIED_ROUTES ? "QUALIFIED_ON_BUILDER_MODEL" : "NOT_QUALIFIED_FOR_ROUTING");
  const previous = input.previous ?? { repairs: 0, escalations: 0, signatures: [], interrupted: 0 };
  const singlePass = !MULTI_STAGE_CLASSES.has(taskClass) && taskClass !== "plan";
  // The task contract's limits can lower the policy's, never raise them.
  const limit = { repairs: Math.min(OPERATION_LIMITS.repairs, input.contract?.limits.repairs ?? OPERATION_LIMITS.repairs), escalations: Math.min(OPERATION_LIMITS.escalations, input.contract?.limits.escalations ?? OPERATION_LIMITS.escalations) };
  if (limit.repairs < OPERATION_LIMITS.repairs || limit.escalations < OPERATION_LIMITS.escalations) codes.push("CONTRACT_LIMITS_LOWER");
  // A class may run below the requested effort (MAKEBORNE_ROUTE_<CLASS>_EFFORT), never above it.
  const asked = env[`${envName(taskClass)}_EFFORT`]?.trim().toLowerCase();
  let cellEffort = effort;
  if (asked && asked in INTENSITY_RANK && INTENSITY_RANK[asked as Intensity] < INTENSITY_RANK[effort] && !capabilityIssue(model, { effort: asked as Intensity, thinkingDisplayUpdates: needsUpdates(input.stage) })) { cellEffort = asked as Intensity; codes.push(`EFFORT_${asked.toUpperCase()}`); }
  else if (asked && !(asked in INTENSITY_RANK)) warnOnce(`Ignoring ${envName(taskClass)}_EFFORT "${asked}": use low, medium or high.`);
  // A cheaper cell (another model, or the builder model at a lower effort) escalates once to the builder model at the
  // requested effort: "run low, re-run the failures at the requested level".
  const cheaper = model !== primary || cellEffort !== effort;
  let repairs = singlePass ? Math.max(0, limit.repairs - previous.repairs) : 0;
  let escalations = cheaper ? Math.max(0, limit.escalations - previous.escalations) : 0;
  if (previous.interrupted > 0) { escalations = 0; repairs = 0; codes.push("PRIOR_INTERRUPTED_NO_RETRY"); }
  if (previous.repairs >= OPERATION_LIMITS.repairs) codes.push("REPAIR_USED");
  if (previous.escalations >= OPERATION_LIMITS.escalations) codes.push("ESCALATION_USED");
  const fromEnv = (env.MAKEBORNE_ROUTE_FIRST_STEP ?? "").trim().toLowerCase();
  const firstStep = fromEnv === "capped" ? FIRST_STEP_CAPPED : fromEnv === "low" ? FIRST_STEP_LOW : FIRST_STEP_ON;
  if (signals.empty && input.stage === "build") codes.push(`FIRST_STEP_${firstStep.rule.toUpperCase().replace(/-/g, "_")}`);
  return { model, effort: cellEffort, cheaper, escalation: escalations > 0 ? primary : null, repairs, escalations, firstStep, codes };
}

/** Model-specific instructions for an attempt, added to its request context (the system prompt stays identical, so it caches).
 * From Anthropic's Claude Haiku 5.5 guidance: in long agent prompts at low or medium effort it may stop early or call work
 * done without checking it. */
export function attemptGuidance(route: Pick<RoutingDecision, "class">, model: string): string {
  if (!model.startsWith("claude-haiku-")) return "";
  const copy = route.class === "copy-edit" ? " This is a copy edit: change only the text, numbers or links the request names, everywhere they appear (including tel: and mailto: links), and nothing else: no new elements, no styling, no rewording of other text." : "";
  return `\n\nKeep working until everything the request asks for is done, then call finish. Before finish, re-read each file you changed and confirm the requested text is there exactly as asked.${copy}`;
}

function checksFor(input: RouteInput, document: boolean, deck: boolean) {
  const fallback: readonly CheckId[] = input.stage === "plan" ? [] : document ? DOCUMENT_STAGE_CHECKS[deck ? "deck" : "book"] : WEBSITE_STAGE_CHECKS;
  const ids = input.contract?.checks ?? [...fallback];
  const loop = input.contract ? inLoop(ids) : [...fallback];
  return { requiredChecks: { contract: ACCEPTANCE_CONTRACT, ids: ids as CheckId[] } as RequiredChecks, inLoopChecks: loop.length || !input.contract ? loop : [...fallback], deferredChecks: ids.filter(id => !loop.includes(id as CheckId)) };
}

/** Routes one stage: a full, recorded decision. Off (default) and shadow execute today's behaviour exactly. */
export function routeStage(input: RouteInput, env: Record<string, string | undefined> = process.env): RoutingDecision {
  const mode = routingMode(env), primary = primaryModel(env);
  const { class: taskClass, codes: classCodes } = classifyStage(input);
  const signals = routeSignals(input, taskClass);
  const effort = INTENSITY[input.effort] ?? "medium";
  const plan = onPlan(input, taskClass, signals, effort, env);
  const executes = mode === "on";
  const model = executes ? plan.model : primary;
  const stageEffort = executes ? plan.effort : effort;
  const eligibleModels = [...new Set([primary, ...Object.values(QUALIFIED_ROUTES), env[envName(taskClass)]?.trim()].filter((item): item is string => Boolean(item)))]
    .filter(candidate => capabilityIssue(candidate, { effort, vision: Boolean(input.attachments) || input.stage === "review", thinkingDisplayUpdates: needsUpdates(input.stage) }) === null);
  const reasonCodes = [`MODE_${mode.toUpperCase()}`, ...classCodes, ...(executes ? plan.codes : [])];
  // A cheaper cell keeps the rest of the allowance for its escalation, whether it is another model or a lower effort.
  const routed = executes && plan.cheaper;
  const singlePass = !MULTI_STAGE_CLASSES.has(taskClass);
  const document = input.stage === "document", deck = input.artifact === "deck";
  return {
    policyVersion: ROUTING_POLICY_VERSION, capabilityConfigVersion: CAPABILITY_CONFIG_VERSION, mode,
    parent: { operationId: input.operation?.id ?? null, runId: input.operation?.runId ?? null, stage: input.stage }, inputRevision: input.operation?.revision ?? null,
    taskRole: input.stage === "plan" ? "planner" : document ? "document-builder" : "website-builder",
    class: taskClass, reasonCodes, signals, model, effort: stageEffort,
    firstStep: executes ? plan.firstStep : FIRST_STEP_LOW, eligibleModels,
    tools: { files: input.stage !== "plan", images: input.stage !== "plan" && input.stage !== "review", concept: taskClass === "new-site", webSearch: false },
    context: { selection: document ? "document-snapshot" : input.stage === "plan" ? "brief-and-project" : "project-snapshot", files: signals.files, estimatedTokens: signals.contextTokens },
    ...checksFor(input, document, deck),
    allocation: executes ? {
      initialShare: routed ? ALLOCATION.routedInitialShare : plan.repairs ? ALLOCATION.initialShareWithRepairOnly : 1,
      repairShare: plan.repairs ? ALLOCATION.repairShare : 0,
      initialTimeShare: (routed || plan.repairs) && singlePass ? ALLOCATION.initialTimeShare : 1, repairTimeShare: plan.repairs ? ALLOCATION.repairTimeShare : 0,
    } : { initialShare: 1, repairShare: 0, initialTimeShare: 1, repairTimeShare: 0 },
    limits: executes ? { repairs: plan.repairs, escalations: plan.escalations } : { repairs: 0, escalations: 0 },
    escalation: executes ? plan.escalation : null, escalationEffort: effort,
    fallback: "preserve-valid-work",
    shadow: mode === "shadow" ? { model: plan.model, escalation: plan.escalation, firstStep: plan.firstStep.rule, reasonCodes: plan.codes } : null,
    reason: reasonCodes.join(" "), routing: mode,
  };
}

/** Every model a decision may call (the executed model and its escalation), for fail-closed price and capability checks. */
export const routeModels = (route: RoutingDecision) => [route.model, ...(route.escalation ? [route.escalation] : [])];
/** Null when every model the decision may call is priced and supports the stage; otherwise why not. */
export function routeIssue(route: RoutingDecision): string | null {
  for (const model of routeModels(route)) {
    try { textCapabilities(model); } catch (error) { return (error as Error).message; }
    const issue = capabilityIssue(model, { effort: route.effort, vision: route.parent.stage === "review", thinkingDisplayUpdates: needsUpdates(route.parent.stage) });
    if (issue) return issue;
  }
  return null;
}

/* ---------- Durable state ---------- */

/** Compact, content-free record of one stage's routing (durable operation detail and logs). */
export type RouteRecord = {
  v: typeof ROUTING_POLICY_VERSION; mode: RoutingMode; class: TaskClass; codes: string[];
  models: string[]; attempts: RouteAttempt[]; outcome: "accept" | "continue" | "preserve" | "stop";
  repairs: number; escalations: number; escalation: string | null; absorbedMicrousd: number;
  checks: { contract: typeof ACCEPTANCE_CONTRACT; failed: string[]; notChecked: string[]; deferred: string[] };
  shadow: { model: string; escalation: string | null; firstStep: string } | null;
};
export type AttemptRole = "initial" | "repair" | "escalation";
export type FailureKind = "accept" | "continue" | "quality" | "incomplete" | "refusal" | "model-output" | "unverified" | "infrastructure" | "credential" | "deterministic" | "spend-stop" | "cancelled";
export type RouteAttempt = { role: AttemptRole; model: string; kind: FailureKind; signature: string | null; providerMicrousd: number; ms: number };
/** The event the client sees: task class and attempt role only (no model or provider names in customer UI). */
export type RouteEvent = { type: "route"; stage: RouteStage; class: TaskClass; label: string; role: AttemptRole; escalated: boolean };

/** Reads the operation's earlier runs (makeborne_ai_operation_read `runs`) into the counts this policy enforces. */
export function priorRoute(runs: unknown): PriorRoute {
  const out: PriorRoute = { repairs: 0, escalations: 0, signatures: [], interrupted: 0 };
  for (const run of Array.isArray(runs) ? runs : []) {
    const item = run as { status?: unknown; result?: { route?: unknown } | null } | null;
    const route = item?.result?.route as Partial<RouteRecord> | undefined;
    if (!item?.result && item?.status !== "finished") { out.interrupted++; continue; }
    if (!route || typeof route !== "object") continue;
    out.repairs += Number.isSafeInteger(route.repairs) ? route.repairs! : 0;
    out.escalations += Number.isSafeInteger(route.escalations) ? route.escalations! : 0;
    for (const attempt of Array.isArray(route.attempts) ? route.attempts : []) if (typeof attempt?.signature === "string" && attempt.kind !== "accept" && attempt.kind !== "continue") out.signatures.push(attempt.signature);
  }
  return out;
}

/** Normalized diagnostics: the same failure in other words, numbers or quotes gives the same signature. */
export function failureSignature(problems: readonly string[]): string | null {
  const lines = [...new Set(problems.map(problem => problem.toLowerCase().replace(/"[^"]*"|“[^”]*”|'[^']*'/g, "\"…\"").replace(/\d+(?:\.\d+)?/g, "#").replace(/\s+/g, " ").trim()).filter(Boolean))].sort();
  if (!lines.length) return null;
  let hash = 0x811c9dc5;
  for (const char of lines.join("\n")) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, "0");
}

/** Failure class of a thrown error. Only refusals and malformed model output may escalate; infrastructure never does. */
export function errorKind(error: unknown): FailureKind {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  if (code === "REFUSED") return "refusal";
  if (code === "CANCELLED" || (error as { name?: unknown } | null)?.name === "AbortError") return "cancelled";
  if (["HOLD_EXPIRED", "RUN_BUDGET", "OVERRUN", "PROVIDER_LIMIT", "PROVIDER_DISABLED", "SPEND_UNAVAILABLE"].includes(code)) return "spend-stop";
  if (code === "UNSUPPORTED_AI_CONFIG" || code === "UNPRICED_MODEL") return "deterministic";
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403) return "credential";
  if (typeof status === "number" || /timeout|network|ECONN|fetch failed|socket/i.test(String((error as Error)?.message))) return "infrastructure";
  return error instanceof Error ? "model-output" : "infrastructure";
}
const REPAIRABLE: ReadonlySet<FailureKind> = new Set(["quality", "incomplete"]);
/** Classes whose repeated finding comes from a check on the cheap attempt (the copy check), which the builder model's escalation
 * is not held to: a repeat there means the cheap model can't do it, so it escalates instead of stopping. */
const ESCALATE_ON_REPEAT: ReadonlySet<TaskClass> = new Set(["copy-edit"]);
const ESCALATABLE: ReadonlySet<FailureKind> = new Set(["quality", "incomplete", "refusal", "model-output"]);

export type Evaluation = { kind: FailureKind; checks: CheckResult[]; problems: string[] };
export type RoutedRun<R> = {
  route: RoutingDecision;
  stage: RouteStage;
  spend: RunSpend;
  /** Epoch ms the stage must end by. */
  deadline: number;
  signal: AbortSignal;
  emit: (event: RouteEvent | { type: "status"; message: string }) => void;
  /** Runs one attempt: the initial one, a targeted repair from the current state (with the evidence to fix), or the
   * escalation from the stage's starting state. Every attempt starts a new conversation, so no provider-specific thinking
   * block is ever replayed to another model. */
  attempt: (plan: { role: AttemptRole; model: string; deadline: number; repairNotes: string[]; effort: Intensity }) => Promise<R>;
  /** What the attempt established against the decision's required checks. */
  evaluate: (result: R) => Promise<Evaluation> | Evaluation;
  /** Puts the working copy back to the state before the first attempt (and tells the client). */
  reset: () => void;
  now?: () => number;
};

/**
 * Executes a decision as a bounded state machine: initial attempt -> at most one targeted repair (same model, from the
 * current state, only for repairable quality evidence) -> at most one evidence-justified escalation (builder model, from
 * the starting state) -> accept, preserve the valid work, or stop. Infrastructure, credential, renderer (verification
 * unavailable), deterministic and spending failures never escalate; a repair that repeats the same normalized diagnostics
 * stops the loop. Repair and escalation counts are per operation (the decision's limits already subtract earlier runs).
 * The routed attempts' confirmed cost is absorbed (never charged) when an escalation replaces them, and every attempt stays
 * inside the stage's RunSpend, so the maximum shown before the run remains an upper bound. Off and shadow: one attempt,
 * exactly as before.
 */
export async function runRouted<R>(run: RoutedRun<R>): Promise<{ result: R; record: RouteRecord }> {
  const now = run.now ?? Date.now;
  const { route, spend } = run;
  const record: RouteRecord = { v: ROUTING_POLICY_VERSION, mode: route.mode, class: route.class, codes: route.reasonCodes.slice(0, 16), models: [], attempts: [], outcome: "accept",
    repairs: 0, escalations: 0, escalation: null, absorbedMicrousd: 0, checks: { contract: ACCEPTANCE_CONTRACT, failed: [], notChecked: [], deferred: route.deferredChecks.slice(0, 16) },
    shadow: route.shadow ? { model: route.shadow.model, escalation: route.shadow.escalation, firstStep: route.shadow.firstStep } : null };
  const start = now(), span = Math.max(0, run.deadline - start);
  const announce = (role: AttemptRole) => run.emit({ type: "route", stage: run.stage, class: route.class, label: CLASS_LABELS[route.class], role, escalated: role === "escalation" });
  const once = async (role: AttemptRole, model: string, deadline: number, repairNotes: string[], capShare: number | null) => {
    announce(role);
    record.models.push(model);
    const before = spend.providerMicrousd, started = now(), callsBefore = spend.calls.length;
    // A share of the stage's whole allowance (never more than is left), so a later escalation keeps the rest.
    if (capShare !== null) spend.capAttempt(spend.providerMicrousd + spend.pendingMicrousd + Math.min(spend.remainingMicrousd, Math.floor(spend.runAllowanceMicrousd * capShare)));
    let result: R | null = null, error: unknown = null;
    try { result = await run.attempt({ role, model, deadline, repairNotes, effort: role === "escalation" ? route.escalationEffort ?? route.effort : route.effort }); } catch (caught) { error = caught; } finally { spend.capAttempt(null); }
    let evaluation: Evaluation = error ? { kind: errorKind(error), checks: [], problems: [] } : await run.evaluate(result as R);
    // An attempt that ended unaccepted after provider calls whose usage is unknown (transport or server failures, at their
    // bound) failed on infrastructure, even when the builder only saw its budget run out: never repaired or escalated.
    if (!error && evaluation.kind !== "accept" && evaluation.kind !== "continue" && spend.calls.slice(callsBefore).some(call => call.actualMicrousd === null)) evaluation = { ...evaluation, kind: "infrastructure" };
    const signature = evaluation.kind === "accept" || evaluation.kind === "continue" ? null : failureSignature(evaluation.problems.length ? evaluation.problems : [evaluation.kind]);
    record.attempts.push({ role, model, kind: evaluation.kind, signature, providerMicrousd: spend.providerMicrousd - before, ms: now() - started });
    record.checks = { contract: ACCEPTANCE_CONTRACT, failed: failedIds(evaluation.checks), notChecked: uncheckedIds(evaluation.checks), deferred: route.deferredChecks.slice(0, 16) };
    return { result, error, evaluation, signature };
  };
  const finish = (attempt: { result: R | null; error: unknown }, outcome: RouteRecord["outcome"]) => {
    record.outcome = outcome;
    if (attempt.error) throw Object.assign(attempt.error as object, { route: record });
    return { result: attempt.result as R, record };
  };

  // Off and shadow (and an "on" decision with nothing after the first attempt): exactly one attempt, no caps.
  const more = route.limits.repairs > 0 || route.limits.escalations > 0;
  const confirmedBefore = spend.confirmedMicrousd;
  let last = await once("initial", route.model, more ? Math.min(run.deadline, start + Math.floor(span * route.allocation.initialTimeShare)) : run.deadline, [], more && route.allocation.initialShare < 1 ? route.allocation.initialShare : null);
  if (!more || last.evaluation.kind === "accept" || last.evaluation.kind === "continue") return finish(last, last.evaluation.kind === "continue" ? "continue" : last.evaluation.kind === "accept" ? "accept" : "preserve");
  const stopped = () => run.signal.aborted ? "cancelled" : spend.stopped ? `run ${spend.stopped.toLowerCase()}` : null;

  // One targeted repair: same model, current state, only for quality evidence it can act on.
  if (route.limits.repairs > 0 && REPAIRABLE.has(last.evaluation.kind) && !stopped() && run.deadline - now() > MIN_ESCALATION_MS / 2) {
    const firstSignature = last.signature;
    record.repairs++;
    run.emit({ type: "status", message: "Fixing what did not pass the checks…" });
    last = await once("repair", route.model, Math.min(run.deadline, now() + Math.floor(span * route.allocation.repairTimeShare) + 30_000), last.evaluation.problems.slice(0, 12),
      route.escalation ? route.allocation.repairShare : null);
    if (last.evaluation.kind === "accept") return finish(last, "accept");
    // The same normalized diagnostics after a repair: the loop is not progressing (often a deterministic finding) — stop.
    // An attempt that only ran out of room twice has no diagnostics to repeat and may still escalate.
    if (last.signature && last.signature === firstSignature && last.evaluation.problems.length) {
      record.codes.push("REPEATED_IDENTICAL_FAILURE");
      if (!ESCALATE_ON_REPEAT.has(route.class)) return finish(last, "stop");
    }
  }
  // One escalation, only on evidence the builder model can change, and only with room to finish.
  const blocked = stopped() ?? (run.deadline - now() < MIN_ESCALATION_MS ? "too little time left" : spend.remainingMicrousd < spend.allowanceMicrousd * MIN_ESCALATION_SHARE ? "too little budget left" : null);
  if (!route.escalation || route.limits.escalations < 1 || !ESCALATABLE.has(last.evaluation.kind) || blocked) {
    if (blocked) record.codes.push(`NOT_ESCALATED_${blocked.toUpperCase().replace(/\W+/g, "_")}`);
    else if (route.escalation && !ESCALATABLE.has(last.evaluation.kind)) record.codes.push(`NOT_ESCALATED_${last.evaluation.kind.toUpperCase().replace(/\W+/g, "_")}`);
    return finish(last, ["spend-stop", "cancelled", "credential", "deterministic"].includes(last.evaluation.kind) ? "stop" : "preserve");
  }
  const absorbed = Math.max(0, spend.confirmedMicrousd - confirmedBefore);
  spend.absorb(absorbed);
  record.absorbedMicrousd = absorbed;
  record.escalation = last.evaluation.kind;
  record.escalations++;
  run.reset();
  run.emit({ type: "status", message: "Retrying this step…" });
  last = await once("escalation", route.escalation, run.deadline, [], null);
  return finish(last, last.evaluation.kind === "accept" ? "accept" : last.evaluation.kind === "continue" ? "continue" : ["spend-stop", "cancelled"].includes(last.evaluation.kind) ? "stop" : "preserve");
}

/** The durable and logged form of a route record (already compact and content-free). */
export function routeDetail(record: RouteRecord | null | undefined) {
  if (!record) return null;
  return { ...record, codes: record.codes.slice(0, 20).map(code => code.slice(0, 60)), escalation: record.escalation?.slice(0, 40) ?? null };
}

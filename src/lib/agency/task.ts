import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalSourceJson } from "../projects/canonical-json";
import { textPrice } from "../ai/prices";
import { RequestError } from "../server/http";
import { AGENCY_OPERATION_KINDS } from "../builder/operation-contract";
import type { AgencyInput, AgencyScope } from "../builder/operation-server";
import { sourcesContext, sourcesFingerprint, type OperationSources } from "../builder/operation-sources";
import type { EffortLevel } from "../routing/effort";

/**
 * The common execution contract for agency tasks: one typed envelope per user
 * action, executed on the EXISTING durable operation (ai_operations), its
 * fenced runs, credit holds and provider gate. Nothing here makes a call.
 *
 * Trust boundary: the browser sends only the artifact, the inputs it chose
 * (with the digests it saw), an objective, tool names, a settings profile and
 * a credit ceiling. Workspace, client, project and actor are derived on the
 * server (actor from the authenticated session, the rest from the artifact in
 * SQL); a request that carries them is refused as malformed.
 */
export const AGENCY_KINDS = AGENCY_OPERATION_KINDS;
export type AgencyKind = (typeof AGENCY_KINDS)[number];

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const AgencyInputRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("source"), id: uuid, sha256 }).strict(),
  z.object({ kind: z.literal("asset"), id: uuid, sha256 }).strict(),
  z.object({ kind: z.literal("artifact_version"), id: uuid, version: z.number().int().positive(), sha256: sha256.optional() }).strict(),
]);
export type AgencyInputRef = z.infer<typeof AgencyInputRefSchema>;

export const AgencyTaskRequestSchema = z.object({
  artifactId: uuid,
  /** One explicit user action; a new stepKey on the same action continues it. */
  actionKey: uuid, stepKey: uuid,
  kind: z.enum(AGENCY_KINDS),
  objective: z.string().trim().min(1).max(4000),
  inputs: z.array(AgencyInputRefSchema).max(50),
  permittedTools: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,47}$/)).max(16),
  /** A customer-facing settings profile; the model behind it is server-side only. */
  settings: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/),
  ceilingCredits: z.number().int().min(1).max(240),
  expectedRevision: z.number().int().nonnegative(),
}).strict();
export type AgencyTaskRequest = z.infer<typeof AgencyTaskRequestSchema>;

/**
 * Qualified model settings. A profile is usable for a kind only after a live
 * qualification run recorded its evidence; every other kind is refused: fail closed.
 * PROPOSED after the paid qualification of 24 Oct 2026 (scope agency-qualification-20261024,
 * docs/release-review/agency-qualification-20261024.md); the flags remain off and set nowhere.
 * independent_review and ingest stay unqualified.
 */
export type QualifiedSetting = Readonly<{
  profile: string; model: string; effort: EffortLevel; intensity: "low" | "medium" | "high";
  maxOutputTokens: number; maxTurns: number; qualifiedKinds: readonly AgencyKind[]; evidence: string;
}>;
export const AGENCY_SETTINGS: readonly QualifiedSetting[] = Object.freeze([
  Object.freeze({ profile: "standard", model: "claude-opus-5-5", effort: "medium" as const, intensity: "medium" as const, maxOutputTokens: 8000, maxTurns: 3,
    qualifiedKinds: Object.freeze(["research", "data_report", "image_edit"]) as readonly AgencyKind[],
    evidence: "Proposed after the paid qualification of 2026-10-24 (scope agency-qualification-20261024): research 12/12 briefs, 174/174 facts grounded, replay and Stop checked; data_report 20/20 first-turn narratives at 31b1b3d (3/20 before it); image_edit 3/3 end-to-end edits inside the measured bound. independent_review NOT qualified (grounding bugs, book capture). Flags remain off." }),
]);

/** Per-kind policy: tools a task of this kind may be granted, its credit ceiling, whether specialists may be used and
 * whether the step is given the client's approved knowledge (retrieved, bounded and snapshotted with the operation). */
export type KindPolicy = Readonly<{ tools: readonly string[]; maxCredits: number; specialists: boolean; knowledge: boolean }>;
export const AGENCY_KIND_POLICY: Readonly<Record<AgencyKind, KindPolicy>> = Object.freeze({
  ingest: Object.freeze({ tools: Object.freeze(["read_input"]), maxCredits: 40, specialists: false, knowledge: false }),
  research: Object.freeze({ tools: Object.freeze(["read_input"]), maxCredits: 80, specialists: true, knowledge: true }),
  image_edit: Object.freeze({ tools: Object.freeze(["read_input"]), maxCredits: 60, specialists: false, knowledge: false }),
  independent_review: Object.freeze({ tools: Object.freeze(["read_input"]), maxCredits: 60, specialists: true, knowledge: true }),
  data_report: Object.freeze({ tools: Object.freeze(["read_input"]), maxCredits: 80, specialists: true, knowledge: true }),
});

export type AgencyTask = Readonly<{
  actorId: string; workspaceId: string; clientId: string | null; projectId: string; artifactId: string;
  kind: AgencyKind; objective: string; inputs: readonly AgencyInput[]; permittedTools: readonly string[];
  settings: QualifiedSetting; ceilings: Readonly<{ customerCredits: number; providerMicrousd: number }>;
  expectedRevision: number; actionKey: string; stepKey: string;
  /** "minor" tasks never get specialists: no research/review committee for a small edit. */
  scale: "minor" | "standard";
  /** Files read through ingestion (and any the person chose to continue without), bound into the operation's context and digest. */
  sources?: OperationSources;
}>;

export class AgencyError extends RequestError {}
const refuse = (code: string, message: string, status = 400) => new AgencyError(code, message, status);

export type ResolveDeps = {
  /** SQL-backed scope resolution (resolveAgencyScope in production). */
  scope: (actor: string, artifactId: string, inputs: AgencyInputRef[]) => Promise<AgencyScope>;
  settings?: readonly QualifiedSetting[];
  rateMicrousd: number;
};

export function taskScale(objective: string, inputs: readonly unknown[]): "minor" | "standard" {
  return objective.length <= 280 && inputs.length <= 1 ? "minor" : "standard";
}

/** Server-side envelope from an authenticated actor and an untrusted body. Nothing is reserved here. */
export async function resolveAgencyTask(actor: string, body: unknown, deps: ResolveDeps): Promise<AgencyTask> {
  if (!uuid.safeParse(actor).success) throw refuse("AGENCY_UNAUTHENTICATED", "Sign in to start this task.", 401);
  const parsed = AgencyTaskRequestSchema.safeParse(body);
  if (!parsed.success) throw refuse("AGENCY_TASK_INVALID", "This task request is incomplete or has fields it may not set.");
  const request = parsed.data;
  const policy = AGENCY_KIND_POLICY[request.kind];
  const setting = (deps.settings ?? AGENCY_SETTINGS).find(item => item.profile === request.settings);
  if (!setting || !setting.qualifiedKinds.includes(request.kind))
    throw refuse("AGENCY_SETTINGS_UNQUALIFIED", "This kind of task is not available with these settings yet.", 409);
  try { textPrice(setting.model); } catch { throw refuse("AGENCY_SETTINGS_UNQUALIFIED", "This kind of task is not available with these settings yet.", 409); }
  if (new Set(request.permittedTools).size !== request.permittedTools.length || request.permittedTools.some(tool => !policy.tools.includes(tool)))
    throw refuse("AGENCY_TOOL_REFUSED", "One of the requested tools is not available for this task.");
  if (request.ceilingCredits > policy.maxCredits) throw refuse("AGENCY_CEILING_REFUSED", `This task can use at most ${policy.maxCredits} credits.`);
  if (!Number.isSafeInteger(deps.rateMicrousd) || deps.rateMicrousd <= 0) throw refuse("AGENCY_UNAVAILABLE", "Task pricing is unavailable.", 503);
  const scope = await deps.scope(actor, request.artifactId, request.inputs);
  if (scope.artifactId !== request.artifactId || scope.inputs.length !== request.inputs.length) throw refuse("AGENCY_UNAVAILABLE", "Task scope is unavailable.", 503);
  if (scope.currentVersion !== request.expectedRevision)
    throw refuse("AGENCY_STALE_REVISION", "The project changed since this task was prepared. Reload it and try again.", 409);
  return Object.freeze({
    actorId: actor, workspaceId: scope.workspaceId, clientId: scope.clientId, projectId: scope.projectId, artifactId: scope.artifactId,
    kind: request.kind, objective: request.objective, inputs: Object.freeze(scope.inputs), permittedTools: Object.freeze([...request.permittedTools]),
    settings: setting, ceilings: Object.freeze({ customerCredits: request.ceilingCredits, providerMicrousd: request.ceilingCredits * deps.rateMicrousd }),
    expectedRevision: request.expectedRevision, actionKey: request.actionKey, stepKey: request.stepKey,
    scale: taskScale(request.objective, request.inputs),
  });
}

/** Stored once with the operation. SQL re-verifies `inputs`, `projectId` and `clientId` against the artifact. */
export function taskContext(task: AgencyTask): Record<string, unknown> {
  return { task: { objective: task.objective, inputs: task.inputs, projectId: task.projectId, clientId: task.clientId,
    permittedTools: task.permittedTools, settings: task.settings.profile, scale: task.scale, ceilingCredits: task.ceilings.customerCredits,
    // Present only when files were read or omitted, so tasks without them keep their exact digest.
    ...sourcesContext(task.sources) } };
}

/**
 * Binds the ingestion references of the files a task read (and any "Continue without it" choices) to the task, server-side,
 * after extraction. They become part of the operation's recorded context and input digest: a replay of the same action with a
 * different extraction (another file, changed bytes, a new extraction version) is a different request and is refused.
 */
export function bindTaskSources(task: AgencyTask, sources: OperationSources): AgencyTask {
  if (!sourcesFingerprint(sources)) return task;
  return Object.freeze({ ...task, sources: Object.freeze({ omitted: [...sources.omitted], references: [...sources.references] }) });
}

/** The operation's input digest: equal requests replay, any change is a different request. */
export function taskDigest(task: AgencyTask): string {
  return createHash("sha256").update(canonicalSourceJson({ kind: task.kind, ...taskContext(task) })).digest("hex");
}

/** What a customer sees: no provider or model names. Operators read the exact ledger rows. */
export function publicTaskView(task: AgencyTask) {
  return { kind: task.kind, objective: task.objective, inputs: task.inputs.map(input => ({ kind: input.kind, id: input.id, version: input.version })),
    tools: task.permittedTools, settings: task.settings.profile, ceilingCredits: task.ceilings.customerCredits, expectedRevision: task.expectedRevision };
}

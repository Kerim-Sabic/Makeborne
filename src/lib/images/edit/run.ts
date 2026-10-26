import "server-only";
import { createHash } from "node:crypto";
import { MAX_EDIT_PROMPT_BYTES, MEASURED_EDIT_TOKENS, imageEditPriceCardVersion, type EditTokenTable } from "../../ai/image-edit-prices";
import { budgetedImageEdit, type ImageEditCallOutcome, type ImageEditClientLike, type ToUpload } from "../../ai/image-edit-call";
import { textCallBoundMicrousd, utf8Bytes, type ImageQuality, type ImageSize } from "../../ai/prices";
import { SpendError } from "../../ai/run-spend";
import { RequestError } from "../../server/http";
import { canonicalSourceJson } from "../../projects/canonical-json";
import { beginAgencyOperation, createOperationSpend, finishOperation, readOperation, resolveAgencyScope, watchOperationCancellation, type OperationRun } from "../../builder/operation-server";
import type { OperationStatus } from "../../builder/operation-contract";
import { readInputTool } from "../../agency/inputs";
import { AGENCY_SETTINGS, agencyKindEnabled, resolveAgencyTask, taskContext, taskDigest, type AgencyTask, type QualifiedSetting, type ResolveDeps } from "../../agency/task";
import { chargeableMicrousd, runAgencyTask } from "../../agency/run";
import type { ModelPort } from "../../agency/loop";
import {
  EDIT_LIMITS, EDIT_OPERATION_LABELS, EditCandidateSchema, EditPlanSchema, ImageEditRequestSchema, imageEditingEnabled,
  type EditCandidate, type EditPlan, type ImageEditRequest,
} from "./contract";
import { compositeProtected, normaliseForEdit, transparentShare, validateMask, verifyImageBytes, type NormalisedEdit, type VerifiedImage } from "./pixels";
import { allowedEditModels, routeImageEdit } from "./routing";

/**
 * "Edit image": one explicit user action on the existing durable operation
 * (kind image_edit), in two recorded steps:
 *   1. instruction (Claude, through the stage-1 lead loop): the customer's
 *      description becomes a precise edit instruction, plus whether an
 *      ordinary image operation would do it with no generation;
 *   2. generation: ONE budgeted edit call; the result is stored as a NEW asset
 *      and recorded on the operation as a candidate. Nothing is applied.
 * Accepting is a separate, version-checked save (accept.ts). Resubmitting the
 * same keys replays both recorded steps without any provider call. Nothing is
 * regenerated automatically, and a failed or uncertain call is never retried.
 */
export type EditAssetRow = { id: string; sha256: string; contentType: string; bytes: Buffer; provenance: Record<string, unknown> | null };
export type EditAssets = {
  /** The registered asset in the artifact's own project, through the caller's RLS-bound client (null when not visible there). */
  read(id: string): Promise<EditAssetRow | null>;
  /** A NEW project asset for edited bytes (never overwrites: ids are bound to bytes). */
  store(bytes: Buffer, provenance: Record<string, unknown>, options: { transparent: boolean; lossless: boolean; quality?: number }): Promise<{ id: string; sha256: string; bytes: number; width: number; height: number; mediaType: "image/webp" }>;
};
export type ImageEditDeps = Readonly<{
  env?: Record<string, string | undefined>;
  assets: EditAssets;
  model: ModelPort;
  imageClient: ImageEditClientLike; toUpload: ToUpload;
  rateMicrousd: number; platformDeadline: number;
  readInput?: (task: AgencyTask) => (index: number) => Promise<string>;
  settings?: readonly QualifiedSetting[]; table?: EditTokenTable; allowedModels?: readonly string[];
  scope?: ResolveDeps["scope"]; pollMs?: number; heartbeatMs?: number; now?: () => number;
}>;

/** The instruction step's limits: small, so most of the ceiling stays for the image. */
export const PREPARE_STEP = Object.freeze({ maxTurns: 2, maxOutputTokens: 1200, inputTokens: 6000 });
const SETTINGS_PROFILE = "standard";

export type EditEstimate = { credits: number; maximumMicrousd: number; prepareMicrousd: number; imageMicrousd: number; label: string };
export type EditView = Readonly<{
  state: "candidate" | "deterministic" | "failed" | "uncertain" | "stopped";
  message: string; charged: number; operationId: string | null; replayed: boolean; code?: string;
  candidate?: Omit<EditCandidate, "priceCard">; plan?: Pick<EditPlan, "summary" | "deterministic">;
}>;

const refuse = (code: string, message: string, status = 400) => new RequestError(code, message, status);
const unavailable = () => refuse("IMAGE_EDITING_UNAVAILABLE", "Image editing isn't available yet.", 404);
const uuidFrom = (text: string) => { const hex = createHash("sha256").update(text).digest("hex"); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`; };
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** The objective recorded with the operation: every choice that changes the edit, so a changed request is a different request. */
function objectiveOf(request: ImageEditRequest, maskSha256: string | null) {
  return canonicalSourceJson({ edit: request.operation, request: request.instruction, preserve: request.preserve, settings: request.settings,
    mask: maskSha256, protect: request.protect, references: request.references.length }).slice(0, 4000);
}
const LEAD_SYSTEM = [
  "You prepare one image edit for an image model. You never see the pixels; input 0 is the image (described by read_input), later inputs are reference images.",
  "Turn the customer's request into one precise instruction: what changes, where, what it should look like, and what must stay the same (lighting, perspective, people, text).",
  "Never invent brands, words or claims. Keep any text, label or logo that is already in the picture exactly as it is unless the customer asks otherwise, and set fidelityCritical when there is any.",
  "If an ordinary image operation does the job exactly (resize, crop, compress, or placing an existing logo/label image), set deterministic to it and do not ask for a generated edit.",
  "Masks and protected areas guide the edit; never promise exact pixel preservation in the summary.",
].join("\n");

export function editPrompt(plan: EditPlan, request: ImageEditRequest, normalised: Pick<NormalisedEdit, "autoMask">) {
  const lines = [plan.instruction.trim()];
  const preserve = [...new Set([...plan.preserve, ...request.preserve])];
  if (preserve.length) lines.push(`Keep these exactly as they are: ${preserve.join("; ")}.`);
  if (request.mask || normalised.autoMask) lines.push(normalised.autoMask ? "Fill only the empty area around the existing picture so it continues naturally; keep the existing picture unchanged." : "Change only the area marked by the mask; leave everything else unchanged.");
  if (request.operation === "cutout") lines.push("Remove the background completely so only the subject remains on a fully transparent background.");
  let prompt = lines.join("\n");
  while (utf8Bytes(prompt) > MAX_EDIT_PROMPT_BYTES) prompt = prompt.slice(0, Math.floor(prompt.length * 0.9));
  return prompt;
}

type Prepared = { request: ImageEditRequest; source: VerifiedImage; references: VerifiedImage[]; normalised: NormalisedEdit; route: { model: string; maxBoundMicrousd: number }; estimate: EditEstimate; maskSha256: string | null; setting: QualifiedSetting };

/** Everything checked before any operation, hold or call: flags, shape, scope of every image, bytes, mask, settings, bound and ceiling. */
export async function prepareImageEdit(body: unknown, deps: ImageEditDeps): Promise<Prepared> {
  // A generated edit is paid agency work: it needs the image_edit kind switched on as well as image editing.
  if (!imageEditingEnabled(deps.env ?? process.env) || !agencyKindEnabled("image_edit", deps.env ?? process.env)) throw unavailable();
  const parsed = ImageEditRequestSchema.safeParse(body);
  if (!parsed.success) throw refuse("EDIT_REQUEST_INVALID", parsed.error.issues.find(issue => issue.code === "custom")?.message ?? "This edit request is incomplete or has fields it may not set.");
  const request = parsed.data;
  const route = routeImageEdit({ operation: request.operation, settings: request.settings as never, images: 1 + request.references.length, mask: Boolean(request.mask) || request.operation === "extend" },
    deps.allowedModels ?? allowedEditModels(deps.env ?? process.env), deps.table ?? MEASURED_EDIT_TOKENS, deps.now?.());
  if (!route.ok) { console.warn(JSON.stringify({ event: "image_edit_unsupported", operation: request.operation, settings: request.settings, detail: route.detail })); throw refuse(route.code, route.message, 409); }
  const setting = (deps.settings ?? AGENCY_SETTINGS).find(item => item.profile === SETTINGS_PROFILE);
  if (!setting || !setting.qualifiedKinds.includes("image_edit")) throw refuse("AGENCY_SETTINGS_UNQUALIFIED", "Image editing isn't available yet.", 409);
  const load = async (ref: { id: string; sha256: string }, limit: number) => {
    const row = await deps.assets.read(ref.id);
    // Another workspace or project: indistinguishable from missing.
    if (!row) throw refuse("EDIT_ASSET_UNAVAILABLE", "This image isn't available in this project.", 404);
    if (row.sha256 !== ref.sha256) throw refuse("EDIT_INPUT_CHANGED", "This image no longer matches the one you chose. Reload the project and try again.", 409);
    if (row.bytes.length > limit) throw refuse("EDIT_INPUT_TOO_LARGE", "This image is too large to edit. Use a smaller version of it.", 413);
    const verified = await verifyImageBytes(row.bytes, row.sha256, { bytes: limit });
    if (`image/${verified.format}` !== row.contentType) throw refuse("EDIT_INPUT_INVALID", "This image could not be read.", 415);
    return verified;
  };
  const source = await load(request.asset, EDIT_LIMITS.sourceBytes);
  const references = [];
  for (const reference of request.references) references.push(await load(reference, EDIT_LIMITS.referenceBytes));
  const mask = request.mask ? await validateMask(request.mask.pngBase64, source) : null;
  const normalised = await normaliseForEdit({ source, operation: request.operation, size: request.settings.size, mask: mask?.bytes, references });
  const prepareMicrousd = PREPARE_STEP.maxTurns * textCallBoundMicrousd(setting.model, PREPARE_STEP.inputTokens, PREPARE_STEP.maxOutputTokens);
  const maximumMicrousd = prepareMicrousd + route.maxBoundMicrousd;
  const estimate: EditEstimate = { credits: Math.ceil(maximumMicrousd / deps.rateMicrousd), maximumMicrousd, prepareMicrousd, imageMicrousd: route.maxBoundMicrousd,
    label: "Maximum estimate. You are charged only for what the edit actually uses, never more than this." };
  if (request.ceilingCredits < estimate.credits) throw refuse("EDIT_CEILING_TOO_LOW", `This edit can use up to ${estimate.credits} credits. Approve at least that much to continue.`, 409);
  return { request, source, references, normalised, route, estimate, maskSha256: mask ? sha(mask.bytes) : null, setting };
}

/** The maximum-credit estimate the customer sees before generating (no operation, no hold, no call). */
export async function estimateImageEdit(body: unknown, deps: ImageEditDeps): Promise<EditEstimate & { operation: string }> {
  const draft = body && typeof body === "object" ? { ...(body as Record<string, unknown>), ceilingCredits: 60 } : body;
  const prepared = await prepareImageEdit(draft, deps);
  return { ...prepared.estimate, operation: EDIT_OPERATION_LABELS[prepared.request.operation] };
}

const MESSAGES = {
  candidate: "Here is one edited version. Compare it with the original, then accept it or discard it. The original is unchanged.",
  deterministic: "This change doesn't need a generated edit. Use the resize, crop or placement tools instead; nothing was generated.",
  failed: "The edit could not be made. Your original image is unchanged and you were not charged for the edit.",
  uncertain: "The image service may have started this edit but did not finish in time. Nothing was changed, no new attempt was made, and you were not charged. You can try again as a new edit.",
  stopped: "Stopped. Your original image is unchanged. You were charged only for confirmed work.",
  malformed: "The image service returned an unusable result, so nothing was saved. Your original is unchanged and you were not charged.",
  budget: "This edit needs more credits than are available for it. Nothing was generated and your original is unchanged.",
} as const;

function viewFromStatus(status: OperationStatus | null, replayed: boolean, extra: { charged?: number } = {}): EditView {
  const result = status?.result;
  const operationId = status?.operation.id ?? null;
  const data = EditCandidateSchema.safeParse(result?.data);
  const charged = extra.charged ?? result?.charged ?? 0;
  if (data.success) { const { priceCard, ...candidate } = data.data; void priceCard; return { state: "candidate", message: MESSAGES.candidate, charged, operationId, replayed, candidate }; }
  const plan = EditPlanSchema.safeParse(result?.data);
  if (plan.success && plan.data.deterministic !== "none") return { state: "deterministic", message: MESSAGES.deterministic, charged, operationId, replayed, plan: { summary: plan.data.summary, deterministic: plan.data.deterministic } };
  if (status?.operation.cancelRequested) return { state: "stopped", message: MESSAGES.stopped, charged, operationId, replayed };
  const code = result?.code ?? (typeof (result as Record<string, unknown> | null | undefined)?.editCode === "string" ? String((result as Record<string, unknown>).editCode) : undefined);
  if (code === "EDIT_PROVIDER_UNCERTAIN") return { state: "uncertain", message: MESSAGES.uncertain, charged, operationId, replayed, code };
  return { state: "failed", message: code === "EDIT_OUTPUT_MALFORMED" ? MESSAGES.malformed : code === "RUN_BUDGET" ? MESSAGES.budget : MESSAGES.failed, charged, operationId, replayed, ...(code ? { code } : {}) };
}

/** Run (or replay) one edit action. */
export async function runImageEdit(actor: string, body: unknown, deps: ImageEditDeps): Promise<EditView> {
  const prepared = await prepareImageEdit(body, deps);
  const { request } = prepared;
  const task = await resolveAgencyTask(actor, {
    artifactId: request.artifactId, actionKey: request.actionKey, stepKey: request.stepKey, kind: "image_edit",
    objective: objectiveOf(request, prepared.maskSha256), inputs: [{ kind: "asset", ...request.asset }, ...request.references.map(item => ({ kind: "asset" as const, ...item }))],
    permittedTools: ["read_input"], settings: SETTINGS_PROFILE, ceilingCredits: request.ceilingCredits, expectedRevision: request.expectedRevision,
  }, { scope: deps.scope ?? resolveAgencyScope, settings: deps.settings, rateMicrousd: deps.rateMicrousd, env: deps.env });
  // Step 1: the instruction. Bounded turns and output, a small slice of the ceiling.
  const lead = Object.freeze({ ...task, settings: Object.freeze({ ...task.settings, maxTurns: Math.min(task.settings.maxTurns, PREPARE_STEP.maxTurns), maxOutputTokens: Math.min(task.settings.maxOutputTokens, PREPARE_STEP.maxOutputTokens) }) });
  const prepareCredits = Math.max(1, Math.ceil(prepared.estimate.prepareMicrousd / deps.rateMicrousd));
  const planned = await runAgencyTask(lead, { system: LEAD_SYSTEM, result: EditPlanSchema, resultDescription: "Submit the prepared edit." }, {
    model: deps.model, tools: { read_input: readInputTool as never }, readInput: (deps.readInput ?? defaultReader)(lead), platformDeadline: deps.platformDeadline,
    pollMs: deps.pollMs, heartbeatMs: deps.heartbeatMs, stage: { credits: prepareCredits, providerMicrousd: prepared.estimate.prepareMicrousd },
  });
  const plan = EditPlanSchema.safeParse(planned.status?.result?.data);
  if (planned.outcome !== "result" || !plan.success) return { ...viewFromStatus(planned.status, planned.replayed), ...(planned.code ? { code: planned.code } : {}) };
  if (plan.data.deterministic !== "none") return viewFromStatus(planned.status, planned.replayed, { charged: planned.charged });
  return generateStep(task, prepared, plan.data, deps, planned.charged);
}

async function defaultReaderImport() { return (await import("../../agency/inputs")).inputReader; }
const defaultReader = (task: AgencyTask) => async (index: number) => (await defaultReaderImport())(task)(index);

/** Step 2: the one generation call, recorded on its own fenced run. */
async function generateStep(task: AgencyTask, prepared: Prepared, plan: EditPlan, deps: ImageEditDeps, preparedCharge: number): Promise<EditView> {
  const { request, normalised } = prepared;
  const imageCredits = Math.max(1, Math.ceil(prepared.route.maxBoundMicrousd / deps.rateMicrousd));
  const { run, status } = await beginAgencyOperation({ actor: task.actorId, workspaceId: task.workspaceId, artifactId: task.artifactId, kind: task.kind,
    effort: task.settings.effort, expectedVersion: task.expectedRevision, ceiling: task.ceilings.customerCredits, providerCapMicrousd: prepared.route.maxBoundMicrousd,
    stageCap: imageCredits, context: taskContext(task), digest: taskDigest(task), actionKey: task.actionKey, stepKey: uuidFrom(`${task.stepKey}:generate`) });
  if (!run) return viewFromStatus(status, true, { charged: preparedCharge + (status.result?.charged ?? 0) });
  const spend = createOperationSpend(run, deps.platformDeadline);
  const controller = new AbortController();
  const stopWatch = watchOperationCancellation(run, spend, controller, deps.pollMs);
  const prompt = editPrompt(plan, request, normalised);
  const priceCard = imageEditPriceCardVersion(deps.table ?? MEASURED_EDIT_TOKENS);
  const detail: Record<string, unknown> = { priceCard, operation: request.operation };
  let outcome: ImageEditCallOutcome | null = null, code: string | undefined, candidate: EditCandidate | undefined;
  try {
    outcome = await budgetedImageEdit({ client: deps.imageClient, toUpload: deps.toUpload, spend, signal: controller.signal, model: prepared.route.model, prompt,
      size: request.settings.size as ImageSize, quality: request.settings.quality as ImageQuality, background: request.settings.background,
      images: [{ name: "image.png", bytes: normalised.image, type: "image/png" }, ...normalised.references.map((bytes, index) => ({ name: `reference-${index + 1}.png`, bytes, type: "image/png" as const }))],
      ...(normalised.mask ? { mask: { name: "mask.png", bytes: normalised.mask, type: "image/png" as const } } : {}), table: deps.table });
    if (!outcome.ok) code = outcome.reason === "uncertain" ? "EDIT_PROVIDER_UNCERTAIN" : outcome.reason === "malformed" ? "EDIT_OUTPUT_MALFORMED" : outcome.reason === "rate_limited" ? "EDIT_RATE_LIMITED" : "EDIT_PROVIDER_REFUSED";
    else if (request.operation === "cutout" && await transparentShare(outcome.bytes) < 0.02) code = "EDIT_OUTPUT_MALFORMED";
    else {
      const bytes = await compositeProtected(outcome.bytes, normalised.image, request.protect, normalised.placement);
      const reviewReasons = [
        ...(request.protect.length ? ["Protected areas were restored from the original. Check their edges."] : []),
        ...(plan.fidelityCritical ? ["The picture contains labels, logos or text. Check that they are exactly right."] : []),
        ...(request.mask ? ["The mask guided the edit; areas outside it can still change slightly."] : []),
      ];
      const stored = await deps.assets.store(bytes, {
        kind: "image_edit", of: request.asset.id, ofSha256: request.asset.sha256, operation: request.operation,
        instructionSha256: sha(prompt), requestSha256: sha(objectiveOf(request, prepared.maskSha256)),
        // Operator record (never sent to the browser): exact model, price card and usage.
        model: prepared.route.model, priceCard, usage: outcome.detail.usage, costMicrousd: outcome.detail.costMicrousd, boundMicrousd: outcome.detail.boundMicrousd,
        operationId: run.operation.id, runId: run.id, protect: request.protect, reviewRequired: reviewReasons.length > 0,
      }, { transparent: request.operation === "cutout", lossless: request.protect.length > 0 });
      candidate = { kind: "image_edit_candidate", original: { assetId: request.asset.id, sha256: request.asset.sha256 },
        candidate: { assetId: stored.id, sha256: stored.sha256, width: stored.width, height: stored.height, mediaType: stored.mediaType, bytes: stored.bytes },
        operation: request.operation, summary: plan.summary, reviewRequired: reviewReasons.length > 0, reviewReasons, priceCard };
    }
  } catch (error) {
    code = error instanceof SpendError ? error.code : error instanceof RequestError ? error.code : "EDIT_FAILED";
    if (!(error instanceof SpendError)) console.error(JSON.stringify({ event: "image_edit_failed", run: run.id, code, message: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
  } finally { stopWatch(); }
  if (outcome) Object.assign(detail, { boundMicrousd: outcome.detail.boundMicrousd, costMicrousd: outcome.detail.costMicrousd, overrun: outcome.detail.overrun,
    uncertain: outcome.detail.costMicrousd === null });
  return finishGenerate(run, spend.confirmedMicrousd, chargeableMicrousd(spend), candidate, code, detail, preparedCharge);
}

async function finishGenerate(run: OperationRun, confirmed: number, chargeable: number, candidate: EditCandidate | undefined, code: string | undefined, detail: Record<string, unknown>, preparedCharge: number): Promise<EditView> {
  try {
    const finalization = candidate
      ? await finishOperation(run, chargeable, "result", { ...detail, finished: true }, { data: candidate })
      : await finishOperation(run, confirmed, "failed", { ...detail, code: code ?? "EDIT_FAILED", editCode: code ?? "EDIT_FAILED" });
    const view = viewFromStatus(finalization, false, { charged: preparedCharge + finalization.charged });
    return candidate || !code ? view : { ...view, ...(view.state === "candidate" ? {} : { state: code === "EDIT_PROVIDER_UNCERTAIN" ? "uncertain" as const : view.state, code,
      message: code === "EDIT_PROVIDER_UNCERTAIN" ? MESSAGES.uncertain : code === "EDIT_OUTPUT_MALFORMED" ? MESSAGES.malformed : code === "RUN_BUDGET" ? MESSAGES.budget : view.message }) };
  } catch {
    try {
      const status = await readOperation({ actor: run.actor, workspaceId: run.workspaceId, artifactId: run.artifactId, id: run.operation.id });
      if (status.result?.runId === run.id) return viewFromStatus(status, false);
    } catch { /* fall through */ }
    return { state: "failed", message: "Checking this edit's saved result and credit charge. Use its status before trying again.", charged: 0, operationId: run.operation.id, replayed: false, code: "OPERATION_RECOVERY_PENDING" };
  }
}

/** Refresh/reconnect: recorded state only; never begins or repeats a step. */
export async function readImageEdit(input: { actor: string; workspaceId: string; artifactId: string; id: string }): Promise<EditView> {
  return viewFromStatus(await readOperation(input), true);
}

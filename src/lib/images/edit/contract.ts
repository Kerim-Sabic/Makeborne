import { z } from "zod";
import { EDIT_QUALITIES, EDIT_SIZES } from "../../ai/image-edit-prices";

/**
 * The image-edit contract. The browser names an asset it can see (id + the
 * sha256 it was shown), describes the change, picks explicit output settings
 * from an allowlist and a credit ceiling; the server derives workspace,
 * project and actor, re-verifies every byte, picks the model and prices the
 * call. Originals are immutable: an edit is always a NEW asset, and only an
 * explicit acceptance (a version-checked save) points chosen references at it.
 */
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const EDIT_OPERATIONS = ["background_replace", "object_remove", "object_replace", "extend", "relight_restyle", "variant", "cutout"] as const;
export type EditOperation = (typeof EDIT_OPERATIONS)[number];
/** Customer labels (no provider or model names anywhere in customer copy). */
export const EDIT_OPERATION_LABELS: Readonly<Record<EditOperation, string>> = Object.freeze({
  background_replace: "Replace the background", object_remove: "Remove an object", object_replace: "Replace an object",
  extend: "Extend the picture", relight_restyle: "Adjust lighting or style", variant: "Make a related variant", cutout: "Cut out the subject",
});

/** Limits checked before anything is reserved. */
export const EDIT_LIMITS = Object.freeze({
  sourceBytes: 20_000_000, sourcePixels: 20_000_000,
  maskBytes: 4 * 1024 * 1024, maskBase64Chars: Math.ceil((4 * 1024 * 1024) / 3) * 4,
  references: 3, referenceBytes: 8 * 1024 * 1024,
  /** Everything sent in one multipart request after normalisation. */
  payloadBytes: 48 * 1024 * 1024,
  instructionChars: 2000, preserveNotes: 8, protectRegions: 4,
  /** Aspect difference tolerated without "extend" (2%). */
  aspectTolerance: 0.02,
});

export const EditSettingsSchema = z.object({
  size: z.enum(EDIT_SIZES as unknown as [string, ...string[]]),
  quality: z.enum(EDIT_QUALITIES as unknown as [string, ...string[]]),
  background: z.enum(["opaque", "transparent"]),
}).strict();
export type EditSettings = { size: (typeof EDIT_SIZES)[number]; quality: (typeof EDIT_QUALITIES)[number]; background: "opaque" | "transparent" };

/** A rectangle in fractions of the source image (0..1). */
export const RegionSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().gt(0).max(1), height: z.number().gt(0).max(1) }).strict()
  .refine(region => region.x + region.width <= 1.000001 && region.y + region.height <= 1.000001, "The region must stay inside the image.");
export type Region = z.infer<typeof RegionSchema>;

export const AssetRefSchema = z.object({ id: uuid, sha256 }).strict();
export const ImageEditRequestSchema = z.object({
  artifactId: uuid,
  /** One explicit user action; resubmitting the same keys replays its recorded result. */
  actionKey: uuid, stepKey: uuid,
  asset: AssetRefSchema,
  operation: z.enum(EDIT_OPERATIONS),
  instruction: z.string().trim().min(3).max(EDIT_LIMITS.instructionChars),
  /** Optional PNG mask (transparent = may change), exactly the source's dimensions. It guides the model; it is not a pixel guarantee. */
  mask: z.object({ pngBase64: z.string().min(16).max(EDIT_LIMITS.maskBase64Chars).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict().optional(),
  references: z.array(AssetRefSchema).max(EDIT_LIMITS.references).default([]),
  settings: EditSettingsSchema,
  /** What must stay as it is (the user's words, passed to the instruction). */
  preserve: z.array(z.string().trim().min(1).max(200)).max(EDIT_LIMITS.preserveNotes).default([]),
  /** Fidelity-critical regions (labels, logos): original pixels are composited back exactly after the edit, and review is required. */
  protect: z.array(RegionSchema).max(EDIT_LIMITS.protectRegions).default([]),
  ceilingCredits: z.number().int().min(1).max(60),
  expectedRevision: z.number().int().nonnegative(),
}).strict().superRefine((request, ctx) => {
  if (request.operation === "cutout" && request.settings.background !== "transparent") ctx.addIssue({ code: "custom", path: ["settings", "background"], message: "A cut-out needs a transparent background." });
  if (request.operation !== "cutout" && request.settings.background === "transparent") ctx.addIssue({ code: "custom", path: ["settings", "background"], message: "Only cut-outs use a transparent background." });
  if (request.operation === "extend" && request.mask) ctx.addIssue({ code: "custom", path: ["mask"], message: "Extending builds its own mask from the new canvas." });
  const ids = [request.asset.id, ...request.references.map(item => item.id)];
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["references"], message: "Each image may be used once." });
});
export type ImageEditRequest = z.infer<typeof ImageEditRequestSchema>;

/** What the instruction step (Claude) returns: data only, validated on the server. */
export const EditPlanSchema = z.object({
  instruction: z.string().trim().min(10).max(3000).describe("The precise edit instruction for the image model: what changes, where, and how it should look. Never names a brand that is not in the request."),
  preserve: z.array(z.string().trim().min(1).max(200)).max(8).describe("Elements that must stay as they are, restated precisely"),
  deterministic: z.enum(["none", "resize", "crop", "compress", "composite"]).describe("'none' when the change needs a generated edit; otherwise the ordinary image operation that does it exactly, with no generation"),
  fidelityCritical: z.boolean().describe("True when the image holds a product label, logo, text or another element that must stay exact"),
  summary: z.string().trim().min(1).max(300).describe("One sentence for the customer describing the planned change"),
}).strict();
export type EditPlan = z.infer<typeof EditPlanSchema>;

/** The candidate an edit step records on its operation (typed data; never applied by the step). */
export const EditCandidateSchema = z.object({
  kind: z.literal("image_edit_candidate"),
  original: z.object({ assetId: uuid, sha256 }).strict(),
  candidate: z.object({ assetId: uuid, sha256, width: z.number().int().positive(), height: z.number().int().positive(), mediaType: z.enum(["image/webp", "image/png"]), bytes: z.number().int().positive() }).strict(),
  operation: z.enum(EDIT_OPERATIONS),
  summary: z.string().max(300),
  reviewRequired: z.boolean(),
  reviewReasons: z.array(z.string().max(200)).max(6),
  priceCard: z.string().max(64),
}).strict();
export type EditCandidate = z.infer<typeof EditCandidateSchema>;

/** Which uses of the original an acceptance switches. Anything not listed keeps the original. */
export const DOCUMENT_LOCATION = /^(?:cover|slide:[a-z0-9][a-z0-9-]{0,47}(?::person:[0-5])?|chapter:[a-z0-9][a-z0-9-]{0,47}(?::figure:(?:[0-9]|[1-4][0-9]))?)$/;
export const EditReferenceSchema = z.discriminatedUnion("kind", [
  /** An outline/content block's image. */
  z.object({ kind: z.literal("block"), sectionId: uuid, blockId: uuid }).strict(),
  /** The style profile's reference image. */
  z.object({ kind: z.literal("style_reference") }).strict(),
  /** Every use of one named document image (book/deck). */
  z.object({ kind: z.literal("document_asset"), name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/) }).strict(),
  /** One placement in a book/deck: cover, a slide, a slide's person, a chapter opener or the nth figure in a chapter. */
  z.object({ kind: z.literal("document_image"), at: z.string().regex(DOCUMENT_LOCATION) }).strict(),
  /** Every use of a website image path (all textual uses of its public URL). */
  z.object({ kind: z.literal("website_asset"), path: z.string().min(1).max(240) }).strict(),
  /** One textual use (0-based) of a website image's public URL in one source file. */
  z.object({ kind: z.literal("website_occurrence"), path: z.string().min(1).max(240), file: z.string().min(1).max(240), occurrence: z.number().int().min(0).max(199) }).strict(),
]);
export type EditReference = z.infer<typeof EditReferenceSchema>;

export const AcceptEditSchema = z.object({
  artifactId: uuid,
  /** Idempotency key of the acceptance save. */
  acceptKey: uuid,
  originalAssetId: uuid, candidateAssetId: uuid,
  expectedVersion: z.number().int().positive(),
  references: z.array(EditReferenceSchema).min(1).max(20),
  /** The customer looked at the protected areas (required when the candidate asks for review). */
  reviewed: z.boolean().default(false),
}).strict();
export type AcceptEdit = z.infer<typeof AcceptEditSchema>;

/** Ordinary image processing: no model call, no credits. */
export const DeterministicEditSchema = z.object({
  artifactId: uuid,
  asset: AssetRefSchema,
  op: z.discriminatedUnion("type", [
    z.object({ type: z.literal("resize"), width: z.number().int().min(16).max(4096), height: z.number().int().min(16).max(4096), fit: z.enum(["cover", "contain", "inside"]) }).strict(),
    z.object({ type: z.literal("crop"), region: RegionSchema }).strict(),
    z.object({ type: z.literal("compress"), quality: z.number().int().min(40).max(95) }).strict(),
    /** Exact composite of another project image (a logo or label) into a region of this one. */
    z.object({ type: z.literal("composite"), overlay: AssetRefSchema, region: RegionSchema }).strict(),
  ]),
}).strict();
export type DeterministicEdit = z.infer<typeof DeterministicEditSchema>;

/** Server-side flag (off by default). Nothing in the browser can turn it on. */
export function imageEditingEnabled(env: Record<string, string | undefined> = process.env) { return env.MAKEBORNE_IMAGE_EDITING === "on"; }

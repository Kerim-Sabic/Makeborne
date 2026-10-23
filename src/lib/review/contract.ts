import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalSourceJson } from "../projects/canonical-json";

/**
 * Independent review contract (agency stage 6). Nothing here makes a call.
 * The module uses node:crypto (server); the browser may `import type` from it.
 *
 * A review is bound to one exact revision {artifactId, version, contentSha}.
 * The reviewer sees a fresh context: the approved brief, approved facts, the
 * rendered output and measured diagnostics with explicit coverage limits. It
 * NEVER sees the builder's own summary or self-assessment: every object is
 * strict, so a request carrying such a field is refused, and nothing in the
 * prompt is taken from builder notes.
 */
export const REVIEW_SCHEMA = "makeborne.independent-review/1";

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/);
const short = (max: number) => z.string().trim().min(1).max(max);

export const ReviewSubjectSchema = z.object({ artifactId: uuid, version: z.number().int().positive(), contentSha: sha256 }).strict();
export type ReviewSubject = z.infer<typeof ReviewSubjectSchema>;

/** The stored version content's identity: canonical JSON, sha256. */
export function contentSha(content: unknown): string {
  return createHash("sha256").update(canonicalSourceJson(content)).digest("hex");
}
export const sameSubject = (a: ReviewSubject, b: ReviewSubject) => a.artifactId === b.artifactId && a.version === b.version && a.contentSha === b.contentSha;

/** The approved brief: requirements are the only things a finding may cite as "the brief requires". */
export const BriefSchema = z.object({
  id: short(64), version: z.number().int().nonnegative(), approved: z.literal(true),
  summary: z.string().trim().max(2000),
  requirements: z.array(z.object({ id: slug, text: short(400) }).strict()).max(40),
}).strict();
export type Brief = z.infer<typeof BriefSchema>;

/**
 * Approved facts, as the knowledge module exposes them to reviewers: a per-task
 * snapshot of approved, non-superseded facts. This is an interface only; the
 * knowledge branch's own types are not imported (it is not merged).
 */
export const ApprovedFactSchema = z.object({ id: short(64), statement: short(500), value: z.string().trim().max(120).optional(), source: z.string().trim().max(200).optional() }).strict();
export const ApprovedFactsSchema = z.object({ snapshotId: short(64), facts: z.array(ApprovedFactSchema).max(200) }).strict();
export type ApprovedFact = z.infer<typeof ApprovedFactSchema>;
export type ApprovedFacts = z.infer<typeof ApprovedFactsSchema>;
export type ClaimKind = "price" | "percentage" | "quantity" | "year";
export type ClaimCheckResult = Readonly<{ text: string; kind: ClaimKind; supported: boolean; factId: string | null }>;
/** "Approved facts + claims check": the knowledge module's checker plugs in here; claims.ts has a deterministic default. */
export type ClaimsCheck = (text: string, facts: ApprovedFacts) => readonly ClaimCheckResult[];

// ---- Locations, evidence, findings ----
export const VIEWPORTS = ["desktop", "phone"] as const;
export const RoutePath = z.string().regex(/^\/[A-Za-z0-9/_-]{0,80}$/);
export const LocationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("route"), route: RoutePath, viewport: z.enum(VIEWPORTS), selector: z.string().trim().max(200).nullable() }).strict(),
  z.object({ kind: z.literal("page"), page: z.number().int().min(1).max(2000), chapterId: slug.nullable() }).strict(),
  z.object({ kind: z.literal("slide"), slide: z.number().int().min(1).max(40), slideId: slug.nullable() }).strict(),
  z.object({ kind: z.literal("artifact") }).strict(),
]);
export type ReviewLocation = z.infer<typeof LocationSchema>;

const box = z.object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(1), h: z.number().int().min(1) }).strict();
export const EvidenceSchema = z.discriminatedUnion("type", [
  /** A deterministic measurement, by its diagnostic id. */
  z.object({ type: z.literal("measured"), diagnosticId: short(160), value: short(300) }).strict(),
  /** A region of one supplied image. */
  z.object({ type: z.literal("crop"), imageId: short(64), box }).strict(),
  /** Exact text from the rendered output, the brief or an approved fact. */
  z.object({ type: z.literal("quote"), text: short(300), from: z.enum(["artifact", "brief", "facts"]) }).strict(),
]);
export type ReviewEvidence = z.infer<typeof EvidenceSchema>;

export const SEVERITIES = ["blocker", "major", "minor", "nit"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const severityRank = (severity: Severity) => SEVERITIES.length - SEVERITIES.indexOf(severity);
/** Only blocker and major findings may reach a repair. */
export const repairs = (severity: Severity) => severity === "blocker" || severity === "major";
export const CATEGORIES = ["broken", "layout", "legibility", "content", "factual", "completeness", "accessibility", "export"] as const;

export const VerificationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("deterministic"), checkId: short(64) }).strict(),
  z.object({ type: z.literal("visual"), note: short(200) }).strict(),
]);
const BriefRef = z.object({ ref: slug, quote: short(300) }).strict();

/** What the model may return per finding. It cannot set its own source or grounding. */
export const ModelFindingSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,79}$/),
  category: z.enum(CATEGORIES),
  location: LocationSchema,
  evidence: EvidenceSchema,
  severity: z.enum(SEVERITIES),
  briefRequirement: BriefRef.nullable(),
  factRefs: z.array(short(64)).max(5),
  proposedRepair: short(500),
  verificationMethod: VerificationSchema,
}).strict();
export type ModelFinding = z.infer<typeof ModelFindingSchema>;
/** The reviewer's whole answer. There is deliberately no "passed" field: status is computed on the server. */
export const ModelReviewSchema = z.object({
  findings: z.array(ModelFindingSchema).max(30),
  coverageNotes: z.array(short(200)).max(10),
}).strict();
export type ModelReview = z.infer<typeof ModelReviewSchema>;

/** grounding: measured (a deterministic check), grounded (evidence and any cited brief/facts resolve), unverified (they do not). */
export const FindingSchema = ModelFindingSchema.extend({
  source: z.enum(["deterministic", "model"]),
  grounding: z.enum(["measured", "grounded", "unverified"]),
  note: z.string().max(300).optional(),
}).strict();
export type Finding = z.infer<typeof FindingSchema>;

// ---- Rendered evidence ----
export const ImageSchema = z.object({
  id: z.string().regex(/^img-[a-z0-9-]{1,56}$/), label: short(120),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  width: z.number().int().min(1).max(1568), height: z.number().int().min(1).max(1568),
  data: z.string().min(100).max(700_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export type ReviewImage = z.infer<typeof ImageSchema>;

const ViewportCaptureSchema = z.object({
  viewport: z.enum(VIEWPORTS), width: z.number().int().min(200).max(3000), height: z.number().int().min(200).max(3000),
  pageHeight: z.number().int().min(0).max(1_000_000), capturedHeight: z.number().int().min(0).max(1_000_000),
  images: z.array(z.string()).max(8),
}).strict();
export const WebsiteEvidenceSchema = z.object({
  kind: z.literal("website"),
  routes: z.array(z.object({ path: RoutePath, text: z.string().max(20_000), viewports: z.array(ViewportCaptureSchema).length(2) }).strict()).min(1).max(4),
  images: z.array(ImageSchema).max(28),
}).strict();
export const BookEvidenceSchema = z.object({
  kind: z.literal("book"),
  pdf: z.object({
    pageCount: z.number().int().min(0).max(2000),
    pages: z.array(z.object({ page: z.number().int().min(1), width: z.number().positive(), height: z.number().positive(), glyphs: z.number().int().min(0), images: z.number().int().min(0) }).strict()).max(2000),
    outline: z.array(z.object({ title: z.string().max(200), page: z.number().int().min(1) }).strict()).max(400),
  }).strict().nullable(),
  chapters: z.array(z.object({ id: slug, title: z.string().max(200), text: z.string().max(40_000) }).strict()).max(40),
  images: z.array(ImageSchema).max(12),
}).strict();
export const ChartPartSchema = z.object({ part: z.string().max(120), type: z.string().max(40), native: z.boolean(), embeddedData: z.boolean() }).strict();
export const DeckEvidenceSchema = z.object({
  kind: z.literal("deck"),
  slides: z.array(z.object({
    slide: z.number().int().min(1), slideId: slug, title: z.string().max(200), text: z.string().max(4000),
    imageId: z.string().nullable(), notes: z.string().max(3000).nullable(),
    charts: z.array(ChartPartSchema).max(6), pictures: z.number().int().min(0),
    sourceHasChart: z.boolean(),
  }).strict()).max(40),
  images: z.array(ImageSchema).max(20),
}).strict();
export const RenderedEvidenceSchema = z.discriminatedUnion("kind", [WebsiteEvidenceSchema, BookEvidenceSchema, DeckEvidenceSchema]);
export type WebsiteEvidence = z.infer<typeof WebsiteEvidenceSchema>;
export type BookEvidence = z.infer<typeof BookEvidenceSchema>;
export type DeckEvidence = z.infer<typeof DeckEvidenceSchema>;
export type RenderedEvidence = z.infer<typeof RenderedEvidenceSchema>;

/** One deterministic check result at one location. */
export const DiagnosticSchema = z.object({
  id: short(160), check: short(64), location: LocationSchema,
  status: z.enum(["passed", "failed", "not_checked"]), measured: z.string().max(300), reason: z.string().max(200).optional(),
}).strict();
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
export const CoverageSchema = z.object({
  inspected: z.array(short(200)).max(60),
  /** Always explicit: a review never implies coverage it did not have. */
  notInspected: z.array(z.object({ what: short(200), reason: short(200) }).strict()).min(1).max(40),
}).strict();
export type Coverage = z.infer<typeof CoverageSchema>;

export const ReviewRequestSchema = z.object({
  schema: z.literal(REVIEW_SCHEMA),
  subject: ReviewSubjectSchema,
  brief: BriefSchema,
  facts: ApprovedFactsSchema,
  evidence: RenderedEvidenceSchema,
  diagnostics: z.array(DiagnosticSchema).max(400),
  coverage: CoverageSchema,
}).strict().superRefine((request, context) => {
  const images = new Set(request.evidence.images.map(image => image.id));
  if (images.size !== request.evidence.images.length) context.addIssue({ code: "custom", message: "Image ids must be unique." });
  const ids = new Set(request.diagnostics.map(item => item.id));
  if (ids.size !== request.diagnostics.length) context.addIssue({ code: "custom", message: "Diagnostic ids must be unique." });
  if (request.evidence.kind === "website") for (const route of request.evidence.routes) {
    if (new Set(route.viewports.map(item => item.viewport)).size !== 2) context.addIssue({ code: "custom", message: `Route ${route.path} needs one desktop and one phone capture.` });
    for (const item of route.viewports) for (const id of item.images) if (!images.has(id)) context.addIssue({ code: "custom", message: `Unknown image ${id}.` });
  }
});
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

/** Binds a request: any change to subject, brief, facts, evidence or diagnostics is a different review. */
export function reviewRequestDigest(request: ReviewRequest): string {
  return createHash("sha256").update(canonicalSourceJson(request)).digest("hex");
}

export const UNAVAILABLE_REASONS = ["refusal", "truncated", "malformed", "no_result", "provider_failed", "budget", "reviewer_not_qualified", "reviewer_disabled", "stale"] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/** The stored and returned result. No provider or model names. */
export const ReviewResultSchema = z.object({
  schema: z.literal(REVIEW_SCHEMA),
  subject: ReviewSubjectSchema,
  requestDigest: sha256,
  /** acceptable: no blocker/major; changes_needed: at least one; review_unavailable: the visual/content review did not complete (never "passed"). */
  status: z.enum(["acceptable", "changes_needed", "review_unavailable"]),
  unavailableReason: z.enum(UNAVAILABLE_REASONS).optional(),
  reviewer: z.enum(["fresh_context", "deterministic_only"]),
  findings: z.array(FindingSchema).max(400),
  checks: z.object({ passed: z.number().int().min(0), failed: z.number().int().min(0), notChecked: z.number().int().min(0) }).strict(),
  coverage: CoverageSchema,
  coverageNotes: z.array(z.string().max(200)).max(10),
}).strict();
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

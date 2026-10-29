import { z } from "zod";
import { SourceReferenceSchema } from "../ingest/request";

/**
 * "Understand this client" (agency stage 4): the request, the answer a model
 * may give, and the stored brief. The stored brief is what the person reviews;
 * every claim in it is either a FACT that cites a source it was found in
 * (a page read at a recorded time, a supplied document, the person's notes,
 * an approved knowledge fact or the client record) or an INFERENCE, labelled
 * as such. validate.ts enforces that on the server; nothing a model or a page
 * says can skip it.
 */
export const RESEARCH_VERSION = "research-2026-10-24.1";
export const EXTRACTOR_VERSION = "research-page-2026-10-24.1";

export const DELIVERABLES = ["website", "ebook", "deck", "other"] as const;
export type Deliverable = (typeof DELIVERABLES)[number];
export const DELIVERABLE_LABEL: Record<Deliverable, string> = { website: "Website", ebook: "Ebook or guide", deck: "Presentation deck", other: "Other" };

/** Why a source could not be used. "unreadable" is for supplied documents. */
export const INACCESSIBLE_REASONS = ["blocked", "private", "robots", "timeout", "too_large", "login", "not_found", "not_html", "redirects", "invalid", "error", "unreadable"] as const;
export type InaccessibleReason = (typeof INACCESSIBLE_REASONS)[number];
export const INACCESSIBLE_LABEL: Record<InaccessibleReason, string> = {
  blocked: "The site refused automated reading", private: "Private or internal address (never read)", robots: "The site asks automated readers not to open this page",
  timeout: "The page took too long to answer", too_large: "The page is too large to read safely", login: "Needs a sign-in to see", not_found: "Not found",
  not_html: "Not a web page", redirects: "Too many redirects", invalid: "Not a valid public web address", error: "Could not be read", unreadable: "The file could not be read",
};
export const NOT_READ_REASONS = ["page_budget", "byte_budget", "time_budget"] as const;
export type NotReadReason = (typeof NOT_READ_REASONS)[number];
export const NOT_READ_LABEL: Record<NotReadReason, string> = {
  page_budget: "Page limit for one request reached", byte_budget: "Reading limit for one request reached", time_budget: "Time limit for one request reached",
};

/** P1..P20 public pages, D1..D5 supplied documents, N1 the person's notes, C1 the client record, K-… approved knowledge. */
export const SourceIdSchema = z.string().regex(/^(P([1-9]|1\d|20)|D[1-5]|N1|C1|K-[0-9a-f]{8}-r\d{1,6})$/);
export type SourceId = z.infer<typeof SourceIdSchema>;

// ---------- request ----------
export const MAX_COMPETITORS = 3;
export const MAX_DOCUMENTS = 5;
export const MAX_NOTES_CHARS = 20_000;
export const ResearchDocumentSchema = z.object({ name: z.string().trim().min(1).max(255), mediaType: z.string().min(1).max(120), reference: SourceReferenceSchema }).strict();
export type ResearchDocument = z.infer<typeof ResearchDocumentSchema>;
export const ResearchRequestSchema = z.object({
  /** One explicit user action. Repeating it returns the stored brief: no new reads, no new charge. */
  actionKey: z.string().uuid(), stepKey: z.string().uuid(),
  url: z.string().trim().min(4).max(2048),
  /** The client project the brief is kept with. Optional: without one the brief is written without AI assistance. */
  artifactId: z.string().uuid().nullable().default(null),
  competitorUrls: z.array(z.string().trim().min(4).max(2048)).max(MAX_COMPETITORS).default([]),
  documents: z.array(ResearchDocumentSchema).max(MAX_DOCUMENTS).default([]),
  notes: z.string().max(MAX_NOTES_CHARS).default(""),
  settings: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/).default("standard"),
  ceilingCredits: z.number().int().min(1).max(40).default(20),
}).strict();
export type ResearchRequest = z.output<typeof ResearchRequestSchema>;

// ---------- what a model may answer (validated, then grounded) ----------
const text = (max: number) => z.string().trim().min(1).max(max);
export const ModelCitationSchema = z.object({ source: SourceIdSchema, quote: text(300) }).strict();
export const ModelClaimSchema = z.object({
  text: text(400), basis: z.enum(["fact", "inference"]),
  citations: z.array(ModelCitationSchema).max(4).default([]),
  reasoning: text(300).optional(),
}).strict();
export type ModelClaim = z.input<typeof ModelClaimSchema>;
export const SECTIONS = ["offering", "audience", "positioning", "brandCues", "strengths", "shortcomings"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<Section, string> = {
  offering: "What they offer", audience: "Who it is for (evidence only)", positioning: "How they present themselves", brandCues: "Brand cues",
  strengths: "Website strengths", shortcomings: "Website shortcomings",
};
const SECTION_LIMIT: Record<Section, number> = { offering: 8, audience: 6, positioning: 6, brandCues: 6, strengths: 6, shortcomings: 8 };
/** "offering:0" names the first offering claim. */
export const ClaimRefSchema = z.string().regex(/^(offering|audience|positioning|brandCues|strengths|shortcomings|competitors\.\d):\d{1,2}$/);
export const ModelBriefSchema = z.object({
  ...Object.fromEntries(SECTIONS.map(section => [section, z.array(ModelClaimSchema).max(SECTION_LIMIT[section]).default([])])) as Record<Section, z.ZodDefault<z.ZodArray<typeof ModelClaimSchema>>>,
  competitors: z.array(z.object({ source: SourceIdSchema, name: text(120), claims: z.array(ModelClaimSchema).max(3).default([]) }).strict()).max(5).default([]),
  questions: z.array(text(240)).max(10).default([]),
  recommendations: z.array(z.object({ deliverable: z.enum(DELIVERABLES), title: text(120), reason: z.string().trim().min(20).max(600), basedOn: z.array(ClaimRefSchema).max(6).default([]) }).strict()).min(1).max(3),
}).strict();
export type ModelBrief = z.input<typeof ModelBriefSchema>;
export type ParsedModelBrief = z.output<typeof ModelBriefSchema>;

// ---------- the stored brief ----------
export const StoredCitationSchema = z.object({
  source: SourceIdSchema, quote: z.string().max(300), title: z.string().max(300),
  url: z.string().max(2048).optional(), fetchedAt: z.string().optional(), stale: z.boolean().optional(),
}).strict();
export type StoredCitation = z.infer<typeof StoredCitationSchema>;
export const StoredClaimSchema = z.object({
  id: z.string().regex(/^c-[a-z0-9.]+-\d{1,2}$/), text: z.string().max(400), basis: z.enum(["fact", "inference"]),
  citations: z.array(StoredCitationSchema).max(4), note: z.string().max(300).optional(),
}).strict();
export type StoredClaim = z.infer<typeof StoredClaimSchema>;
export const SourceViewSchema = z.object({
  id: SourceIdSchema, kind: z.enum(["page", "document", "notes", "knowledge", "client_record"]), title: z.string().max(300),
  role: z.enum(["home", "page", "competitor"]).optional(), url: z.string().max(2048).optional(), fetchedAt: z.string().optional(),
  sha256: z.string().optional(), stale: z.boolean().optional(), fromCache: z.boolean().optional(),
  assetId: z.string().uuid().optional(), extractionVersion: z.string().optional(), factId: z.string().uuid().optional(), revision: z.number().int().optional(),
  /** Customer-safe notes about the source (e.g. "Text addressed to automated tools was ignored"). */
  flags: z.array(z.string().max(200)).max(6).default([]),
}).strict();
export type SourceView = z.infer<typeof SourceViewSchema>;
export const ResearchBriefSchema = z.object({
  version: z.literal(RESEARCH_VERSION), method: z.enum(["deterministic", "assisted"]), generatedAt: z.string(),
  client: z.object({ id: z.string().uuid(), name: z.string().max(200), url: z.string().max(2048) }).strict(),
  sections: z.object(Object.fromEntries(SECTIONS.map(section => [section, z.array(StoredClaimSchema)])) as Record<Section, z.ZodArray<typeof StoredClaimSchema>>).strict(),
  competitors: z.array(z.object({ name: z.string().max(120), url: z.string().max(2048), source: SourceIdSchema, claims: z.array(StoredClaimSchema) }).strict()).max(5),
  questions: z.array(z.string().max(240)).max(16),
  recommendations: z.array(z.object({ deliverable: z.enum(DELIVERABLES), title: z.string().max(120), reason: z.string().max(600), basedOn: z.array(z.string()).max(6) }).strict()).max(3),
  identity: z.object({ status: z.enum(["consistent", "unverified", "conflict"]), notes: z.array(z.string().max(300)).max(8), excludedSources: z.array(SourceIdSchema).max(30) }).strict(),
  sources: z.array(SourceViewSchema).max(40),
  inaccessible: z.array(z.object({ target: z.string().max(2048), reason: z.enum(INACCESSIBLE_REASONS), detail: z.string().max(300) }).strict()).max(30),
  notRead: z.array(z.object({ url: z.string().max(2048), reason: z.enum(NOT_READ_REASONS) }).strict()).max(30),
  search: z.object({ performed: z.literal(false), reason: z.string().max(300) }).strict(),
  plan: z.array(z.string().max(300)).max(10),
  removed: z.array(z.object({ text: z.string().max(400), reason: z.string().max(200) }).strict()).max(60),
  knowledge: z.object({ snapshotId: z.string().uuid().nullable(), used: z.number().int().nonnegative() }).strict(),
  limits: z.object({ pages: z.number().int(), bytes: z.number().int(), ms: z.number().int(), pagesRead: z.number().int(), bytesRead: z.number().int(), elapsedMs: z.number().int() }).strict(),
}).strict();
export type ResearchBrief = z.infer<typeof ResearchBriefSchema>;

/** Every claim id in a brief, for selections and recommendations. */
export function claimsOf(brief: Pick<ResearchBrief, "sections" | "competitors">): StoredClaim[] {
  return [...SECTIONS.flatMap(section => brief.sections[section]), ...brief.competitors.flatMap(item => item.claims)];
}

// ---------- user actions on a brief ----------
export const SelectionSchema = z.object({
  /** Claims the person kept (default: every fact). */
  include: z.array(z.string().max(40)).max(120).optional(),
  /** The person's own corrections, recorded as their statement. */
  corrections: z.array(z.object({ id: z.string().max(40), text: z.string().trim().min(1).max(400) }).strict()).max(60).default([]),
}).strict();
export type Selection = z.output<typeof SelectionSchema>;
export const BriefActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), selection: SelectionSchema.default({ corrections: [] }) }).strict(),
  z.object({ action: z.literal("proposal"), selection: SelectionSchema.default({ corrections: [] }) }).strict(),
  z.object({ action: z.literal("plan"), selection: SelectionSchema.default({ corrections: [] }), recommendation: z.number().int().min(0).max(2).default(0), confirmNewPlan: z.boolean().default(false) }).strict(),
]);
export type BriefAction = z.output<typeof BriefActionSchema>;

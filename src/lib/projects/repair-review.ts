import "server-only";
import {createHash, randomUUID} from "node:crypto";
import {z} from "zod";
import {canonicalSourceJson} from "./canonical-json";
import {validateBuildReceipt} from "./build-receipt";
import type {websiteBuildInput} from "./build-input";

type Workload = ReturnType<typeof websiteBuildInput>;
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const ScopeSchema = z.object({workspaceId: uuid, projectId: uuid, artifactId: uuid}).strict();
const IssueSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  category: z.enum(["composition", "typography", "imagery", "content_accuracy", "interaction", "accessibility", "responsive", "motion"]),
  severity: z.enum(["blocking", "major", "minor"]),
  observation: z.string().trim().min(1).max(600),
  requestedChange: z.string().trim().min(1).max(600),
  evidence: z.object({kind: z.enum(["browser_observation", "source_inspection"]), reference: z.string().trim().min(1).max(300),
    viewport: z.object({width: z.number().int().min(240).max(7680), height: z.number().int().min(240).max(4320)}).strict().nullable()}).strict(),
}).strict();
const ObservationsSchema = z.object({recordedAt: z.string().datetime({offset: true}), issues: z.array(IssueSchema).min(1).max(12)}).strict()
  .superRefine((value, context) => {
    if (new Set(value.issues.map(issue => issue.id)).size !== value.issues.length) context.addIssue({code: "custom", message: "Issue identifiers must be unique."});
  });
const ReportSchema = z.object({schemaVersion: z.literal(1), purpose: z.literal("website_repair_review"), decision: z.literal("changes_requested"),
  scope: ScopeSchema, jobId: uuid, versionId: uuid, sourceHash: hash, buildHash: hash, reviewerId: uuid,
  observations: ObservationsSchema}).strict();
const RowSchema = z.object({id: uuid, workspace_id: uuid, version_id: uuid, reviewer_id: uuid,
  decision: z.literal("changes_requested"), body: z.string().max(10000)}).strict();
const ContextSchema = z.object({scope: ScopeSchema, jobId: uuid, reviewerId: uuid}).strict();
const fail = () => {throw Object.assign(new Error("WEBSITE_REPAIR_REVIEW_MISMATCH"), {code: "WEBSITE_REPAIR_REVIEW_MISMATCH"});};
const digest = (value: unknown) => createHash("sha256").update(canonicalSourceJson(value)).digest("hex");

/** Serializable, approval-bound repair instructions. Database authority must
 * independently confirm this digest against the saved review before dispatch. */
export function parseWebsiteRepairBinding(input: unknown) {
  const binding = z.object({reviewId: uuid, reportHash: hash, report: ReportSchema}).strict().parse(input);
  if (binding.reportHash !== digest(binding.report)) fail();
  return binding;
}

/** Instructions for a repair, never proof of quality or permission to spend.
 * Caller must first authorize current membership and load this saved workload
 * and its receipt through the existing job/version boundary. No arbitrary
 * review comment, URL or model-written claim can act as an approval. */
export function createWebsiteRepairReview(contextInput: unknown, observations: unknown, workload: Workload, receiptInput: unknown) {
  const context = ContextSchema.parse(contextInput), receipt = validateBuildReceipt(receiptInput, workload);
  if (context.scope.artifactId !== workload.artifactId) fail();
  const report = ReportSchema.parse({schemaVersion: 1, purpose: "website_repair_review", decision: "changes_requested",
    ...context, versionId: workload.revisionId, sourceHash: receipt.sourceHash, buildHash: receipt.buildHash, observations});
  const body = canonicalSourceJson(report);
  if (body.length > 10000 || Buffer.byteLength(body) > 10000) fail();
  // Reuse the existing append-only public.reviews record. No parallel ledger.
  const row = RowSchema.parse({id: randomUUID(), workspace_id: context.scope.workspaceId, version_id: workload.revisionId,
    reviewer_id: context.reviewerId, decision: "changes_requested", body});
  return {row, reportHash: digest(report)};
}

/** Reload an existing review against the exact current, authorized source and
 * compiled build. Once a proposal binds reportHash, require that same digest on
 * dispatch. This validates identity; it does not attest that observations are true. */
export function readWebsiteRepairReview(rowInput: unknown, contextInput: unknown, workload: Workload, receiptInput: unknown,
  expected?: {reviewId: string; reportHash: string}) {
  const row = RowSchema.parse(rowInput), context = ContextSchema.parse(contextInput);
  if (Buffer.byteLength(row.body) > 10000) fail();
  const receipt = validateBuildReceipt(receiptInput, workload), report = ReportSchema.parse(JSON.parse(row.body));
  if (row.workspace_id !== context.scope.workspaceId || row.version_id !== workload.revisionId || row.reviewer_id !== context.reviewerId
    || report.versionId !== workload.revisionId || report.sourceHash !== receipt.sourceHash || report.buildHash !== receipt.buildHash
    || report.reviewerId !== context.reviewerId || report.jobId !== context.jobId || context.scope.artifactId !== workload.artifactId
    || canonicalSourceJson(report.scope) !== canonicalSourceJson(context.scope)) fail();
  const reportHash = digest(report);
  if (expected && (uuid.parse(expected.reviewId) !== row.id || hash.parse(expected.reportHash) !== reportHash)) fail();
  return {reviewId: row.id, reportHash, report};
}

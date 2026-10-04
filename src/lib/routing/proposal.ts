import { createHash } from "node:crypto";
import { z } from "zod";
import { ArtifactContentSchema, StyleProfileSchema } from "../domain";
import { ScopeSchema } from "../jobs/contracts";
import { type ModelRoute } from "./contracts";
import { prepareWorkflow, WorkflowPreparationSchema } from "./workflow";

export const GenerationInputSchema = z.object({
  scope: ScopeSchema,
  baseVersionId: z.string().uuid().nullable(),
  brief: z.string().min(1).max(30000),
  audience: z.string().max(1000),
  purpose: z.string().max(2000),
  wording: z.enum(["preserve", "improve", "summarise"]).default("preserve"),
  content: ArtifactContentSchema,
  style: StyleProfileSchema,
  sourceIds: z.array(z.string().uuid()).max(1000),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.sourceIds).size !== input.sourceIds.length) ctx.addIssue({ code: "custom", message: "Source references must be unique." });
  for (const section of input.content.sections) for (const block of section.blocks) {
    if (block.sourceIds.some(id => !input.sourceIds.includes(id))) ctx.addIssue({ code: "custom", message: "Content references a source outside the approved input." });
  }
});

/** Stable hashing of validated JSON; preserves array order and exact text. */
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new Error("Proposal contains a non-JSON value.");
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value), "utf8").digest("hex");
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Server-only preparation. Inputs/routes must come from authorized server records.
 * Store the complete result before presenting its hash for approval. No dispatch. */
export function prepareGenerationProposal(input: unknown, preparation: unknown, routes: readonly ModelRoute[]) {
  const parsed = GenerationInputSchema.parse(input);
  const policy = WorkflowPreparationSchema.parse(preparation);
  if (parsed.content.kind !== policy.output) throw new Error("Workflow output does not match the approved content format.");
  const workflow = prepareWorkflow(policy, routes);
  if (workflow.status === "blocked") return { status: "blocked" as const, blocked: workflow.blocked, proposal: null };
  const proposal = {
    version: "generation-proposal-v1" as const,
    input: parsed,
    inputHash: digest(parsed),
    workflow: workflow.snapshot,
  };
  return freeze({ status: "prepared" as const, blocked: [], proposal: { ...proposal, approvalHash: digest(proposal) } });
}
export type GenerationProposal = NonNullable<ReturnType<typeof prepareGenerationProposal>["proposal"]>;

/** Parameter values for the private SQL store, not a browser/API payload. */
export function generationProposalRecord(proposal: GenerationProposal, now: string) {
  verifyGenerationApproval(proposal, proposal.approvalHash, proposal.input, now);
  return {
    workspace_id: proposal.input.scope.workspaceId,
    project_id: proposal.input.scope.projectId,
    artifact_id: proposal.input.scope.artifactId,
    base_version_id: proposal.input.baseVersionId,
    input_hash: proposal.inputHash,
    approval_hash: proposal.approvalHash,
    snapshot: proposal,
    maximum_vendor_microusd: proposal.workflow.maximumVendorMicrousd,
    maximum_customer_credits: proposal.workflow.maximumCustomerCredits,
    prepared_at: proposal.workflow.preparedAt,
    expires_at: proposal.workflow.expiresAt,
  };
}

/** Compare an approval to a proposal fetched from trusted storage, never a client-
 * supplied proposal. Hashes are integrity bindings, NOT signatures/authorization.
 * Caller must separately recheck membership, rights, routes, balance, and atomically reserve. */
export function verifyGenerationApproval(stored: GenerationProposal, approvalHash: string, currentInput: unknown, now: string) {
  const at = z.string().datetime().parse(now);
  const suppliedHash = z.string().regex(/^[a-f0-9]{64}$/).parse(approvalHash);
  const { approvalHash: recordedHash, ...payload } = stored;
  if (digest(payload) !== recordedHash || suppliedHash !== recordedHash) throw new Error("The generation proposal changed. Review a new proposal.");
  if (Date.parse(at) < Date.parse(stored.workflow.preparedAt) || Date.parse(at) >= Date.parse(stored.workflow.expiresAt)) throw new Error("The generation proposal is no longer current.");
  if (digest(GenerationInputSchema.parse(currentInput)) !== stored.inputHash) throw new Error("The project input changed. Review a new proposal.");
  return { inputHash: stored.inputHash, approvalHash: recordedHash, maximumVendorMicrousd: stored.workflow.maximumVendorMicrousd, maximumCustomerCredits: stored.workflow.maximumCustomerCredits };
}

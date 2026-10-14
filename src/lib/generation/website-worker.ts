import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {ExactAmountSchema} from "../jobs/contracts";
import {RouteSchema, RoutingRequestSchema, selectRoute} from "../routing/contracts";
import {GenerationInputSchema, verifyGenerationApproval, type GenerationProposal} from "../routing/proposal";
import {createAnthropicWebsiteGenerator} from "./website-generators";
import {buildWebsiteSourcePrompt} from "./website-source-contract";
import {validateDraftContext} from "./draft-contract";
import {SourceAssetSchema} from "../projects/website-source";
import type {resolveWebsiteSourceAssets} from "../projects/source-assets";
import {quotePlainTextUsage} from "../providers/text-metering";
import type {AnthropicTextConfig, AnthropicTextDependencies} from "../providers/anthropic-text";
import {getEffortPolicy} from "../routing/effort";
import {canonicalSourceJson} from "../projects/canonical-json";
import {resolveAnthropicEffort} from "../providers/anthropic-effort";
import {prepareWebsiteQualification,prepareWebsiteRepairQualification,websiteRepairGenerationInput} from "./qualification-proposal";
import {parseWebsiteRepairBinding} from "../projects/repair-review";
import {WorkerLeaseSchema as LeaseSchema,createWorkerAccounting,type WorkerLease as Lease,type WorkerAccountingDependencies} from "./worker-accounting";

type Artwork = Awaited<ReturnType<typeof resolveWebsiteSourceAssets>>;
export type WebsiteWorkerDependencies = WorkerAccountingDependencies & {
  configurationRef: string;
  /** Autocommit-only restricted worker pool/connection, never an app/service
   * client or a client inside BEGIN. A dispatch must commit before HTTP. */
  provider: Pick<AnthropicTextDependencies, "spendingAllowed" | "countInputTokens" | "fetch">;
  /** Trusted scoped original-byte resolver; browser registries are forbidden. */
  resolveAssets(lease: Lease, input: z.infer<typeof GenerationInputSchema>, signal: AbortSignal): Promise<{descriptors: unknown; artwork: Artwork}>;
};
const failure = (code: string) => Object.assign(new Error(code), {code});

/** One approved website draft attempt. Uses the existing adapter, SQL authority,
 * version store and metering; no implicit retry/fallback, acceptance or publish.
 * Runtime bootstrap must enforce restricted credentials and aggregate budgets. */
export function createClaudeWebsiteWorker(configuration: AnthropicTextConfig, dependencies: WebsiteWorkerDependencies) {
  return createWebsiteWorker(configuration, dependencies, false);
}

/** Operator-only bootstrap; no browser route or customer quality acceptance.
 * Exact server-owned qualification policy plus the original SQL cap/lease/cost
 * authorities remain mandatory. Never use this executor for customer jobs. */
export function createClaudeWebsiteQualificationWorker(configuration: AnthropicTextConfig, dependencies: WebsiteWorkerDependencies) {
  return createWebsiteWorker(configuration, dependencies, true);
}

function createWebsiteWorker(configuration: AnthropicTextConfig, dependencies: WebsiteWorkerDependencies, qualification: boolean) {
  return async (leaseInput: unknown, signal: AbortSignal) => {
    const lease = LeaseSchema.parse(leaseInput);
    signal.throwIfAborted();
    const proposal = lease.approvedInput.proposal as GenerationProposal;
    const input = GenerationInputSchema.parse(proposal.input);
    verifyGenerationApproval(proposal, proposal.approvalHash, input, new Date().toISOString());
    let generationInput = input;
    if (qualification) {
      const options = {now: proposal.workflow.preparedAt,
        effort: proposal.workflow.effort.level, processingConsent: true, externalProcessingConsent: true, sourceRightsConfirmed: true};
      const repair = "repairReview" in proposal ? parseWebsiteRepairBinding(proposal.repairReview) : null;
      if (repair && repair.report.reviewerId !== lease.approvedInput.actorId) throw failure("WEBSITE_WORKER_REPAIR_REVIEWER_CHANGED");
      const expected = repair ? prepareWebsiteRepairQualification(input, options, repair) : prepareWebsiteQualification(input, options);
      if (canonicalSourceJson(expected) !== canonicalSourceJson(proposal)) throw failure("WEBSITE_WORKER_QUALIFICATION_POLICY_CHANGED");
      if (repair) generationInput = websiteRepairGenerationInput(input, repair);
    } else if ("purpose" in proposal) throw failure("WEBSITE_WORKER_OPERATOR_PROPOSAL_DENIED");
    const policy=getEffortPolicy(proposal.workflow.effort.level);
    if(canonicalSourceJson(policy)!==canonicalSourceJson(proposal.workflow.effort))throw failure("WEBSITE_WORKER_EFFORT_POLICY_CHANGED");
    if (input.content.kind !== "website" || input.scope.workspaceId !== lease.workspaceId || !input.scope.artifactId
      || Date.now() >= Math.min(Date.parse(lease.deadlineAt), Date.parse(lease.approvedInput.authorizationExpiresAt))
      || !Number.isFinite(Date.parse(lease.deadlineAt)) || !Number.isFinite(Date.parse(lease.approvedInput.authorizationExpiresAt))) {
      throw failure("WEBSITE_WORKER_SCOPE_INVALID");
    }
    const stages = proposal.workflow.stages.filter(stage => stage.stage === "draft");
    if (stages.length !== 1) throw failure("WEBSITE_WORKER_ROUTE_INVALID");
    const stage = stages[0], route = RouteSchema.parse(stage.route), request = RoutingRequestSchema.parse(stage.request);
    if (route.provider !== "anthropic" || route.dataBoundary !== "external" || route.model !== configuration.model || route.status !== "ready"
      || !route.adapterVerified || !route.policyApproved || !route.licenseApproved || !route.configurationRef
      || route.configurationRef !== dependencies.configurationRef
      || !route.capabilities.includes("website_code") || !route.price || Date.parse(route.price.expiresAt) <= Date.now()
      || !["input_tokens", "output_tokens"].every(unit => request.usage.some(item => item.unit === unit))
      || (!qualification && !selectRoute({...request, now: new Date().toISOString()}, [route]).selected)) {
      throw failure("WEBSITE_WORKER_ROUTE_INVALID");
    }
    const effort=resolveAnthropicEffort(configuration.model,policy.reasoningIntensity);
    if(configuration.effort!==undefined&&configuration.effort!==effort)throw failure("WEBSITE_WORKER_EFFORT_MISMATCH");
    for (const [unit, maximum] of [["input_tokens", configuration.maximumInputTokens], ["output_tokens", configuration.maximumOutputTokens]] as const) {
      if (!Number.isSafeInteger(maximum) || BigInt(maximum) > BigInt(request.usage.find(item => item.unit === unit)!.maximum)) {
        throw failure("WEBSITE_WORKER_TOKEN_BOUND_INVALID");
      }
    }
    // Verify the configured maximum fits this stage's existing approved bound.
    const maximum = quotePlainTextUsage(route, {input_tokens: String(configuration.maximumInputTokens),
      output_tokens: String(configuration.maximumOutputTokens)});
    if (BigInt(maximum) > BigInt(ExactAmountSchema.parse(stage.maximumVendorMicrousd))) {
      throw failure("WEBSITE_WORKER_PRICE_BOUND_INVALID");
    }
    const assets = await dependencies.resolveAssets(lease, input, signal);
    const descriptors = z.array(SourceAssetSchema).max(100).parse(assets.descriptors);
    const context = validateDraftContext({input: generationInput, presentationMode: null, sourceMaterial: lease.approvedInput.sourceMaterial, availableAssetIds: descriptors.map(asset => asset.id)});
    if (context.sourceMaterial.length !== input.sourceIds.length) throw failure("WEBSITE_WORKER_SOURCES_INVALID");
    // Preflight context and artwork before the adapter can claim paid dispatch.
    buildWebsiteSourcePrompt(context, descriptors);
    if (assets.artwork.length !== descriptors.length || new Set(assets.artwork.map(asset => asset.id)).size !== assets.artwork.length
      || descriptors.some(asset => !assets.artwork.some(original => original.id === asset.id
      && original.path === asset.path && original.sha256 === asset.sha256 && original.mediaType === asset.mediaType
      && original.bytes.byteLength === asset.bytes && createHash("sha256").update(original.bytes).digest("hex") === asset.sha256))) {
      throw failure("WEBSITE_WORKER_ASSETS_INVALID");
    }
    signal.throwIfAborted();
    const accounting=createWorkerAccounting(lease,route,dependencies,signal,'WEBSITE_WORKER');
    const generate = createAnthropicWebsiteGenerator({...configuration,effort}, {...dependencies.provider, claimDispatch:accounting.claimDispatch});
    const result = await generate(lease.jobId, context, descriptors, signal);
    if (result.status === "not_dispatched") return {state: "not_dispatched" as const, reason: result.reason};
    // A confirmed response and usage may still need operator reconciliation if
    // cancellation revoked this worker's live fence. Never invent zero cost.
    const values=await accounting.retain(result.evidence);
    if (result.status !== "website_candidate") {
      await accounting.recordFailure(values);
      return {state: "attempt_failed" as const, reason: result.reason};
    }
    const candidate = result.candidate;
    const receipt=await accounting.commit(values,candidate.content,input.style,[...new Set([...candidate.content.websiteSource.assets.map(asset=>asset.id),...input.style.referenceAssetIds])],"Generated website source; build and design review required.");
    // The same commit inserted the durable build operation. Compilation must
    // not depend on this process staying alive after the paid response is saved.
    return {state: "build_queued" as const, versionId: receipt.versionId, outcomeId: receipt.outcomeId, readyForPublication: false as const};
  };
}

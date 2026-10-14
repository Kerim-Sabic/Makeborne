import "server-only";
import {z} from "zod";
import {mapVersion} from "../cloud/mappers";
import {compileTrustedPublication, type PublicationCompilerDependencies, PublicationBindingSchema} from "./publication-compiler";
import {composePublicationOutput} from "./publication-output";
import type {resolveWebsiteSourceAssets} from "./source-assets";

const ClaimSchema = z.object({
  id: z.string().uuid(), actorId: z.string().uuid(), state: z.literal("running"),
  scope: z.object({workspaceId: z.string().uuid(), projectId: z.string().uuid(), artifactId: z.string().uuid()}),
  versionId: z.string().uuid(), versionNumber: z.number().int().positive(), publicationRevision: z.number().int().nonnegative(),
  versionContentHash: z.string().regex(/^[a-f0-9]{64}$/), slug: z.string(), interactive: z.boolean(),
  fence: z.union([z.string().regex(/^[1-9][0-9]*$/), z.number().int().positive()]),
  leaseUntil: z.string(), version: z.record(z.string(), z.unknown()),
}).passthrough();
export type PublicationWorkerDependencies = {
  /** Restricted control connection. It is never forwarded into the compiler or renderer. */
  rpc(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  executor: PublicationCompilerDependencies | ((context: {preparationId: string; workerId: string; fence: string; leaseUntil: string},
    signal: AbortSignal) => Promise<PublicationCompilerDependencies>);
  /** Verify originals under current fenced project authority. No arbitrary URLs
   * or caller-selected storage paths; never reuse stale browser asset bytes. */
  resolveArtwork(scope: {preparationId: string; workerId: string; fence: string; workspaceId: string; projectId: string},
    version: ReturnType<typeof mapVersion>, signal: AbortSignal): Promise<Awaited<ReturnType<typeof resolveWebsiteSourceAssets>>>;
  address(slug: string): string;
};

/** Durable worker entry point, not a request-handler background task. A supervisor
 * supplies a qualified isolated executor and handles queue delivery/retries. */
export async function runPublicationPreparation(preparationId: string, workerId: string, deps: PublicationWorkerDependencies, signal: AbortSignal) {
  z.string().uuid().parse(preparationId); z.string().uuid().parse(workerId); signal.throwIfAborted();
  const claimed = await deps.rpc("makeborne_claim_publication_preparation", {p_preparation: preparationId, p_worker: workerId}, signal);
  if (claimed === null) return {state: "not_claimed" as const};
  const claim = ClaimSchema.parse(claimed);
  if (claim.id !== preparationId || !Number.isFinite(Date.parse(claim.leaseUntil)) || Date.parse(claim.leaseUntil) <= Date.now()) throw new Error("PUBLICATION_CLAIM_INVALID");
  const fence = String(claim.fence), remaining = Date.parse(claim.leaseUntil) - Date.now() - 5000;
  if (remaining <= 0) throw new Error("PUBLICATION_LEASE_EXPIRED");
  const execution = AbortSignal.any([signal, AbortSignal.timeout(Math.min(remaining, 290_000))]);
  const binding = PublicationBindingSchema.parse({preparationId, actorId: claim.actorId, ...claim.scope,
    versionId: claim.versionId, versionNumber: claim.versionNumber, publicationRevision: claim.publicationRevision,
    versionContentHash: claim.versionContentHash, slug: claim.slug, interactive: claim.interactive});
  try {
    const version = mapVersion(claim.version);
    if (version.id !== claim.versionId || version.artifactId !== claim.scope.artifactId || version.number !== claim.versionNumber) throw new Error("PUBLICATION_VERSION_MISMATCH");
    const artwork = await deps.resolveArtwork({preparationId, workerId, fence, ...claim.scope}, version, execution);
    await deps.rpc("makeborne_load_publication_preparation", {p_preparation: preparationId, p_worker: workerId, p_fence: fence}, execution);
    execution.throwIfAborted();
    const executor = typeof deps.executor === "function"
      ? await deps.executor({preparationId, workerId, fence, leaseUntil: claim.leaseUntil}, execution)
      : deps.executor;
    execution.throwIfAborted();
    const compiled = await compileTrustedPublication({binding, version, artwork}, executor, execution);
    const content = version.content;
    const composed = composePublicationOutput(compiled, {title: content.title,
      description: content.websiteSource?.designDirection?.positioning.slice(0, 160) ?? content.title,
      address: deps.address(claim.slug), interactive: claim.interactive});
    execution.throwIfAborted();
    const result = await deps.rpc("makeborne_complete_publication_preparation", {p_preparation: preparationId, p_worker: workerId,
      p_fence: fence, p_receipt: composed.receipt, p_output: composed.serializedOutput}, execution);
    return {state: "completed" as const, result};
  } catch (error) {
    // Completion may have committed even if its response was lost. SQL failure
    // recording is fenced and cannot replace a ready/promoted outcome.
    const code = error instanceof Error && /^PUBLICATION_[A-Z_]+$/.test(error.message) ? error.message : "PUBLICATION_PREPARATION_FAILED";
    try {await deps.rpc("makeborne_fail_publication_preparation", {p_preparation: preparationId, p_worker: workerId, p_fence: fence, p_error: code}, AbortSignal.timeout(5000));}
    catch { /* Durable status remains authoritative; the lease bounds recovery. */ }
    throw error;
  }
}

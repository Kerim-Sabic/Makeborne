import "server-only";
import {z} from "zod";
import {ArtifactVersionSchema} from "../domain";
import {websiteBuildInput} from "./build-input";
import {validateBuildReceipt} from "./build-receipt";
import {retainCompiledOutput, type CompiledOutputStore} from "./compiled-output";
export {validateBuildReceipt} from "./build-receipt";
import type {resolveWebsiteSourceAssets} from "./source-assets";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const LeaseSchema = z.object({state: z.literal("leased"), jobId: z.string().uuid(), workspaceId: z.string().uuid(),
  versionId: z.string().uuid(), workerId: z.string().uuid(), fence: z.string().regex(/^[1-9][0-9]{0,15}$/),
  deadlineAt: z.string().datetime({offset: true})}).strict();
type Version = z.infer<typeof ArtifactVersionSchema>;
type Workload = ReturnType<typeof websiteBuildInput>;
type Lease = z.infer<typeof LeaseSchema>;
const failure = (code: string) => Object.assign(new Error(code), {code});

export type BuildWorkerDependencies = {
  /** Dedicated restricted builder connection, never a provider/service pool. */
  sql: {query(text: string, values: unknown[]): Promise<{rows: Record<string, unknown>[]}>};
  outputStore: CompiledOutputStore;
  resolveArtwork(version: Version, signal: AbortSignal): Promise<Awaited<ReturnType<typeof resolveWebsiteSourceAssets>>>;
  /** Must independently verify real output bytes and enforce isolation, bounded
   * runtime and cancellation. No arbitrary user build commands or credentials. */
  build(workload: Workload, signal: AbortSignal): Promise<{status: "built"; receipt: unknown; readFile(path: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array>; dispose(): Promise<void>} | {status: "failed"}>;
};

/** One already leased build. The supervisor owns heartbeat/shutdown and role
 * assertion. No model calls, customer acceptance or publication permissions. */
export function createProjectBuildWorker(dependencies: BuildWorkerDependencies) {
  return async (leaseInput: unknown, signal: AbortSignal) => {
    const lease: Lease = LeaseSchema.parse(leaseInput);
    signal.throwIfAborted();
    if (BigInt(lease.fence) > BigInt(Number.MAX_SAFE_INTEGER) || Date.parse(lease.deadlineAt) <= Date.now()) throw failure("BUILD_LEASE_EXPIRED");
    const binding = [lease.jobId, lease.workerId, lease.fence];
    const loaded = (await dependencies.sql.query("select makeborne_private.load_project_build($1,$2,$3) as input", binding)).rows[0]?.input;
    const input = z.object({version: z.record(z.string(), z.unknown()), resultFingerprint: hash}).strict().parse(loaded), row = input.version;
    const version = ArtifactVersionSchema.parse({id: row.id, artifactId: row.artifact_id, number: row.version_number,
      parentVersionId: row.parent_version_id, content: row.content, style: row.style_snapshot, assetIds: row.asset_manifest,
      createdAt: new Date(z.string().datetime({offset: true}).parse(row.created_at)).toISOString(), createdBy: row.created_by, changeSummary: row.change_summary});
    if (version.id !== lease.versionId || row.workspace_id !== lease.workspaceId) throw failure("BUILD_VERSION_SCOPE_INVALID");
    const artwork = await dependencies.resolveArtwork(version, signal);
    const workload = websiteBuildInput(version, artwork);
    signal.throwIfAborted();
    // Original asset fetch/preflight may take time; recheck live authority before
    // any untrusted code execution, and again inside the completion transaction.
    await dependencies.sql.query("select makeborne_private.load_project_build($1,$2,$3)", binding);
    signal.throwIfAborted();
    const built = await dependencies.build(workload, signal);
    if (built.status === "failed") {
      await dependencies.sql.query("select makeborne_private.fail_project_build($1,$2,$3)", binding);
      return {state: "failed" as const};
    }
    try {
      signal.throwIfAborted();
      const receipt = validateBuildReceipt(built.receipt, workload);
      await retainCompiledOutput(dependencies.outputStore, lease.workspaceId, receipt, built.readFile, signal);
      // Retention can take time: completion repeats the live fence/session/source checks.
      signal.throwIfAborted();
      const completed = (await dependencies.sql.query("select makeborne_private.complete_project_build($1,$2,$3,$4) as result", [...binding, receipt])).rows[0]?.result;
      return z.object({state: z.literal("compiled"), versionId: z.literal(version.id), replayed: z.boolean(), readyForPublication: z.literal(false)}).strict().parse(completed);
    } finally {await built.dispose();}
  };
}

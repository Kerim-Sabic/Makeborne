import "server-only";
import { z } from "zod";

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
type Bucket = { remove: (paths: string[]) => PromiseLike<{ error: { message?: string } | null }> };
export type CleanupDatabase = { rpc: Rpc; storage: { from: (bucket: string) => Bucket } };
export type CleanupResult = { swept: number; removed: number; failed: number; waiting: number };

const OBJECT_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/portal\/[0-9a-f-]{36}\.webp$/;
const Taken = z.object({ paths: z.array(z.string()), waiting: z.number().int().nonnegative() });

/**
 * Removes client photos that are no longer needed: first sweeps photos unused for 30 days
 * (for one site, or everywhere when artifactId is null), then empties the database's queue of
 * stored objects to delete (client deletes, sweeps and cascades all queue there). Objects are
 * forgotten only after storage confirms the removal; failures stay queued with backoff.
 * Only <workspace>/<project>/portal/<id>.webp objects are ever removed.
 */
export async function purgePortalUploads(db: CleanupDatabase, artifactId: string | null, limit = 50): Promise<CleanupResult> {
  const swept = await db.rpc("makeborne_portal_sweep_unused_uploads", { p_artifact: artifactId, p_limit: limit });
  if (swept.error) throw new Error(`sweep failed: ${swept.error.code ?? "unknown"}`);
  const taken = await db.rpc("makeborne_portal_take_upload_trash", { p_limit: limit });
  if (taken.error) throw new Error(`queue failed: ${taken.error.code ?? "unknown"}`);
  const queue = Taken.parse(taken.data);
  const paths = queue.paths.filter(path => OBJECT_PATH.test(path));
  const sweptCount = z.object({ removed: z.number().int().nonnegative() }).parse(swept.data).removed;
  if (!paths.length) return { swept: sweptCount, removed: 0, failed: queue.paths.length, waiting: queue.waiting };
  const removed = await db.storage.from("project-assets").remove(paths);
  // A missing object counts as removed; any error keeps the batch queued for a later attempt.
  if (removed.error) return { swept: sweptCount, removed: 0, failed: queue.paths.length, waiting: queue.waiting };
  const cleared = await db.rpc("makeborne_portal_clear_upload_trash", { p_paths: paths });
  if (cleared.error) throw new Error(`clear failed: ${cleared.error.code ?? "unknown"}`);
  return { swept: sweptCount, removed: paths.length, failed: queue.paths.length - paths.length, waiting: Math.max(0, queue.waiting - paths.length) };
}

/**
 * Export and deletion jobs over a server-key Supabase client. Framework-free (no Next,
 * no "server-only") so the local-stack check can run exactly this code; server.ts wires
 * it to the app. Never import this from browser code: it needs the server key.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXPORT_RETENTION_HOURS } from "./contracts";
import { runAccountDeletion, type DeletionClaim, type DeletionDeps, type StepResult } from "./deletion-job";
import { buildAccountExport, type ExportDeps } from "./export-builder";

export type Db = SupabaseClient;
export const EXPORT_BUCKET = "account-exports";

/** Structured operational log: request id, event and code only. */
export function rightsLog(kind: "export" | "deletion", entry: Record<string, string | number | undefined>) {
  console.info(JSON.stringify({ event: `account_${kind}`, ...entry }));
}

export async function rpc<T>(db: Db, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    if (error.code === "MBD10") throw Object.assign(new Error("lease lost"), { code: "MBD10" });
    throw Object.assign(new Error("ACCOUNT_RIGHTS_UNAVAILABLE"), { code: /^[A-Z0-9]{5}$/.test(error.code ?? "") ? `DB_${error.code}` : "ACCOUNT_RIGHTS_UNAVAILABLE" });
  }
  return data as T;
}

/** Build one queued export (or one whose build stopped), upload its parts and mark it ready. */
export async function runAccountExportWith(db: Db, options: { requestId?: string; websiteSources?: (userId: string) => ExportDeps["websiteSources"] } = {}) {
  const lease = randomUUID();
  const claim = await rpc<{ id: string; userId: string } | null>(db, "makeborne_account_export_claim", { p_lease: lease, p_request: options.requestId ?? null, p_seconds: 280 });
  if (!claim) return { status: "none" as const };
  try {
    const built = await buildAccountExport({
      now: () => new Date(),
      rows: async (source, offset, limit) => rpc<unknown[]>(db, "makeborne_account_export_rows", { p_user: claim.userId, p_source: source, p_offset: offset, p_limit: limit }),
      download: async objectPath => {
        // Registered paths start with the workspace id; anything else is not read.
        if (!/^[0-9a-f-]{36}\//.test(objectPath)) return null;
        const { data } = await db.storage.from("project-assets").download(objectPath);
        return data ? new Uint8Array(await data.arrayBuffer()) : null;
      },
      websiteSources: options.websiteSources?.(claim.userId),
    });
    const parts = [];
    for (const part of built.parts) {
      const path = `${claim.userId}/${claim.id}/part-${part.part}.zip`;
      const { error } = await db.storage.from(EXPORT_BUCKET).upload(path, part.bytes, { contentType: "application/zip", upsert: true, cacheControl: "no-store" });
      if (error) throw Object.assign(new Error("upload"), { code: "EXPORT_UPLOAD_FAILED" });
      parts.push({ part: part.part, path, bytes: part.bytes.byteLength, sha256: part.sha256 });
    }
    await rpc(db, "makeborne_account_export_complete", { p_request: claim.id, p_lease: lease, p_parts: parts,
      p_summary: { ...built.summary, files: built.files.included, filesSkipped: built.files.skipped, filesMissing: built.files.missing }, p_hours: EXPORT_RETENTION_HOURS });
    rightsLog("export", { request: claim.id, outcome: "ready", parts: parts.length });
    return { status: "ready" as const, requestId: claim.id };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "EXPORT_FAILED";
    const safe = /^[A-Z0-9_]{2,40}$/.test(code) ? code : "EXPORT_FAILED";
    if (safe !== "MBD10") await db.rpc("makeborne_account_export_fail", { p_request: claim.id, p_lease: lease, p_code: safe });
    rightsLog("export", { request: claim.id, outcome: "failed", code: safe });
    return { status: "failed" as const, requestId: claim.id, code: safe };
  }
}

/** Remove every object below a prefix (folders are walked; at most 10 levels). */
export async function removeStoragePrefix(db: Db, bucket: string, prefix: string) {
  let removed = 0;
  const walk = async (folder: string, depth: number): Promise<void> => {
    if (depth > 10) return;
    // Removed objects drop out of the listing, so list from the start until it is empty.
    for (let round = 0; round < 1000; round++) {
      const { data, error } = await db.storage.from(bucket).list(folder.replace(/\/$/, ""), { limit: 100, offset: 0 });
      if (error) throw Object.assign(new Error("list"), { code: "STORAGE_LIST_FAILED" });
      const files = (data ?? []).filter(item => item.id).map(item => `${folder}${item.name}`);
      const folders = (data ?? []).filter(item => !item.id).map(item => `${folder}${item.name}/`);
      if (!files.length && !folders.length) return;
      for (const sub of folders) await walk(sub, depth + 1);
      if (files.length) {
        const { error: removeError } = await db.storage.from(bucket).remove(files);
        if (removeError) throw Object.assign(new Error("remove"), { code: "STORAGE_REMOVE_FAILED" });
        removed += files.length;
      }
    }
    throw Object.assign(new Error("storage"), { code: "STORAGE_NOT_EMPTY" });
  };
  await walk(prefix.endsWith("/") ? prefix : `${prefix}/`, 0);
  return removed;
}

/** Remove files of exports past their 72 hours, then mark them expired. */
export async function expireAccountExportsWith(db: Db) {
  const due = await rpc<{ id: string; paths: string[] | null }[]>(db, "makeborne_account_export_due_expiry", { p_limit: 50 });
  for (const item of due ?? []) {
    const paths = (item.paths ?? []).filter(path => typeof path === "string");
    if (paths.length) {
      const { error } = await db.storage.from(EXPORT_BUCKET).remove(paths);
      if (error) continue;
    }
    await rpc(db, "makeborne_account_export_mark_expired", { p_request: item.id });
  }
  return (due ?? []).length;
}

/** Database steps through the RPCs, app steps through the server key's auth and storage APIs. */
export function deletionDepsFor(db: Db, options: { removeDomain: (providerId: string) => Promise<void> }): DeletionDeps {
  return {
    newLease: () => randomUUID(),
    claim: (lease, requestId) => rpc<DeletionClaim | null>(db, "makeborne_account_deletion_claim", { p_lease: lease, p_request: requestId ?? null, p_seconds: 280 }),
    step: (id, lease, step) => rpc<StepResult>(db, "makeborne_account_deletion_step", { p_request: id, p_lease: lease, p_step: step }),
    mark: async (id, lease, step) => { await rpc(db, "makeborne_account_deletion_mark", { p_request: id, p_lease: lease, p_step: step }); },
    release: async (id, lease, code) => { await rpc(db, "makeborne_account_deletion_release", { p_request: id, p_lease: lease, p_code: code }); },
    domains: (id, lease) => rpc<{ id: string; providerId: string }[]>(db, "makeborne_account_deletion_domains", { p_request: id, p_lease: lease }),
    removeDomain: options.removeDomain,
    lockSignIn: async userId => {
      const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
      if (error && error.status !== 404) throw Object.assign(new Error("lock"), { code: "AUTH_LOCK_FAILED" });
    },
    removeStorage: (bucket, prefix) => removeStoragePrefix(db, bucket, prefix),
    deleteAuthUser: async userId => {
      const { error } = await db.auth.admin.deleteUser(userId, false);
      if (error && error.status !== 404) throw Object.assign(new Error("auth"), { code: "AUTH_DELETE_FAILED" });
    },
    log: entry => rightsLog("deletion", entry),
  };
}

/** Process due deletions (each request to completion or to its next wait). */
export async function runDueAccountDeletionsWith(db: Db, removeDomain: (providerId: string) => Promise<void>, limit = 3) {
  const results = [];
  for (let index = 0; index < limit; index++) {
    const result = await runAccountDeletion(deletionDepsFor(db, { removeDomain }));
    if (result.status === "none") break;
    results.push(result);
  }
  return results;
}

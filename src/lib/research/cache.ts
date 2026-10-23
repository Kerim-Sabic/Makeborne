import { z } from "zod";
import { EXTRACTOR_VERSION, INACCESSIBLE_REASONS } from "./contract";

/**
 * Tenant-scoped page cache (table client_research_pages). A cache is bound to
 * one actor, workspace and client when it is created; there is no way to read
 * or write another client's pages through it, and the database re-checks the
 * actor's current role on every call. Expired copies are returned flagged
 * `expired` so the reader can refetch, or label the copy stale when a refetch
 * fails.
 */
export const PAGE_TTL_MS = 72 * 3_600_000;
export const FAILURE_TTL_MS = 3_600_000;
export const ROBOTS_TTL_MS = 24 * 3_600_000;
export const MAX_CACHED_PAGE_JSON = 60_000;

export const CachedPageSchema = z.object({
  url: z.string(), finalUrl: z.string().nullable().optional(), status: z.enum(["ok", "inaccessible"]), reason: z.enum(INACCESSIBLE_REASONS).nullable().optional(),
  sha256: z.string().nullable().optional(), bytes: z.number().int().nonnegative().default(0), page: z.record(z.string(), z.unknown()).default({}),
  extractorVersion: z.string(), fetchedAt: z.string(), expiresAt: z.string(), expired: z.boolean().default(false),
});
export type CachedPage = z.infer<typeof CachedPageSchema>;
export type CacheEntry = Omit<CachedPage, "expired">;

export interface ResearchCache {
  read(url: string): Promise<CachedPage | null>;
  put(entry: CacheEntry): Promise<void>;
}

export type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
export type CacheScope = Readonly<{ actorId: string; workspaceId: string; clientId: string }>;

/** A copy is usable while it is unexpired and was made by this extractor version. */
export function usable(entry: CachedPage | null, now: number): boolean {
  return Boolean(entry && !entry.expired && Date.parse(entry.expiresAt) > now && entry.extractorVersion === EXTRACTOR_VERSION);
}

/** The production cache: two service entry points, scoped to one actor, workspace and client. Cache failures never fail research. */
export function rpcCache(rpc: Rpc, scope: CacheScope): ResearchCache {
  return Object.freeze({
    async read(url: string) {
      const { data, error } = await rpc("makeborne_research_pages_read", { p_actor: scope.actorId, p_workspace: scope.workspaceId, p_client: scope.clientId, p_urls: [url] });
      if (error) { if (error.code === "42501" || error.code === "P0002") throw Object.assign(new Error("Research access changed."), { code: error.code }); return null; }
      const rows = z.array(CachedPageSchema).safeParse(data);
      return rows.success ? rows.data.find(row => row.url === url) ?? null : null;
    },
    async put(entry: CacheEntry) {
      if (JSON.stringify(entry.page).length > MAX_CACHED_PAGE_JSON) return;
      const { error } = await rpc("makeborne_research_page_put", { p_actor: scope.actorId, p_workspace: scope.workspaceId, p_client: scope.clientId, p_page: entry });
      if (error && (error.code === "42501" || error.code === "P0002")) throw Object.assign(new Error("Research access changed."), { code: error.code });
    },
  });
}

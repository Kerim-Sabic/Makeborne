import { z } from "zod";

/**
 * Library card facts beyond the listing (audit M06 reconciliation): publication
 * state and client label, read through one authorized, read-only route for the
 * exact set of cards shown, plus the library's sort/client scope and the
 * per-device, per-account view preference. Client-safe.
 */

export type PublicationState = "draft" | "live" | "live-behind";
/** Publication state from the hosted-site row the Publish panel reads; no row or offline is Draft.
 * `renamedOnly`: every version saved after the live one only renamed the project (see `sameExceptTitle`), which is not an unpublished change. */
export function publicationState(currentVersion: number, site: { live: boolean; version_number: number } | null | undefined, renamedOnly = false): PublicationState {
  if (!site?.live) return "draft";
  return site.version_number >= currentVersion || renamedOnly ? "live" : "live-behind";
}
/** At most this many live projects per card-meta request have their rename-only versions verified; the rest keep the plain version comparison. */
export const RENAME_VERIFY_MAX = 8;
type SavedVersion = { content: unknown; style_snapshot: unknown; asset_manifest: unknown };
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`
  : JSON.stringify(value) ?? "null";
/** Two saved versions that differ at most in `content.title`: same content otherwise, same style and the same assets. */
export function sameExceptTitle(a: SavedVersion, b: SavedVersion): boolean {
  const body = (content: unknown) => { if (!content || typeof content !== "object" || Array.isArray(content)) return stable(content); const { title: _title, ...rest } = content as Record<string, unknown>; void _title; return stable(rest); };
  return body(a.content) === body(b.content) && stable(a.style_snapshot) === stable(b.style_snapshot) && stable(a.asset_manifest) === stable(b.asset_manifest);
}
export const PUBLICATION_LABEL: Record<PublicationState, string> = { draft: "Draft", live: "Live", "live-behind": "Live · newer changes not published" };
/** The same states in a few words, for the badge on a grid card; the full label stays in its tooltip and the list view. */
export const PUBLICATION_SHORT: Record<PublicationState, string> = { draft: "Draft", live: "Live", "live-behind": "Live · unpublished changes" };
/** Exact versions behind a state, e.g. for a tooltip: never a guess when the live version is unknown. */
export function publicationDetail(state: PublicationState, currentVersion: number, liveVersion: number | null): string {
  if (state === "draft") return "Not published.";
  if (liveVersion === null) return PUBLICATION_LABEL[state];
  if (state === "live" && currentVersion > liveVersion) return `Version ${liveVersion} is live. Later versions only rename the project.`;
  return state === "live" ? `Version ${liveVersion} is live.` : `Version ${liveVersion} is live. Version ${currentVersion} is saved but not published.`;
}

export const CARD_META_MAX = 50;
/** A published address is only ever http(s) and only accompanies a live state; a draft never carries one. */
const LiveAddress = z.string().max(400).url().refine(value => /^https?:\/\//.test(value), "http(s) only");
export const CardMetaItemSchema = z.object({
  artifactId: z.string().uuid(), currentVersion: z.number().int().nonnegative(),
  client: z.object({ id: z.string().uuid(), name: z.string().min(1).max(300) }).strict().nullable(),
  publication: z.object({ state: z.enum(["draft", "live", "live-behind"]), liveVersion: z.number().int().nonnegative().nullable(), address: LiveAddress.nullable() }).strict()
    .refine(value => value.state !== "draft" || value.address === null, "A draft has no live address"),
}).strict();
export type CardMetaItem = z.infer<typeof CardMetaItemSchema>;
/** The live address a card may copy or open: only from the authorized hosted-site row, only while Live (or Live with newer changes). */
export function liveAddress(facts: Pick<CardMetaItem, "publication"> | null | undefined): string | null {
  const publication = facts?.publication;
  if (!publication || publication.state === "draft" || !publication.address) return null;
  return LiveAddress.safeParse(publication.address).success ? publication.address : null;
}
export const CardMetaResponseSchema = z.object({ workspaceId: z.string().uuid(), items: z.array(CardMetaItemSchema).max(CARD_META_MAX) }).strict();

/** One request per account + workspace + exact id set; an answer for another key is never shown. */
export const cardMetaKey = (accountId: string, workspaceId: string, artifactIds: readonly string[]) => `${accountId}\n${workspaceId}\n${[...new Set(artifactIds)].sort().join(",")}`;
export const cardMetaPath = (workspaceId: string, artifactIds: readonly string[]) => `/api/cloud/workspaces/${workspaceId}/artifacts/card-meta?ids=${[...new Set(artifactIds)].sort().join(",")}`;
/** Chunks of at most CARD_META_MAX ids, in display order. */
export function cardMetaChunks(artifactIds: readonly string[]) {
  const unique = [...new Set(artifactIds)], chunks: string[][] = [];
  for (let at = 0; at < unique.length; at += CARD_META_MAX) chunks.push(unique.slice(at, at + CARD_META_MAX));
  return chunks;
}
/** The facts a card may show: only for the version its own label names (a stale listing shows none until Refresh). */
export function cardFacts(meta: ReadonlyMap<string, CardMetaItem>, artifact: { id: string; currentVersion: number }) {
  const item = meta.get(artifact.id);
  return item && item.currentVersion === artifact.currentVersion ? item : null;
}

export const LIBRARY_SORTS = { saved: "Recently saved", created: "Newest created", title: "Title (A–Z)" } as const;
export type LibrarySort = keyof typeof LIBRARY_SORTS;
/** "all", "none" (no client) or one client id. */
export type LibraryClientFilter = string;
const Uuid = z.string().uuid();
export function libraryListPath(workspaceId: string, options: { offset?: number; sort: LibrarySort; client: LibraryClientFilter }) {
  const query = new URLSearchParams({ artifactsOffset: String(options.offset ?? 0) });
  if (options.sort !== "saved") query.set("artifactsSort", options.sort);
  if (options.client !== "all") query.set("artifactsClient", options.client);
  return `/api/cloud/workspaces/${workspaceId}?${query}`;
}
/** Server-side validation of the listing scope; anything else is refused, not ignored. */
export function parseLibraryScope(search: URLSearchParams): { sort: LibrarySort; client: LibraryClientFilter } {
  const sort = search.get("artifactsSort") ?? "saved", client = search.get("artifactsClient") ?? "all";
  if (!(sort in LIBRARY_SORTS) || (client !== "all" && client !== "none" && !Uuid.safeParse(client).success)) throw new Error("Invalid library scope");
  return { sort: sort as LibrarySort, client };
}

export type LibraryView = "grid" | "list";
/** Per device and per account: another account on this device never inherits it, and sign-out removes it. */
export const libraryViewKey = (accountId: string) => `makeborne.library-view.v1.${accountId}`;
export function readLibraryView(storage: Pick<Storage, "getItem"> | null, accountId: string | null): LibraryView {
  if (!storage || !accountId) return "grid";
  try { return storage.getItem(libraryViewKey(accountId)) === "list" ? "list" : "grid"; } catch { return "grid"; }
}
export function writeLibraryView(storage: Pick<Storage, "setItem"> | null, accountId: string | null, view: LibraryView) {
  if (!storage || !accountId) return;
  try { storage.setItem(libraryViewKey(accountId), view); } catch { /* The preference is optional. */ }
}
export type LibraryScope = { sort: LibrarySort; client: LibraryClientFilter };
export const DEFAULT_LIBRARY_SCOPE: LibraryScope = { sort: "saved", client: "all" };
export const libraryScopeKey = (scope: LibraryScope) => `${scope.sort}\n${scope.client}`;

/**
 * The library's search text, kind, client and sort in the address bar
 * (`/studio?tab=projects&q=…&kind=…&client=…&sort=…`), so Back/Forward and
 * reload restore them. Only the user's own search text and an opaque client id
 * appear; defaults are omitted; unknown values fall back to defaults; every
 * other parameter (tab, workspace, create, handoff) is kept as it is.
 */
export const LIBRARY_KINDS = ["all", "website", "book", "presentation"] as const;
export type LibraryQuery = { q: string; kind: (typeof LIBRARY_KINDS)[number]; client: LibraryClientFilter; sort: LibrarySort };
export const DEFAULT_LIBRARY_QUERY: LibraryQuery = { q: "", kind: "all", ...DEFAULT_LIBRARY_SCOPE };
export const LIBRARY_QUERY_MAX = 200;
export function readLibraryQuery(search: string): LibraryQuery {
  const query = new URLSearchParams(search);
  const kind = query.get("kind"), client = query.get("client"), sort = query.get("sort");
  return {
    q: (query.get("q") ?? "").slice(0, LIBRARY_QUERY_MAX),
    kind: LIBRARY_KINDS.includes(kind as LibraryQuery["kind"]) ? kind as LibraryQuery["kind"] : "all",
    client: client === "none" || (client && Uuid.safeParse(client).success) ? client.toLowerCase() : "all",
    sort: sort && sort in LIBRARY_SORTS ? sort as LibrarySort : "saved",
  };
}
/** The same address with the library state applied (relative: path + query + hash). */
export function withLibraryQuery(href: string, state: LibraryQuery): string {
  const url = new URL(href, "http://local.invalid");
  for (const key of ["q", "kind", "client", "sort"]) url.searchParams.delete(key);
  const q = state.q.slice(0, LIBRARY_QUERY_MAX);
  if (q.trim()) url.searchParams.set("q", q);
  if (state.kind !== "all") url.searchParams.set("kind", state.kind);
  if (state.client !== "all") url.searchParams.set("client", state.client);
  if (state.sort !== "saved") url.searchParams.set("sort", state.sort);
  return `${url.pathname}${url.search}${url.hash}`;
}

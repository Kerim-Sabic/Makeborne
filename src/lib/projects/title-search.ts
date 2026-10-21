/**
 * Studio library title search (M05). The server searches the titles of every
 * saved project in one workspace the caller can read (never briefs, notes,
 * content or other workspaces) and pages through them with an opaque keyset
 * cursor. In the browser a result belongs to the exact account + workspace +
 * type + query it was requested for: a response for anything else (an older
 * query, another workspace, a previous account) is never shown, and a failed
 * search is an error with Retry, never "no matches". Client-safe.
 */
export const TITLE_QUERY_MAX = 200;
export const TITLE_KINDS = ["all", "website", "book", "presentation"] as const;
export type TitleKindFilter = (typeof TITLE_KINDS)[number];
export type TitleCursor = { createdAt: string; id: string };

export const normalizeTitleQuery = (raw: string) => raw.replace(/\s+/g, " ").trim().slice(0, TITLE_QUERY_MAX);
export const titleSearchKey = (accountId: string, workspaceId: string, kind: string, query: string) =>
  JSON.stringify([accountId, workspaceId, kind, normalizeTitleQuery(query)]);

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The cursor keeps the database's full timestamp precision; a rounded time could skip rows created in the same millisecond. */
export function encodeTitleCursor(cursor: TitleCursor): string {
  if (!TIMESTAMP.test(cursor.createdAt) || !UUID.test(cursor.id)) throw new Error("Invalid title search cursor");
  return `${cursor.createdAt}~${cursor.id.toLowerCase()}`;
}
export function decodeTitleCursor(value: string): TitleCursor | null {
  const [createdAt, id, extra] = value.split("~");
  return extra === undefined && createdAt && id && TIMESTAMP.test(createdAt) && UUID.test(id) ? { createdAt, id: id.toLowerCase() } : null;
}

export type TitleSearchRequest = { query: string; kind: TitleKindFilter; after: TitleCursor | null };
/** Server-side parameters: `q` (1–200 characters after trimming), `kind`, optional `cursor`. Anything else invalid returns null. */
export function parseTitleSearch(params: URLSearchParams): TitleSearchRequest | null {
  const raw = params.get("q") ?? "";
  if (raw.length > TITLE_QUERY_MAX * 2) return null;
  const query = normalizeTitleQuery(raw);
  const kind = params.get("kind") ?? "all";
  const cursor = params.get("cursor");
  const after = cursor === null ? null : decodeTitleCursor(cursor);
  if (!query || !(TITLE_KINDS as readonly string[]).includes(kind) || cursor !== null && !after) return null;
  return { query, kind: kind as TitleKindFilter, after };
}
export function titleSearchPath(workspaceId: string, query: string, kind: string, cursor?: string | null) {
  const params = new URLSearchParams({ q: normalizeTitleQuery(query), kind });
  if (cursor) params.set("cursor", cursor);
  return `/api/cloud/workspaces/${workspaceId}/artifacts?${params}`;
}

export type TitleSearchPage<Item> = { artifacts: Item[]; pagination: { total: number; nextCursor: string | null } };
export type TitleSearch<Item> =
  | { status: "idle"; key: null }
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; items: Item[]; total: number; nextCursor: string | null; more: "idle" | "loading" | "error" }
  | { status: "error"; key: string };
export const idleTitleSearch = <Item>(): TitleSearch<Item> => ({ status: "idle", key: null });

/** First page for `key`, accepted only while `key` is still the one being shown. */
export function firstPage<Item>(current: TitleSearch<Item>, activeKey: string | null, key: string, page: TitleSearchPage<Item>): TitleSearch<Item> {
  if (activeKey !== key) return current;
  return { status: "ready", key, items: page.artifacts, total: page.pagination.total, nextCursor: page.pagination.nextCursor, more: "idle" };
}
/** A further page: appended (without repeating a project) only onto the same key's results. */
export function nextPage<Item extends { id: string }>(current: TitleSearch<Item>, activeKey: string | null, key: string, page: TitleSearchPage<Item>): TitleSearch<Item> {
  if (activeKey !== key || current.status !== "ready" || current.key !== key) return current;
  const seen = new Set(current.items.map(item => item.id));
  return { ...current, items: [...current.items, ...page.artifacts.filter(item => !seen.has(item.id))], total: page.pagination.total, nextCursor: page.pagination.nextCursor, more: "idle" };
}
export function failedSearch<Item>(current: TitleSearch<Item>, activeKey: string | null, key: string, append: boolean): TitleSearch<Item> {
  if (activeKey !== key) return current;
  if (append) return current.status === "ready" && current.key === key ? { ...current, more: "error" } : current;
  return { status: "error", key };
}

/** Results that may be shown and opened for `key`: none while pending, failed or stale. */
export function currentMatches<Item>(search: TitleSearch<Item>, key: string | null): Item[] {
  return key !== null && search.status === "ready" && search.key === key ? search.items : [];
}
export function titleSearchNotice(search: TitleSearch<unknown>, key: string | null): "searching" | "error" | "empty" | null {
  if (key === null) return null;
  if (search.key !== key || search.status === "loading") return "searching";
  if (search.status === "error") return "error";
  return search.items.length ? null : "empty";
}

/** Loaded projects matching the query, in the server's order (newest created first), for the moment before or instead of the full search. */
export function loadedTitleMatches<Item extends { id: string; title: string; kind: string; createdAt: string }>(items: Item[], query: string, kind: string): Item[] {
  const needle = normalizeTitleQuery(query).toLowerCase();
  return items.filter(item => (kind === "all" || item.kind === kind) && item.title.toLowerCase().includes(needle))
    .sort((a, b) => a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

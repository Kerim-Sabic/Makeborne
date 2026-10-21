/**
 * Client command palette search state (⌘K). A result belongs to the exact
 * workspace + query it was requested for: while a newer search is pending, old
 * client rows are not selectable, and a failed request is an error with Retry,
 * never "no matches". Static actions filter locally and stay usable. Client-safe.
 */

export type PaletteSearch<Client> =
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; clients: Client[] }
  | { status: "error"; key: string };

export const searchKey = (workspaceId: string, query: string) => `${workspaceId}\n${query.trim()}`;

/** Client rows that may be shown and chosen for the current key (none while pending, failed or stale). */
export function currentClients<Client>(search: PaletteSearch<Client>, key: string): Client[] {
  return search.status === "ready" && search.key === key ? search.clients : [];
}

/** What the list says below the items: searching, failed (with Retry), empty, or nothing. */
export function searchNotice(search: PaletteSearch<unknown>, key: string, itemCount: number): "searching" | "error" | "empty" | null {
  if (search.key !== key || search.status === "loading") return "searching";
  if (search.status === "error") return "error";
  return itemCount ? null : "empty";
}

/** A valid active index for the visible items; -1 when there is nothing to choose. */
export const clampActive = (active: number, itemCount: number) => itemCount ? Math.min(Math.max(active, 0), itemCount - 1) : -1;

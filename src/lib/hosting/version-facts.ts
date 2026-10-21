/**
 * Saved, checked and live: three independent facts about a website (audit M07,
 * reconciliation part-2 #72/#79). "Saved" is the editor's current version,
 * "checked" is the latest saved version (without unsaved changes) that an explicit
 * pre-publish check ran on in this browser session, and "live" is what the
 * publication status reports. None of them implies the others. Client-safe.
 */

export type ScopeIds = { accountId: string; workspaceId: string; artifactId: string };
/** What ran: the search & sharing checklist (saved source or prepared output) or the rendered-state colour check. */
export type CheckKind = "search" | "rendered-contrast";
export type CheckRecord = { version: number; kind: CheckKind; at: string; prepared: boolean };

const PREFIX = "makeborne-checked-v1";
export const checkRecordKey = (scope: ScopeIds) => `${PREFIX}:${scope.accountId}:${scope.workspaceId}:${scope.artifactId}`;

/** A stored record, or null when it is missing, malformed or for another scope. */
export function parseCheckRecord(raw: string | null): CheckRecord | null {
  if (!raw || raw.length > 400) return null;
  try {
    const value = JSON.parse(raw) as Partial<CheckRecord>;
    if (!Number.isInteger(value.version) || (value.version as number) < 1 || !["search", "rendered-contrast"].includes(value.kind as string)
      || typeof value.at !== "string" || Number.isNaN(Date.parse(value.at)) || typeof value.prepared !== "boolean") return null;
    return { version: value.version as number, kind: value.kind as CheckKind, at: value.at, prepared: value.prepared };
  } catch { return null; }
}

/** Only a check of a saved version with no unsaved changes names a checked version. */
export function checkCounts(version: number, dirty: boolean) { return Number.isInteger(version) && version >= 1 && !dirty; }

export type LiveFact = number | "offline" | "error" | undefined;
export type VersionFacts = {
  saved: string; checked: string; live: string;
  /** Plain warning when the editor has saved work the public site doesn't show. */
  notice: string | null;
  checkedVersion: number | null; liveVersion: number | null;
};

export function versionFacts(input: { saved: number; dirty: boolean; checked: CheckRecord | null; live: LiveFact }): VersionFacts {
  const { saved, dirty, checked, live } = input;
  const liveVersion = typeof live === "number" ? live : null;
  const checkedVersion = checked && checked.version <= saved ? checked.version : null;
  const savedText = saved < 1 ? "Not saved yet" : dirty ? `Saved version ${saved} · newer edits not saved` : `Saved version ${saved}`;
  const checkedText = checkedVersion === null ? "Not checked yet"
    : `Checked version ${checkedVersion}${checked!.prepared ? " (prepared pages)" : ""}${checkedVersion < saved ? " · older than saved" : ""}`;
  const liveText = live === undefined ? "Checking live version…" : live === "error" ? "Couldn’t check what’s live" : live === "offline" ? "Not live" : `Live version ${live}`;
  let notice: string | null = null;
  if (liveVersion !== null && saved > liveVersion) notice = `Newer saved changes aren’t live yet: version ${saved} is saved, version ${liveVersion} is live. Publish to update the site.`;
  else if (liveVersion !== null && dirty) notice = `Your unsaved edits aren’t live. Version ${liveVersion} is live.`;
  return { saved: savedText, checked: checkedText, live: liveText, notice, checkedVersion, liveVersion };
}

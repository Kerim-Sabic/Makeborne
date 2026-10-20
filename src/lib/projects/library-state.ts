/** What the account project list actually knows. A count alone cannot tell "none" from "not loaded yet". */
export type AccountLibraryStatus =
  | { state: "checking" }
  | { state: "unavailable"; reason: "cloud-off" | "signed-out" }
  | { state: "loading" }
  | { state: "loaded"; count: number }
  | { state: "failed" };

export type AccountLibraryInput = {
  /** Result of the capability check that decides whether account projects exist on this deployment. */
  cloud: "unknown" | "available" | "off" | "error";
  authReady: boolean;
  accountId: string | null;
  busy: boolean;
  /** Projects in the loaded snapshot, or null while no snapshot has been loaded. */
  loadedCount: number | null;
  /** The account's workspace list loaded and it has no workspace to read. */
  noWorkspace: boolean;
  /** A load error is showing. */
  failed: boolean;
};

export function accountLibraryStatus(input: AccountLibraryInput): AccountLibraryStatus {
  if (input.cloud === "error") return { state: "failed" };
  if (input.cloud === "off") return { state: "unavailable", reason: "cloud-off" };
  if (input.cloud === "unknown" || !input.authReady) return { state: "checking" };
  if (!input.accountId) return { state: "unavailable", reason: "signed-out" };
  // A refresh that fails after a successful load keeps showing the loaded list.
  if (input.loadedCount !== null && !input.busy) return { state: "loaded", count: input.loadedCount };
  if (input.busy) return { state: "loading" };
  if (input.failed) return { state: "failed" };
  if (input.noWorkspace) return { state: "loaded", count: 0 };
  return { state: "loading" };
}

/**
 * Whether the studio may show its "Your projects will live here" welcome.
 * It is a claim that nothing is saved, so it needs evidence: device projects
 * are known and empty, and account projects are known to be empty or do not
 * apply (cloud off or signed out). Loading shows progress instead, and a failed
 * load shows the error and Retry, never a friendly empty state.
 */
export function projectsWelcome(deviceProjectCount: number, status: AccountLibraryStatus): "welcome" | "none" | "pending" {
  if (deviceProjectCount > 0) return "none";
  switch (status.state) {
    case "checking":
    case "loading": return "pending";
    case "failed": return "none";
    case "unavailable": return "welcome";
    case "loaded": return status.count === 0 ? "welcome" : "none";
  }
}

/**
 * Projects page order. Returning users (saved projects on this device or in
 * the account) get their library first and creation below it; new users keep
 * the prompt-first entry. While the account list is still unknown (checking,
 * loading, failed) the page keeps what this account showed last time on this
 * device, so a returning user's page does not jump on every visit and a
 * refresh or failed reload never flips it. A first visit stays prompt-first.
 */
export type LibraryLayout = "library-first" | "prompt-first";
export function libraryLayout(deviceProjectCount: number, status: AccountLibraryStatus, remembered: boolean | null): LibraryLayout {
  if (deviceProjectCount > 0) return "library-first";
  switch (status.state) {
    case "loaded": return status.count > 0 ? "library-first" : "prompt-first";
    case "unavailable": return "prompt-first";
    case "checking":
    case "loading":
    case "failed": return remembered ? "library-first" : "prompt-first";
  }
}

/** Device-local layout memory: only the last account and whether it had saved projects. Never titles, counts or IDs of projects. */
export const LIBRARY_HINT_KEY = "makeborne.library-layout.v1";
/** Read lazily: merely touching `localStorage` throws where site data is blocked. */
type HintStorage = () => Pick<Storage, "getItem" | "setItem">;
/** The remembered answer for this account; `undefined` accepts the last account on this device while the signed-in account is not known yet. */
export function readLibraryHint(storage: HintStorage, accountId: string | null | undefined): boolean | null {
  if (accountId === null) return null;
  try {
    const value: unknown = JSON.parse(storage().getItem(LIBRARY_HINT_KEY) ?? "null");
    if (!value || typeof value !== "object") return null;
    const hint = value as { accountId?: unknown; returning?: unknown };
    if (typeof hint.accountId !== "string" || typeof hint.returning !== "boolean") return null;
    return accountId === undefined || hint.accountId === accountId ? hint.returning : null;
  } catch { return null; }
}
export function writeLibraryHint(storage: HintStorage, accountId: string, returning: boolean) {
  try { storage().setItem(LIBRARY_HINT_KEY, JSON.stringify({ accountId, returning })); } catch { /* Layout memory is a convenience; the page still decides from loaded data. */ }
}

export function sameLibraryStatus(a: AccountLibraryStatus, b: AccountLibraryStatus) {
  return a.state === b.state && (a.state !== "loaded" || b.state === "loaded" && a.count === b.count)
    && (a.state !== "unavailable" || b.state === "unavailable" && a.reason === b.reason);
}

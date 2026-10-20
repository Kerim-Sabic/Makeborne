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

export function sameLibraryStatus(a: AccountLibraryStatus, b: AccountLibraryStatus) {
  return a.state === b.state && (a.state !== "loaded" || b.state === "loaded" && a.count === b.count)
    && (a.state !== "unavailable" || b.state === "unavailable" && a.reason === b.reason);
}

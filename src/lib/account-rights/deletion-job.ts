/**
 * Account deletion job: runs one due request through every step, in order. Each step
 * is idempotent and recorded in the database, so a stopped run resumes at the first
 * missing step under a new lease. Dependencies are injected so this runs offline.
 * Logs carry the request id, step and a code only, never personal data.
 */
export const DELETION_STEPS = ["recheck", "lock", "unpublish", "domains", "disconnect", "retain", "erase", "storage", "auth", "finish"] as const;
export type DeletionStep = typeof DELETION_STEPS[number];
/** Steps the app performs itself (provider or storage calls); the rest run in the database. */
export const APP_STEPS: readonly DeletionStep[] = ["lock", "domains", "storage", "auth"];

export type DeletionClaim = { id: string; userId: string; subjectRef: string; steps: Record<string, string>; attempts: number; workspaceIds: string[] };
export type StepResult = { step: string; outcome: "done" | "blocked" | "busy"; workspaceIds?: string[] };
export type DeletionDeps = {
  claim(lease: string, requestId?: string): Promise<DeletionClaim | null>;
  step(requestId: string, lease: string, step: DeletionStep): Promise<StepResult>;
  mark(requestId: string, lease: string, step: DeletionStep): Promise<void>;
  release(requestId: string, lease: string, code: string): Promise<void>;
  domains(requestId: string, lease: string): Promise<{ id: string; providerId: string }[]>;
  /** Detach one custom hostname from the edge provider. A missing hostname counts as removed. */
  removeDomain(providerId: string): Promise<void>;
  /** Block new sign-ins and token refresh for the account while it is deleted. */
  lockSignIn(userId: string): Promise<void>;
  /** Remove every object under the prefix in the bucket; returns how many were removed. */
  removeStorage(bucket: "project-assets" | "account-exports", prefix: string): Promise<number>;
  /** Remove the sign-in record. A record that is already gone counts as removed. */
  deleteAuthUser(userId: string): Promise<void>;
  log(entry: { request: string; step: string; outcome: string; code?: string }): void;
  newLease(): string;
};
export type DeletionRun = { status: "none" | "completed" | "blocked" | "busy" | "failed"; requestId?: string; step?: DeletionStep; code?: string };

const codeOf = (error: unknown) => {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code) ? code : "STEP_FAILED";
};

export async function runAccountDeletion(deps: DeletionDeps, options: { requestId?: string } = {}): Promise<DeletionRun> {
  const lease = deps.newLease();
  const claim = await deps.claim(lease, options.requestId);
  if (!claim) return { status: "none" };
  const done = new Set(Object.keys(claim.steps ?? {}));
  let workspaceIds = [...(claim.workspaceIds ?? [])];
  for (const step of DELETION_STEPS) {
    if (done.has(step)) continue;
    try {
      if (APP_STEPS.includes(step)) {
        if (step === "lock") await deps.lockSignIn(claim.userId);
        else if (step === "domains") for (const domain of await deps.domains(claim.id, lease)) await deps.removeDomain(domain.providerId);
        else if (step === "storage") {
          for (const workspace of workspaceIds) await deps.removeStorage("project-assets", `${workspace}/`);
          await deps.removeStorage("account-exports", `${claim.userId}/`);
        } else if (step === "auth") await deps.deleteAuthUser(claim.userId);
        await deps.mark(claim.id, lease, step);
      } else {
        const result = await deps.step(claim.id, lease, step);
        if (result.workspaceIds) workspaceIds = [...new Set([...workspaceIds, ...result.workspaceIds])];
        if (result.outcome === "blocked") { deps.log({ request: claim.id, step, outcome: "blocked" }); return { status: "blocked", requestId: claim.id, step }; }
        if (result.outcome === "busy") {
          await deps.release(claim.id, lease, "BUSY");
          deps.log({ request: claim.id, step, outcome: "busy", code: "BUSY" });
          return { status: "busy", requestId: claim.id, step, code: "BUSY" };
        }
      }
      deps.log({ request: claim.id, step, outcome: "done" });
    } catch (error) {
      const code = codeOf(error);
      // Release so the next run resumes here; the lease-lost case has nothing to release.
      if (code !== "MBD10") await deps.release(claim.id, lease, code).catch(() => undefined);
      deps.log({ request: claim.id, step, outcome: "failed", code });
      return { status: "failed", requestId: claim.id, step, code };
    }
  }
  return { status: "completed", requestId: claim.id };
}

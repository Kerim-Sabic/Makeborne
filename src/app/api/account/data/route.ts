import { accountDataStatus } from "@/lib/account-rights/contracts";
import { rightsError, rightsJson } from "@/lib/account-rights/http";
import { accountDeletionEnabled, accountDeletionGraceDays, accountExportEnabled, accountRightsStatus, requireRightsUser } from "@/lib/account-rights/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Settings > Your data: exports, any deletion request, and what would block a deletion. */
export async function GET() {
  try {
    const exportEnabled = accountExportEnabled(), deletionEnabled = accountDeletionEnabled();
    const user = await requireRightsUser();
    // A request made while the feature was on stays visible (and cancellable) after it is turned off.
    const raw = await accountRightsStatus(user.id);
    return rightsJson(accountDataStatus(raw, { exportEnabled, deletionEnabled, email: user.email ?? null, graceDays: accountDeletionGraceDays() }));
  } catch (error) { return rightsError(error); }
}

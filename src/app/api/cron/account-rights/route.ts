import { authorizedCron } from "@/lib/server/cron-auth";
import { accountDeletionEnabled, accountExportEnabled, expireAccountExports, purgeRetainedRecords, runAccountExport, runDueAccountDeletions } from "@/lib/account-rights/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };

/**
 * Account data rights tick (bearer CRON_SECRET; NOT scheduled in vercel.json yet —
 * Codex wires the schedule). Removes expired export files, retries exports whose
 * build stopped, runs deletions whose grace period has ended, and drops retained
 * records past their period. Each part is off unless its flag is exactly "on".
 */
async function handle(request: Request) {
  const exportOn = accountExportEnabled(), deletionOn = accountDeletionEnabled();
  if (!exportOn && !deletionOn) return Response.json({ error: { code: "JOB_DISABLED", message: "Account data rights are disabled." } }, { status: 503, headers });
  if (!authorizedCron(request)) return Response.json({ error: { code: "UNAUTHORIZED", message: "Not authorized." } }, { status: 401, headers });
  const expired = await expireAccountExports();
  const exports = [];
  if (exportOn) for (let index = 0; index < 2; index++) {
    const result = await runAccountExport();
    if (result.status === "none") break;
    exports.push(result);
  }
  const deletions = deletionOn ? await runDueAccountDeletions(3) : [];
  const retainedPurged = deletionOn ? await purgeRetainedRecords() : 0;
  return Response.json({ expired, exports, deletions, retainedPurged }, { headers });
}
export const GET = handle;
export const POST = handle;

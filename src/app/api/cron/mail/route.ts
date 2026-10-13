import { billingDatabase } from "@/lib/billing/database";
import { automationEnabled } from "@/lib/mail/config";
import { processDueEnrollments, syncReplies } from "@/lib/mail/engine";
import { authorizedCron } from "@/lib/server/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };

/**
 * Email automation tick (Vercel Cron, GET with the bearer secret), every 10
 * minutes: record replies first (so sequences stop), then send due steps.
 * Disabled unless MAKEBORNE_MAIL_AUTOMATION_ENABLED=true.
 */
async function handle(request: Request) {
  if (!automationEnabled()) return Response.json({ error: { code: "JOB_DISABLED", message: "Email automation is disabled." } }, { status: 503, headers });
  if (!authorizedCron(request)) return Response.json({ error: { code: "UNAUTHORIZED", message: "Not authorized." } }, { status: 401, headers });
  const db = billingDatabase();
  const replies = await syncReplies({ db });
  const failedReplySyncSet = new Set(replies.failedAccountIds);
  const sends = await processDueEnrollments({ db }, { limit: 60, failedReplySyncSet });
  return Response.json({ replies, sends }, { headers });
}
export const GET = handle;
export const POST = handle;

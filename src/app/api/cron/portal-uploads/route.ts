import { billingDatabase } from "@/lib/billing/database";
import { purgePortalUploads } from "@/lib/portal/upload-cleanup";
import { authorizedCron } from "@/lib/server/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };

/**
 * Daily clean-up of client portal photos (GET or POST with the bearer CRON_SECRET): removes
 * photos unused for 30 days everywhere and empties the queue of stored objects to delete.
 * Uploads and deletes already clean up their own site, so this only catches the rest.
 */
async function handle(request: Request) {
  if (!authorizedCron(request)) return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401, headers });
  const totals = { swept: 0, removed: 0, failed: 0, waiting: 0, batches: 0 };
  try {
    const db = billingDatabase();
    const deadline = Date.now() + 240_000;
    // Up to 20 batches of 100: stop early once a batch finds nothing more to do.
    while (totals.batches < 20 && Date.now() < deadline) {
      const result = await purgePortalUploads(db, null, 100);
      totals.batches++; totals.swept += result.swept; totals.removed += result.removed; totals.failed += result.failed; totals.waiting = result.waiting;
      if (result.swept + result.removed + result.failed === 0) break;
    }
    console.info(JSON.stringify({ job: "portal_uploads", status: "ok", ...totals }));
    return Response.json({ status: "ok", ...totals }, { headers });
  } catch {
    console.error(JSON.stringify({ job: "portal_uploads", status: "failed", code: "PORTAL_UPLOADS_JOB_UNAVAILABLE" }));
    return Response.json({ error: { code: "PORTAL_UPLOADS_JOB_UNAVAILABLE" } }, { status: 503, headers });
  }
}
export const GET = handle;
export const POST = handle;

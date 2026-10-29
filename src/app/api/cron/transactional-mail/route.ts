import { runConfirmationSweep } from "@/lib/billing/purchase-confirmations";
import { authorizedCron } from "@/lib/server/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store" };

/**
 * Confirmation and acknowledgement outbox, for a frequent scheduler (every 5 minutes; Vercel Pro or a
 * reviewed external scheduler sends GET with the cron bearer secret). Each confirmation is already sent
 * right after it is queued and due retries ride on every webhook; this only shortens retry gaps.
 */
async function handle(request: Request) {
  if (!authorizedCron(request)) return Response.json({ error: { code: "UNAUTHORIZED", message: "Not authorized." } }, { status: 401, headers });
  const result = await runConfirmationSweep(undefined, { confirmations: 50, mail: 50 });
  if ("error" in result) return Response.json({ ...result, status: "failed" }, { status: 503, headers });
  // Fulfilment remains independent of email, but an operator's mail monitor must
  // see provider refusals, failed records and unmapped paid plans as failures.
  const failed = result.confirmations.failed > 0 || result.confirmations.skipped > 0 || result.mail.failed > 0;
  const enabled = result.mail.enabled;
  const status = failed ? "failed" : enabled ? "healthy" : "disabled";
  return Response.json({ ...result, status }, { status: failed || !enabled ? 503 : 200, headers });
}

export const GET = handle;
export const POST = handle;

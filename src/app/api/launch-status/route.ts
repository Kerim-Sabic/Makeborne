import { salesOpenNow } from "@/lib/launch/sales-open";
import { launchConfig } from "@/lib/launch/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public and anonymous: the server clock (for big client skew) and whether plans are on sale right now.
// The sales answer is the checkout's own gate (src/lib/launch/sales-open.ts); checkout always rechecks it.
// Cached per instance for 30 seconds, however many visitors ask.
let cached: { at: number; value: Promise<boolean> } | null = null;
function salesOpen(now: number) {
  if (!cached || now - cached.at > 30_000) cached = { at: now, value: salesOpenNow().catch(() => false) };
  return cached.value;
}

export async function GET() {
  const config = launchConfig();
  const open = config.enabled ? await salesOpen(Date.now()) : false;
  return Response.json(
    { now: Date.now(), launchAt: new Date(config.launchAt).toISOString(), enabled: config.enabled, salesOpen: open },
    { headers: { "Cache-Control": "no-store" } },
  );
}

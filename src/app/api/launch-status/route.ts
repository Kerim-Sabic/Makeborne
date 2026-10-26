import { plansOnSale } from "@/lib/billing/plans-on-sale";
import { launchConfig } from "@/lib/launch/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public and anonymous: the server clock (for big client skew) and whether plans are on sale right now.
// The sales answer is the same advisory gate the plans page uses; checkout always rechecks it.
// One database check per instance every 30 seconds, however many visitors ask.
let cached: { at: number; value: Promise<boolean> } | null = null;
function salesOpen(now: number) {
  if (!cached || now - cached.at > 30_000) cached = { at: now, value: plansOnSale().catch(() => false) };
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

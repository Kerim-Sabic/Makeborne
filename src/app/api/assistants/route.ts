import { chatEnabled } from "@/lib/experts/start";
import { CHAT_ROUTES } from "@/lib/experts/chat-run";
import { RANK_MODEL } from "@/lib/leads/finder";
import { DISCOVER_MODEL } from "@/lib/leads/discover";
import { builderAvailability } from "@/lib/builder/availability";
import { providerCapacity } from "@/lib/ai/live-run";
import { requirePricedModel } from "@/lib/ai/model-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether the lead finder and the advisors can start a request now, read before
 * anyone types. The same gates their POST routes check first (connected, priced
 * models, provider spending open), in the same order, without reserving credits
 * or calling a provider. Like GET /api/build: reasons only, never amounts.
 * Read-only; the POST routes still decide every request.
 */
export async function GET() {
  let capacity: ReturnType<typeof providerCapacity> | null = null;
  const sharedCapacity = () => (capacity ??= providerCapacity("anthropic"));
  const [leads, advisor] = await Promise.all([
    builderAvailability({ configured: chatEnabled(), priced: () => { requirePricedModel(RANK_MODEL); requirePricedModel(DISCOVER_MODEL); }, capacity: sharedCapacity }),
    builderAvailability({ configured: chatEnabled(), priced: () => requirePricedModel(CHAT_ROUTES.standard.model), capacity: sharedCapacity }),
  ]);
  return Response.json({ leads, advisor }, { headers: { "Cache-Control": "no-store" } });
}

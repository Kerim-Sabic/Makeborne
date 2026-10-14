import { requireBillingUser, requireCreationAccess } from "@/lib/billing/access";
import { CreditTopupInputSchema } from "@/lib/billing/topups-contracts";
import { createTopupCheckout, creditTopupAvailability } from "@/lib/billing/topups";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET() {
  try { return Response.json(await creditTopupAvailability(), { headers }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireBillingUser();
    const parsed = CreditTopupInputSchema.safeParse(await boundedJson(request, 2048));
    if (!parsed.success) throw new RequestError("INVALID_CREDIT_PACK", "Choose an available credit pack and try again.", 400);
    await requireCreationAccess(user);
    return Response.json(await createTopupCheckout(user.id, parsed.data), { headers });
  } catch (error) { return apiError(error); }
}

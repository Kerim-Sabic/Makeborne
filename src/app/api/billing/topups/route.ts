import { requireBillingUser, requireCreationAccess } from "@/lib/billing/access";
import { CreditTopupInputSchema } from "@/lib/billing/topups-contracts";
import { CREDIT_TOPUPS_NOT_OPEN, creditTopupAvailability } from "@/lib/billing/topups";
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
    // Intentionally no provider call. Opening checkout before durable grants,
    // refund handling and the one-time plan mapping exist would charge for
    // credits that this application cannot yet deliver.
    throw new RequestError("TOPUPS_NOT_OPEN", CREDIT_TOPUPS_NOT_OPEN, 503);
  } catch (error) { return apiError(error); }
}

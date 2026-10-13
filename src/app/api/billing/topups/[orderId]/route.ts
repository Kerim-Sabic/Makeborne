import { requireBillingUser } from "@/lib/billing/access";
import { readTopupStatus, topupStatusUnavailable } from "@/lib/billing/topup-status";
import { apiError, RequestError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const user = await requireBillingUser();
    const { orderId } = await params;
    return Response.json(await readTopupStatus(user.id, orderId), { headers });
  } catch (error) {
    const response = apiError(error instanceof RequestError && [400, 401, 404].includes(error.status) ? error : topupStatusUnavailable());
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}

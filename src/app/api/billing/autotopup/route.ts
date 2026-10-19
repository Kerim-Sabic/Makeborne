import { z } from "zod";
import { requireBillingUser } from "@/lib/billing/access";
import { authorizeAutotopup, autotopupStatus, revokeAutotopup } from "@/lib/billing/autotopup";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const InputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable"), confirmed: z.literal(true), termsVersion: z.string().min(1).max(80),
    priceCents: z.number().int().min(100).max(100000), threshold: z.number().int().min(1).max(1000), monthlyLimit: z.number().int().min(1).max(10) }).strict(),
  z.object({ action: z.literal("disable") }).strict(),
]);

export async function GET() {
  try { return Response.json(await autotopupStatus((await requireBillingUser()).id), { headers }); }
  catch (error) { return apiError(error); }
}

/** Enable stores the customer's explicit consent to the exact offer shown; it never charges. Disable stops future charges. */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireBillingUser();
    const parsed = InputSchema.safeParse(await boundedJson(request, 2048));
    if (!parsed.success) throw new RequestError("AUTOTOPUP_INVALID_CHOICE", "Review the automatic top-up details and confirm them.", 400);
    const result = parsed.data.action === "enable" ? await authorizeAutotopup(user.id, parsed.data) : await revokeAutotopup(user.id);
    return Response.json(result, { headers });
  } catch (error) { return apiError(error); }
}

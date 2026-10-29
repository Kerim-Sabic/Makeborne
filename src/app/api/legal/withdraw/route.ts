import { billingUser } from "@/lib/billing/access";
import { billingDatabase } from "@/lib/billing/database";
import { defaultPlanLabel, sendDueMail } from "@/lib/billing/purchase-confirmations";
import { accountPurchaseRecords, submitWithdrawal, withdrawalInput } from "@/lib/legal/withdrawal";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The "Confirm withdrawal" step of /withdraw (Consumer Rights Directive Art. 11a). Stores the
 * notice with server time and queues its acknowledgement; refunds stay with support. */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const parsed = withdrawalInput.safeParse(await boundedJson(request, 16_000));
    if (!parsed.success) throw new RequestError("WITHDRAWAL_INVALID", "Check the fields, then confirm again.", 400);
    const user = await billingUser();
    const db = billingDatabase();
    const rpc = (name: string, args?: Record<string, unknown>) => db.rpc(name, args);
    const account = user?.email ? { id: user.id, email: user.email.toLowerCase() } : null;
    if (user && !account) throw new RequestError("WITHDRAWAL_ACCOUNT", "Your account has no email address. Email admin@makeborne.com instead.", 400);
    const payments = account ? (await accountPurchaseRecords(rpc, account.id))?.payments ?? [] : [];
    const result = await submitWithdrawal(rpc, account, parsed.data, payments, defaultPlanLabel);
    // Best effort: the acknowledgement goes now when mail is on; otherwise the outbox keeps it.
    if (result.acknowledgement === "queued") await sendDueMail(3);
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

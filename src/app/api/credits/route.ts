import { requireBillingUser } from "@/lib/billing/access";
import { ensureTrialCredits, getCreditBalance } from "@/lib/credits/server";
import { apiError, RequestError } from "@/lib/server/http";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET() {
  try {
    const user = await requireBillingUser();
    // Idempotent: a confirmed free-tier account sees its trial on first visit.
    await ensureTrialCredits(user.id).catch(() => undefined);
    const client = await createClient();
    const [balance, ledger] = await Promise.all([
      getCreditBalance(user.id),
      // The user's own session: row-level security limits this to their ledger.
      client.from("credit_ledger").select("id,delta,kind,reference,balance_after,metadata,created_at")
        .eq("user_id", user.id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50),
    ]);
    if (ledger.error) throw new RequestError("CREDITS_UNAVAILABLE", "Credit activity is temporarily unavailable.", 503);
    const entries = (ledger.data ?? []).map(row => ({
      id: row.id as string, kind: row.kind as string, reference: row.reference as string,
      delta: Number(row.delta), balanceAfter: Number(row.balance_after),
      metadata: (row.metadata ?? {}) as Record<string, unknown>, createdAt: row.created_at as string,
    }));
    return Response.json({ ...balance, entries }, { headers });
  } catch (error) { return apiError(error); }
}

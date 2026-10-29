import "server-only";
import { z } from "zod";
import { RequestError } from "@/lib/server/http";
import { composeWithdrawalAcknowledgement, money, serviceLabel, withdrawalStatement } from "./purchase-confirmation";

/** The withdrawal form's input. Signed-out notices give an email; signed-in ones may pick a payment. */
export const withdrawalInput = z.object({
  email: z.string().trim().max(320).optional(),
  name: z.string().trim().max(200).optional(),
  paymentId: z.string().regex(/^pay_[A-Za-z0-9]{1,64}$/).optional(),
  paymentReference: z.string().trim().max(200).optional(),
  message: z.string().trim().max(2000).optional(),
  confirm: z.literal(true),
}).strict();
export type WithdrawalInput = z.infer<typeof withdrawalInput>;

export type AccountPayment = { paymentId: string; kind: "plan" | "pack"; planId?: string; packId?: string; credits?: number; amountCents: number; currency: string; paidAt: string };
export type PlanLabel = { name: string; interval: "monthly" | "yearly"; credits: number } | null;

/** What the notice names, in the words the buyer sees before confirming. */
export function paymentService(payment: AccountPayment, planLabel: (planId: string) => PlanLabel) {
  const plan = payment.kind === "plan" && payment.planId ? planLabel(payment.planId) : null;
  const base = payment.kind === "plan"
    ? plan ? serviceLabel({ kind: "plan", name: plan.name, interval: plan.interval, credits: plan.credits }) : "Makeborne plan"
    : serviceLabel({ kind: "pack", name: "Credit pack", interval: null, credits: Number(payment.credits ?? 0) || 1 });
  const ordered = new Date(payment.paidAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `${base} (${money(payment.amountCents, payment.currency)}, ordered on ${ordered}, Whop payment reference ${payment.paymentId})`;
}

export function noticeService(input: WithdrawalInput, account: { email: string } | null, chosen: AccountPayment | null, planLabel: (planId: string) => PlanLabel) {
  if (chosen) return paymentService(chosen, planLabel);
  const reference = input.paymentReference?.trim();
  if (reference) return `Makeborne purchase with the payment reference ${reference}`;
  return `Makeborne purchase on the account ${(account?.email ?? input.email ?? "").trim().toLowerCase()}`.trim();
}

type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
export type WithdrawalResult = { reference: string; receivedAt: string; acknowledgement: "queued" | "manual"; statement: string; email: string; paymentId: string | null };

/** Stores the notice (server time) and queues its acknowledgement. Never refunds or revokes anything. */
export async function submitWithdrawal(rpc: Rpc, user: { id: string; email: string } | null, input: WithdrawalInput, payments: AccountPayment[], planLabel: (planId: string) => PlanLabel): Promise<WithdrawalResult> {
  if (!user) {
    const email = (input.email ?? "").toLowerCase();
    if (!/^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,63}$/.test(email)) throw new RequestError("WITHDRAWAL_EMAIL", "Enter the email address of your Makeborne account.", 400);
    if (input.paymentId) throw new RequestError("WITHDRAWAL_SIGN_IN", "Sign in to choose a payment, or type its reference instead.", 400);
  }
  const chosen = input.paymentId ? payments.find(item => item.paymentId === input.paymentId) ?? null : null;
  if (input.paymentId && !chosen) throw new RequestError("WITHDRAWAL_PAYMENT", "That payment is not on this account.", 403);
  const statement = withdrawalStatement(noticeService(input, user, chosen, planLabel));
  const { subject, template } = composeWithdrawalAcknowledgement({ statement, paymentId: chosen?.paymentId ?? null,
    paymentReference: chosen ? null : input.paymentReference?.trim() || null, name: input.name?.trim() || null, message: input.message?.trim() || null });
  const { data, error } = await rpc("makeborne_record_withdrawal_request", {
    p_user: user?.id ?? null, p_email: user ? null : input.email ?? null, p_name: input.name?.trim() || null,
    p_payment_reference: chosen ? null : input.paymentReference?.trim() || null, p_payment_id: chosen?.paymentId ?? null,
    p_statement: statement, p_message: input.message?.trim() || null, p_ack_subject: subject, p_ack_template: template,
  });
  if (error) {
    if (error.code === "53400") throw new RequestError("WITHDRAWAL_RATE_LIMITED", "We already have several notices from this address today. Email admin@makeborne.com and we will help.", 429);
    if (error.code === "42501") throw new RequestError("WITHDRAWAL_PAYMENT", "That payment is not on this account.", 403);
    if (error.code === "22023") throw new RequestError("WITHDRAWAL_INVALID", "Check the email address and the fields, then try again.", 400);
    throw new RequestError("WITHDRAWAL_UNSAVED", "Your notice could not be saved. Please email it to admin@makeborne.com; the date you send it counts.", 503);
  }
  const row = data as { reference?: unknown; receivedAt?: unknown; acknowledgement?: unknown; paymentId?: unknown } | null;
  if (typeof row?.reference !== "string" || typeof row.receivedAt !== "string" || (row.acknowledgement !== "queued" && row.acknowledgement !== "manual"))
    throw new RequestError("WITHDRAWAL_UNSAVED", "Your notice could not be confirmed. Please email it to admin@makeborne.com; the date you send it counts.", 503);
  return { reference: row.reference, receivedAt: row.receivedAt, acknowledgement: row.acknowledgement, statement,
    email: user?.email ?? (input.email ?? "").toLowerCase(), paymentId: typeof row.paymentId === "string" ? row.paymentId : null };
}

/** The signed-in account's payments and records for the billing page and the withdrawal form. */
export type PurchaseRecords = {
  confirmations: { id: string; kind: "plan" | "pack"; paymentId: string; product: string; interval: string | null; credits: number; amountCents: number; currency: string; paidAt: string; subject: string; body: string; mail: string; sentAt: string | null }[];
  withdrawals: { reference: string; receivedAt: string; paymentId: string | null; paymentReference: string | null; acknowledgement: string; mail: string }[];
  payments: AccountPayment[];
};

export async function accountPurchaseRecords(rpc: Rpc, userId: string): Promise<PurchaseRecords | null> {
  try {
    const { data, error } = await rpc("makeborne_account_purchase_records", { p_user: userId });
    if (error || !data || typeof data !== "object") return null;
    const value = data as Partial<PurchaseRecords>;
    return { confirmations: Array.isArray(value.confirmations) ? value.confirmations : [], withdrawals: Array.isArray(value.withdrawals) ? value.withdrawals : [],
      payments: Array.isArray(value.payments) ? value.payments : [] };
  } catch { return null; }
}

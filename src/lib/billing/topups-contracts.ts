import { z } from "zod";
import { ExactAmountSchema } from "@/lib/jobs/contracts";
import { CREDIT_TOPUP_CATALOG_VERSION, creditTopupPack } from "./topups-catalog";

const packId = z.enum(["boost_100", "boost_300", "boost_1000"]);
const uuid = z.string().uuid();
const datetime = z.string().datetime();
const integer = /^(0|[1-9][0-9]{0,18})$/;
const positiveAmount = ExactAmountSchema.refine(value => /^[1-9][0-9]{0,18}$/.test(value), "Amount must be positive.");

/** The browser may choose a pack, never its price, credits, owner or entitlement. */
export const CreditTopupInputSchema = z.object({ packId, requestId: uuid }).strict();

/** A future server adapter binds a verified one-time Whop checkout to this row. */
export const CreditTopupPurchaseSchema = z.object({
  id: uuid,
  requestId: uuid,
  userId: uuid,
  creditAccountId: uuid,
  packId,
  catalogVersion: z.literal(CREDIT_TOPUP_CATALOG_VERSION),
  credits: positiveAmount,
  priceCents: positiveAmount,
  currency: z.literal("usd"),
  merchantId: z.string().regex(/^biz_[A-Za-z0-9]+$/),
  planId: z.string().regex(/^plan_[A-Za-z0-9]+$/),
  checkoutId: z.string().regex(/^ch_[A-Za-z0-9]+$/),
  whopUserId: z.string().regex(/^user_[A-Za-z0-9]+$/),
  createdAt: datetime,
}).strict().superRefine((purchase, ctx) => {
  const pack = creditTopupPack(purchase.packId);
  if (!pack || purchase.credits !== String(pack.credits) || purchase.priceCents !== String(pack.priceCents)) ctx.addIssue({ code: "custom", message: "Purchase does not match its server catalog version." });
});

/**
 * Normalized evidence, NEVER a webhook/browser payload. Before supplying this,
 * a trusted adapter must verify the signature, retrieve current Whop records,
 * bind all IDs and normalize original USD principal separately from tax/fees.
 */
export const CreditTopupPaymentSchema = z.object({
  id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  merchantId: z.string().regex(/^biz_[A-Za-z0-9]+$/),
  planId: z.string().regex(/^plan_[A-Za-z0-9]+$/),
  checkoutId: z.string().regex(/^ch_[A-Za-z0-9]+$/),
  whopUserId: z.string().regex(/^user_[A-Za-z0-9]+$/),
  currency: z.literal("usd"),
  principalCents: positiveAmount,
  refundedPrincipalCents: ExactAmountSchema,
  status: z.enum(["pending", "failed", "paid", "refunded"]),
  dispute: z.enum(["none", "open", "won", "lost"]),
  updatedAt: datetime,
}).strict().superRefine((payment, ctx) => {
  if (integer.test(payment.refundedPrincipalCents) && integer.test(payment.principalCents) && BigInt(payment.refundedPrincipalCents) > BigInt(payment.principalCents)) ctx.addIssue({ code: "custom", message: "Refund cannot exceed original principal." });
  if (payment.status === "refunded" && payment.refundedPrincipalCents !== payment.principalCents) ctx.addIssue({ code: "custom", message: "A fully refunded payment requires complete refund evidence." });
  if (["pending", "failed"].includes(payment.status) && payment.refundedPrincipalCents !== "0") ctx.addIssue({ code: "custom", message: "Unpaid payments cannot contain refund evidence." });
});

export type CreditTopupPurchase = z.infer<typeof CreditTopupPurchaseSchema>;
export type CreditTopupPayment = z.infer<typeof CreditTopupPaymentSchema>;

export const CreditTopupStateSchema = z.object({
  purchaseId: uuid,
  payment: CreditTopupPaymentSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["awaiting_payment", "funded", "held", "reversed"]),
  grantedCredits: ExactAmountSchema,
  reversedCredits: ExactAmountSchema,
}).strict().superRefine((state, ctx) => {
  if (integer.test(state.reversedCredits) && integer.test(state.grantedCredits) && BigInt(state.reversedCredits) > BigInt(state.grantedCredits)) ctx.addIssue({ code: "custom", message: "Reversal cannot exceed the original grant." });
  if (state.status === "awaiting_payment" && state.grantedCredits !== "0") ctx.addIssue({ code: "custom", message: "Awaiting payments cannot hold granted credits." });
  if (state.status === "funded" && (state.grantedCredits === "0" || state.reversedCredits !== "0")) ctx.addIssue({ code: "custom", message: "Funded state requires a non-reversed grant." });
  if (state.status === "funded" && (state.payment.status !== "paid" || state.payment.refundedPrincipalCents !== "0" || ["open", "lost"].includes(state.payment.dispute))) ctx.addIssue({ code: "custom", message: "Funded state requires current undisputed payment evidence." });
  if (state.status === "reversed" && state.grantedCredits !== state.reversedCredits) ctx.addIssue({ code: "custom", message: "Reversed state must neutralize the entire grant." });
});
export type CreditTopupState = z.infer<typeof CreditTopupStateSchema>;

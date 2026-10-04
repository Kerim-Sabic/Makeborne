import { CreditTopupPaymentSchema, CreditTopupPurchaseSchema, CreditTopupStateSchema, type CreditTopupPayment, type CreditTopupPurchase, type CreditTopupState } from "./topups-contracts";

export class CreditTopupReconciliationError extends Error {
  constructor(public readonly code: "BINDING_MISMATCH" | "CONFLICTING_EVIDENCE" | "REFUND_REGRESSION" | "STATE_MISMATCH") {
    super("This credit purchase needs reconciliation before any balance changes.");
  }
}

export type CreditTopupEffect = {
  eventKey: string;
  userId: string;
  creditAccountId: string;
  purchaseId: string;
  paymentId: string;
} & ({ kind: "grant" | "reversal"; credits: string } | { kind: "hold" | "release_hold" });

function assertBinding(purchase: CreditTopupPurchase, payment: CreditTopupPayment) {
  if (purchase.merchantId !== payment.merchantId || purchase.planId !== payment.planId
    || purchase.checkoutId !== payment.checkoutId || purchase.whopUserId !== payment.whopUserId
    || purchase.currency !== payment.currency || purchase.priceCents !== payment.principalCents) {
    throw new CreditTopupReconciliationError("BINDING_MISMATCH");
  }
}

/**
 * Pure proposed ledger effects, not funded credits. The eventual database
 * adapter must commit effects + state in one transaction with a revision check,
 * unique payment/purchase binding and unique event keys. Never call from a
 * browser endpoint with supplied payment evidence.
 */
export function reconcileCreditTopup(purchaseInput: unknown, previousInput: unknown | null, paymentInput: unknown): {
  state: CreditTopupState;
  effects: CreditTopupEffect[];
  outcome: "updated" | "duplicate" | "stale";
  needsReview: boolean;
} {
  const purchase = CreditTopupPurchaseSchema.parse(purchaseInput);
  const payment = CreditTopupPaymentSchema.parse(paymentInput);
  const previous = previousInput === null ? null : CreditTopupStateSchema.parse(previousInput);
  assertBinding(purchase, payment);
  if (previous) {
    assertBinding(purchase, previous.payment);
    if (previous.purchaseId !== purchase.id || previous.payment.id !== payment.id
      || (previous.grantedCredits !== "0" && previous.grantedCredits !== purchase.credits)
      || previous.revision === Number.MAX_SAFE_INTEGER) throw new CreditTopupReconciliationError("STATE_MISMATCH");
    if (Date.parse(payment.updatedAt) < Date.parse(previous.payment.updatedAt)) return { state: previous, effects: [], outcome: "stale", needsReview: previous.status === "held" };
    if (Date.parse(payment.updatedAt) === Date.parse(previous.payment.updatedAt)) {
      if (JSON.stringify({ ...payment, updatedAt: previous.payment.updatedAt }) !== JSON.stringify(previous.payment)) throw new CreditTopupReconciliationError("CONFLICTING_EVIDENCE");
      return { state: previous, effects: [], outcome: "duplicate", needsReview: previous.status === "held" };
    }
    if (BigInt(payment.refundedPrincipalCents) < BigInt(previous.payment.refundedPrincipalCents)) throw new CreditTopupReconciliationError("REFUND_REGRESSION");
    if (previous.grantedCredits !== "0" && ["pending", "failed"].includes(payment.status)) throw new CreditTopupReconciliationError("CONFLICTING_EVIDENCE");
  }

  const revision = previous ? previous.revision + 1 : 0;
  const effects: CreditTopupEffect[] = [];
  const effect = (change: { kind: "grant" | "reversal"; credits: string } | { kind: "hold" | "release_hold" }) => effects.push({
    eventKey: `credit_topup:${payment.id}:${change.kind}${change.kind === "hold" || change.kind === "release_hold" ? `:${revision}` : ""}`,
    ...change, userId: purchase.userId, creditAccountId: purchase.creditAccountId,
    purchaseId: purchase.id, paymentId: payment.id,
  });
  let grantedCredits = previous?.grantedCredits ?? "0";
  let reversedCredits = previous?.reversedCredits ?? "0";
  let status: CreditTopupState["status"] = "awaiting_payment";
  const fullyRefunded = payment.refundedPrincipalCents === payment.principalCents;
  const partiallyRefunded = payment.refundedPrincipalCents !== "0" && !fullyRefunded;

  if (fullyRefunded || previous?.status === "reversed") {
    // Refund-before-success creates a tombstone so a delayed payment cannot
    // grant credits. Already consumed credits become a debt/adjustment in the
    // durable wallet, never silently restored or dropped by an insufficient balance.
    if (grantedCredits !== reversedCredits) effect({ kind: "reversal", credits: (BigInt(grantedCredits) - BigInt(reversedCredits)).toString() });
    if (previous?.status === "held") effect({ kind: "release_hold" });
    reversedCredits = grantedCredits;
    status = "reversed";
  } else if (partiallyRefunded || payment.dispute === "open" || payment.dispute === "lost") {
    // Partial refund allocation and lost-dispute settlement require a reviewed
    // policy. Hold this grant instead of inventing a proportional cash balance.
    if (previous?.status !== "held") effect({ kind: "hold" });
    status = "held";
  } else if (payment.status === "paid") {
    if (grantedCredits === "0") { effect({ kind: "grant", credits: purchase.credits }); grantedCredits = purchase.credits; }
    if (previous?.status === "held") effect({ kind: "release_hold" });
    status = "funded";
  } else if (previous?.status === "held") {
    effect({ kind: "release_hold" });
  }
  const state = CreditTopupStateSchema.parse({ purchaseId: purchase.id, payment, revision, status, grantedCredits, reversedCredits });
  return { state, effects, outcome: "updated", needsReview: status === "held" };
}

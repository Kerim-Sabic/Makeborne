import type { AutotopupStatus } from "./autotopup-consent";

/**
 * Display rules for the automatic top-up panel (audit: top-up panel gaps).
 * Revoking an existing authorization never depends on the current offer;
 * saved consent is not described as active charging; and a request whose
 * result is unknown is reconciled from the server's status instead of being
 * reported as "nothing changed". Client-safe; it never charges.
 */

export type PostOutcome = { kind: "saved"; status: AutotopupStatus } | { kind: "rejected"; message: string } | { kind: "uncertain" };
export type Choice = { termsVersion: string; priceCents: number; threshold: number; monthlyLimit: number };

/** A definite answer is either the new status or the server's refusal; everything else is unknown. */
export function postOutcome(ok: boolean, httpStatus: number, body: unknown): PostOutcome {
  const value = body as { offer?: unknown; error?: { message?: unknown } } | null;
  if (ok) return value && typeof value === "object" && value.offer ? { kind: "saved", status: value as AutotopupStatus } : { kind: "uncertain" };
  // A refused request (validation, sign-in, changed offer) changed nothing; timeouts and server errors may have.
  const refused = httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408;
  const message = typeof value?.error?.message === "string" ? value.error.message : null;
  return refused && message ? { kind: "rejected", message } : { kind: "uncertain" };
}

export function panelHeading(status: AutotopupStatus): string {
  if (!status.authorization) return "Automatic top-ups";
  return status.offer.chargingEnabled ? "Automatic top-ups are on" : "Automatic top-ups: authorization saved";
}

/** The saved authorization no longer matches the current offer, so it cannot be used to charge. */
export function offerChanged(status: AutotopupStatus): boolean {
  const { offer, authorization } = status;
  return !!authorization && (offer.priceCents === null || authorization.priceCents !== offer.priceCents || authorization.termsVersion !== offer.termsVersion);
}

/** After an unknown result, what the server's status says happened. */
export function reconcile(action: "enable" | "disable", before: AutotopupStatus, after: AutotopupStatus, choice: Choice | null): { saved: boolean; message: string } {
  if (action === "disable") return after.authorization
    ? { saved: false, message: "Your authorization is still saved: turning it off didn't go through. You can try again." }
    : { saved: true, message: "Automatic top-ups are off. No future automatic charges will be made." };
  const saved = !!after.authorization && !!choice && after.authorization.id !== before.authorization?.id
    && after.authorization.priceCents === choice.priceCents && after.authorization.termsVersion === choice.termsVersion
    && after.authorization.thresholdCredits === choice.threshold && after.authorization.monthlyLimitCharges === choice.monthlyLimit;
  return saved ? { saved: true, message: "Your authorization was saved." } : { saved: false, message: "Your authorization wasn't saved. Review the details and try again." };
}

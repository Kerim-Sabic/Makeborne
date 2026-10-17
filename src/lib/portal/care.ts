/**
 * Client care plans: the agency charges its own client a recurring fee through its own payment
 * link and records payments it received. Status (UTC dates): paid → due for 7 days after the
 * paid-through date (reminder) → paused (portal read-only; the website is never affected).
 * Shared by the routes and the UI. Client-safe.
 */
import { z } from "zod";

export const CARE_GRACE_DAYS = 7;
export type CareStatus = "none" | "paid" | "due" | "paused";
export type CareInterval = "month" | "quarter" | "year";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const status = z.enum(["none", "paid", "due", "paused"]);
const interval = z.enum(["month", "quarter", "year"]);
const money = { amountCents: z.number().int().min(0).max(100_000_000).nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable() };
const statusFields = { status, paidThrough: day.optional(), dueOn: day.optional(), pausesOn: day.optional() };

/** Same rule as the database: a full https:// address without credentials, spaces, quotes or backslashes. */
export const PAYMENT_LINK = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[^\s<>"'`\\]*)?$/;
export const paymentLink = z.string().trim().max(500).regex(PAYMENT_LINK, "Use the full https:// payment link from your payment provider.");

/** What the client sees (portal). */
export const CareBillingSchema = z.object({ label: z.string(), ...money, interval, paymentUrl: paymentLink.nullable(), ...statusFields });
export type CareBilling = z.infer<typeof CareBillingSchema>;

/** What the agency sees. */
export const CarePlanSchema = z.object({ clientId: z.string().uuid(), label: z.string(), ...money, interval, paymentUrl: z.string().nullable(), active: z.boolean(), updatedAt: z.string(), ...statusFields });
export type CarePlan = z.infer<typeof CarePlanSchema>;
export const CarePaymentSchema = z.object({ id: z.string().uuid(), ...money, coversFrom: day, coversTo: day, note: z.string(), recordedAt: z.string(), undoneAt: z.string().nullable() });
export type CarePayment = z.infer<typeof CarePaymentSchema>;
export const CarePlanResponseSchema = z.object({ plan: CarePlanSchema.nullable(), payments: z.array(CarePaymentSchema) });
/** GET/PUT .../clients/[clientId]/care-plan, POST .../payments, DELETE .../payments/[id] */
export type CarePlanResponse = z.infer<typeof CarePlanResponseSchema>;
export const CareOverviewSchema = z.array(CarePlanSchema.extend({ clientName: z.string() }));
/** GET .../care-plans: every plan in the workspace, paused and due first. */
export type CareOverview = { available: boolean; plans: z.infer<typeof CareOverviewSchema> };

/** PUT .../clients/[clientId]/care-plan */
export const CarePlanUpdateSchema = z.object({
  label: z.string().trim().min(1, "Give the plan a short name.").max(80).regex(/^[^<>\n]*$/),
  amountCents: z.number().int().min(0).max(100_000_000).nullable(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullable(),
  interval,
  paymentUrl: paymentLink.nullable(),
  paidThrough: day.nullable(),
  active: z.boolean(),
}).strict().refine(value => (value.amountCents === null) === (value.currency === null), { message: "Enter the price with its currency, or leave both empty." });
/** POST .../care-plan/payments (Idempotency-Key header required) */
export const CarePaymentCreateSchema = z.object({ note: z.string().trim().max(300).regex(/^[^<>]*$/).default("") }).strict();

export const INTERVAL_LABEL: Record<CareInterval, string> = { month: "month", quarter: "quarter", year: "year" };

export function formatMoney(amountCents: number | null, currency: string | null, locale?: string) {
  if (amountCents === null || !currency) return "";
  try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountCents / 100); }
  catch { return `${(amountCents / 100).toFixed(2)} ${currency}`; }
}
/** "€49.00 / month" or "" when no price is set. */
export const formatPrice = (plan: { amountCents: number | null; currency: string | null; interval: CareInterval }, locale?: string) => {
  const amount = formatMoney(plan.amountCents, plan.currency, locale);
  return amount ? `${amount} / ${INTERVAL_LABEL[plan.interval]}` : "";
};
/** "31 Oct 2026" for a YYYY-MM-DD date (read as a calendar day, not a moment). */
export function formatDay(value: string | undefined | null, locale?: string) {
  if (!value) return "";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
}
/** Major units text ("49.00") ↔ cents, for the agency form. */
export function parseAmount(text: string): number | null | undefined {
  const value = text.trim().replace(",", ".");
  if (!value) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) return undefined;
  return Math.round(Number(value) * 100);
}

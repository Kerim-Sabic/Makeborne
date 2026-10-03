import { z } from "zod";
import { ExactAmountSchema } from "../jobs/contracts";

export const BillingEntrySchema = z.object({
  id: z.string().min(1).max(200),
  occurredAt: z.string().datetime(),
  project: z.string().min(1).max(160),
  action: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  category: z.enum(["Creation", "Media", "Hosting", "Research"]),
  status: z.enum(["Reserved", "Charged", "Released", "Refunded"]),
  credits: ExactAmountSchema,
}).strict();

export const BillingViewSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("unavailable"), unit: z.literal("whole_customer_credits"),
    available: z.null(), reserved: z.null(), used: z.null(), period: z.null(),
    entries: z.array(BillingEntrySchema).length(0),
  }).strict(),
  z.object({
    status: z.literal("ready"), unit: z.literal("whole_customer_credits"),
    available: ExactAmountSchema, reserved: ExactAmountSchema, used: ExactAmountSchema,
    period: z.string().trim().min(1).max(120),
    entries: z.array(BillingEntrySchema).max(1000),
  }).strict(),
]).refine(value => new Set(value.entries.map(entry => entry.id)).size === value.entries.length, "Duplicate billing events are not allowed.");

export type BillingEntry = z.infer<typeof BillingEntrySchema>;
export type BillingViewModel = z.infer<typeof BillingViewSchema>;
export const unavailableBilling: BillingViewModel = {
  status: "unavailable", unit: "whole_customer_credits", available: null,
  reserved: null, used: null, period: null, entries: [],
};

/** Validation is a display boundary, not proof of identity, funding or permission. */
export function readBillingView(input: unknown): BillingViewModel {
  const parsed = BillingViewSchema.safeParse(input);
  return parsed.success ? parsed.data : { ...unavailableBilling, entries: [] };
}

export function filterBillingEntries(entries: BillingEntry[], category: string, query: string) {
  const search = query.trim().toLowerCase();
  return entries.filter(entry => (category === "All activity" || entry.category === category)
    && `${entry.project} ${entry.action}`.toLowerCase().includes(search));
}

/** A statement of loaded activity only; never infer account totals from a page. */
export function billingStatement(input: unknown, category: string, query: string): string {
  const summary = BillingViewSchema.parse(input);
  if (summary.status !== "ready") throw new Error("Usage is unavailable.");
  return JSON.stringify({
    schema: "makeborne.usage-statement.v1", unit: summary.unit, period: summary.period,
    coverage: "Loaded activity matching the selected filters; not a complete account ledger or invoice.",
    filters: { category, query: query.trim() },
    entries: filterBillingEntries(summary.entries, category, query).map(entry => ({ id: entry.id, occurredAt: entry.occurredAt, project: entry.project, action: entry.action, category: entry.category, status: entry.status, credits: entry.credits })),
  }, null, 2);
}

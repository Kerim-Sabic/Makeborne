import { z } from "zod";
import { ExactAmountSchema } from "../jobs/contracts";

export const BillingEntrySchema = z.object({
  id: z.string().min(1).max(200),
  occurredAt: z.string().datetime(),
  project: z.string().min(1).max(160),
  action: z.string().min(1).max(200),
  /** Internal; never shown, searched or exported. Omitted when not recorded. */
  model: z.string().min(1).max(200).optional(),
  category: z.enum(["Creation", "Media", "Hosting", "Research", "Account"]),
  /** Reserved, Charged and Released describe one credit hold; Refunded, Withheld and Restored are their own events. */
  status: z.enum(["Reserved", "Charged", "Released", "Refunded", "Withheld", "Restored"]),
  credits: ExactAmountSchema,
}).strict();

/**
 * Where the loaded rows sit in their period: `total` events in the period,
 * `newer` events before this page, `olderCursor` when more follow.
 */
export const BillingHistorySchema = z.object({
  periodKey: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
  total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  newer: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  olderCursor: z.string().min(1).max(300).nullable(),
}).strict();

function historyConsistent(history: z.infer<typeof BillingHistorySchema>, loaded: number) {
  const shown = history.newer + loaded;
  return history.olderCursor === null ? shown === history.total : loaded > 0 && shown < history.total;
}

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
    history: BillingHistorySchema,
  }).strict(),
]).refine(value => new Set(value.entries.map(entry => entry.id)).size === value.entries.length, "Duplicate billing events are not allowed.")
  .refine(value => value.status !== "ready" || historyConsistent(value.history, value.entries.length), "Usage page does not match its period totals.");

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

/** What a usage history lists, and what it never does. */
export const USAGE_SCOPE = "credit holds, charges, releases, credit refunds and payment-review adjustments";
export const USAGE_EXCLUDED = "Plan, pack and trial credit grants and credit expiry are not listed";

/** Where the loaded rows sit in their period, for the page and the statement. */
export function usageCoverage(summary: Extract<BillingViewModel, { status: "ready" }>) {
  const { total, newer, olderCursor } = summary.history;
  const loaded = summary.entries.length;
  const complete = newer === 0 && olderCursor === null;
  const range = loaded === 0 ? "none" : `${newer + 1}–${newer + loaded}`;
  return { complete, total, from: loaded === 0 ? 0 : newer + 1, to: newer + loaded,
    text: complete ? `All ${total} recorded in ${summary.period}` : `Showing ${range} of ${total} recorded in ${summary.period}` };
}

/** A statement of loaded activity only; never infer account totals from a page. */
export function billingStatement(input: unknown, category: string, query: string): string {
  const summary = BillingViewSchema.parse(input);
  if (summary.status !== "ready") throw new Error("Usage is unavailable.");
  const coverage = usageCoverage(summary);
  const filtered = category !== "All activity" || query.trim() !== "";
  return JSON.stringify({
    schema: "makeborne.usage-statement.v2", unit: summary.unit, period: summary.period,
    coverage: `${coverage.complete ? `Every recorded item in ${summary.period}` : `Items ${coverage.from}–${coverage.to} of ${coverage.total} recorded in ${summary.period}; the rest are on other pages`}`
      + `${filtered ? ", narrowed by the selected filters" : ""}. Lists ${USAGE_SCOPE}. ${USAGE_EXCLUDED}; not a complete account ledger or invoice.`,
    history: { complete: coverage.complete, total: coverage.total, from: coverage.from, to: coverage.to },
    usedInPeriod: summary.used,
    filters: { category, query: query.trim() },
    entries: filterBillingEntries(summary.entries, category, query).map(entry => ({ id: entry.id, occurredAt: entry.occurredAt, project: entry.project, action: entry.action, category: entry.category, status: entry.status, credits: entry.credits })),
  }, null, 2);
}

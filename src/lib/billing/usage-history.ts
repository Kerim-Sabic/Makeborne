import { z } from "zod";
import { ExactAmountSchema } from "../jobs/contracts";
import { readBillingView, unavailableBilling, type BillingEntry, type BillingViewModel } from "./view";

/**
 * Usage history (audit F08): maps the caller-scoped database read
 * (public.makeborne_usage_history) to the billing view. Pure and offline:
 * every field is validated, an inconsistent read fails closed to
 * "unavailable" (never an empty "no activity"), and nothing is invented.
 */
export const USAGE_PAGE_SIZE = 100;
/** Credit wallets started in October 2026; earlier months hold no activity. */
export const USAGE_EARLIEST_PERIOD = "2026-10";

export type UsagePeriod = { key: string; start: string; end: string; label: string };
export type UsageCursor = { at: string; id: string };

const PERIOD_KEY = /^([0-9]{4})-(0[1-9]|1[0-2])$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function periodOf(year: number, month: number): UsagePeriod {
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return { key: `${year}-${String(month + 1).padStart(2, "0")}`, start: start.toISOString(), end: end.toISOString(), label: `${MONTHS[month]} ${year} (UTC)` };
}

/** A calendar month (UTC) from `?usage=YYYY-MM`; anything else, future or too early is the current month. */
export function usagePeriod(input: unknown, now: Date = new Date()): UsagePeriod {
  const current = periodOf(now.getUTCFullYear(), now.getUTCMonth());
  const key = typeof input === "string" ? input : "";
  const match = PERIOD_KEY.exec(key);
  if (!match || key > current.key || key < USAGE_EARLIEST_PERIOD) return current;
  return periodOf(Number(match[1]), Number(match[2]) - 1);
}

/** Neighbouring months with possible activity, or null at either end. */
export function adjacentUsagePeriods(key: string, now: Date = new Date()): { previous: string | null; next: string | null } {
  const match = PERIOD_KEY.exec(key);
  if (!match) return { previous: null, next: null };
  const year = Number(match[1]), month = Number(match[2]) - 1;
  const previous = periodOf(year, month - 1).key;
  const next = periodOf(year, month + 1).key;
  const current = periodOf(now.getUTCFullYear(), now.getUTCMonth()).key;
  return { previous: previous >= USAGE_EARLIEST_PERIOD ? previous : null, next: next <= current ? next : null };
}

const CURSOR_AT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;
const CURSOR_ID = /^(hold:[0-9a-f]{32}|ledger:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Opaque keyset cursor: the exact database occurrence time (microseconds) and row id of the last row shown. */
export function encodeUsageCursor(cursor: UsageCursor): string {
  return `${cursor.at.replace(/[-:.]/g, "")}~${cursor.id.replace(":", "-")}`;
}

export function decodeUsageCursor(input: unknown): UsageCursor | null {
  if (typeof input !== "string" || input.length > 120) return null;
  const match = /^([0-9]{8})T([0-9]{6})([0-9]{6})Z~(hold|ledger)-([0-9a-f-]{32,36})$/.exec(input);
  if (!match) return null;
  const [, day, time, micros, kind, key] = match;
  const at = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}.${micros}Z`;
  const id = `${kind}:${key}`;
  return CURSOR_AT.test(at) && Number.isFinite(Date.parse(at)) && CURSOR_ID.test(id) ? { at, id } : null;
}

const text = (max: number) => z.string().min(1).max(max);
const RowSchema = z.object({
  id: z.string().regex(CURSOR_ID),
  occurredAt: z.string().regex(CURSOR_AT),
  status: z.enum(["Reserved", "Charged", "Released", "Refunded", "Withheld", "Restored"]),
  credits: ExactAmountSchema,
  source: z.enum(["operation", "brief_questions", "lead_find", "chat", "personalize", "followup", "unknown", "refund", "payment"]),
  operationKind: z.enum(["build", "review", "plan"]).optional(),
  runKind: z.enum(["build", "continuation", "review", "plan"]).optional(),
  format: z.enum(["website", "book", "presentation"]).optional(),
  projectState: z.enum(["visible", "hidden", "deleted"]).optional(),
  projectTitle: text(160).optional(),
  expert: text(200).optional(),
  held: ExactAmountSchema.optional(),
  lapsed: ExactAmountSchema.optional(),
  reason: text(500).optional(),
  paymentKind: z.enum(["payment", "credit_pack"]).optional(),
}).strict();

const ResultSchema = z.object({
  unit: z.literal("whole_customer_credits"),
  generatedAt: z.string().regex(CURSOR_AT),
  wallet: z.object({ available: ExactAmountSchema, reserved: ExactAmountSchema, balance: ExactAmountSchema, unlimited: z.boolean() }).strict(),
  period: z.object({
    start: z.string().regex(CURSOR_AT), end: z.string().regex(CURSOR_AT),
    total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), used: ExactAmountSchema,
    newer: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), hasMore: z.boolean(),
  }).strict(),
  entries: z.array(RowSchema).max(500),
}).strict();

export type UsageRow = z.infer<typeof RowSchema>;

const FORMATS = { website: "Website", book: "Book", presentation: "Presentation" } as const;
const STEPS = { build: "build", continuation: "build (continued)", review: "review", plan: "plan" } as const;
const PROJECT = { hidden: "Project no longer shared with you", deleted: "Deleted project" } as const;
const WITHHELD: Record<string, string> = {
  refunded: "Payment refunded: unused credits removed", dispute_lost: "Payment charged back: unused credits removed",
  reversed: "Credit pack payment refunded: unused credits removed", disputed: "Payment disputed: unused credits on hold",
  partially_refunded: "Payment partly refunded: unused credits on hold", refund_review: "Refund in progress: unused credits on hold",
  held: "Credit pack payment under review: unused credits on hold",
};
const RELEASE_REASONS: Record<string, string> = {
  "hold timeout": "timed out", "credit pack payment under review": "payment under review",
  "subscription payment held": "payment under review", "subscription payment reversed": "payment refunded",
};

function formatCredits(value: string) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(BigInt(value));
}

function holdDetail(row: UsageRow): string {
  const parts: string[] = [];
  if (row.status === "Reserved") parts.push("in progress");
  if (row.status === "Charged" && row.held && BigInt(row.held) > BigInt(row.credits)) parts.push(`${formatCredits(row.held)} reserved, rest returned`);
  if (row.status === "Released" && row.reason && RELEASE_REASONS[row.reason]) parts.push(RELEASE_REASONS[row.reason]);
  if (row.status === "Released" && row.lapsed && row.lapsed !== "0") parts.push(`${formatCredits(row.lapsed)} expired while held`);
  return parts.length ? ` · ${parts.join(", ")}` : "";
}

/** One database row as a customer-safe entry. Unknown activity stays visible as such. */
export function usageEntry(row: UsageRow): BillingEntry {
  const base = { id: row.id, occurredAt: row.occurredAt, status: row.status, credits: row.credits };
  switch (row.source) {
    case "operation": {
      const step = row.runKind ? STEPS[row.runKind] : row.operationKind ? STEPS[row.operationKind] : null;
      const action = row.format && step ? `${FORMATS[row.format]} ${step}` : step ? `Project ${step}` : "Project step";
      const project = row.projectState === "visible" && row.projectTitle ? row.projectTitle : PROJECT[row.projectState === "hidden" ? "hidden" : "deleted"];
      return { ...base, project, action: action + holdDetail(row), category: "Creation" };
    }
    case "brief_questions": return { ...base, project: "No project yet", action: "Briefing questions" + holdDetail(row), category: "Creation" };
    case "chat": return { ...base, project: "No project", action: "Expert chat" + holdDetail(row), category: "Research" };
    case "personalize": return { ...base, project: "Client CRM", action: "Personalized follow-up draft" + holdDetail(row), category: "Creation" };
    case "followup": return { ...base, project: "Client CRM", action: "Follow-up draft" + holdDetail(row), category: "Creation" };
    case "lead_find": return { ...base, project: "Client CRM", action: "Lead finder" + holdDetail(row), category: "Research" };
    case "unknown": return { ...base, project: "Unrecognized activity", action: "Credit hold without a recorded feature" + holdDetail(row), category: "Account" };
    case "refund": return { ...base, project: "Account", action: "Credits refunded", category: "Account" };
    case "payment": {
      const action = row.status === "Restored" ? (row.paymentKind === "credit_pack" ? "Credit pack review resolved: credits returned" : "Payment review resolved: credits returned")
        : (row.reason && WITHHELD[row.reason]) ?? "Payment under review: unused credits on hold";
      return { ...base, project: "Account", action, category: "Account" };
    }
  }
}

function fail(reason: string): BillingViewModel {
  console.error(JSON.stringify({ event: "usage_history_unavailable", reason }));
  return { ...unavailableBilling, entries: [] };
}

/**
 * Validates one read and builds the view. Totals come from the read's wallet
 * and period figures, never from summing the page. A complete period must
 * reconcile: its Charged rows sum exactly to the period's `used`.
 */
export function usageHistoryView(input: unknown, period: UsagePeriod, cursor: UsageCursor | null): BillingViewModel {
  const parsed = ResultSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_result");
  const result = parsed.data;
  if (Date.parse(result.period.start) !== Date.parse(period.start) || Date.parse(result.period.end) !== Date.parse(period.end)) return fail("period_mismatch");
  if (cursor === null && result.period.newer !== 0) return fail("cursor_mismatch");
  const rows = result.entries;
  const start = Date.parse(period.start), end = Date.parse(period.end);
  if (rows.some(row => Date.parse(row.occurredAt) < start || Date.parse(row.occurredAt) >= end)) return fail("row_outside_period");
  for (let index = 1; index < rows.length; index++) {
    const [a, b] = [rows[index - 1], rows[index]];
    if (a.occurredAt < b.occurredAt || (a.occurredAt === b.occurredAt && a.id <= b.id)) return fail("unordered_rows");
  }
  if (cursor && rows[0] && (rows[0].occurredAt > cursor.at || (rows[0].occurredAt === cursor.at && rows[0].id >= cursor.id))) return fail("cursor_overlap");
  const last = rows[rows.length - 1];
  const olderCursor = result.period.hasMore && last ? encodeUsageCursor({ at: last.occurredAt, id: last.id }) : null;
  if (result.period.hasMore && !last) return fail("empty_partial_page");
  if (result.period.newer === 0 && !result.period.hasMore) {
    const charged = rows.filter(row => row.status === "Charged").reduce((sum, row) => sum + BigInt(row.credits), BigInt(0));
    if (charged !== BigInt(result.period.used)) return fail("charges_do_not_reconcile");
  }
  const view = readBillingView({
    status: "ready", unit: result.unit, available: result.wallet.available, reserved: result.wallet.reserved,
    used: result.period.used, period: period.label, entries: rows.map(usageEntry),
    history: { periodKey: period.key, total: result.period.total, newer: result.period.newer, olderCursor },
  });
  return view.status === "ready" ? view : fail("view_rejected");
}

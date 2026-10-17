/** Summarises a website's visitor analytics for its owner, and joins them with
 * what the site produced: enquiries, the leads made from them, and clients won.
 * Pure and deterministic; the route supplies rows already scoped to one site. */

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = typeof ANALYTICS_RANGES[number];
export type Dimension = "path" | "referrer" | "country" | "device";
export type DayRow = { day: string; views: number; visitors: number };
export type BreakdownRow = { day: string; dimension: Dimension; value: string; views: number };
export type EnquiryRow = { created_at: string; email: string };
export type ClientRow = { email: string | null; stage: string | null };
export type Metric = { value: number; previous: number; change: number | null };
export type Summary = {
  range: AnalyticsRange; from: string; to: string;
  totals: { visitors: Metric; views: Metric; enquiries: Metric; conversion: Metric; leads: number; won: number };
  series: { day: string; views: number; visitors: number; enquiries: number }[];
  top: Record<Dimension, { value: string; views: number; share: number }[]>;
  hasData: boolean;
};

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const email = (value: string | null) => (value ?? "").trim().toLowerCase();
const change = (value: number, previous: number) => previous > 0 ? Math.round(((value - previous) / previous) * 1000) / 10 : value > 0 ? null : 0;
const metric = (value: number, previous: number): Metric => ({ value, previous, change: change(value, previous) });
/** Enquiries per 100 visitors, one decimal. */
const rate = (enquiries: number, visitors: number) => visitors > 0 ? Math.round((enquiries / visitors) * 1000) / 10 : 0;

/** The last `range` UTC days ending today, and the same span before it. */
export function rangeDays(range: AnalyticsRange, now = Date.now()) {
  const today = Date.parse(`${isoDay(now)}T00:00:00Z`);
  const from = today - (range - 1) * DAY_MS, previousFrom = from - range * DAY_MS;
  return { from: isoDay(from), to: isoDay(today), previousFrom: isoDay(previousFrom), days: Array.from({ length: range }, (_, index) => isoDay(from + index * DAY_MS)) };
}

export function summarise(input: { range: AnalyticsRange; days: DayRow[]; breakdowns: BreakdownRow[]; enquiries: EnquiryRow[]; clients: ClientRow[]; now?: number }): Summary {
  const { from, to, previousFrom, days } = rangeDays(input.range, input.now);
  const inRange = (day: string) => day >= from && day <= to, inPrevious = (day: string) => day >= previousFrom && day < from;
  const byDay = new Map(input.days.filter(row => inRange(row.day)).map(row => [row.day, row]));
  const enquiriesByDay = new Map<string, number>();
  let enquiries = 0, previousEnquiries = 0;
  const senders = new Set<string>();
  for (const row of input.enquiries) {
    const day = row.created_at.slice(0, 10);
    if (inRange(day)) { enquiries++; enquiriesByDay.set(day, (enquiriesByDay.get(day) ?? 0) + 1); senders.add(email(row.email)); }
    else if (inPrevious(day)) previousEnquiries++;
  }
  const sum = (rows: DayRow[], key: "views" | "visitors") => rows.reduce((total, row) => total + Math.max(0, row[key] | 0), 0);
  const current = input.days.filter(row => inRange(row.day)), previous = input.days.filter(row => inPrevious(row.day));
  const visitors = sum(current, "visitors"), previousVisitors = sum(previous, "visitors");
  // Leads and wins: clients whose email wrote through this site in the period.
  const matched = input.clients.filter(client => senders.has(email(client.email)));
  const top = {} as Summary["top"];
  for (const dimension of ["path", "referrer", "country", "device"] as const) {
    const totals = new Map<string, number>();
    for (const row of input.breakdowns) if (row.dimension === dimension && inRange(row.day)) totals.set(row.value, (totals.get(row.value) ?? 0) + Math.max(0, row.views | 0));
    const all = [...totals.values()].reduce((a, b) => a + b, 0);
    top[dimension] = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8)
      .map(([value, views]) => ({ value, views, share: all ? Math.round((views / all) * 1000) / 10 : 0 }));
  }
  return {
    range: input.range, from, to,
    totals: {
      visitors: metric(visitors, previousVisitors),
      views: metric(sum(current, "views"), sum(previous, "views")),
      enquiries: metric(enquiries, previousEnquiries),
      conversion: metric(rate(enquiries, visitors), rate(previousEnquiries, previousVisitors)),
      leads: matched.length,
      won: matched.filter(client => client.stage === "Won").length,
    },
    series: days.map(day => ({ day, views: byDay.get(day)?.views ?? 0, visitors: byDay.get(day)?.visitors ?? 0, enquiries: enquiriesByDay.get(day) ?? 0 })),
    top,
    hasData: current.length > 0 || enquiries > 0,
  };
}

/** Friendly labels for breakdown values. */
export function dimensionLabel(dimension: Dimension, value: string) {
  if (value === "(direct)") return "Direct or unknown";
  if (value === "(unknown)") return "Unknown";
  if (value === "(other)") return "Other";
  if (dimension === "device") return value === "mobile" ? "Phone" : value === "tablet" ? "Tablet" : value === "desktop" ? "Computer" : value;
  if (dimension === "path") return value === "/" ? "Home page" : value;
  return value;
}

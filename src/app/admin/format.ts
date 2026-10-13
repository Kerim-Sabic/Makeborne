/** Display helpers for the administrator console (server-rendered, en-US, UTC). */
const number = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export const count = (value: number | null | undefined) => number.format(Number(value ?? 0));
export const usdFromCents = (cents: number) => money.format(cents / 100);
/** Provider spend is recorded in micro-USD. */
export const usdFromMicro = (microusd: number | null | undefined) => money.format(Number(microusd ?? 0) / 1_000_000);
export const exactTime = (iso: string | null | undefined) => iso ? `${dateTime.format(new Date(iso))} UTC` : "—";
export const day = (iso: string | null | undefined) => iso ? date.format(new Date(iso)) : "—";

/** "3 days ago" / "in 5 hours", relative to the moment the page was rendered. */
export function relative(iso: string | null | undefined, now: number) {
  if (!iso) return "Never";
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3_600], ["minute", 60]];
  const format = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return "Just now";
}

export const titleCase = (value: string) => value.replace(/[_-]+/g, " ").replace(/^\w/, letter => letter.toUpperCase());

/** The moment this request is rendered. Admin pages are server components rendered once per
 * request (`dynamic = "force-dynamic"`), so one timestamp keeps every relative time consistent. */
export const requestTime = () => Date.now();

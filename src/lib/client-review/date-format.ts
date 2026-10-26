const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Review HTML is rendered on the server, then hydrated in a different locale/timezone. */
export function reviewDateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function reviewTimeLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${hours}:${minutes} UTC`;
}

/** The same moment as a full UTC date and time, e.g. "8 Nov 2026, 23:57 UTC": what the server renders before the reader's time zone is known. */
export function reviewUtcDateTimeLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return `${reviewDateLabel(value)}, ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** The date and time in the reader's own time zone, named, e.g. "9 Nov 2026, 00:57 CET". Browser only (after hydration); `timeZone` is for checks. */
export function localDateTimeLabel(value: string, timeZone?: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short", timeZone }).format(date);
}

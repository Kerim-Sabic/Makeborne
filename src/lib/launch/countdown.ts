/**
 * Launch countdown time math. Pure and isomorphic: no clocks are read here; every function takes `now`.
 * The countdown is informational only. It never opens or closes sales; plan buttons follow the server's sales state.
 */

/** Wednesday 28 October 2026, 19:00 in Sarajevo (CET, UTC+1 after the 25 October change). */
export const DEFAULT_LAUNCH_AT = "2026-10-28T18:00:00Z";
/** After launch the banner says "We're live" for this long, then hides itself. */
export const LIVE_WINDOW_MS = 48 * 60 * 60 * 1000;
/** The launch is announced in the owner's own zone; visitors also see their local time. */
export const LAUNCH_TIME_ZONE = "Europe/Sarajevo";
/** Client clocks closer than this to the server are trusted as they are. */
export const SKEW_TOLERANCE_MS = 1500;
/** A server time embedded in the page is older than it looks (download and hydration), so it only corrects very large skew. */
export const PAGE_SKEW_TOLERANCE_MS = 60_000;

export type LaunchPhase = "before" | "live" | "after";
export type Remaining = { totalMs: number; totalSeconds: number; days: number; hours: number; minutes: number; seconds: number };

/** A valid ISO instant, or the default launch moment. Never throws. */
export function parseLaunchAt(value: string | undefined | null): number {
  const parsed = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value.trim()) ? Date.parse(value.trim()) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.parse(DEFAULT_LAUNCH_AT);
}

/** Only the exact value "on" shows the countdown. Unset uses this branch's default (on). */
export function countdownEnabled(value: string | undefined | null, fallback = "on"): boolean {
  return (value ?? fallback) === "on";
}

export function launchPhase(now: number, launchAt: number): LaunchPhase {
  if (now < launchAt) return "before";
  return now < launchAt + LIVE_WINDOW_MS ? "live" : "after";
}

/** Time left, counted in whole seconds rounded up: 00:00:01 is shown until the launch instant itself. */
export function remaining(now: number, launchAt: number): Remaining {
  const totalMs = Math.max(0, launchAt - now);
  const totalSeconds = Math.ceil(totalMs / 1000);
  return {
    totalMs, totalSeconds,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor(totalSeconds / 3600) % 24,
    minutes: Math.floor(totalSeconds / 60) % 60,
    seconds: totalSeconds % 60,
  };
}

const plural = (value: number, unit: string) => `${value} ${unit}${value === 1 ? "" : "s"}`;

/** For screen readers and the timer's label, at minute precision: "2 days, 4 hours, 12 minutes left". */
export function remainingLabel(left: Remaining): string {
  if (left.totalSeconds <= 0) return "Makeborne is live";
  if (left.totalSeconds < 60) return "Less than a minute left";
  const parts = [left.days && plural(left.days, "day"), left.hours && plural(left.hours, "hour"), left.minutes && plural(left.minutes, "minute")].filter(Boolean);
  return `${parts.join(", ")} left`;
}

/** What the polite live region says. It changes only at hour boundaries, then at minute boundaries in the final hour. */
export function announcement(left: Remaining): string {
  if (left.totalSeconds <= 0) return "Makeborne is live.";
  if (left.totalSeconds > 3600) {
    const hours = Math.ceil(left.totalSeconds / 3600);
    const days = Math.floor(hours / 24), rest = hours % 24;
    return `${[days && plural(days, "day"), rest && plural(rest, "hour")].filter(Boolean).join(", ")} until launch.`;
  }
  const minutes = Math.ceil(left.totalSeconds / 60);
  return `${plural(minutes, "minute")} until launch.`;
}

/** Compact banner text: "1d 4h 12m", "12m 30s" in the last hour, "30s" in the last minute. */
export function shortRemaining(left: Remaining): string {
  if (left.totalSeconds <= 0) return "now";
  if (left.days) return `${left.days}d ${left.hours}h ${left.minutes}m`;
  if (left.hours) return `${left.hours}h ${left.minutes}m`;
  if (left.minutes) return `${left.minutes}m ${String(left.seconds).padStart(2, "0")}s`;
  return `${left.seconds}s`;
}

/** Two digits per unit; days keep every digit they need. */
export function digits(value: number, min = 2): string[] {
  return String(Math.max(0, Math.floor(value))).padStart(min, "0").split("");
}

/** Milliseconds until the next whole second (or minute) of the corrected clock, plus a small margin. */
export function nextTickDelay(now: number, unitMs: 1000 | 60000, launchAt?: number): number {
  let delay = unitMs - (((now % unitMs) + unitMs) % unitMs) + 12;
  // Never sleep past the launch instant, so a minute-granular clock still switches on time.
  if (launchAt !== undefined && launchAt > now) delay = Math.min(delay, launchAt - now + 12);
  return Math.max(16, delay);
}

/**
 * Server-minus-client offset from one request: the server's time is taken to be halfway through the round trip.
 * Returns 0 when the client clock is within tolerance, so ordinary clocks are never "corrected".
 */
export function clockOffset(input: { sentAt: number; receivedAt: number; serverNow: number }, tolerance = SKEW_TOLERANCE_MS): number {
  const { sentAt, receivedAt, serverNow } = input;
  if (![sentAt, receivedAt, serverNow].every(Number.isFinite) || receivedAt < sentAt) return 0;
  const offset = serverNow - (sentAt + (receivedAt - sentAt) / 2);
  return Math.abs(offset) > tolerance ? Math.round(offset) : 0;
}

/** An HTTP Date header has one-second precision; good enough for big skew. NaN when absent or malformed. */
export function dateHeaderTime(value: string | null | undefined): number {
  return value ? Date.parse(value) : NaN;
}

/** "Wednesday 28 October · 19:00 CET", in the launch zone. Render on the server and pass down, so markup is identical everywhere. */
export function launchDateText(launchAt: number, timeZone = LAUNCH_TIME_ZONE): { date: string; time: string; short: string } {
  const at = new Date(launchAt);
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(at);
  const date = `${part({ weekday: "long" })} ${part({ day: "numeric" })} ${part({ month: "long" })}`;
  const short = `${part({ weekday: "short" })} ${part({ day: "numeric" })} ${part({ month: "short" })}`;
  const clock = part({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const zone = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" }).formatToParts(at).find(item => item.type === "timeZoneName")?.value ?? "";
  return { date, time: `${clock} ${zone}`.trim(), short };
}

/** UTC offset of a zone at an instant, in minutes. */
export function zoneOffsetMinutes(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(at));
  const value = (type: string) => Number(parts.find(item => item.type === type)?.value);
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour") % 24, value("minute"), value("second"));
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60000);
}

/**
 * The launch moment in the visitor's own zone, or null when it reads the same as in Sarajevo.
 * Client-only (it depends on the browser's zone): call it after mount, never during the first render.
 */
export function localLaunchText(launchAt: number, timeZone: string | undefined, locale?: string): string | null {
  if (!timeZone) return null;
  try {
    if (zoneOffsetMinutes(launchAt, timeZone) === zoneOffsetMinutes(launchAt, LAUNCH_TIME_ZONE)) return null;
    const at = new Date(launchAt);
    const time = new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(at);
    const day = (zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
    const sameDay = day(timeZone) === day(LAUNCH_TIME_ZONE);
    const weekday = sameDay ? "" : `${new Intl.DateTimeFormat(locale, { timeZone, weekday: "short" }).format(at)} `;
    return `${weekday}${time} in your time`;
  } catch { return null; }
}

/** A `?countdown=at:<iso>` test override (non-production only; the caller decides). Null when absent or invalid. */
export function countdownOverride(value: string | string[] | undefined | null): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !raw.startsWith("at:")) return null;
  const parsed = Date.parse(raw.slice(3));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Live-window copy that never claims checkout is open unless the server says plans are on sale. */
export function liveCopy(salesOpen: boolean | null): { headline: string; cta: string | null; note: string | null } {
  if (salesOpen === true) return { headline: "We're live", cta: "See plans", note: null };
  if (salesOpen === false) return { headline: "We're live", cta: null, note: "Plans opening any moment" };
  return { headline: "We're live", cta: null, note: null };
}

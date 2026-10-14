/**
 * Sending pace for a newly connected mailbox, so automated outreach looks human
 * and protects the sender's reputation: 10 a day for the first three days, 15
 * until day seven, then five more each day up to the mailbox's limit (max 50
 * by default). Automated sends are spaced at least MIN_GAP_MS apart.
 */
export const MIN_GAP_MS = 2 * 60_000;
export const DAY_MS = 86_400_000;

export function dailyQuota(warmupStartedAt: Date, dailyLimit: number, now: Date) {
  const day = Math.max(0, Math.floor((now.getTime() - warmupStartedAt.getTime()) / DAY_MS));
  const ramp = day < 3 ? 10 : day < 7 ? 15 : 15 + 5 * (day - 6);
  return Math.max(1, Math.min(dailyLimit, ramp));
}

/** Start of the current UTC day, the window daily quotas are counted in. */
export const utcDayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export function sendAllowed(input: { sentToday: number; quota: number; lastSentAt: Date | null; now: Date; automated: boolean }) {
  if (input.sentToday >= input.quota) return { ok: false as const, reason: "daily_limit" as const };
  if (input.automated && input.lastSentAt && input.now.getTime() - input.lastSentAt.getTime() < MIN_GAP_MS) return { ok: false as const, reason: "spacing" as const };
  return { ok: true as const };
}

/** When the next step is due: delayDays after now, never earlier than now. */
export const dueAfter = (now: Date, delayDays: number) => new Date(now.getTime() + Math.max(0, delayDays) * DAY_MS);

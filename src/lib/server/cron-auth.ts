import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Constant-time bearer check against CRON_SECRET (at least 32 characters). */
export function authorizedCron(request: Request, secret = process.env.CRON_SECRET) {
  if (!secret || secret.length < 32) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

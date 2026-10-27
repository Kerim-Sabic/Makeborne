import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { WAITLIST_CONSENT_VERSION } from "./waitlist-shared";

/**
 * Launch waitlist server helpers. Raw IP addresses and browser strings never leave this module: only keyed
 * SHA-256 hashes (HMAC with the waitlist salt) are stored, for abuse limits. The same salt signs unsubscribe links.
 */
export const WaitlistInput = z.object({
  email: z.string().max(320),
  /** Honeypot: people never see or fill it. */
  company: z.string().max(200).optional(),
  source: z.string().max(400).nullable().optional(),
  consent: z.literal(WAITLIST_CONSENT_VERSION),
}).strict();

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed, lower-cased and checked, or null. Lower-casing makes the unique constraint case-insensitive. */
export function normalizeWaitlistEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || !EMAIL_SHAPE.test(email)) return null;
  const [local, domain] = email.split("@");
  if (local.length > 64 || domain.length > 253 || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..") || !/^[a-z0-9.-]+$/.test(domain)) return null;
  if (!z.string().email().safeParse(email).success) return null;
  return email;
}

/**
 * The waitlist salt: MAKEBORNE_WAITLIST_SALT when set (at least 32 characters); otherwise derived on the server from the
 * existing SUPABASE_SECRET_KEY (an HMAC with a fixed label, so the key itself is never used or exposed directly), so
 * production needs no new secret. Null keeps the waitlist closed. Never log the result.
 */
export function waitlistSecret(env: Record<string, string | undefined> = process.env): string | null {
  const salt = env.MAKEBORNE_WAITLIST_SALT;
  if (salt && salt.length >= 32) return salt;
  const key = env.SUPABASE_SECRET_KEY;
  return key?.startsWith("sb_secret_") ? createHmac("sha256", key).update("makeborne-launch-waitlist-salt-v1").digest("hex") : null;
}

/** Keyed SHA-256 with a purpose label, so one secret never produces the same hash for two uses. */
export function keyedHash(secret: string, purpose: "ip" | "user-agent" | "unsubscribe", value: string): string {
  return createHmac("sha256", secret).update(`makeborne-waitlist:${purpose}:`).update(value).digest("hex");
}

/** The first address in X-Forwarded-For (the platform sets it), as the telemetry route reads it. */
export function requestIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function unsubscribeSignature(secret: string, id: string): string {
  return keyedHash(secret, "unsubscribe", id.toLowerCase());
}
/** Constant-time check of an unsubscribe link's signature. */
export function validUnsubscribe(secret: string, id: unknown, signature: unknown): id is string {
  if (typeof id !== "string" || typeof signature !== "string" || !UUID.test(id.toLowerCase()) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(unsubscribeSignature(secret, id), "hex"), Buffer.from(signature, "hex"));
}
export function unsubscribeUrl(origin: string, secret: string, id: string): string {
  return `${origin}/waitlist/unsubscribe?id=${encodeURIComponent(id)}&sig=${unsubscribeSignature(secret, id)}`;
}

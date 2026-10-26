import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { WAITLIST_CONSENT_VERSION } from "./waitlist-shared";

/**
 * Launch waitlist server helpers. Raw IP addresses and browser strings never leave this module: only keyed
 * SHA-256 hashes (HMAC with MAKEBORNE_WAITLIST_SECRET) are stored, for abuse limits.
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

/** The secret is at least 32 characters, or the waitlist stays closed. */
export function waitlistSecret(env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.MAKEBORNE_WAITLIST_SECRET;
  return secret && secret.length >= 32 ? secret : null;
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

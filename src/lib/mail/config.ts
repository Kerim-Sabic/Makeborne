import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type MailProvider = "google" | "microsoft";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
/** Matches the granted_scopes database contract; only provider-returned grants belong here. */
export function parseGrantedScopes(raw: string) {
  const scopes = [...new Set(raw.split(/\s+/).filter(Boolean))];
  if (scopes.length > 32 || scopes.some(scope => !/^[A-Za-z0-9][A-Za-z0-9:/._-]{0,199}$/.test(scope))) throw new Error("The provider returned invalid mailbox permissions.");
  return scopes;
}
export type GoogleMailMode = "full" | "send_only";
/** Unset preserves the existing requested scopes. Unknown settings fail closed to send-only. */
export const googleMailMode = (): GoogleMailMode => !process.env.MAKEBORNE_GOOGLE_MAIL_MODE || process.env.MAKEBORNE_GOOGLE_MAIL_MODE === "full" ? "full" : "send_only";
export function mailCapabilities(account: { provider: MailProvider; granted_scopes?: readonly string[] | null }) {
  if (account.provider === "microsoft") return { canSend: true, canTrackReplies: true, canAutomate: true };
  const canSend = account.granted_scopes?.includes(GMAIL_SEND_SCOPE) === true;
  const canTrackReplies = canSend && googleMailMode() === "full" && account.granted_scopes?.includes(GMAIL_READ_SCOPE) === true;
  return { canSend, canTrackReplies, canAutomate: canTrackReplies };
}
export const MANUAL_MAIL_NOTICE = "This mailbox supports manual sending only. Read replies in your inbox and update the client's stage yourself. Reply tracking and automatic sequences are unavailable.";

/**
 * Owner setup (env only, never in the repo):
 * - MAKEBORNE_MAIL_ENCRYPTION_KEY: 64 hex characters (32 bytes) for token encryption and OAuth state signing.
 * - MAKEBORNE_GOOGLE_MAIL_CLIENT_ID / _SECRET: Google Cloud OAuth client (Gmail API enabled).
 * - MAKEBORNE_MICROSOFT_MAIL_CLIENT_ID / _SECRET: Microsoft Entra app (multi-tenant + personal accounts).
 * Redirect URIs to register: {app origin}/api/mail/callback/google and /api/mail/callback/microsoft.
 */
export function mailKey() {
  const key = process.env.MAKEBORNE_MAIL_ENCRYPTION_KEY;
  return key && /^[a-f0-9]{64}$/i.test(key) ? Buffer.from(key, "hex") : null;
}
export function providerConfig(provider: MailProvider) {
  const prefix = provider === "google" ? "MAKEBORNE_GOOGLE_MAIL" : "MAKEBORNE_MICROSOFT_MAIL";
  const clientId = process.env[`${prefix}_CLIENT_ID`], clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  return clientId && clientSecret && mailKey() ? { clientId, clientSecret } : null;
}
export const mailAvailability = () => ({ google: providerConfig("google") !== null, microsoft: providerConfig("microsoft") !== null });
export const automationEnabled = () => process.env.MAKEBORNE_MAIL_AUTOMATION_ENABLED === "true";

/** AES-256-GCM, bound to the mailbox id so a token copied to another row cannot be opened. */
export function sealSecret(value: string, accountId: string) {
  const key = mailKey();
  if (!key) throw new Error("Mail encryption key is not configured.");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(accountId));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(part => part.toString("base64url")).join(".");
}
export function openSecret(value: string, accountId: string) {
  const key = mailKey();
  if (!key) throw new Error("Mail encryption key is not configured.");
  const [iv, tag, data] = value.split(".").map(part => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(accountId)); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Signed, expiring OAuth state carrying who started the connection and for which workspace. */
export function signState(payload: { userId: string; workspaceId: string; provider: MailProvider; nonce: string }, now = Date.now()) {
  const key = mailKey();
  if (!key) throw new Error("Mail encryption key is not configured.");
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + 10 * 60_000 })).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(`mail-state.${body}`).digest("base64url")}`;
}
export function verifyState(state: string, now = Date.now()) {
  const key = mailKey();
  const [body, signature] = state.split(".");
  if (!key || !body || !signature) return null;
  const expected = createHmac("sha256", key).update(`mail-state.${body}`).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { userId: string; workspaceId: string; provider: MailProvider; nonce: string; exp: number };
    return payload.exp > now ? payload : null;
  } catch { return null; }
}

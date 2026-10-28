import "server-only";

/**
 * Minimal transactional mailer (Resend HTTP API) for purchase confirmations and withdrawal
 * acknowledgements only. Off unless MAKEBORNE_TRANSACTIONAL_MAIL_ENABLED=true and RESEND_API_KEY
 * is a Resend key (send-only access is enough). The key never leaves this module, and results
 * carry only an error code. Resend keeps an idempotency key for 24 hours, so a retried row is
 * not sent twice inside that window.
 */
export const TRANSACTIONAL_FROM = "Makeborne <admin@makeborne.com>";
export const TRANSACTIONAL_REPLY_TO = "admin@makeborne.com";
const ENDPOINT = "https://api.resend.com/emails";

export type MailEnv = Record<string, string | undefined>;
export type TransactionalMail = { to: string; subject: string; text: string; idempotencyKey: string };
export type SendResult = { ok: true; id: string } | { ok: false; code: string; retry: boolean };

export function transactionalMailEnabled(env: MailEnv = process.env) {
  return env.MAKEBORNE_TRANSACTIONAL_MAIL_ENABLED === "true" && /^re_[A-Za-z0-9_]{10,}$/.test(env.RESEND_API_KEY ?? "");
}

export async function sendTransactionalMail(mail: TransactionalMail, deps: { env?: MailEnv; fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<SendResult> {
  const env = deps.env ?? process.env;
  if (!transactionalMailEnabled(env)) return { ok: false, code: "MAIL_DISABLED", retry: true };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail.to) || !mail.subject || !mail.text || mail.idempotencyKey.length < 8)
    return { ok: false, code: "MAIL_INVALID", retry: false };
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": mail.idempotencyKey.slice(0, 256) },
      body: JSON.stringify({ from: TRANSACTIONAL_FROM, to: [mail.to], reply_to: TRANSACTIONAL_REPLY_TO, subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
  } catch {
    return { ok: false, code: "MAIL_NETWORK", retry: true };
  }
  if (response.ok) {
    const data = await response.json().catch(() => null) as { id?: unknown } | null;
    return typeof data?.id === "string" && data.id.length > 0 && data.id.length <= 200 ? { ok: true, id: data.id } : { ok: false, code: "MAIL_UNCONFIRMED", retry: true };
  }
  // 409: the same idempotency key with a different body, or one still in flight. Retrying later is safe.
  if (response.status === 429) return { ok: false, code: "MAIL_RATE_LIMITED", retry: true };
  if (response.status >= 500 || response.status === 409) return { ok: false, code: `MAIL_HTTP_${response.status}`, retry: true };
  return { ok: false, code: `MAIL_HTTP_${response.status}`, retry: response.status === 401 || response.status === 403 };
}

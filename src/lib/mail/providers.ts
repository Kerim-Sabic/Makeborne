import "server-only";
import { randomUUID } from "node:crypto";
import { buildMime, replySubject } from "./compose";
import { GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE, MICROSOFT_READWRITE_SCOPE, MICROSOFT_SEND_SCOPE, googleMailMode, hasMicrosoftScope, microsoftMailMode, parseGrantedScopes, type MailProvider } from "./config";

/** Network access is injected so the engine can be tested without real mailboxes. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type TokenSet = { accessToken: string; refreshToken?: string; expiresAt: Date; grantedScopes?: string[] };
/** Ids are null when the provider returns none (Outlook send-only: /me/sendMail answers 202 with no body). */
export type SentMessage = { providerMessageId: string | null; threadId: string | null; rfcMessageId: string | null };
export type InboundMessage = { providerMessageId: string; threadId: string; from: string; subject: string; snippet: string; receivedAt: Date };
export type OutgoingEmail = { from: string; fromName: string; to: string; toName: string; subject: string; text: string;
  /** Reply in this thread when present. */ replyTo?: { threadId: string; rfcMessageId: string | null; subject: string } | null };

/** Errors that mean the mailbox needs reconnecting (not a problem with this one email). */
export class MailAuthError extends Error { readonly code = "MAIL_AUTH"; }
/** The provider refused this email (bad address, too large…): definitely not sent. */
export class MailRejectedError extends Error { readonly code = "MAIL_REJECTED"; }
/** The outcome is unknown (timeout, 5xx after the request was sent): it may have been sent. */
export class MailUncertainError extends Error { readonly code = "MAIL_UNCERTAIN"; }

async function json<T>(response: Response, during: "send" | "other"): Promise<T> {
  if (response.status === 401 || response.status === 403) throw new MailAuthError(`Mailbox access was refused (${response.status}). Reconnect the mailbox.`);
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200).replace(/\s+/g, " ");
    if (response.status >= 500 && during === "send") throw new MailUncertainError(`The mail provider failed (${response.status}); the email may have been sent.`);
    if (response.status === 429 || response.status >= 500) throw new Error(`Mail provider is busy (${response.status}). ${detail}`);
    throw (during === "send" ? new MailRejectedError(`The mail provider refused this email (${response.status}). ${detail}`) : new Error(`Mail provider error (${response.status}). ${detail}`));
  }
  return response.status === 202 || response.status === 204 ? ({} as T) : await response.json() as T;
}
async function guarded(fetcher: Fetch, url: string, init: RequestInit, during: "send" | "other") {
  try { return await fetcher(url, { ...init, signal: init.signal ?? AbortSignal.timeout(20_000) }); }
  catch (error) {
    if (during === "send") throw new MailUncertainError("The connection to the mail provider dropped; the email may have been sent.");
    throw error;
  }
}
const form = (values: Record<string, string>) => new URLSearchParams(values).toString();

export type ProviderClient = {
  authUrl(input: { clientId: string; redirectUri: string; state: string; loginHint?: string }): string;
  exchange(input: { clientId: string; clientSecret: string; redirectUri: string; code: string }): Promise<TokenSet & { refreshToken: string }>;
  refresh(input: { clientId: string; clientSecret: string; refreshToken: string }): Promise<TokenSet>;
  profile(accessToken: string): Promise<{ email: string; name: string }>;
  send(accessToken: string, email: OutgoingEmail): Promise<SentMessage>;
  /** Messages in the thread from someone other than `self`, newest last. */
  replies(accessToken: string, threadId: string, self: string): Promise<InboundMessage[]>;
};

const googleScopes = () => ["openid", "email", "profile", GMAIL_SEND_SCOPE, ...(googleMailMode() === "full" ? [GMAIL_READ_SCOPE] : [])];
/** Send-only asks for sending and identity only; full mode adds the mailbox access reply tracking uses. */
export const microsoftScopes = () => ["openid", "email", "profile", "offline_access", "User.Read", MICROSOFT_SEND_SCOPE, ...(microsoftMailMode() === "full" ? [MICROSOFT_READWRITE_SCOPE] : [])];
const sameAddress = (header: string, self: string) => header.toLowerCase().includes(self.toLowerCase());
const addressIn = (header: string) => /<([^>]+)>/.exec(header)?.[1] ?? header.trim();

export function googleClient(fetcher: Fetch = fetch, options: { allowRead?: boolean } = {}): ProviderClient {
  const token = async (values: Record<string, string>) => {
    const result = await json<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }>(await guarded(fetcher, "https://oauth2.googleapis.com/token",
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(values) }, "other"), "other");
    if (result.scope !== undefined && typeof result.scope !== "string") throw new Error("The provider returned invalid mailbox permissions.");
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: new Date(Date.now() + (result.expires_in - 60) * 1000),
      ...(result.scope === undefined ? {} : { grantedScopes: parseGrantedScopes(result.scope) }) };
  };
  const api = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });
  return {
    authUrl: ({ clientId, redirectUri, state, loginHint }) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code",
      scope: googleScopes().join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "false", state, ...(loginHint ? { login_hint: loginHint } : {}) })}`,
    async exchange({ clientId, clientSecret, redirectUri, code }) {
      const result = await token({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code, grant_type: "authorization_code" });
      if (!result.refreshToken) throw new MailAuthError("Google did not grant offline access. Remove Makeborne from your Google account permissions and connect again.");
      if (!result.grantedScopes?.includes(GMAIL_SEND_SCOPE)) throw new MailAuthError("Google did not confirm permission to send email. Connect again and allow sending.");
      return { ...result, refreshToken: result.refreshToken };
    },
    refresh: ({ clientId, clientSecret, refreshToken }) => token({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" })
      .catch(error => { throw error instanceof MailAuthError || /invalid_grant|400/.test(String(error)) ? new MailAuthError("Google access expired or was revoked. Reconnect the mailbox.") : error; }),
    async profile(accessToken) {
      const user = await json<{ email?: string; email_verified?: boolean; name?: string }>(await guarded(fetcher, "https://openidconnect.googleapis.com/v1/userinfo", { headers: api(accessToken) }, "other"), "other");
      if (user.email_verified !== true || typeof user.email !== "string" || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(user.email)) throw new MailAuthError("Google did not provide a verified email address. Connect again.");
      return { email: user.email, name: typeof user.name === "string" ? user.name : "" };
    },
    async send(accessToken, email) {
      const rfcMessageId = `<${randomUUID()}@makeborne.com>`;
      const raw = buildMime({ from: email.from, fromName: email.fromName, to: email.to, toName: email.toName,
        subject: email.replyTo ? replySubject(email.replyTo.subject) : email.subject, text: email.text, messageId: rfcMessageId, inReplyTo: email.replyTo?.rfcMessageId ?? null, references: null });
      const sent = await json<{ id: string; threadId: string }>(await guarded(fetcher, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        { method: "POST", headers: { ...api(accessToken), "Content-Type": "application/json" }, body: JSON.stringify({ raw, ...(email.replyTo ? { threadId: email.replyTo.threadId } : {}) }) }, "send"), "send");
      // Store our RFC Message-ID; reading sent-message metadata would require inbox permissions.
      return { providerMessageId: sent.id, threadId: sent.threadId, rfcMessageId };
    },
    async replies(accessToken, threadId, self) {
      if (googleMailMode() !== "full" || !options.allowRead) throw new Error("Reply tracking is unavailable for this Gmail connection.");
      const thread = await json<{ messages?: { id: string; internalDate: string; snippet?: string; payload?: { headers?: { name: string; value: string }[] } }[] }>(await guarded(fetcher,
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, { headers: api(accessToken) }, "other"), "other");
      return (thread.messages ?? []).flatMap(message => {
        const headers = message.payload?.headers ?? [], from = headers.find(item => item.name.toLowerCase() === "from")?.value ?? "";
        if (!from || sameAddress(from, self)) return [];
        return [{ providerMessageId: message.id, threadId, from: addressIn(from), subject: headers.find(item => item.name.toLowerCase() === "subject")?.value ?? "",
          snippet: (message.snippet ?? "").slice(0, 2000), receivedAt: new Date(Number(message.internalDate)) }];
      });
    },
  };
}

export function microsoftClient(fetcher: Fetch = fetch, options: { allowRead?: boolean } = {}): ProviderClient {
  const authority = "https://login.microsoftonline.com/common/oauth2/v2.0";
  const graph = "https://graph.microsoft.com/v1.0";
  // Mailbox reads and drafts only when the server mode and this mailbox's recorded grant both allow them.
  const readWrite = () => microsoftMailMode() === "full" && options.allowRead === true;
  const token = async (values: Record<string, string>) => {
    const result = await json<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }>(await guarded(fetcher, `${authority}/token`,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ ...values, scope: microsoftScopes().join(" ") }) }, "other"), "other");
    if (result.scope !== undefined && typeof result.scope !== "string") throw new Error("The provider returned invalid mailbox permissions.");
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: new Date(Date.now() + (result.expires_in - 60) * 1000),
      ...(result.scope === undefined ? {} : { grantedScopes: parseGrantedScopes(result.scope) }) };
  };
  const api = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" });
  type GraphMessage = { id: string; conversationId: string; internetMessageId?: string; subject?: string; bodyPreview?: string; receivedDateTime?: string; from?: { emailAddress?: { address?: string } } };
  return {
    authUrl: ({ clientId, redirectUri, state, loginHint }) => `${authority}/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code",
      response_mode: "query", scope: microsoftScopes().join(" "), state, prompt: "select_account", ...(loginHint ? { login_hint: loginHint } : {}) })}`,
    async exchange({ clientId, clientSecret, redirectUri, code }) {
      const result = await token({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code, grant_type: "authorization_code" });
      if (!result.refreshToken) throw new MailAuthError("Microsoft did not grant offline access. Connect again and accept all permissions.");
      if (!result.grantedScopes || !hasMicrosoftScope(result.grantedScopes, MICROSOFT_SEND_SCOPE)) throw new MailAuthError("Microsoft did not confirm permission to send email. Connect again and accept the permissions.");
      return { ...result, refreshToken: result.refreshToken };
    },
    refresh: ({ clientId, clientSecret, refreshToken }) => token({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" })
      .catch(error => { throw error instanceof MailAuthError || /invalid_grant|400/.test(String(error)) ? new MailAuthError("Microsoft access expired or was revoked. Reconnect the mailbox.") : error; }),
    async profile(accessToken) {
      const me = await json<{ mail?: string | null; userPrincipalName?: string; displayName?: string }>(await guarded(fetcher, `${graph}/me?$select=mail,userPrincipalName,displayName`, { headers: api(accessToken) }, "other"), "other");
      return { email: me.mail || me.userPrincipalName || "", name: me.displayName ?? "" };
    },
    async send(accessToken, email) {
      const body = { contentType: "Text", content: email.text };
      if (!readWrite()) {
        // Send-only (Mail.Send): one call, no draft and no mailbox reads. Graph returns no ids, so the
        // message cannot be threaded or tracked; a follow-up goes out as a new "Re:" email.
        await json(await guarded(fetcher, `${graph}/me/sendMail`, { method: "POST", headers: api(accessToken), body: JSON.stringify({ saveToSentItems: true, message: {
          subject: email.replyTo ? replySubject(email.replyTo.subject) : email.subject, body, toRecipients: [{ emailAddress: { address: email.to, name: email.toName } }] } }) }, "send"), "send");
        return { providerMessageId: null, threadId: null, rfcMessageId: null };
      }
      let draft: GraphMessage;
      if (email.replyTo?.rfcMessageId) {
        // Reply in the thread: find the sent message by its Internet Message-ID, then reply to it.
        const found = await json<{ value: GraphMessage[] }>(await guarded(fetcher, `${graph}/me/messages?$filter=${encodeURIComponent(`internetMessageId eq '${email.replyTo.rfcMessageId.replace(/'/g, "''")}'`)}&$select=id,conversationId&$top=1`,
          { headers: api(accessToken) }, "other"), "other");
        const original = found.value[0];
        draft = original
          ? await json<GraphMessage>(await guarded(fetcher, `${graph}/me/messages/${encodeURIComponent(original.id)}/createReply`, { method: "POST", headers: api(accessToken), body: "{}" }, "other"), "other")
          : await json<GraphMessage>(await guarded(fetcher, `${graph}/me/messages`, { method: "POST", headers: api(accessToken), body: JSON.stringify({ subject: replySubject(email.replyTo.subject), body, toRecipients: [{ emailAddress: { address: email.to, name: email.toName } }] }) }, "other"), "other");
        if (original) await json(await guarded(fetcher, `${graph}/me/messages/${encodeURIComponent(draft.id)}`, { method: "PATCH", headers: api(accessToken), body: JSON.stringify({ body }) }, "other"), "other");
      } else {
        draft = await json<GraphMessage>(await guarded(fetcher, `${graph}/me/messages`, { method: "POST", headers: api(accessToken),
          body: JSON.stringify({ subject: email.subject, body, toRecipients: [{ emailAddress: { address: email.to, name: email.toName } }] }) }, "other"), "other");
      }
      await json(await guarded(fetcher, `${graph}/me/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST", headers: api(accessToken), body: "" }, "send"), "send");
      return { providerMessageId: draft.id, threadId: draft.conversationId, rfcMessageId: draft.internetMessageId ?? null };
    },
    async replies(accessToken, threadId, self) {
      if (!readWrite()) throw new Error("Reply tracking is unavailable for this Outlook connection.");
      const list = await json<{ value: GraphMessage[] }>(await guarded(fetcher, `${graph}/me/messages?$filter=${encodeURIComponent(`conversationId eq '${threadId.replace(/'/g, "''")}'`)}&$select=id,conversationId,subject,bodyPreview,receivedDateTime,from&$top=50`,
        { headers: api(accessToken) }, "other"), "other");
      return list.value.flatMap(message => {
        const from = message.from?.emailAddress?.address ?? "";
        if (!from || sameAddress(from, self)) return [];
        return [{ providerMessageId: message.id, threadId, from, subject: message.subject ?? "", snippet: (message.bodyPreview ?? "").slice(0, 2000), receivedAt: new Date(message.receivedDateTime ?? Date.now()) }];
      });
    },
  };
}

export const providerClient = (provider: MailProvider, fetcher?: Fetch, options?: { allowRead?: boolean }) => provider === "google" ? googleClient(fetcher, options) : microsoftClient(fetcher, options);

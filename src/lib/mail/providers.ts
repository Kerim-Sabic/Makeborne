import "server-only";
import { buildMime, replySubject } from "./compose";
import type { MailProvider } from "./config";

/** Network access is injected so the engine can be tested without real mailboxes. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type TokenSet = { accessToken: string; refreshToken?: string; expiresAt: Date };
export type SentMessage = { providerMessageId: string; threadId: string; rfcMessageId: string | null };
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

const GOOGLE_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"];
const MICROSOFT_SCOPES = ["openid", "email", "profile", "offline_access", "User.Read", "Mail.Send", "Mail.ReadWrite"];
const sameAddress = (header: string, self: string) => header.toLowerCase().includes(self.toLowerCase());
const addressIn = (header: string) => /<([^>]+)>/.exec(header)?.[1] ?? header.trim();

export function googleClient(fetcher: Fetch = fetch): ProviderClient {
  const token = async (values: Record<string, string>) => {
    const result = await json<{ access_token: string; refresh_token?: string; expires_in: number }>(await guarded(fetcher, "https://oauth2.googleapis.com/token",
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(values) }, "other"), "other");
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: new Date(Date.now() + (result.expires_in - 60) * 1000) };
  };
  const api = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });
  return {
    authUrl: ({ clientId, redirectUri, state, loginHint }) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code",
      scope: GOOGLE_SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state, ...(loginHint ? { login_hint: loginHint } : {}) })}`,
    async exchange({ clientId, clientSecret, redirectUri, code }) {
      const result = await token({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code, grant_type: "authorization_code" });
      if (!result.refreshToken) throw new MailAuthError("Google did not grant offline access. Remove Makeborne from your Google account permissions and connect again.");
      return { ...result, refreshToken: result.refreshToken };
    },
    refresh: ({ clientId, clientSecret, refreshToken }) => token({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" })
      .catch(error => { throw error instanceof MailAuthError || /invalid_grant|400/.test(String(error)) ? new MailAuthError("Google access expired or was revoked. Reconnect the mailbox.") : error; }),
    async profile(accessToken) {
      const gmail = await json<{ emailAddress: string }>(await guarded(fetcher, "https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: api(accessToken) }, "other"), "other");
      const user = await json<{ name?: string }>(await guarded(fetcher, "https://openidconnect.googleapis.com/v1/userinfo", { headers: api(accessToken) }, "other"), "other").catch(() => ({ name: "" }));
      return { email: gmail.emailAddress, name: user.name ?? "" };
    },
    async send(accessToken, email) {
      const raw = buildMime({ from: email.from, fromName: email.fromName, to: email.to, toName: email.toName,
        subject: email.replyTo ? replySubject(email.replyTo.subject) : email.subject, text: email.text, inReplyTo: email.replyTo?.rfcMessageId ?? null, references: null });
      const sent = await json<{ id: string; threadId: string }>(await guarded(fetcher, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        { method: "POST", headers: { ...api(accessToken), "Content-Type": "application/json" }, body: JSON.stringify({ raw, ...(email.replyTo ? { threadId: email.replyTo.threadId } : {}) }) }, "send"), "send");
      // The Message-ID lets later steps thread correctly; losing it only weakens threading.
      let rfcMessageId: string | null = null;
      try {
        const meta = await json<{ payload?: { headers?: { name: string; value: string }[] } }>(await guarded(fetcher,
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(sent.id)}?format=metadata&metadataHeaders=Message-ID`, { headers: api(accessToken) }, "other"), "other");
        rfcMessageId = meta.payload?.headers?.find(item => item.name.toLowerCase() === "message-id")?.value ?? null;
      } catch { rfcMessageId = null; }
      return { providerMessageId: sent.id, threadId: sent.threadId, rfcMessageId };
    },
    async replies(accessToken, threadId, self) {
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

export function microsoftClient(fetcher: Fetch = fetch): ProviderClient {
  const authority = "https://login.microsoftonline.com/common/oauth2/v2.0";
  const graph = "https://graph.microsoft.com/v1.0";
  const token = async (values: Record<string, string>) => {
    const result = await json<{ access_token: string; refresh_token?: string; expires_in: number }>(await guarded(fetcher, `${authority}/token`,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ ...values, scope: MICROSOFT_SCOPES.join(" ") }) }, "other"), "other");
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: new Date(Date.now() + (result.expires_in - 60) * 1000) };
  };
  const api = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" });
  type GraphMessage = { id: string; conversationId: string; internetMessageId?: string; subject?: string; bodyPreview?: string; receivedDateTime?: string; from?: { emailAddress?: { address?: string } } };
  return {
    authUrl: ({ clientId, redirectUri, state, loginHint }) => `${authority}/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code",
      response_mode: "query", scope: MICROSOFT_SCOPES.join(" "), state, prompt: "select_account", ...(loginHint ? { login_hint: loginHint } : {}) })}`,
    async exchange({ clientId, clientSecret, redirectUri, code }) {
      const result = await token({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code, grant_type: "authorization_code" });
      if (!result.refreshToken) throw new MailAuthError("Microsoft did not grant offline access. Connect again and accept all permissions.");
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

export const providerClient = (provider: MailProvider, fetcher?: Fetch) => provider === "google" ? googleClient(fetcher) : microsoftClient(fetcher);

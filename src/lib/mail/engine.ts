import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ClientOutreachSchema, closedOutreachStages, emptyOutreach, normalizeOutreachStage, saveOutreach, type ClientOutreach } from "../client-outreach";
import { mailVariables, renderTemplate, SequenceStepsSchema } from "./compose";
import { mailCapabilities, MANUAL_MAIL_NOTICE, openSecret, providerConfig, sealSecret, type MailProvider } from "./config";
import { MailAuthError, MailRejectedError, MailUncertainError, providerClient, type Fetch, type ProviderClient, type SentMessage } from "./providers";
import { dailyQuota, dueAfter, sendAllowed, utcDayStart } from "./throttle";

export type MailAccountRow = { id: string; workspace_id: string; user_id: string; provider: MailProvider; granted_scopes?: string[]; email: string; display_name: string; status: string;
  daily_limit: number; warmup_started_at: string; last_sent_at: string | null; last_synced_at: string | null };
type ClientRow = { id: string; workspace_id: string; name: string; company: string; email: string; website: string; outreach: unknown; updated_at: string };
export type EngineDeps = { db: SupabaseClient; fetcher?: Fetch; now?: () => Date; clients?: Partial<Record<MailProvider, ProviderClient>> };

const providerFor = (deps: EngineDeps, account: MailAccountRow) => deps.clients?.[account.provider] ?? providerClient(account.provider, deps.fetcher, { allowRead: mailCapabilities(account).canTrackReplies });
const nowOf = (deps: EngineDeps) => deps.now?.() ?? new Date();
const failure = (error: { message?: string; code?: string } | null) => { if (error) throw Object.assign(new Error(error.message ?? "Database error"), { code: error.code }); };
const clip = (value: string, length: number) => value.length > length ? `${value.slice(0, length - 1)}…` : value;

async function markAccount(deps: EngineDeps, account: MailAccountRow, status: "active" | "error", lastError: string | null) {
  await deps.db.from("mail_accounts").update({ status, last_error: lastError ? clip(lastError, 500) : null, updated_at: nowOf(deps).toISOString() }).eq("id", account.id);
}

/** Seals and stores tokens; a null refresh token keeps the stored one. */
export async function storeTokens(deps: EngineDeps, accountId: string, refreshToken: string | null, accessToken: string, expiresAt: Date) {
  failure((await deps.db.rpc("makeborne_mail_token_write", { p_account: accountId, p_refresh: refreshToken ? sealSecret(refreshToken, accountId) : null,
    p_access: sealSecret(accessToken, accountId), p_expires: expiresAt.toISOString() })).error);
}

/** A valid access token, refreshed and re-sealed when it is about to expire. */
export async function accessToken(deps: EngineDeps, account: MailAccountRow): Promise<string> {
  const config = providerConfig(account.provider);
  if (!config) throw new MailAuthError("This mail provider isn't configured on the server.");
  const { data: stored, error } = await deps.db.rpc("makeborne_mail_token_read", { p_account: account.id });
  failure(error);
  const data = stored as { refresh_token: string; access_token: string | null; access_expires_at: string | null } | null;
  if (!data?.refresh_token) throw new MailAuthError("Mailbox tokens are missing. Reconnect the mailbox.");
  if (data.access_token && data.access_expires_at && new Date(data.access_expires_at).getTime() > nowOf(deps).getTime() + 60_000) return openSecret(data.access_token, account.id);
  try {
    const refreshed = await providerFor(deps, account).refresh({ ...config, refreshToken: openSecret(data.refresh_token, account.id) });
    if (refreshed.grantedScopes !== undefined) {
      failure((await deps.db.from("mail_accounts").update({ granted_scopes: refreshed.grantedScopes }).eq("id", account.id)).error);
      account.granted_scopes = refreshed.grantedScopes;
    }
    await storeTokens(deps, account.id, refreshed.refreshToken ?? null, refreshed.accessToken, refreshed.expiresAt);
    return refreshed.accessToken;
  } catch (error) {
    if (error instanceof MailAuthError) await markAccount(deps, account, "error", error.message);
    throw error;
  }
}

/** Applies an outreach change with the same history rules as the CRM screens; retries on concurrent edits. */
export async function updateClientOutreach(deps: EngineDeps, clientId: string, workspaceId: string, change: (current: ClientOutreach) => { next: ClientOutreach; text: string; type: "contact" | "update" | "note" }, activityId: string = crypto.randomUUID()) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await deps.db.from("clients").select("outreach,updated_at").eq("id", clientId).eq("workspace_id", workspaceId).maybeSingle();
    failure(error);
    if (!data) return;
    const previous = data.outreach ? ClientOutreachSchema.parse(data.outreach) : undefined;
    if (previous?.activity.some(entry => entry.id === activityId)) return;
    const { next, text, type } = change(previous ?? emptyOutreach());
    let outreach: ClientOutreach;
    try { outreach = saveOutreach(previous, next, { id: activityId, at: nowOf(deps).toISOString(), text: clip(text, 1900), type }); } catch { return; } // history full: never block mail
    const result = await deps.db.from("clients").update({ outreach }).eq("id", clientId).eq("workspace_id", workspaceId).eq("updated_at", data.updated_at).select("id");
    failure(result.error);
    if (result.data?.length) return;
  }
}
const localDay = (date: Date) => date.toISOString().slice(0, 10);

async function sentToday(deps: EngineDeps, account: MailAccountRow) {
  const { count, error } = await deps.db.from("mail_messages").select("id", { count: "exact", head: true }).eq("account_id", account.id).eq("direction", "out")
    .in("status", ["sending", "sent", "unknown"]).gte("created_at", utcDayStart(nowOf(deps)).toISOString());
  failure(error);
  return count ?? 0;
}

export type SendRequest = { account: MailAccountRow; client: ClientRow; subject: string; text: string; createdBy: string | null; automated: boolean;
  enrollmentId?: string; step?: number; replyTo?: { threadId: string; rfcMessageId: string | null; subject: string } | null };
export type SendOutcome = { status: "sent"; messageId: string } | { status: "skipped"; reason: "daily_limit" | "spacing" | "claimed" } | { status: "failed" | "unknown" | "auth"; messageId?: string; error: string };

/** Sends one email: quota check, claim (exactly once per sequence step), provider call, then CRM history. */
export async function sendEmail(deps: EngineDeps, request: SendRequest): Promise<SendOutcome> {
  const now = nowOf(deps), { account, client } = request;
  if (account.status !== "active") return { status: "auth", error: "Reconnect this mailbox before sending." };
  if (!mailCapabilities(account).canSend) return { status: "auth", error: "Reconnect this mailbox to confirm its sending permission." };
  if (request.automated && !mailCapabilities(account).canAutomate) return { status: "failed", error: MANUAL_MAIL_NOTICE };
  if (!client.email) return { status: "failed", error: `${client.name} has no email address.` };
  const allowed = sendAllowed({ sentToday: await sentToday(deps, account), quota: dailyQuota(new Date(account.warmup_started_at), account.daily_limit, now),
    lastSentAt: account.last_sent_at ? new Date(account.last_sent_at) : null, now, automated: request.automated });
  if (!allowed.ok) return { status: "skipped", reason: allowed.reason };
  const claim = await deps.db.from("mail_messages").insert({ workspace_id: account.workspace_id, client_id: client.id, account_id: account.id,
    enrollment_id: request.enrollmentId ?? null, step: request.step ?? null, direction: "out", status: "sending", subject: clip(request.subject, 300), body: clip(request.text, 20000),
    from_address: account.email, to_address: client.email, thread_id: request.replyTo?.threadId ?? null, created_by: request.createdBy }).select("id").single();
  if (claim.error?.code === "23505") return { status: "skipped", reason: "claimed" };
  failure(claim.error);
  const messageId = claim.data!.id as string;
  let sent: SentMessage | null = null;
  try {
    const token = await accessToken(deps, account);
    if (!mailCapabilities(account).canSend) throw new MailAuthError("Reconnect this mailbox to confirm its sending permission.");
    if (request.automated && !mailCapabilities(account).canAutomate) throw new MailRejectedError(MANUAL_MAIL_NOTICE);
    sent = await providerFor(deps, account).send(token, { from: account.email, fromName: account.display_name, to: client.email, toName: client.name,
      subject: request.subject, text: request.text, replyTo: request.replyTo ?? null });
    failure((await deps.db.from("mail_messages").update({ status: "sent", provider_message_id: sent.providerMessageId, thread_id: sent.threadId, rfc_message_id: sent.rfcMessageId, sent_at: now.toISOString() }).eq("id", messageId)).error);
    failure((await deps.db.from("mail_accounts").update({ last_sent_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", account.id)).error);
    await updateClientOutreach(deps, client.id, client.workspace_id, current => ({
      next: { ...current, stage: current.stage === "Lead" ? "Contacted" : current.stage, channel: current.channel === "Not set" ? "Email" : current.channel, lastContact: localDay(now) },
      text: `Email sent${request.enrollmentId ? " (sequence)" : ""}: ${request.subject || "(reply)"}`, type: "contact",
    }));
    return { status: "sent", messageId };
  } catch (error) {
    // A confirmed provider send must never become a retryable failure because
    // its database receipt, mailbox timestamp or CRM history could not be saved.
    const uncertain = sent !== null || error instanceof MailUncertainError;
    const message = sent ? "The provider accepted this email, but its saved record could not be confirmed. Do not resend it."
      : error instanceof Error ? error.message : "Sending failed.";
    const status = uncertain ? "unknown" : "failed";
    try {
      await deps.db.from("mail_messages").update({ status, error: clip(message, 500),
        ...(sent ? { provider_message_id: sent.providerMessageId, thread_id: sent.threadId, rfc_message_id: sent.rfcMessageId, sent_at: now.toISOString() } : {}) }).eq("id", messageId);
    } catch { /* Keep the original outcome even if recording it also fails; the claim still prevents automatic resends. */ }
    if (uncertain) return { status: "unknown", messageId, error: message };
    if (error instanceof MailAuthError) return { status: "auth", messageId, error: message };
    if (error instanceof MailRejectedError) return { status: "failed", messageId, error: message };
    // Token or network trouble before sending: the claim stays failed; a person can retry.
    return { status: "failed", messageId, error: message };
  }
}

type EnrollmentRow = { id: string; workspace_id: string; sequence_id: string; client_id: string; account_id: string; status: string; next_step: number; next_send_at: string | null; created_by: string | null };

/** Sends every sequence step that is due, within each mailbox's pace. Safe to run concurrently. */
export async function processDueEnrollments(deps: EngineDeps, options: { limit?: number; accountIds?: string[]; failedReplySyncSet?: ReadonlySet<string> } = {}) {
  const now = nowOf(deps), summary = { sent: 0, skipped: 0, completed: 0, stopped: 0, failed: 0, paused: 0 };
  let query = deps.db.from("mail_enrollments").select("*").eq("status", "active").lte("next_send_at", now.toISOString()).order("next_send_at").limit(options.limit ?? 40);
  if (options.accountIds) query = query.in("account_id", options.accountIds);
  const { data: due, error } = await query;
  failure(error);
  const blockedAccounts = new Set<string>(options.failedReplySyncSet);
  for (const enrollment of (due ?? []) as EnrollmentRow[]) {
    if (blockedAccounts.has(enrollment.account_id)) { summary.skipped++; continue; }
    const set = async (fields: Record<string, unknown>) => { await deps.db.from("mail_enrollments").update({ ...fields, updated_at: now.toISOString() }).eq("id", enrollment.id).eq("status", "active"); };
    const [{ data: sequence }, { data: client }, { data: account }] = await Promise.all([
      deps.db.from("mail_sequences").select("steps,stop_on_reply,archived").eq("id", enrollment.sequence_id).maybeSingle(),
      deps.db.from("clients").select("id,workspace_id,name,company,email,website,outreach,updated_at").eq("id", enrollment.client_id).maybeSingle(),
      deps.db.from("mail_accounts").select("*").eq("id", enrollment.account_id).maybeSingle(),
    ]);
    if (!sequence || !client || !account) { await set({ status: "stopped", last_error: "The sequence, client or mailbox was removed." }); summary.stopped++; continue; }
    if (!mailCapabilities(account as MailAccountRow).canAutomate) { await set({ status: "paused", last_error: MANUAL_MAIL_NOTICE }); blockedAccounts.add(account.id); summary.paused++; continue; }
    const steps = SequenceStepsSchema.safeParse(sequence.steps);
    if (!steps.success || sequence.archived) { await set({ status: "stopped", last_error: "The sequence was archived or is invalid." }); summary.stopped++; continue; }
    // Stored stages may use the previous vocabulary during the CRM transition (e.g. Delivered = Won).
    const stage = String(normalizeOutreachStage((client.outreach as { stage?: string } | null)?.stage ?? ""));
    if (stage && closedOutreachStages.includes(stage)) { await set({ status: "stopped", last_error: `Client marked ${stage}.` }); summary.stopped++; continue; }
    if (sequence.stop_on_reply) {
      const { count, error: replyError } = await deps.db.from("mail_messages").select("id", { count: "exact", head: true }).eq("client_id", client.id).eq("direction", "in")
        .gte("sent_at", (enrollment as unknown as { created_at: string }).created_at ?? "1970-01-01");
      if (replyError) { blockedAccounts.add(account.id); summary.skipped++; continue; }
      if ((count ?? 0) > 0) { await set({ status: "replied" }); summary.stopped++; continue; }
    }
    const step = steps.data[enrollment.next_step];
    if (!step) { await set({ status: "completed", next_send_at: null }); summary.completed++; continue; }
    // Later steps without a subject continue the first email's thread.
    let replyTo: SendRequest["replyTo"] = null;
    if (!step.subject && enrollment.next_step > 0) {
      const { data: previous } = await deps.db.from("mail_messages").select("thread_id,rfc_message_id,subject").eq("enrollment_id", enrollment.id).eq("direction", "out").eq("status", "sent")
        .order("step", { ascending: false }).limit(1).maybeSingle();
      if (previous?.thread_id) replyTo = { threadId: previous.thread_id, rfcMessageId: previous.rfc_message_id, subject: previous.subject };
    }
    const variables = mailVariables(client, { name: (account as MailAccountRow).display_name || (account as MailAccountRow).email.split("@")[0] });
    const subject = renderTemplate(step.subject || replyTo?.subject || "", variables), body = renderTemplate(step.body, variables);
    if (subject.missing.length || body.missing.length) {
      await set({ status: "paused", last_error: `Missing details for ${[...subject.missing, ...body.missing].join(", ")}. Add them to the client or a fallback like {{first_name|there}}.` });
      summary.paused++; continue;
    }
    const outcome = await sendEmail(deps, { account: account as MailAccountRow, client: client as ClientRow, subject: subject.text, text: body.text, createdBy: enrollment.created_by,
      automated: true, enrollmentId: enrollment.id, step: enrollment.next_step, replyTo });
    if (outcome.status === "sent") {
      const next = steps.data[enrollment.next_step + 1];
      await set(next ? { next_step: enrollment.next_step + 1, next_send_at: dueAfter(now, next.delayDays).toISOString(), last_error: null } : { next_step: enrollment.next_step + 1, status: "completed", next_send_at: null, last_error: null });
      if (!next) summary.completed++;
      summary.sent++;
      blockedAccounts.add(account.id); // spacing: at most one automated send per mailbox per run
    } else if (outcome.status === "skipped") {
      summary.skipped++;
      if (outcome.reason !== "claimed") blockedAccounts.add(account.id);
    } else if (outcome.status === "auth") { await set({ status: "paused", last_error: outcome.error }); blockedAccounts.add(account.id); summary.paused++; }
    else if (outcome.status === "unknown") { await set({ status: "paused", last_error: `${outcome.error} Check your Sent folder before taking further action.` }); blockedAccounts.add(account.id); summary.paused++; }
    else { await set({ status: "failed", last_error: outcome.error }); summary.failed++; }
  }
  return summary;
}

/** Finds replies in threads we sent from, records them, stops sequences and moves the client into a conversation. */
export async function syncReplies(deps: EngineDeps, options: { accountIds?: string[] } = {}) {
  const now = nowOf(deps);
  let accountsQuery = deps.db.from("mail_accounts").select("*").eq("status", "active");
  if (options.accountIds) accountsQuery = accountsQuery.in("id", options.accountIds);
  const { data: accounts, error } = await accountsQuery;
  failure(error);
  const summary = { accounts: 0, replies: 0, errors: 0, failedAccountIds: [] as string[], unavailableAccountIds: [] as string[] };
  for (const account of (accounts ?? []) as MailAccountRow[]) {
    summary.accounts++;
    if (!mailCapabilities(account).canTrackReplies) { summary.unavailableAccountIds.push(account.id); continue; }
    try {
      const token = await accessToken(deps, account);
      if (!mailCapabilities(account).canTrackReplies) { summary.unavailableAccountIds.push(account.id); continue; }
      const { data: threads, error: threadError } = await deps.db.from("mail_messages").select("thread_id,client_id,workspace_id").eq("account_id", account.id).eq("direction", "out")
        .eq("status", "sent").not("thread_id", "is", null).order("sent_at", { ascending: false }).limit(201);
      failure(threadError);
      const seen = new Map<string, { client_id: string; workspace_id: string }>();
      for (const row of (threads ?? []).slice(0, 200)) if (row.thread_id && row.client_id && !seen.has(row.thread_id)) seen.set(row.thread_id, row);
      const incomplete = (threads?.length ?? 0) > 200 || seen.size > 60;
      for (const [threadId, owner] of [...seen].slice(0, 60)) {
        const inbound = await providerFor(deps, account).replies(token, threadId, account.email);
        for (const reply of inbound) {
          const inserted = await deps.db.from("mail_messages").insert({ workspace_id: owner.workspace_id, client_id: owner.client_id, account_id: account.id, direction: "in", status: "received",
            provider_message_id: reply.providerMessageId, thread_id: threadId, subject: clip(reply.subject, 300), body: clip(reply.snippet, 20000), from_address: clip(reply.from, 320),
            to_address: account.email, sent_at: reply.receivedAt.toISOString() }).select("id");
          let activityId = inserted.data?.[0]?.id as string | undefined;
          if (inserted.error?.code === "23505") {
            // The prior run may have stored the reply but failed before stopping
            // its sequence or saving history. Replay those effects idempotently.
            const recorded = await deps.db.from("mail_messages").select("id").eq("account_id", account.id).eq("provider_message_id", reply.providerMessageId).eq("direction", "in").maybeSingle();
            failure(recorded.error);
            activityId = recorded.data?.id;
          } else { failure(inserted.error); summary.replies++; }
          if (!activityId) throw new Error("The saved reply could not be confirmed.");
          failure((await deps.db.from("mail_enrollments").update({ status: "replied", updated_at: now.toISOString() }).eq("client_id", owner.client_id).in("status", ["active", "paused"])
            .lte("created_at", reply.receivedAt.toISOString())).error);
          await updateClientOutreach(deps, owner.client_id, owner.workspace_id, current => ({
            next: { ...current, stage: ["Lead", "Contacted"].includes(current.stage) ? "Conversation" : current.stage, lastContact: localDay(reply.receivedAt), nextFollowUp: localDay(now) },
            text: `Replied by email: ${clip(reply.snippet || reply.subject, 600)}`, type: "contact",
          }), activityId);
        }
      }
      if (incomplete) throw new Error("Reply check reached its safety limit. Automatic follow-ups are waiting for a complete check.");
      failure((await deps.db.from("mail_accounts").update({ last_synced_at: now.toISOString() }).eq("id", account.id)).error);
    } catch (error) {
      summary.errors++;
      summary.failedAccountIds.push(account.id);
      if (!(error instanceof MailAuthError)) console.error(JSON.stringify({ event: "mail_sync_failed", account: account.id, message: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
    }
  }
  return summary;
}

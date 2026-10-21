import { cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { automationEnabled, googleMailMode, mailAvailability, mailCapabilities, microsoftMailMode } from "@/lib/mail/config";
import { dailyQuota, utcDayStart } from "@/lib/mail/throttle";
import { mailContext } from "@/lib/mail/server";

type Context = { params: Promise<{ workspaceId: string }> };

/** Email overview for the workspace: mailboxes (with today's pace), templates, sequences with counts, and recent replies. */
export async function GET(_request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const { client, user } = await mailContext(workspaceId, false);
    const [accounts, templates, sequences, enrollments, replies, sentToday] = await Promise.all([
      client.from("mail_accounts").select("id,user_id,provider,granted_scopes,email,display_name,status,last_error,daily_limit,warmup_started_at,last_sent_at,last_synced_at").eq("workspace_id", workspaceId).order("created_at"),
      client.from("mail_templates").select("id,name,subject,body,updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(200),
      client.from("mail_sequences").select("id,name,steps,stop_on_reply,archived,updated_at").eq("workspace_id", workspaceId).eq("archived", false).order("updated_at", { ascending: false }).limit(100),
      client.from("mail_enrollments").select("sequence_id,account_id,status").eq("workspace_id", workspaceId).limit(5000),
      client.from("mail_messages").select("id,client_id,subject,body,from_address,sent_at,created_at").eq("workspace_id", workspaceId).eq("direction", "in").order("created_at", { ascending: false }).limit(25),
      client.from("mail_messages").select("account_id").eq("workspace_id", workspaceId).eq("direction", "out").in("status", ["sending", "sent", "unknown"]).gte("created_at", utcDayStart(new Date()).toISOString()).limit(5000),
    ]);
    for (const result of [accounts, templates, sequences, enrollments, replies, sentToday]) databaseError(result.error);
    const counts = new Map<string, Record<string, number>>();
    for (const row of enrollments.data ?? []) { const entry = counts.get(row.sequence_id) ?? {}; entry[row.status] = (entry[row.status] ?? 0) + 1; counts.set(row.sequence_id, entry); }
    // Which sequences still send from each mailbox (running or paused clients), for its connection card.
    const sequenceName = new Map((sequences.data ?? []).map(row => [row.id, row.name as string]));
    const usage = new Map<string, Map<string, { sequenceId: string; name: string; active: number; paused: number }>>();
    for (const row of enrollments.data ?? []) {
      if (!row.account_id || (row.status !== "active" && row.status !== "paused")) continue;
      const bySequence = usage.get(row.account_id) ?? new Map();
      const entry = bySequence.get(row.sequence_id) ?? { sequenceId: row.sequence_id, name: sequenceName.get(row.sequence_id) ?? "Archived sequence", active: 0, paused: 0 };
      entry[row.status as "active" | "paused"]++;
      bySequence.set(row.sequence_id, entry); usage.set(row.account_id, bySequence);
    }
    const sends = new Map<string, number>();
    for (const row of sentToday.data ?? []) sends.set(row.account_id, (sends.get(row.account_id) ?? 0) + 1);
    const clientIds = [...new Set((replies.data ?? []).map(row => row.client_id).filter(Boolean))];
    const names = clientIds.length ? await client.from("clients").select("id,name").in("id", clientIds) : { data: [], error: null };
    databaseError(names.error);
    const nameOf = new Map((names.data ?? []).map(row => [row.id, row.name]));
    return cloudJson({
      availability: mailAvailability(), automation: automationEnabled(), googleMode: googleMailMode(), microsoftMode: microsoftMailMode(),
      accounts: (accounts.data ?? []).map(account => ({ id: account.id, provider: account.provider, email: account.email, displayName: account.display_name, status: account.status,
        lastError: account.last_error, mine: account.user_id === user.id, dailyLimit: account.daily_limit, lastSyncedAt: account.last_synced_at, lastSentAt: account.last_sent_at, ...mailCapabilities(account),
        sequences: [...(usage.get(account.id)?.values() ?? [])],
        todayQuota: dailyQuota(new Date(account.warmup_started_at), account.daily_limit, new Date()), sentToday: sends.get(account.id) ?? 0 })),
      templates: (templates.data ?? []).map(row => ({ id: row.id, name: row.name, subject: row.subject, body: row.body, updatedAt: row.updated_at })),
      sequences: (sequences.data ?? []).map(row => ({ id: row.id, name: row.name, steps: row.steps, stopOnReply: row.stop_on_reply, updatedAt: row.updated_at, counts: counts.get(row.id) ?? {} })),
      replies: (replies.data ?? []).map(row => ({ id: row.id, clientId: row.client_id, clientName: row.client_id ? nameOf.get(row.client_id) ?? "Client" : "Unknown", subject: row.subject,
        snippet: row.body.slice(0, 280), from: row.from_address, at: row.sent_at ?? row.created_at })),
    });
  } catch (error) { return cloudError(error); }
}

import { z } from "zod";
import { cloudBody, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { mailVariables, renderTemplate } from "@/lib/mail/compose";
import { sendEmail } from "@/lib/mail/engine";
import { mailContext, ownMailbox } from "@/lib/mail/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; clientId: string }> };
const Send = z.object({ accountId: z.string().uuid(), subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(20000),
  /** Reply in the latest thread with this client instead of starting a new one. */ reply: z.boolean().default(false) }).strict();

/** Every email sent to or received from this client, newest last. */
export async function GET(_request: Request, context: Context) {
  try {
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const { client } = await mailContext(workspaceId, false);
    const { data, error } = await client.from("mail_messages").select("id,direction,status,subject,body,from_address,to_address,sent_at,created_at,error,enrollment_id,step,account_id")
      .eq("workspace_id", workspaceId).eq("client_id", clientId).order("created_at", { ascending: true }).limit(300);
    databaseError(error);
    return cloudJson({ messages: (data ?? []).map(row => ({ id: row.id, direction: row.direction, status: row.status, subject: row.subject, body: row.body, from: row.from_address, to: row.to_address,
      at: row.sent_at ?? row.created_at, error: row.error, automated: row.enrollment_id !== null, step: row.step, accountId: row.account_id })) });
  } catch (error) { return cloudError(error); }
}

/** Sends one email now from the user's own mailbox, filling {{tokens}} from the client record. */
export async function POST(request: Request, context: Context) {
  try {
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const body = await cloudBody(request, Send, 80_000);
    const { db, user } = await mailContext(workspaceId, true);
    const account = await ownMailbox(db, workspaceId, body.accountId, user.id);
    const { data: target, error } = await db.from("clients").select("id,workspace_id,name,company,email,website,outreach,updated_at").eq("id", clientId).eq("workspace_id", workspaceId).maybeSingle();
    databaseError(error);
    if (!target) throw new RequestError("NOT_FOUND", "This client is unavailable in this workspace.", 404);
    const variables = mailVariables(target, { name: account.display_name || account.email.split("@")[0] });
    const subject = renderTemplate(body.subject, variables), text = renderTemplate(body.body, variables);
    const missing = [...new Set([...subject.missing, ...text.missing])];
    if (missing.length) throw new RequestError("MISSING_DETAILS", `Fill in or remove {{${missing.join("}}, {{")}}} first (or add a fallback like {{first_name|there}}).`);
    let replyTo = null;
    if (body.reply) {
      const { data: last } = await db.from("mail_messages").select("thread_id,rfc_message_id,subject").eq("client_id", clientId).eq("account_id", account.id).eq("direction", "out").eq("status", "sent")
        .not("thread_id", "is", null).order("sent_at", { ascending: false }).limit(1).maybeSingle();
      if (last?.thread_id) replyTo = { threadId: last.thread_id, rfcMessageId: last.rfc_message_id, subject: last.subject };
    }
    const outcome = await sendEmail({ db }, { account, client: target, subject: subject.text, text: text.text, createdBy: user.id, automated: false, replyTo });
    if (outcome.status === "sent") return cloudJson({ sent: true, messageId: outcome.messageId }, 201);
    if (outcome.status === "skipped") throw new RequestError("DAILY_LIMIT", "This mailbox reached today's sending limit (it grows during warm-up). Try again tomorrow.", 429);
    if (outcome.status === "unknown") throw new RequestError("SEND_UNCERTAIN", `${outcome.error} Check your Sent folder before trying again.`, 502);
    if (outcome.status === "auth") throw new RequestError("MAILBOX_NEEDS_RECONNECT", outcome.error, 409);
    throw new RequestError("SEND_FAILED", outcome.error, 502);
  } catch (error) { return cloudError(error); }
}

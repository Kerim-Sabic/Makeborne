import { z } from "zod";
import { cloudBody, cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { processDueEnrollments, syncReplies } from "@/lib/mail/engine";
import { mailContext } from "@/lib/mail/server";
import { MANUAL_MAIL_NOTICE } from "@/lib/mail/config";

export const runtime = "nodejs";
export const maxDuration = 120;
type Context = { params: Promise<{ workspaceId: string }> };

/** "Check now": syncs replies and sends due sequence steps for the user's own mailboxes in this workspace. */
export async function POST(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    await cloudBody(request, z.object({}).strict());
    const { db, user } = await mailContext(workspaceId, true);
    const { data, error } = await db.from("mail_accounts").select("id").eq("workspace_id", workspaceId).eq("user_id", user.id).eq("status", "active");
    databaseError(error);
    const accountIds = (data ?? []).map(row => row.id);
    if (!accountIds.length) return cloudJson({ replies: 0, sent: 0, note: "Connect a mailbox first." });
    const replies = await syncReplies({ db }, { accountIds });
    const failedReplySyncSet = new Set(replies.failedAccountIds);
    const sent = await processDueEnrollments({ db }, { accountIds, limit: 20, failedReplySyncSet });
    return cloudJson({ replies: replies.replies, sent: sent.sent, waiting: sent.skipped, paused: sent.paused, failed: sent.failed, replyCheckErrors: replies.errors,
      ...(replies.unavailableAccountIds.length ? { note: `${MANUAL_MAIL_NOTICE} Other eligible mailboxes: ${replies.replies} replies, ${sent.sent} sends.` } : {}) });
  } catch (error) { return cloudError(error); }
}

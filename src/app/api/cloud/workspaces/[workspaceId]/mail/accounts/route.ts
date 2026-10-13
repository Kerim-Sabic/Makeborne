import { z } from "zod";
import { cloudBody, cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { mailContext, ownMailbox } from "@/lib/mail/server";

type Context = { params: Promise<{ workspaceId: string }> };

/** Adjust a mailbox's daily limit (warm-up still applies on top). */
export async function PATCH(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const body = await cloudBody(request, z.object({ id: z.string().uuid(), dailyLimit: z.number().int().min(1).max(200) }).strict());
    const { db, user } = await mailContext(workspaceId, true);
    await ownMailbox(db, workspaceId, body.id, user.id);
    databaseError((await db.from("mail_accounts").update({ daily_limit: body.dailyLimit, updated_at: new Date().toISOString() }).eq("id", body.id)).error);
    return cloudJson({ id: body.id, dailyLimit: body.dailyLimit });
  } catch (error) { return cloudError(error); }
}

/** Disconnect: tokens are deleted and running sequences on this mailbox are paused. Sent history is kept. */
export async function DELETE(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const body = await cloudBody(request, z.object({ id: z.string().uuid() }).strict());
    const { db, user } = await mailContext(workspaceId, true);
    await ownMailbox(db, workspaceId, body.id, user.id);
    const now = new Date().toISOString();
    databaseError((await db.rpc("makeborne_mail_token_write", { p_account: body.id, p_refresh: "revoked", p_access: null, p_expires: null })).error);
    databaseError((await db.from("mail_accounts").update({ status: "disconnected", last_error: null, updated_at: now }).eq("id", body.id)).error);
    databaseError((await db.from("mail_enrollments").update({ status: "paused", last_error: "Mailbox disconnected. Reconnect it to resume.", updated_at: now }).eq("account_id", body.id).eq("status", "active")).error);
    return cloudJson({ id: body.id, status: "disconnected" });
  } catch (error) { return cloudError(error); }
}

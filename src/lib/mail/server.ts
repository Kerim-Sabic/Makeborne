import "server-only";
import { cloudContext } from "../cloud/server";
import { billingDatabase } from "../billing/database";
import { RequestError } from "../server/http";
import type { MailAccountRow } from "./engine";

/**
 * Workspace access for mail routes. Rights are checked with the user's own
 * session (RLS); mail tables are then written with the service role, which the
 * browser can never use.
 */
export async function mailContext(workspaceId: string, write: boolean) {
  const context = await cloudContext(workspaceId, write);
  if (write && context.workspace?.role === "reviewer") throw new RequestError("EDITOR_REQUIRED", "Only owners and editors can manage email.", 403);
  return { ...context, db: billingDatabase() };
}

/** A mailbox in this workspace that the signed-in user connected (only they may send from it). */
export async function ownMailbox(db: ReturnType<typeof billingDatabase>, workspaceId: string, accountId: string, userId: string): Promise<MailAccountRow> {
  const { data, error } = await db.from("mail_accounts").select("*").eq("id", accountId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new RequestError("MAIL_UNAVAILABLE", "Email is temporarily unavailable.", 503);
  if (!data) throw new RequestError("NOT_FOUND", "This mailbox isn't connected to the workspace.", 404);
  if (data.user_id !== userId) throw new RequestError("MAILBOX_OWNER_REQUIRED", "Only the person who connected this mailbox can send from it.", 403);
  return data as MailAccountRow;
}

export const mailError = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code;
  if (code === "23505") return new RequestError("ALREADY_EXISTS", "That already exists.", 409);
  return error;
};

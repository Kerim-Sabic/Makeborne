import { cloudContext, cloudError, cloudJson } from "@/lib/cloud/server";

/**
 * Getting-started progress for the checklist: counts only, read with the
 * member's own permissions. A table this account can't read (or that isn't
 * migrated yet) reports null, so its step is hidden rather than wrong.
 */
export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const { client } = await cloudContext(workspaceId);
    const rows = (table: string) => client.from(table).select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    const tally = async (query: PromiseLike<{ count: number | null; error: unknown }>) => {
      const { count, error } = await query;
      return error ? null : count ?? 0;
    };
    const [artifacts, clients, finderLeads, mailboxes, sentEmails, reviewLinks] = await Promise.all([
      tally(rows("artifacts")),
      tally(rows("clients")),
      tally(rows("clients").eq("lead_source", "Lead finder")),
      tally(rows("mail_accounts").neq("status", "disconnected")),
      tally(rows("mail_messages").eq("direction", "out").eq("status", "sent")),
      tally(rows("client_review_links")),
    ]);
    return cloudJson({ progress: { artifacts, clients, finderLeads, mailboxes, sentEmails, reviewLinks } });
  } catch (error) { return cloudError(error); }
}

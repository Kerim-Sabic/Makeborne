import { cloudBody, cloudError, cloudJson, validId } from "@/lib/cloud/server";
import { AccessUpdateSchema, type PortalAccessResponse, type PortalInviteCreated } from "@/lib/portal/contracts";
import { agencyContext, agencyDatabaseError, agencyTrusted } from "@/lib/portal/agency";
import { mapAccess } from "@/lib/portal/mappers";
import { INVITE_DAYS, newPortalInvite, portalInviteUrl } from "@/lib/portal/server";
import { RequestError, sameOrigin } from "@/lib/server/http";

type Context = { params: Promise<{ workspaceId: string; clientId: string; accessId: string }> };
type Client = Awaited<ReturnType<typeof agencyContext>>["client"];

/** The access row must belong to the client in the URL (members read it through RLS; never the token hash). */
async function requireClientAccess(client: Client, workspaceId: string, clientId: string, accessId: string) {
  const { data, error } = await client.from("client_portal_access").select("id,client_id").eq("workspace_id", workspaceId).eq("id", accessId).maybeSingle();
  agencyDatabaseError(error);
  if (!data || data.client_id !== clientId) throw new RequestError("NOT_FOUND", "This portal access is unavailable for this client.", 404);
}

/** {action:"resend"} rotates the invite link (shown once); {action:"update"} sets the plan label and paid-through date. */
export async function PATCH(request: Request, context: Context) {
  try {
    const { workspaceId, clientId, accessId } = await context.params;
    validId(clientId); validId(accessId);
    const body = await cloudBody(request, AccessUpdateSchema, 4_096);
    if (body.action === "resend") {
      const { client, trusted, db } = await agencyTrusted(workspaceId, true);
      await requireClientAccess(client, workspaceId, clientId, accessId);
      const invite = newPortalInvite();
      const { data, error } = await db.rpc("makeborne_resend_portal_invite", { ...trusted, p_workspace: workspaceId, p_access: accessId, p_token_hash: invite.hash, p_days: INVITE_DAYS });
      agencyDatabaseError(error);
      const result: PortalInviteCreated = { access: mapAccess(data), inviteUrl: portalInviteUrl(request, invite.token) };
      const response = cloudJson(result);
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
    const { client } = await agencyContext(workspaceId, true);
    await requireClientAccess(client, workspaceId, clientId, accessId);
    const { data, error } = await client.rpc("makeborne_update_portal_access", { p_workspace: workspaceId, p_access: accessId, p_plan_label: body.planLabel, p_paid_through: body.paidThrough });
    agencyDatabaseError(error);
    const result: PortalAccessResponse = { access: mapAccess(data) };
    return cloudJson(result);
  } catch (error) { return cloudError(error); }
}

/** Revokes access immediately. Works for owners and editors without a creation membership; open changes are withdrawn. */
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const { workspaceId, clientId, accessId } = await context.params;
    validId(clientId); validId(accessId);
    const { client, trusted, db } = await agencyTrusted(workspaceId, false);
    await requireClientAccess(client, workspaceId, clientId, accessId);
    const { data, error } = await db.rpc("makeborne_revoke_portal_access", { ...trusted, p_workspace: workspaceId, p_access: accessId });
    agencyDatabaseError(error);
    const result: PortalAccessResponse = { access: mapAccess(data) };
    return cloudJson(result);
  } catch (error) { return cloudError(error); }
}

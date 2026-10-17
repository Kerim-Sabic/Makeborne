import { cloudBody, cloudError, cloudJson, validId } from "@/lib/cloud/server";
import { InviteSchema, type PortalInviteCreated } from "@/lib/portal/contracts";
import { agencyContext, agencyDatabaseError, agencyTrusted } from "@/lib/portal/agency";
import { UNAVAILABLE_OVERVIEW, mapAccess, mapOverview } from "@/lib/portal/mappers";
import { INVITE_DAYS, missingPortal, newPortalInvite, portalInviteUrl } from "@/lib/portal/server";

type Context = { params: Promise<{ workspaceId: string; clientId: string }> };

/** The client's portal access and sites (ClientPortalOverview). Owners and editors only. */
export async function GET(_request: Request, context: Context) {
  try {
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const { client } = await agencyContext(workspaceId, false);
    const { data, error } = await client.rpc("makeborne_portal_client_overview", { p_workspace: workspaceId, p_client: clientId });
    if (missingPortal(error)) return cloudJson(UNAVAILABLE_OVERVIEW);
    agencyDatabaseError(error);
    return cloudJson(mapOverview(data));
  } catch (error) { return cloudError(error); }
}

/** Invites a client contact. The link is returned once and never stored or logged. */
export async function POST(request: Request, context: Context) {
  try {
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const { trusted, db } = await agencyTrusted(workspaceId, true);
    const body = await cloudBody(request, InviteSchema, 4_096);
    const invite = newPortalInvite();
    const { data, error } = await db.rpc("makeborne_create_portal_invite", { ...trusted, p_workspace: workspaceId, p_client: clientId,
      p_email: body.email, p_display_name: body.displayName, p_token_hash: invite.hash, p_days: INVITE_DAYS });
    agencyDatabaseError(error);
    const result: PortalInviteCreated = { access: mapAccess(data), inviteUrl: portalInviteUrl(request, invite.token) };
    const response = cloudJson(result, 201);
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) { return cloudError(error); }
}

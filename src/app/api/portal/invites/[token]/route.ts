import { mapInvite } from "@/lib/portal/mappers";
import { anonymousPortalDatabase, portalDatabaseError, portalFail, portalJson, requireInviteToken } from "@/lib/portal/server";
import { RequestError } from "@/lib/server/http";

type Context = { params: Promise<{ token: string }> };

/** Public: what an invite shows before sign-in (PortalInvite). The token is never logged. */
export async function GET(_request: Request, context: Context) {
  try {
    const token = requireInviteToken((await context.params).token);
    const { data, error } = await anonymousPortalDatabase().rpc("makeborne_read_portal_invite", { p_token: token });
    portalDatabaseError(error);
    if (!data) throw new RequestError("INVITE_UNAVAILABLE", "This invite link is not valid.", 404);
    const response = portalJson(mapInvite(data));
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) { return portalFail(error); }
}

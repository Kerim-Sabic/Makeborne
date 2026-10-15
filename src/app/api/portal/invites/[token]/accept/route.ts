import { z } from "zod";
import type { PortalInviteAccepted } from "@/lib/portal/contracts";
import { portalContext, portalDatabaseError, portalFail, portalJson, requireInviteToken } from "@/lib/portal/server";
import { sameOrigin } from "@/lib/server/http";

type Context = { params: Promise<{ token: string }> };

/** Accepts an invite for the signed-in account (strict email match, single use). Never creates a workspace membership. */
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const token = requireInviteToken((await context.params).token);
    const { trusted, db } = await portalContext(request);
    const { data, error } = await db.rpc("makeborne_accept_portal_invite", { p_token: token, ...trusted });
    portalDatabaseError(error);
    const body: PortalInviteAccepted = { accessId: z.object({ accessId: z.string().uuid() }).passthrough().parse(data).accessId };
    return portalJson(body);
  } catch (error) { return portalFail(error); }
}

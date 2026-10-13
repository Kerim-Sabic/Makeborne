import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { requireCreationAccess } from "@/lib/billing/access";

const input = z.object({ showBadge: z.boolean() }).strict();

/** The "Made with Makeborne" badge on the owner's published websites. */
export async function GET() {
  try {
    const { client, user } = await cloudContext();
    const { data, error } = await client.from("workspaces").select("site_badge").eq("owner_id", user.id).maybeSingle();
    databaseError(error);
    return cloudJson({ showBadge: data ? data.site_badge !== false : true, owned: Boolean(data) });
  } catch (error) { return cloudError(error); }
}

export async function PUT(request: Request) {
  try {
    const body = await cloudBody(request, input);
    const { client, user } = await cloudContext();
    // Removing the badge is a paid-plan option (administrators included).
    if (!body.showBadge) await requireCreationAccess(user);
    const { data, error } = await client.from("workspaces").update({ site_badge: body.showBadge }).eq("owner_id", user.id).select("site_badge").maybeSingle();
    databaseError(error);
    return cloudJson({ showBadge: data ? data.site_badge !== false : body.showBadge, owned: Boolean(data) });
  } catch (error) { return cloudError(error); }
}

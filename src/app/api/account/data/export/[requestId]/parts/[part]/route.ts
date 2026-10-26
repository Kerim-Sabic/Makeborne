import { validId } from "@/lib/cloud/server";
import { rightsError } from "@/lib/account-rights/http";
import { exportPartUrl, requireRightsUser } from "@/lib/account-rights/server";
import { RequestError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ requestId: string; part: string }> };

/** Download one part: a link valid for two minutes, made only when clicked, only for its owner. */
export async function GET(_request: Request, context: Context) {
  try {
    const { requestId, part } = await context.params;
    validId(requestId);
    if (!/^[1-9][0-9]{0,2}$/.test(part)) throw new RequestError("NOT_FOUND", "This download is unavailable.", 404);
    const user = await requireRightsUser();
    const url = await exportPartUrl(user.id, requestId, Number(part));
    // Same answer for another account's export and an expired one.
    if (!url) throw new RequestError("EXPORT_EXPIRED", "This download has expired or isn't yours. Prepare a new export in Settings.", 404);
    return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", Vary: "Cookie" } });
  } catch (error) { return rightsError(error); }
}

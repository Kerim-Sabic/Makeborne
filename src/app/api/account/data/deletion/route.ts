import { z } from "zod";
import { cloudBody, requestKey } from "@/lib/cloud/server";
import { confirmationMatches } from "@/lib/account-rights/contracts";
import { rightsError, rightsJson } from "@/lib/account-rights/http";
import { accountDeletionEnabled, cancelAccountDeletion, requestAccountDeletion, requireRecentSignIn, requireRightsUser, rightsLog } from "@/lib/account-rights/server";
import { RequestError, sameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Body = z.object({ confirmation: z.string().max(320), understood: z.literal(true) }).strict();

/** Schedule deletion of the signed-in account after the grace period. */
export async function POST(request: Request) {
  try {
    if (!accountDeletionEnabled()) { sameOrigin(request); throw new RequestError("DELETION_UNAVAILABLE", "Account deletion isn't available in the app yet. Email admin@makeborne.com to delete your account.", 503); }
    const key = requestKey(request);
    const body = await cloudBody(request, Body, 2_000);
    const user = await requireRightsUser();
    if (!confirmationMatches(body.confirmation, user.email)) throw new RequestError("CONFIRMATION_MISMATCH", "Type the email address you sign in with, exactly as shown.", 400);
    await requireRecentSignIn(user);
    const result = await requestAccountDeletion(user.id, key);
    if (result.status === "refused") return rightsJson({ error: { code: "DELETION_BLOCKED", message: "Some things need your attention before your account can be deleted." }, blockers: result.blockers ?? [] }, 409);
    if (result.status === "blocked") throw new RequestError("DELETION_NEEDS_SUPPORT", "Your deletion has already started and needs our team to finish. Email admin@makeborne.com.", 409);
    if (result.status === "replayed") throw new RequestError("REQUEST_KEY_USED", "That request was already used. Reload Settings and try again.", 409);
    if (result.id) rightsLog("deletion", { request: result.id, outcome: result.status });
    return rightsJson({ id: result.id, state: result.status, scheduledFor: result.scheduledFor ?? null });
  } catch (error) { return rightsError(error); }
}

/** Cancel a deletion that hasn't started. Works even if the feature was turned off since. */
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireRightsUser();
    const result = await cancelAccountDeletion(user.id);
    if (result.status === "started") throw new RequestError("DELETION_STARTED", "Your deletion has already started and can't be cancelled.", 409);
    if (result.id) rightsLog("deletion", { request: result.id, outcome: "cancelled" });
    return rightsJson({ state: result.status });
  } catch (error) { return rightsError(error); }
}

import "server-only";
/**
 * Agency side of the client portal (studio routes). Owners and editors manage
 * invites, site settings and change decisions; reviewers are refused. Invite
 * creation, resend and revocation run as service_role with the verified actor
 * and session; revocation needs no creation membership so it always works.
 */
import { cloudContext, databaseError } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { PORTAL_SETUP_MESSAGE, missingPortal, portalDatabase, trustedSession } from "./server";

type DatabaseError = { code?: string; message?: string } | null;

/** cloudContext plus an explicit reviewer refusal (also for reads: reviewers can't manage the portal). */
export async function agencyContext(workspaceId: string, write: boolean) {
  const context = await cloudContext(workspaceId, write);
  if (!context.workspace || context.workspace.role === "reviewer") throw new RequestError("ACCESS_DENIED", "Reviewers cannot manage client access.", 403);
  return { ...context, workspace: context.workspace };
}

/** Agency context with the trusted actor/session for the service-role portal functions. */
export async function agencyTrusted(workspaceId: string, write: boolean) {
  const context = await agencyContext(workspaceId, write);
  return { ...context, trusted: await trustedSession(context.client, context.user.id), db: portalDatabase() };
}

const plain = (message: string | undefined, fallback: string) => message && /^[\p{L}\p{N} ,.;:'’()*@/-]{1,240}$/u.test(message) ? message : fallback;

export function agencyDatabaseError(error: DatabaseError) {
  if (!error) return;
  const code = error.code ?? "";
  if (missingPortal(error)) throw new RequestError("PORTAL_SETUP", PORTAL_SETUP_MESSAGE, 503);
  if (code === "PT409" && error.message?.startsWith("The site changed")) {
    throw new RequestError("CHANGE_CONFLICT", "The site changed since the client started editing. Review the latest version, then approve with overwrite to replace those collections.", 409);
  }
  if (code === "PT409") throw new RequestError("REVISION_CONFLICT", plain(error.message, "This changed since you opened it. Reload and try again."), 409);
  if (code === "PP409") throw new RequestError("ALREADY_INVITED", plain(error.message, "This email already has portal access for this client."), 409);
  if (code === "MB429") throw new RequestError("WRITE_LIMIT", plain(error.message, "Portal limit reached. Try again later."), 429);
  if (code === "22023") throw new RequestError("INVALID", plain(error.message, "Some details are not valid."), 400);
  if (code === "P0002") throw new RequestError("NOT_FOUND", plain(error.message, "This record is unavailable in this workspace."), 404);
  databaseError(error);
}

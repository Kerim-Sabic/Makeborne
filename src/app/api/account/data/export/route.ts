import { after } from "next/server";
import { requestKey } from "@/lib/cloud/server";
import { rightsError, rightsJson } from "@/lib/account-rights/http";
import { accountExportEnabled, requestAccountExport, requireRightsUser, rightsLog, runAccountExport } from "@/lib/account-rights/server";
import { RequestError, sameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The export is prepared after the response, within this route's duration.
export const maxDuration = 300;

/** Ask for a copy of everything this account owns. One a day; built on the server. */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (!accountExportEnabled()) throw new RequestError("EXPORT_UNAVAILABLE", "Data export isn't available yet. Email admin@makeborne.com for a copy of your data.", 503);
    const key = requestKey(request);
    const user = await requireRightsUser();
    const result = await requestAccountExport(user.id, key);
    if (result.status === "limited") throw new RequestError("EXPORT_LIMIT", "You can prepare one export a day. Your latest export is listed below.", 429);
    if (result.status === "queued" && result.id) {
      const id = result.id;
      rightsLog("export", { request: id, outcome: "queued" });
      after(async () => { await runAccountExport(id).catch(() => rightsLog("export", { request: id, outcome: "failed", code: "EXPORT_JOB_ERROR" })); });
      return rightsJson({ id, state: "queued" }, 202);
    }
    return rightsJson({ id: result.id ?? null, state: "building" });
  } catch (error) { return rightsError(error); }
}

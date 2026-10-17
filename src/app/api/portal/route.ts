import { readHomeBilling } from "@/lib/portal/care-server";
import { mapHome } from "@/lib/portal/mappers";
import { portalContext, portalDatabaseError, portalFail, portalJson } from "@/lib/portal/server";

/** The signed-in client's grants and sites (PortalHome). */
export async function GET(request: Request) {
  try {
    const { trusted, db } = await portalContext(request);
    const { data, error } = await db.rpc("makeborne_portal_home", { ...trusted });
    portalDatabaseError(error);
    return portalJson(mapHome(data, await readHomeBilling(db, trusted)));
  } catch (error) { return portalFail(error); }
}

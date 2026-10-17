import { cloudError, cloudJson } from "@/lib/cloud/server";
import { CareOverviewSchema, type CareOverview } from "@/lib/portal/care";
import { agencyContext, agencyDatabaseError } from "@/lib/portal/agency";
import { missingPortal } from "@/lib/portal/server";

type Context = { params: Promise<{ workspaceId: string }> };

/** Every care plan in the workspace with its status, paused and due first (the agency's "who owes" list). */
export async function GET(_request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const { client } = await agencyContext(workspaceId, false);
    const { data, error } = await client.rpc("makeborne_care_plans", { p_workspace: workspaceId });
    if (missingPortal(error)) return cloudJson({ available: false, plans: [] } satisfies CareOverview);
    agencyDatabaseError(error);
    return cloudJson({ available: true, plans: CareOverviewSchema.parse(data) } satisfies CareOverview);
  } catch (error) { return cloudError(error); }
}

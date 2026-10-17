import { cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { ANALYTICS_RANGES, rangeDays, summarise, type AnalyticsRange, type BreakdownRow, type ClientRow, type DayRow, type EnquiryRow } from "@/lib/hosting/site-analytics";

type Context = { params: Promise<{ workspaceId: string; artifactId: string }> };
const missingTable = (code?: string) => code === "42P01" || code === "PGRST205";

/** A website's visitors next to its enquiries and the clients they became (owner only). */
export async function GET(request: Request, context: Context) {
  try {
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const range = Number(new URL(request.url).searchParams.get("days") ?? 30) as AnalyticsRange;
    if (!ANALYTICS_RANGES.includes(range)) throw new RequestError("INVALID_RANGE", "Choose 7, 30 or 90 days.", 400);
    const { client, workspace } = await cloudContext(workspaceId);
    if (workspace?.role !== "owner") throw new RequestError("OWNER_REQUIRED", "Only the workspace owner can see website analytics.", 403);
    const { previousFrom, from } = rangeDays(range);
    const scoped = (table: string, columns: string) => client.from(table).select(columns).eq("workspace_id", workspaceId).eq("artifact_id", artifactId);
    const [site, days, breakdowns, enquiries] = await Promise.all([
      client.from("hosted_sites").select("live").eq("workspace_id", workspaceId).eq("artifact_id", artifactId).maybeSingle(),
      scoped("site_view_days", "day,views,visitors").gte("day", previousFrom).order("day").limit(200),
      scoped("site_view_breakdowns", "day,dimension,value,views").gte("day", from).limit(20_000),
      scoped("site_enquiries", "created_at,email").gte("created_at", `${previousFrom}T00:00:00Z`).limit(5_000),
    ]);
    databaseError(site.error);
    // Analytics tables arrive with their migration; until then the panel says so.
    if (missingTable(days.error?.code) || missingTable(breakdowns.error?.code)) return cloudJson({ available: false, published: Boolean(site.data), live: site.data?.live ?? false });
    databaseError(days.error); databaseError(breakdowns.error);
    if (!missingTable(enquiries.error?.code)) databaseError(enquiries.error);
    const enquiryRows = (enquiries.error ? [] : enquiries.data ?? []) as unknown as EnquiryRow[];
    let clients: ClientRow[] = [];
    if (enquiryRows.length) {
      const rows = await client.from("clients").select("email,outreach->>stage").eq("workspace_id", workspaceId).neq("email", "").limit(5_000);
      databaseError(rows.error);
      clients = ((rows.data ?? []) as { email: string | null; stage: string | null }[]).map(row => ({ email: row.email, stage: row.stage }));
    }
    const summary = summarise({ range, days: (days.data ?? []) as unknown as DayRow[], breakdowns: (breakdowns.data ?? []) as unknown as BreakdownRow[], enquiries: enquiryRows, clients });
    return cloudJson({ available: true, published: Boolean(site.data), live: site.data?.live ?? false, summary });
  } catch (error) { return cloudError(error); }
}

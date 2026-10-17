import { cloudContext, cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { clientsByEmail, normalEmail } from "@/lib/crm/enquiry-clients";

type Context = { params: Promise<{ workspaceId: string }> };

/** Unread website enquiries from people who aren't clients yet (owner only; others get an empty list). */
export async function GET(_request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const { client, workspace } = await cloudContext(workspaceId);
    if (workspace?.role !== "owner") return cloudJson({ items: [] });
    const enquiries = await client.from("site_enquiries").select("id,name,email,message,created_at,artifact_id").eq("workspace_id", workspaceId).is("read_at", null).order("created_at", { ascending: false }).limit(50);
    databaseError(enquiries.error);
    const items = enquiries.data ?? [];
    if (!items.length) return cloudJson({ items: [] });
    const [sites, existing] = await Promise.all([
      client.from("artifacts").select("id,title").eq("workspace_id", workspaceId).in("id", [...new Set(items.map(item => item.artifact_id as string))]),
      client.from("clients").select("id,email").eq("workspace_id", workspaceId).neq("email", "").limit(5000),
    ]);
    databaseError(sites.error); databaseError(existing.error);
    const titles = new Map((sites.data ?? []).map(site => [site.id as string, site.title as string]));
    const known = clientsByEmail((existing.data ?? []) as { id: string; email: string }[]);
    return cloudJson({ items: items.map(item => ({ ...item, site: titles.get(item.artifact_id as string) ?? "Website", clientId: known.get(normalEmail(item.email as string)) ?? null })) });
  } catch (error) { return cloudError(error); }
}

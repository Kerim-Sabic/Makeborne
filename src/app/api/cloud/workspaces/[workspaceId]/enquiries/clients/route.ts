import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { billingDatabase } from "@/lib/billing/database";
import { RequestError } from "@/lib/server/http";
import { speaksCurrentCrmProtocol } from "@/lib/crm-protocol";
import { clientsByEmail, enquiryClientFields, enquiryOutreach, enquiryRequestKey, normalEmail, type SiteEnquiry } from "@/lib/crm/enquiry-clients";
import type { ClientOutreach } from "@/lib/client-outreach";

type Context = { params: Promise<{ workspaceId: string }> };
const Body = z.object({ ids: z.array(z.string().uuid()).min(1).max(25), day: z.iso.date() }).strict();
type Row = { id: string; email: string | null; outreach: ClientOutreach | null; updated_at: string };
type Result = { enquiryId: string; clientId?: string; status: "created" | "existing" | "failed"; message?: string };

/**
 * Website enquiries become CRM leads. New people are created through the same
 * makeborne_create_record('create_client') path as the Clients page, with a
 * request key derived from the enquiry, so a retry returns the same client.
 * Existing clients (matched by email) get the enquiry as an activity note.
 */
export async function POST(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    if (!speaksCurrentCrmProtocol(request.headers)) throw new RequestError("APP_OUT_OF_DATE", "Makeborne was updated. Reload this page to keep working with clients.", 426);
    const body = await cloudBody(request, Body);
    const { client, workspace } = await cloudContext(workspaceId, true);
    if (workspace?.role !== "owner") throw new RequestError("OWNER_REQUIRED", "Only the workspace owner can add website enquiries to clients.", 403);
    const ids = [...new Set(body.ids)];
    const enquiries = await client.from("site_enquiries").select("id,name,email,message,created_at,artifact_id").eq("workspace_id", workspaceId).in("id", ids);
    databaseError(enquiries.error);
    const found = (enquiries.data ?? []) as (SiteEnquiry & { artifact_id: string })[];
    if (!found.length) throw new RequestError("NOT_FOUND", "Those enquiries are no longer available.", 404);
    const sites = await client.from("artifacts").select("id,title").eq("workspace_id", workspaceId).in("id", [...new Set(found.map(item => item.artifact_id))]);
    databaseError(sites.error);
    const titles = new Map((sites.data ?? []).map(site => [site.id as string, site.title as string]));
    const existing = await client.from("clients").select("id,email,outreach,updated_at").eq("workspace_id", workspaceId).neq("email", "").limit(5000);
    databaseError(existing.error);
    const rows = new Map(((existing.data ?? []) as Row[]).map(row => [row.id, row]));
    const byEmail = clientsByEmail([...rows.values()]);

    const results: Result[] = [];
    // Oldest first, so a person who wrote twice gets their notes in order.
    for (const enquiry of [...found].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      try {
        const site = titles.get(enquiry.artifact_id) ?? "your website";
        let clientId = byEmail.get(normalEmail(enquiry.email)), status: Result["status"] = "existing";
        if (!clientId) {
          const created = await client.rpc("makeborne_create_record", { p_workspace_id: workspaceId, p_request_key: enquiryRequestKey(enquiry.id), p_operation: "create_client", p_payload: enquiryClientFields(enquiry, site) });
          databaseError(created.error);
          const record = (created.data as { record: Row; replayed: boolean }).record;
          clientId = record.id; status = (created.data as { replayed: boolean }).replayed ? "existing" : "created";
          rows.set(record.id, record); byEmail.set(normalEmail(enquiry.email), record.id);
        }
        // Add the enquiry as an activity note; one retry on a concurrent edit.
        for (let attempt = 0; attempt < 2; attempt++) {
          let row = rows.get(clientId);
          if (!row || attempt > 0) {
            const fresh = await client.from("clients").select("id,email,outreach,updated_at").eq("workspace_id", workspaceId).eq("id", clientId).maybeSingle();
            databaseError(fresh.error);
            if (!fresh.data) throw new RequestError("NOT_FOUND", "The client is unavailable.", 404);
            row = fresh.data as Row; rows.set(clientId, row);
          }
          const outreach = enquiryOutreach(enquiry, site, body.day, row.outreach ?? undefined);
          if (row.outreach && JSON.stringify(outreach) === JSON.stringify(row.outreach)) break;
          const saved = await client.from("clients").update({ outreach }).eq("workspace_id", workspaceId).eq("id", clientId).eq("updated_at", row.updated_at).select("id,email,outreach,updated_at").maybeSingle();
          databaseError(saved.error);
          if (saved.data) { rows.set(clientId, saved.data as Row); break; }
        }
        // Handled enquiries are marked read (owner inbox uses the same service write).
        const read = await billingDatabase().from("site_enquiries").update({ read_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("id", enquiry.id).is("read_at", null);
        databaseError(read.error);
        results.push({ enquiryId: enquiry.id, clientId, status });
      } catch (cause) {
        results.push({ enquiryId: enquiry.id, status: "failed", message: cause instanceof RequestError ? cause.message : "This enquiry couldn't be added. Try again." });
      }
    }
    return cloudJson({ results });
  } catch (error) { return cloudError(error); }
}

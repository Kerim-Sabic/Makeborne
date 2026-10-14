import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { readBrandKit } from "@/lib/brand/server";
import { readLeadSite } from "@/lib/leads/redesign-server";
import { redesignBrief } from "@/lib/leads/redesign";

export const runtime = "nodejs";
export const maxDuration = 45;

/** Reads a client's current website and returns a redesign brief, an audit and a draft brand kit.
 * Nothing is saved and no AI is used; the owner reviews it and creates the project themselves. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; clientId: string }> }) {
  try {
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const body = await cloudBody(request, z.object({ url: z.string().trim().max(500).optional() }).strict(), 2_000);
    const { client, workspace } = await cloudContext(workspaceId, true);
    if (workspace?.role === "reviewer") throw new RequestError("EDITOR_REQUIRED", "Only owners and editors can start a redesign.", 403);
    const found = await client.from("clients").select("id,name,company,website").eq("workspace_id", workspaceId).eq("id", clientId).maybeSingle();
    databaseError(found.error);
    if (!found.data) throw new RequestError("NOT_FOUND", "This client is unavailable in this workspace.", 404);
    const url = body.url || String(found.data.website ?? "");
    if (!url.trim()) throw new RequestError("WEBSITE_REQUIRED", "Add this client's website first.", 400);

    let site;
    try { site = await readLeadSite(url); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/blocks automated reading/.test(message)) throw new RequestError("SITE_UNREADABLE", "This site blocks automated reading. Create the project and describe the business yourself.", 422);
      const known = /^(Not a valid link|Only web links|Links with credentials|Only standard web ports|Private addresses|Too many redirects|The page answered|Not a web page)/.test(message);
      throw new RequestError("SITE_UNREADABLE", known ? message : "Their website couldn't be read. Check the address, or create the project and describe the business yourself.", 422);
    }
    const existingKit = await readBrandKit(client, workspaceId, clientId).catch(() => null);
    const name = String(found.data.company || found.data.name).slice(0, 120);
    const brief = redesignBrief({ name, site: site.url, home: site.home, pages: site.pages, audit: site.audit, hasBrandKit: Boolean(existingKit || site.brand) });
    return cloudJson({
      name, url: site.url, title: `${name} website redesign`.slice(0, 160), brief, audit: site.audit,
      pagesRead: [{ label: "Home", url: site.url }, ...site.pages.map(page => ({ label: page.label, url: page.url }))],
      facts: { phones: site.home.phones, emails: site.home.emails, address: site.home.address, hours: site.home.hours.length, words: site.home.words + site.pages.reduce((sum, page) => sum + page.content.words, 0) },
      brand: site.brand, hasBrandKit: Boolean(existingKit),
    });
  } catch (error) { return cloudError(error); }
}

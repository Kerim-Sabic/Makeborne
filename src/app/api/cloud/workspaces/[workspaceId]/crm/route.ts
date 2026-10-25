import { z } from "zod";
import { cloudBody, cloudContext, cloudJson, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { speaksCurrentCrmProtocol } from "@/lib/crm-protocol";
import { serviceRpc } from "@/lib/research/server";
import { fitScore } from "@/lib/crm-research/score";
import { addProspect, addSuppression, crmError, dismissDuplicate, guardedCheck, overview, prospectContext, ProspectSchema, removeRow, requireCrmResearch, requireEditor, storeCheck } from "@/lib/crm-research/server";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ workspaceId: string }> };

/**
 * CRM research for a workspace (flag MAKEBORNE_CRM_RESEARCH=on, 404 otherwise).
 * GET: deals that need attention, suggested duplicates and the do-not-contact list.
 * POST actions (owners and editors):
 * - check: a website check of a business that isn't a client yet (stored for 30 days),
 *   with its fit, look-alike clients and do-not-contact state;
 * - add: add that business as a client (duplicate and do-not-contact checks first;
 *   idempotent by request key); the check's cited findings and contact details
 *   become PROPOSED client facts when client knowledge is on;
 * - dismiss_duplicate, suppress, unsuppress, delete_check.
 * Nothing here sends email or approves anything.
 */
const day = z.iso.date();
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check"), url: z.string().trim().max(500).default(""), name: z.string().trim().max(120).default(""), email: z.string().trim().max(254).default(""),
    phone: z.string().trim().max(40).default(""), category: z.string().trim().max(80).default(""), targets: z.array(z.string().trim().max(40)).max(10).default([]) }).strict(),
  z.object({ action: z.literal("add"), requestKey: z.string().uuid(), checkId: z.string().uuid().nullable().default(null), allowDuplicate: z.boolean().default(false), today: day, prospect: ProspectSchema }).strict(),
  z.object({ action: z.literal("dismiss_duplicate"), a: z.string().uuid(), b: z.string().uuid() }).strict(),
  z.object({ action: z.literal("suppress"), kind: z.enum(["email", "domain"]), value: z.string().trim().min(3).max(320), reason: z.string().trim().max(200).default("") }).strict(),
  z.object({ action: z.literal("unsuppress"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("delete_check"), id: z.string().uuid() }).strict(),
]);

export async function GET(request: Request, context: Context) {
  try {
    requireCrmResearch();
    const { workspaceId } = await context.params;
    const { client, workspace } = await cloudContext(workspaceId);
    const today = day.safeParse(new URL(request.url).searchParams.get("day"));
    if (!today.success) throw new RequestError("INVALID_DAY", "Send today's date from your calendar.");
    return cloudJson({ enabled: true, canEdit: workspace?.role !== "reviewer", ...await overview(client, workspaceId, today.data) });
  } catch (error) { return crmError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    requireCrmResearch();
    const { workspaceId } = await context.params;
    validId(workspaceId);
    const body = await cloudBody(request, Body, 24_000);
    const { client, user, workspace } = await cloudContext(workspaceId, true);
    requireEditor(workspace?.role);
    if (body.action === "check") {
      const check = await guardedCheck(user.id, body.url || null);
      const checkId = await storeCheck(client, { workspaceId, userId: user.id, clientId: null, check });
      const { matches, suppressed } = await prospectContext(client, workspaceId, { name: body.name || check.host || body.url, website: check.finalUrl ?? body.url, email: body.email, phone: body.phone });
      const fit = fitScore({ check, website: body.url, email: body.email || check.contacts.find(item => item.kind === "email")?.value, phone: body.phone || check.contacts.find(item => item.kind === "phone")?.value,
        category: body.category, targets: body.targets, suppressed: Boolean(suppressed), existing: matches.some(item => item.strength === "strong") });
      return cloudJson({ checkId, check, fit, matches, suppressed });
    }
    if (body.action === "add") {
      if (!speaksCurrentCrmProtocol(request.headers)) throw new RequestError("APP_OUT_OF_DATE", "Makeborne was updated. Reload this page to keep working with clients.", 426);
      const result = await addProspect(client, { workspaceId, userId: user.id, requestKey: body.requestKey, prospect: body.prospect, checkId: body.checkId, allowDuplicate: body.allowDuplicate, today: body.today, rpc: serviceRpc() });
      return cloudJson(result, result.replayed ? 200 : 201);
    }
    if (body.action === "dismiss_duplicate") { await dismissDuplicate(client, workspaceId, user.id, body.a, body.b); return cloudJson({ ok: true }); }
    if (body.action === "suppress") return cloudJson({ suppression: await addSuppression(client, workspaceId, user.id, body.kind, body.value, body.reason) }, 201);
    if (body.action === "unsuppress") { await removeRow(client, "crm_suppressions", workspaceId, body.id); return cloudJson({ ok: true }); }
    await removeRow(client, "crm_site_checks", workspaceId, body.id);
    return cloudJson({ ok: true });
  } catch (error) { return crmError(error); }
}

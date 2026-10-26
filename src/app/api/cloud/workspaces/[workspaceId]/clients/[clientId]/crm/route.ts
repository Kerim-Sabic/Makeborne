import { z } from "zod";
import { cloudBody, cloudContext, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { clientKnowledgeEnabled } from "@/lib/knowledge/server";
import { serviceRpc } from "@/lib/research/server";
import { buildTimeline } from "@/lib/crm-research/timeline";
import { attentionFor, cleanNextStep } from "@/lib/crm-research/pipeline";
import { matchesFor, suppressionFor } from "@/lib/crm-research/match";
import { DraftRefused, openingDraft } from "@/lib/crm-research/draft";
import { proposalsFromCheck } from "@/lib/crm-research/facts";
import type { SiteCheck } from "@/lib/crm-research/site-check";
import { crmError, directory, guardedCheck, latestClientCheck, proposeFacts, readCheck, requireCrmResearch, requireEditor, setNextStep, siteCheckAdmission, storeCheck, suppressions } from "@/lib/crm-research/server";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ workspaceId: string; clientId: string }> };

/**
 * CRM research for one client (flag MAKEBORNE_CRM_RESEARCH=on, 404 otherwise).
 * GET (any member): latest website check, the whole timeline, what needs attention,
 * the next step, look-alike clients and do-not-contact state.
 * POST (owners and editors): check (their website, kept with the client),
 * next_step (compare-and-set), draft (an honest first email to read and send
 * yourself; never sent from here), propose (a check's cited facts as PROPOSED
 * client knowledge).
 */
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check") }).strict(),
  z.object({ action: z.literal("next_step"), text: z.string().max(400), expectedRevision: z.number().int().min(0) }).strict(),
  z.object({ action: z.literal("draft"), senderName: z.string().trim().max(80).default(""), senderBusiness: z.string().trim().max(80).default(""), offer: z.string().trim().max(240).default("") }).strict(),
  z.object({ action: z.literal("propose"), checkId: z.string().uuid() }).strict(),
]);
type Row = { id: string; name: string; company: string | null; email: string | null; website: string | null; notes: string | null; created_at: string; outreach: { stage?: string; nextFollowUp?: string | null; lastContact?: string | null; activity?: { id: string; at: string; text: string; type?: string }[] } | null };

async function load(context: Context, write: boolean) {
  const { workspaceId, clientId } = await context.params;
  validId(clientId);
  const auth = await cloudContext(workspaceId, write);
  const { data, error } = await auth.client.from("clients").select("id,name,company,email,website,notes,created_at,outreach").eq("workspace_id", workspaceId).eq("id", clientId).maybeSingle();
  databaseError(error);
  if (!data) throw new RequestError("NOT_FOUND", "This client is unavailable in this workspace.", 404);
  return { ...auth, workspaceId, clientId, row: data as Row };
}
/** A source that isn't there (older database, or not readable) is left out rather than failing the page. */
async function optional<T>(query: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  try { const { data, error } = await query; return error ? [] : data ?? []; } catch { return []; }
}

export async function GET(request: Request, context: Context) {
  try {
    requireCrmResearch();
    const { client: db, workspace, workspaceId, clientId, row } = await load(context, false);
    const today = z.iso.date().safeParse(new URL(request.url).searchParams.get("day"));
    if (!today.success) throw new RequestError("INVALID_DAY", "Send today's date from your calendar.");
    const [check, steps, emails, projects, briefs, facts, checks, rows, blocked] = await Promise.all([
      latestClientCheck(db, workspaceId, clientId),
      optional<{ text: string; revision: number; updated_at: string }>(db.from("crm_next_steps").select("text,revision,updated_at").eq("workspace_id", workspaceId).eq("client_id", clientId).limit(1)),
      optional<{ id: string; direction: "out" | "in"; status: string; subject: string; created_at: string; sent_at: string | null }>(db.from("mail_messages").select("id,direction,status,subject,created_at,sent_at").eq("workspace_id", workspaceId).eq("client_id", clientId).order("created_at", { ascending: false }).limit(50)),
      optional<{ id: string; title: string; kind: string; created_at: string }>(db.from("projects").select("id,title,kind,created_at").eq("workspace_id", workspaceId).eq("client_id", clientId).order("created_at", { ascending: false }).limit(50)),
      optional<{ id: string; created_at: string; method: string }>(db.from("client_research_briefs").select("id,created_at,method").eq("workspace_id", workspaceId).eq("client_id", clientId).order("created_at", { ascending: false }).limit(20)),
      optional<{ id: string; label: string; status: string; created_at: string; approved_at: string | null }>(db.from("client_facts").select("id,label,status,created_at,approved_at").eq("workspace_id", workspaceId).eq("client_id", clientId).order("created_at", { ascending: false }).limit(50)),
      optional<{ id: string; checked_at: string; status: string; score: number | null; final_url: string | null; url: string }>(db.from("crm_site_checks").select("id,checked_at,status,score,final_url,url").eq("workspace_id", workspaceId).eq("client_id", clientId).order("checked_at", { ascending: false }).limit(20)),
      directory(db, workspaceId), suppressions(db, workspaceId),
    ]);
    const projectIds = projects.map(item => item.id), titles = new Map(projects.map(item => [item.id, item.title]));
    const reviews = projectIds.length ? await optional<{ id: string; project_id: string; created_at: string; recipient_name: string; decision: string | null; decided_at: string | null; decision_name: string | null }>(
      db.from("client_review_links").select("id,project_id,created_at,recipient_name,decision,decided_at,decision_name").eq("workspace_id", workspaceId).in("project_id", projectIds).order("created_at", { ascending: false }).limit(50)) : [];
    const step = steps[0] ?? null;
    const timeline = buildTimeline({ activity: row.outreach?.activity ?? [], emails, projects, briefs, facts, checks, nextStep: step, reviews: reviews.map(item => ({ ...item, project_title: titles.get(item.project_id) ?? "" })) });
    const self = { id: row.id, name: row.name, company: row.company, email: row.email, website: row.website, notes: row.notes };
    return cloudJson({
      enabled: true, canEdit: workspace?.role !== "reviewer", knowledge: clientKnowledgeEnabled(),
      check: check ? { id: check.id, ...check.result, attached: true } : null,
      nextStep: step ? { text: step.text, revision: step.revision, updatedAt: step.updated_at } : { text: "", revision: 0, updatedAt: null },
      attention: attentionFor({ id: row.id, name: row.name, createdAt: row.created_at, outreach: row.outreach, nextStep: step?.text ?? null }, today.data),
      timeline,
      duplicates: matchesFor(self, rows.map(item => ({ id: item.id, name: item.company || item.name, company: item.company, email: item.email, website: item.website, notes: item.notes }))),
      suppressed: suppressionFor(blocked, self),
    });
  } catch (error) { return crmError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    requireCrmResearch();
    const body = await cloudBody(request, Body, 8_000);
    const { client: db, user, workspace, workspaceId, clientId, row } = await load(context, true);
    requireEditor(workspace?.role);
    if (body.action === "check") {
      const check = await guardedCheck(user.id, row.website || null, undefined, siteCheckAdmission(serviceRpc(), user.id, workspaceId));
      const id = await storeCheck(serviceRpc(), { workspaceId, userId: user.id, clientId, check });
      return cloudJson({ check: { id, ...check, attached: true } }, 201);
    }
    if (body.action === "next_step") return cloudJson({ nextStep: await setNextStep(db, workspaceId, clientId, cleanNextStep(body.text), body.expectedRevision) });
    if (body.action === "propose") {
      if (!clientKnowledgeEnabled()) throw new RequestError("KNOWLEDGE_DISABLED", "Client knowledge isn't available yet.", 404);
      const check = await readCheck(db, workspaceId, body.checkId);
      if (check.client_id !== clientId) throw new RequestError("NOT_FOUND", "This website check belongs to another client.", 404);
      return cloudJson({ knowledge: await proposeFacts(serviceRpc(), { actorId: user.id, workspaceId, clientId }, proposalsFromCheck(check.result as unknown as SiteCheck)) });
    }
    // draft: approved facts only (never suggested ones), the latest check, and a refusal for do-not-contact.
    const [check, blocked, approved] = await Promise.all([
      latestClientCheck(db, workspaceId, clientId), suppressions(db, workspaceId),
      clientKnowledgeEnabled() ? optional<{ id: string; label: string; value_text: string; key: string }>(db.from("client_facts").select("id,label,value_text,key").eq("workspace_id", workspaceId).eq("client_id", clientId).eq("status", "approved").not("key", "like", "website.issue.%").order("approved_at", { ascending: false }).limit(5)) : Promise.resolve([]),
    ]);
    const suppressed = suppressionFor(blocked, { email: row.email, website: row.website });
    try {
      const result = check?.result as unknown as SiteCheck | undefined;
      const draft = openingDraft({ sender: { name: body.senderName || user.user_metadata?.full_name || "", business: body.senderBusiness }, recipient: { name: row.name, company: row.company, email: row.email }, offer: body.offer,
        check: result ? { status: result.status, checkedAt: result.checkedAt, host: result.host, findings: result.findings ?? [] } : null,
        facts: approved.map(item => ({ id: item.id, label: item.label, valueText: item.value_text })), suppressed: Boolean(suppressed) });
      return cloudJson({ draft, sent: false });
    } catch (cause) {
      if (cause instanceof DraftRefused) throw new RequestError(cause.code === "SUPPRESSED" ? "CONTACT_SUPPRESSED" : "DRAFT_UNAVAILABLE", cause.message, 409);
      throw cause;
    }
  } catch (error) { return crmError(error); }
}

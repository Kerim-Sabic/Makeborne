import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { RequestError } from "../server/http";
import { cloudError, databaseError } from "../cloud/server";
import { emptyOutreach } from "../client-outreach";
import { normalizeTag } from "../leads";
import { canonicalProposal, factPayload, type FactProposal } from "../knowledge/types";
import { clientKnowledgeEnabled } from "../knowledge/server";
import type { Rpc } from "../research/cache";
import { checkWebsite, CHECKER_VERSION, type CheckDeps, type SiteCheck } from "./site-check";
import { proposalsFromCheck } from "./facts";
import { duplicatePairs, matchesFor, normalizeSuppression, suppressionFor, type MatchRecord, type Suppression } from "./match";
import { needsAttention, type PipelineClient } from "./pipeline";

/**
 * Server side of CRM research. Flag MAKEBORNE_CRM_RESEARCH=on (off by default,
 * checked first on every route: 404 otherwise). All reads and writes use the
 * signed-in person's database client, so row-level security decides what they
 * can see (members) and change (owners and editors). Knowledge proposals go
 * through the existing knowledge entry point with that person as the actor,
 * which re-checks their role. Nothing here sends email or approves facts.
 */
export function crmResearchEnabled(env: Record<string, string | undefined> = process.env) { return env.MAKEBORNE_CRM_RESEARCH === "on"; }
export function requireCrmResearch(env: Record<string, string | undefined> = process.env) {
  if (!crmResearchEnabled(env)) throw new RequestError("CRM_RESEARCH_DISABLED", "This isn't available yet.", 404);
}
export function requireEditor(role: string | undefined | null) {
  if (role === "reviewer") throw new RequestError("EDITOR_REQUIRED", "Only owners and editors can change client research.", 403);
}

export const PROSPECT_CHECK_DAYS = 30;
const DIRECTORY_LIMIT = 2000;

// ---------- one check at a time per person, a few per server ----------
const running = new Set<string>();
let total = 0;
export async function guardedCheck(userId: string, url: string | null, deps?: CheckDeps): Promise<SiteCheck> {
  if (running.has(userId)) throw new RequestError("CHECK_BUSY", "Wait for your current website check to finish.", 409);
  if (total >= 4) throw new RequestError("CHECK_BUSY", "Several website checks are running. Try again in a moment.", 429);
  running.add(userId); total++;
  try { return await checkWebsite(url, { deps }); }
  finally { running.delete(userId); total--; }
}

// ---------- reads ----------
type ClientRow = { id: string; name: string; company: string | null; email: string | null; website: string | null; notes: string | null; created_at: string; updated_at: string; outreach: PipelineClient["outreach"] };
export async function directory(db: SupabaseClient, workspaceId: string): Promise<ClientRow[]> {
  const { data, error } = await db.from("clients").select("id,name,company,email,website,notes,created_at,updated_at,outreach").eq("workspace_id", workspaceId).order("created_at", { ascending: true }).limit(DIRECTORY_LIMIT);
  databaseError(error);
  return (data ?? []) as ClientRow[];
}
export async function suppressions(db: SupabaseClient, workspaceId: string): Promise<(Suppression & { id: string; reason: string; createdAt: string })[]> {
  const { data, error } = await db.from("crm_suppressions").select("id,kind,value,reason,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1000);
  databaseError(error);
  return (data ?? []).map(row => ({ id: row.id, kind: row.kind, value: row.value, reason: row.reason ?? "", createdAt: row.created_at }));
}
async function dismissals(db: SupabaseClient, workspaceId: string): Promise<[string, string][]> {
  const { data, error } = await db.from("crm_duplicate_dismissals").select("client_a,client_b").eq("workspace_id", workspaceId).limit(5000);
  databaseError(error);
  return (data ?? []).map(row => [row.client_a, row.client_b]);
}
async function nextSteps(db: SupabaseClient, workspaceId: string) {
  const { data, error } = await db.from("crm_next_steps").select("client_id,text,revision,updated_at").eq("workspace_id", workspaceId).limit(DIRECTORY_LIMIT);
  databaseError(error);
  return new Map((data ?? []).map(row => [row.client_id as string, row as { text: string; revision: number; updated_at: string }]));
}
const asMatch = (row: ClientRow): MatchRecord => ({ id: row.id, name: row.name, company: row.company, email: row.email, website: row.website, notes: row.notes });

export async function overview(db: SupabaseClient, workspaceId: string, today: string) {
  const [rows, blocked, dismissed, steps] = await Promise.all([directory(db, workspaceId), suppressions(db, workspaceId), dismissals(db, workspaceId), nextSteps(db, workspaceId)]);
  // The client list shows each client by name (company second): use the same name here.
  const names = new Map(rows.map(row => [row.id, row.name || row.company || ""]));
  const attention = needsAttention(rows.map(row => ({ id: row.id, name: row.name, company: row.company, createdAt: row.created_at, outreach: row.outreach, nextStep: steps.get(row.id)?.text ?? null })), today);
  const duplicates = duplicatePairs(rows.map(asMatch), dismissed, 50).map(pair => ({ ...pair, aName: names.get(pair.a) ?? "", bName: names.get(pair.b) ?? "" }));
  const contacted = rows.filter(row => suppressionFor(blocked, row)).map(row => ({ id: row.id, name: row.name || row.company || "" }));
  return { attention, duplicates, suppressions: blocked, suppressedClients: contacted.slice(0, 50), truncated: rows.length >= DIRECTORY_LIMIT, clients: rows.length };
}

// ---------- prospect checks ----------
export const CheckRowSchema = z.object({ id: z.string().uuid(), client_id: z.string().uuid().nullable(), url: z.string(), final_url: z.string().nullable(), status: z.string(), score: z.number().nullable(),
  result: z.record(z.string(), z.unknown()), checked_at: z.string(), expires_at: z.string().nullable() }).passthrough();
export async function storeCheck(db: SupabaseClient, input: { workspaceId: string; userId: string; clientId: string | null; check: SiteCheck; now?: number }) {
  const now = input.now ?? Date.now();
  const result = JSON.parse(JSON.stringify(input.check)) as Record<string, unknown>;
  if (JSON.stringify(result).length > 60_000) { (result as { findings?: unknown[] }).findings = (input.check.findings ?? []).slice(0, 10); (result as { strengths?: unknown[] }).strengths = []; }
  const row = { workspace_id: input.workspaceId, client_id: input.clientId, url: (input.check.url ?? input.check.input ?? "").slice(0, 2048) || "(none)", final_url: input.check.finalUrl, status: input.check.status,
    reason: input.check.reason, score: input.check.score, result, checker_version: CHECKER_VERSION, checked_at: input.check.checkedAt,
    expires_at: input.clientId ? null : new Date(Math.min(Date.parse(input.check.checkedAt) || now, now) + PROSPECT_CHECK_DAYS * 86_400_000).toISOString(), created_by: input.userId };
  const { data, error } = await db.from("crm_site_checks").insert(row).select("id").single();
  databaseError(error);
  if (!data) throw new RequestError("CHECK_NOT_SAVED", "The website check couldn't be saved. Try again.", 503);
  return data.id as string;
}
export async function readCheck(db: SupabaseClient, workspaceId: string, id: string) {
  const { data, error } = await db.from("crm_site_checks").select("id,client_id,url,final_url,status,score,result,checked_at,expires_at").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  databaseError(error);
  if (!data || (data.expires_at && Date.parse(data.expires_at) < Date.now())) throw new RequestError("NOT_FOUND", "This website check is no longer available. Run it again.", 404);
  return CheckRowSchema.parse(data);
}
export async function latestClientCheck(db: SupabaseClient, workspaceId: string, clientId: string) {
  const { data, error } = await db.from("crm_site_checks").select("id,client_id,url,final_url,status,score,result,checked_at,expires_at").eq("workspace_id", workspaceId).eq("client_id", clientId).order("checked_at", { ascending: false }).limit(1).maybeSingle();
  databaseError(error);
  return data ? CheckRowSchema.parse(data) : null;
}

/** Duplicate matches and do-not-contact state for a business that isn't a client yet. */
export async function prospectContext(db: SupabaseClient, workspaceId: string, candidate: Omit<MatchRecord, "id">) {
  const [rows, blocked] = await Promise.all([directory(db, workspaceId), suppressions(db, workspaceId)]);
  return { matches: matchesFor({ id: "", ...candidate }, rows.map(asMatch)), suppressed: suppressionFor(blocked, candidate) };
}

// ---------- add a prospect as a client ----------
export const ProspectSchema = z.object({
  name: z.string().trim().min(1).max(120), website: z.string().trim().max(500).default(""), email: z.string().trim().max(254).default(""), phone: z.string().trim().max(40).default(""),
  address: z.string().trim().max(300).default(""), category: z.string().trim().max(80).default(""), source: z.enum(["Lead finder", "Website"]).default("Website"),
  listing: z.string().trim().max(500).default(""), tag: z.string().trim().max(30).default(""),
}).strict();
export type Prospect = z.infer<typeof ProspectSchema>;
const safeUrl = (value: string) => { try { const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); return /^https?:$/.test(url.protocol) ? url.href : ""; } catch { return ""; } };
const safeEmail = (value: string) => z.string().email().safeParse(value).success ? value.toLowerCase() : "";

export async function addProspect(db: SupabaseClient, input: { workspaceId: string; userId: string; requestKey: string; prospect: Prospect; checkId: string | null; allowDuplicate: boolean; today: string; rpc: Rpc }) {
  const { prospect } = input;
  const website = prospect.website ? safeUrl(prospect.website) : "", email = prospect.email ? safeEmail(prospect.email) : "";
  const context = await prospectContext(db, input.workspaceId, { name: prospect.name, website, email, phone: prospect.phone });
  if (context.suppressed) throw Object.assign(new RequestError("CONTACT_SUPPRESSED", `This business is on your do-not-contact list (${context.suppressed.value}). Remove it from the list first if that was a mistake.`, 409), { details: { suppressed: context.suppressed } });
  if (context.matches.length && !input.allowDuplicate) throw Object.assign(new RequestError("POSSIBLE_DUPLICATE", "This looks like a client you already have.", 409), { details: { matches: context.matches } });
  const check = input.checkId ? await readCheck(db, input.workspaceId, input.checkId) : null;
  if (check && check.client_id) throw new RequestError("CHECK_ALREADY_USED", "This website check already belongs to a client.", 409);
  const at = new Date().toISOString(), date = at.slice(0, 10);
  const notes = [
    `Added from a ${prospect.source === "Lead finder" ? "Lead finder result" : "website check"} on ${date}.`,
    prospect.phone && `Phone: ${prospect.phone}`, prospect.address && `Address: ${prospect.address}`, prospect.category && `Category: ${prospect.category}`,
    prospect.listing && `Listing: ${prospect.listing}`,
    check?.status === "checked" && `Website check ${check.checked_at.slice(0, 10)}: ${check.score}/100 room to improve.`,
  ].filter(Boolean).join("\n").slice(0, 10_000);
  const { data: created, error } = await db.rpc("makeborne_create_record", { p_workspace_id: input.workspaceId, p_request_key: input.requestKey, p_operation: "create_client",
    p_payload: { name: prospect.name, company: "", email, website, notes } });
  databaseError(error);
  const record = created.record as { id: string; updated_at: string; outreach?: unknown };
  let outreachSaved = true;
  if (!created.replayed) {
    // A new lead lands in today's follow-ups with the best channel to reach them.
    const outreach = { ...emptyOutreach(), channel: email ? "Email" : prospect.phone ? "Phone" : "Not set", nextFollowUp: input.today,
      activity: [{ id: randomUUID(), at, text: `Added from a ${prospect.source === "Lead finder" ? "Lead finder result" : "website check"}${check?.status === "checked" ? ` (website ${check.score}/100 room to improve)` : ""}.`, type: "note" as const }] };
    const tag = normalizeTag(prospect.tag);
    const { error: patchError } = await db.from("clients").update({ outreach, lead_source: prospect.source === "Lead finder" ? "Lead finder" : "Website", ...(tag ? { tags: [tag] } : {}) })
      .eq("id", record.id).eq("workspace_id", input.workspaceId).eq("updated_at", record.updated_at);
    outreachSaved = !patchError;
  }
  let attached = false, proposed = { proposed: 0, deduplicated: 0, invalid: 0, stopped: null as string | null, available: clientKnowledgeEnabled() };
  if (check) {
    const { data: rows, error: attachError } = await db.from("crm_site_checks").update({ client_id: record.id, expires_at: null }).eq("id", check.id).eq("workspace_id", input.workspaceId).is("client_id", null).select("id");
    attached = !attachError && (rows ?? []).length === 1;
    if (attached && clientKnowledgeEnabled()) proposed = { ...await proposeFacts(input.rpc, { actorId: input.userId, workspaceId: input.workspaceId, clientId: record.id }, proposalsFromCheck(check.result as unknown as SiteCheck)), available: true };
  }
  return { clientId: record.id, replayed: Boolean(created.replayed), outreachSaved, attached, knowledge: proposed, duplicatesConfirmed: context.matches.length > 0 };
}

/** Knowledge PROPOSALS from a check, with the person as the proposer; stops on a permission change. */
export async function proposeFacts(rpc: Rpc, scope: { actorId: string; workspaceId: string; clientId: string }, suggestions: readonly FactProposal[]) {
  const out = { proposed: 0, deduplicated: 0, invalid: 0, stopped: null as string | null };
  for (const suggestion of suggestions) {
    let payload;
    try { payload = factPayload(canonicalProposal(suggestion)); } catch { out.invalid++; continue; }
    const { data, error } = await rpc("makeborne_knowledge_propose", { p_actor: scope.actorId, p_workspace: scope.workspaceId, p_client: scope.clientId, p_fact: payload.fact, p_evidence: payload.evidence, p_operation: null });
    if (error) { if (error.code === "42501" || error.code === "P0002") { out.stopped = error.code === "42501" ? "PERMISSION_CHANGED" : "CLIENT_UNAVAILABLE"; break; } out.invalid++; continue; }
    if ((data as { deduplicated?: boolean })?.deduplicated) out.deduplicated++; else out.proposed++;
  }
  return out;
}

// ---------- small writes ----------
export async function dismissDuplicate(db: SupabaseClient, workspaceId: string, userId: string, a: string, b: string) {
  if (a === b) throw new RequestError("INVALID_PAIR", "Choose two different clients.");
  const [first, second] = a < b ? [a, b] : [b, a];
  const { error } = await db.from("crm_duplicate_dismissals").upsert({ workspace_id: workspaceId, client_a: first, client_b: second, created_by: userId }, { onConflict: "workspace_id,client_a,client_b", ignoreDuplicates: true });
  databaseError(error);
}
export async function addSuppression(db: SupabaseClient, workspaceId: string, userId: string, kind: "email" | "domain", raw: string, reason: string) {
  const entry = normalizeSuppression(kind, raw);
  if (!entry) throw new RequestError("INVALID_CONTACT", kind === "email" ? "Enter a valid email address." : "Enter a website or domain, for example example.com.");
  const { data, error } = await db.from("crm_suppressions").upsert({ workspace_id: workspaceId, kind: entry.kind, value: entry.value, reason: reason.replace(/[<>]/g, "").slice(0, 200), created_by: userId }, { onConflict: "workspace_id,kind,value", ignoreDuplicates: true }).select("id");
  databaseError(error);
  return { ...entry, id: data?.[0]?.id as string | undefined };
}
export async function removeRow(db: SupabaseClient, table: "crm_suppressions" | "crm_site_checks", workspaceId: string, id: string) {
  const { data, error } = await db.from(table).delete().eq("workspace_id", workspaceId).eq("id", id).select("id");
  databaseError(error);
  if (!data?.length) throw new RequestError("NOT_FOUND", "It was already removed.", 404);
}
export async function setNextStep(db: SupabaseClient, workspaceId: string, clientId: string, text: string, expectedRevision: number) {
  const { data, error } = await db.rpc("makeborne_crm_next_step_set", { p_workspace: workspaceId, p_client: clientId, p_text: text, p_expected_revision: expectedRevision });
  if (error?.code === "PT409") throw new RequestError("NEXT_STEP_CHANGED", "Someone else changed the next step. Reload to see it before saving yours.", 409);
  databaseError(error);
  return data as { text: string; revision: number; updatedAt: string };
}

/** Like cloudError, plus the structured details a 409 carries (duplicate matches, the blocking list entry). */
export function crmError(error: unknown) {
  const details = (error as { details?: unknown })?.details;
  if (error instanceof RequestError && details) return Response.json({ error: { code: error.code, message: error.message, details } }, { status: error.status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  return cloudError(error);
}

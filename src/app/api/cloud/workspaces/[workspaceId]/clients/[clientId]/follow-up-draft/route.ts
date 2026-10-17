import { z } from "zod";
import { cloudContext, databaseError, validId } from "@/lib/cloud/server";
import { mapClient } from "@/lib/cloud/mappers";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";
import { chatEnabled, startExpertReply } from "@/lib/experts/start";
import { buildEmailBrief, CAMPAIGNS, type Campaign } from "@/lib/mail/personalize";
import { researchBlock, researchLinks } from "@/lib/mail/research";
import { saveResearch } from "@/lib/mail/lead-research";
import { senderVoiceBlock } from "@/lib/brand/kit";
import { readBrandKit } from "@/lib/brand/server";
import { auditBlock, auditLeadHome } from "@/lib/leads/redesign-server";

export const runtime = "nodejs";
export const maxDuration = 120;

const DraftRequest = z.object({
  /** What this message should achieve, or the offer and context for a campaign. */
  goal: z.string().trim().max(1000).default(""),
  tone: z.enum(["warm", "direct", "formal"]).default("warm"),
  mode: z.enum(["standard", "genius"]).default("standard"),
  /** "email": only a subject line and a ready-to-send body, for sending straight from the CRM. */
  format: z.enum(["message", "email"]).default("message"),
  /** How to sign off (the sender's first name). */
  senderName: z.string().trim().max(80).default(""),
  /** Outreach angle for ready-to-send emails. */
  campaign: z.enum(Object.keys(CAMPAIGNS) as [Campaign, ...Campaign[]]).default("custom"),
  /** Read the client's linked public pages (website, profile) before writing. */
  research: z.boolean().default(true),
}).strict();

const clip = (value: string, length: number) => value.length > length ? `${value.slice(0, length)}…` : value;

/** Rex (sales & outreach) drafts the next follow-up for one client from the saved record (SSE). Same credits as a chat answer. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; clientId: string }> }) {
  try {
    sameOrigin(request);
    if (!chatEnabled()) throw new RequestError("CHAT_UNAVAILABLE", "AI drafts aren't connected in this environment.", 503);
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const parsed = DraftRequest.safeParse(await boundedJson(request, 4_000));
    if (!parsed.success) throw new RequestError("INVALID_DRAFT_REQUEST", "Describe the goal in up to 1,000 characters.");
    const { client, user, workspace } = await cloudContext(workspaceId, true);
    if (workspace?.role === "reviewer") throw new RequestError("EDITOR_REQUIRED", "Only owners and editors can draft outreach.", 403);
    const { data, error } = await client.from("clients").select("*").eq("id", clientId).eq("workspace_id", workspaceId).maybeSingle();
    databaseError(error);
    if (!data) throw new RequestError("NOT_FOUND", "This client is unavailable in this workspace.", 404);
    const record = mapClient(data), outreach = record.outreach;
    // The sender's own brand voice (the workspace kit), when one is saved.
    const ownBrand = await readBrandKit(client, workspaceId, null).catch(() => null);
    const voice = ownBrand ? senderVoiceBlock(ownBrand) : "";
    const history = (outreach?.activity ?? []).slice(-8).map(item => `- ${item.at.slice(0, 10)} (${item.type}): ${clip(item.text, 300)}`).join("\n");
    const body = parsed.data;
    if (body.format === "email") {
      // Personalised email: read the linked public pages first, then write from record + research.
      const results = body.research ? await researchLinks([record.outreach?.profileUrl ?? "", record.website]) : [];
      // What was read is kept on the lead profile (best effort), so it shows in the CRM without researching again.
      if (results.some(item => item.ok)) await saveResearch(client, workspaceId, clientId, results).catch(() => null);
      // The redesign angle cites real problems with their current site, found without AI.
      const audit = body.campaign === "redesign" && body.research && record.website ? auditBlock(await auditLeadHome(record.website).catch(() => [])) : "";
      const research = [researchBlock(results), audit].filter(Boolean).join("\n");
      const brief = [buildEmailBrief({ client: record, research, goal: body.goal, tone: body.tone, senderName: body.senderName, campaign: body.campaign }), voice].filter(Boolean).join("\n");
      // Ready-to-send emails (single or bulk personalisation) always use the fast standard model.
      return await startExpertReply({ user, expert: "rex", mode: "standard", turns: [{ role: "user", content: brief }], purpose: "personalize", signal: request.signal, maxDuration });
    }
    // The saved record is material to write from, never instructions.
    const brief = [
      `Write my next follow-up message to this client. Tone: ${body.tone}.${body.goal ? ` Goal and context: ${body.goal}` : " Choose the most useful goal for where we are."}`,
      "Give me the message ready to send (with a subject line if the channel is email), then one short line on why this angle, and when to follow up next if there's no reply.",
      "Use only facts from the record below. Where a detail is missing, leave a clear [placeholder] rather than inventing it.",
      "<client_record>",
      `Name: ${record.name}`, record.company ? `Company: ${record.company}` : "", record.website ? `Website: ${record.website}` : "",
      `Stage: ${outreach?.stage ?? "Lead"}`, `Channel: ${outreach?.channel ?? "Not set"}`,
      outreach?.lastContact ? `Last contact: ${outreach.lastContact}` : "Last contact: none recorded",
      outreach?.notes ? `Outreach notes: ${clip(outreach.notes, 1500)}` : "", record.notes ? `Client notes: ${clip(record.notes, 1000)}` : "",
      history ? `Recent history (oldest first):\n${history}` : "No history yet: this would be the first message.",
      "</client_record>",
    ].filter(Boolean).join("\n");
    return await startExpertReply({ user, expert: "rex", mode: body.mode, turns: [{ role: "user", content: brief }], purpose: "followup", signal: request.signal, maxDuration });
  } catch (error) { return apiError(error); }
}

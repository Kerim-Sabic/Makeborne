import { cloudBody, cloudContext, cloudError, cloudJson, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { clientKnowledgeEnabled } from "@/lib/knowledge/server";
import { BriefActionSchema } from "@/lib/research/contract";
import { planHandoff, proposalHandoff, saveBriefToClient } from "@/lib/research/actions";
import { clientAnchors, existingPlans, readBrief, requireClientResearch, serviceRpc } from "@/lib/research/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; clientId: string; briefId: string }> };

/**
 * The three actions on a reviewed brief. Nothing here sends outreach, approves a
 * fact or changes a plan:
 * - save: kept claims become PROPOSED facts in Client knowledge (approved there by a person);
 * - proposal: a proposal-deck brief for the existing "Create for this client" flow;
 * - plan: the recommended deliverable's brief for the same flow; when one of this client's
 *   projects already has a saved plan, the person must confirm first and that plan stays as it is.
 */
export async function POST(request: Request, context: Context) {
  try {
    requireClientResearch();
    const { workspaceId, clientId, briefId } = await context.params;
    validId(clientId); validId(briefId);
    const body = await cloudBody(request, BriefActionSchema, 64_000);
    const { client, user } = await cloudContext(workspaceId, true);
    const row = await readBrief({ actorId: user.id, workspaceId, clientId }, briefId);
    if (body.action === "save") {
      if (!clientKnowledgeEnabled()) throw new RequestError("KNOWLEDGE_DISABLED", "Client knowledge isn't available yet, so nothing can be saved to this client.", 409);
      const saved = await saveBriefToClient({ actorId: user.id, workspaceId, clientId, operationId: row.operationId, brief: row.brief, selection: body.selection }, serviceRpc());
      if (saved.stopped === "PERMISSION_CHANGED") throw new RequestError("ACCESS_DENIED", "Your permission for this client changed, so the rest was not saved.", 403);
      return cloudJson({ saved, message: saved.proposed || saved.deduplicated
        ? `${saved.proposed} suggestion${saved.proposed === 1 ? "" : "s"} added to Client knowledge for review${saved.deduplicated ? ` (${saved.deduplicated} already there)` : ""}. Nothing is approved until you approve it there.`
        : "Nothing new to save: these facts are already saved, or have no page or document to cite." });
    }
    if (body.action === "proposal") return cloudJson({ handoff: proposalHandoff(row.brief, body.selection) });
    const handoff = planHandoff(row.brief, body.selection, body.recommendation);
    if (!handoff) throw new RequestError("DELIVERABLE_UNSUPPORTED", "Makeborne can't create this kind of deliverable yet. Choose a website, ebook or deck recommendation.", 409);
    const plans = await existingPlans(client, workspaceId, await clientAnchors(client, workspaceId, clientId));
    if (plans.length && !body.confirmNewPlan) return cloudJson({ needsConfirmation: true, existingPlans: plans,
      message: `${plans.length === 1 ? `“${plans[0].title}” already has a plan` : `${plans.length} of this client's projects already have plans`}. Creating a new plan starts a separate project; the existing plan stays exactly as it is.` });
    return cloudJson({ handoff });
  } catch (error) { return cloudError(error); }
}

import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { listClientKnowledge, proposeClientFact, requireClientKnowledge } from "@/lib/knowledge/server";
import { FACT_KINDS, FACT_STATUSES } from "@/lib/knowledge/types";

export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; clientId: string }> };

/** Client knowledge for one client: list (members), suggest a fact (owners and editors). Off unless MAKEBORNE_CLIENT_KNOWLEDGE=on. */
export async function GET(request: Request, context: Context) {
  try {
    requireClientKnowledge();
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const { client, user, workspace } = await cloudContext(workspaceId);
    const params = new URL(request.url).searchParams;
    const status = z.enum(FACT_STATUSES).optional().safeParse(params.get("status") ?? undefined);
    const kind = z.enum(FACT_KINDS).optional().safeParse(params.get("kind") ?? undefined);
    const q = params.get("q") ?? undefined;
    if (!status.success || !kind.success || (q && q.length > 200)) throw new RequestError("INVALID_FILTER", "Choose a valid filter.");
    return cloudJson(await listClientKnowledge({ client, userId: user.id, workspaceId, canEdit: workspace?.role !== "reviewer" }, clientId, { status: status.data, kind: kind.data, q }));
  } catch (error) { return cloudError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    requireClientKnowledge();
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const body = await cloudBody(request, z.record(z.string(), z.unknown()), 32_000);
    const { client, user } = await cloudContext(workspaceId, true);
    const fact = await proposeClientFact({ client, userId: user.id, workspaceId, canEdit: true }, clientId, body);
    return cloudJson({ fact }, 201);
  } catch (error) { return cloudError(error); }
}

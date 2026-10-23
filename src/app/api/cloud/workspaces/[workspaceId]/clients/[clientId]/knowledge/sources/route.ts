import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, validId } from "@/lib/cloud/server";
import { requireClientKnowledge, revokeKnowledgeSource } from "@/lib/knowledge/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; clientId: string }> };

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["source", "asset"]), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("url"), url: z.string().url().max(2048).regex(/^https?:\/\//) }).strict(),
]);

/** Withdraw a source from this workspace's knowledge: its evidence stops counting, quotes are removed, derived caches move on. */
export async function POST(request: Request, context: Context) {
  try {
    requireClientKnowledge();
    const { workspaceId, clientId } = await context.params;
    validId(clientId);
    const body = await cloudBody(request, Body, 4_000);
    const { client, user } = await cloudContext(workspaceId, true);
    const result = await revokeKnowledgeSource({ client, userId: user.id, workspaceId, canEdit: true }, body.kind, body.kind === "url" ? { url: body.url } : { id: body.id });
    return cloudJson(result);
  } catch (error) { return cloudError(error); }
}

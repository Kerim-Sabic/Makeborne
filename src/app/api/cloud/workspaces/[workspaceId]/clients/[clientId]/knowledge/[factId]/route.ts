import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { canonicalValue, cleanText } from "@/lib/knowledge/types";
import { correctClientFact, factProvenance, requireClientKnowledge, reviewClientFact } from "@/lib/knowledge/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; clientId: string; factId: string }> };

/** Where a fact came from: every source with its place and version, and the revision history. */
export async function GET(_request: Request, context: Context) {
  try {
    requireClientKnowledge();
    const { workspaceId, clientId, factId } = await context.params;
    validId(clientId); validId(factId);
    const { client, user, workspace } = await cloudContext(workspaceId);
    return cloudJson(await factProvenance({ client, userId: user.id, workspaceId, canEdit: workspace?.role !== "reviewer" }, clientId, factId));
  } catch (error) { return cloudError(error); }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), expectedRevision: z.number().int().positive(), note: z.string().trim().max(1000).optional() }).strict(),
  z.object({ action: z.literal("reject"), expectedRevision: z.number().int().positive(), note: z.string().trim().max(1000).optional() }).strict(),
  z.object({ action: z.literal("correct"), expectedRevision: z.number().int().positive(), approve: z.boolean().default(false),
    /** Why, in the person's words: recorded as their statement and kept as evidence. */
    note: z.string().trim().min(1).max(600),
    patch: z.object({ valueText: z.string().trim().min(1).max(2000).optional(), label: z.string().trim().max(200).optional(), validFrom: day.optional(), validTo: day.optional(),
      currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(), unit: z.string().trim().max(16).nullable().optional() }).strict() }).strict(),
]);

export async function PATCH(request: Request, context: Context) {
  try {
    requireClientKnowledge();
    const { workspaceId, clientId, factId } = await context.params;
    validId(clientId); validId(factId);
    const body = await cloudBody(request, Body, 16_000);
    const { client, user } = await cloudContext(workspaceId, true);
    // The fact must be this client's (row-level security also limits it to the workspace).
    const owned = await client.from("client_facts").select("key").eq("workspace_id", workspaceId).eq("client_id", clientId).eq("id", factId).maybeSingle();
    if (owned.error || !owned.data) throw new RequestError("NOT_FOUND", "This fact is unavailable.", 404);
    const account = { client, userId: user.id, workspaceId, canEdit: true };
    if (body.action === "correct") {
      const patch: Record<string, unknown> = { ...body.patch };
      if (body.patch.valueText) {
        patch.valueText = cleanText(body.patch.valueText);
        const canonical = canonicalValue(owned.data.key as string, patch.valueText as string);
        patch.value = canonical.value ?? null;
        if (canonical.currency && body.patch.currency === undefined) patch.currency = canonical.currency;
      }
      if (patch.validFrom && patch.validTo && String(patch.validFrom) > String(patch.validTo)) throw new RequestError("INVALID_KNOWLEDGE", "The end date is before the start date.");
      return cloudJson({ fact: await correctClientFact(account, factId, body.expectedRevision, patch, body.note, body.approve) });
    }
    return cloudJson({ fact: await reviewClientFact(account, factId, body.action, body.expectedRevision, body.note) });
  } catch (error) { return cloudError(error); }
}

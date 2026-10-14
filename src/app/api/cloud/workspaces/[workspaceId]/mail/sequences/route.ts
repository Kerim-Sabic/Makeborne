import { z } from "zod";
import { cloudBody, cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { SequenceStepsSchema } from "@/lib/mail/compose";
import { mailContext } from "@/lib/mail/server";

type Context = { params: Promise<{ workspaceId: string }> };
const Sequence = z.object({ name: z.string().trim().min(1).max(120), steps: SequenceStepsSchema, stopOnReply: z.boolean().default(true) }).strict();

const invalid = (error: unknown) => {
  if (error instanceof RequestError && error.code === "INVALID_CONTENT") return new RequestError("INVALID_SEQUENCE", "Each email needs a body; the first needs a subject; follow-ups wait at least a day; at most 8 emails.");
  return error;
};

/** Multi-step email sequences. Changes apply to the next step each enrolled client receives. */
export async function POST(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const body = await cloudBody(request, Sequence).catch(error => { throw invalid(error); });
    const { client, user } = await mailContext(workspaceId, true);
    const { data, error } = await client.from("mail_sequences").insert({ workspace_id: workspaceId, name: body.name, steps: body.steps, stop_on_reply: body.stopOnReply, created_by: user.id })
      .select("id,name,steps,stop_on_reply,updated_at").single();
    databaseError(error);
    return cloudJson({ sequence: { id: data!.id, name: data!.name, steps: data!.steps, stopOnReply: data!.stop_on_reply, updatedAt: data!.updated_at, counts: {} } }, 201);
  } catch (error) { return cloudError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const body = await cloudBody(request, z.union([Sequence.extend({ id: z.string().uuid() }), z.object({ id: z.string().uuid(), archived: z.literal(true) }).strict()]))
      .catch(error => { throw invalid(error); });
    const { client } = await mailContext(workspaceId, true);
    const fields = "archived" in body ? { archived: true } : { name: body.name, steps: body.steps, stop_on_reply: body.stopOnReply };
    const { data, error } = await client.from("mail_sequences").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", body.id).eq("workspace_id", workspaceId).select("id").maybeSingle();
    databaseError(error);
    if (!data) throw new RequestError("NOT_FOUND", "This sequence no longer exists.", 404);
    return cloudJson({ updated: body.id });
  } catch (error) { return cloudError(error); }
}

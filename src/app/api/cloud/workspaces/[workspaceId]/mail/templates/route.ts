import { z } from "zod";
import { cloudBody, cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { mailContext } from "@/lib/mail/server";

type Context = { params: Promise<{ workspaceId: string }> };
const Template = z.object({ name: z.string().trim().min(1).max(120), subject: z.string().trim().max(300), body: z.string().trim().min(1).max(20000) }).strict();
const columns = "id,name,subject,body,updated_at";
const view = (row: { id: string; name: string; subject: string; body: string; updated_at: string }) => ({ id: row.id, name: row.name, subject: row.subject, body: row.body, updatedAt: row.updated_at });

/** Reusable emails with {{tokens}}. Editors manage them through RLS. */
export async function POST(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const body = await cloudBody(request, Template);
    const { client, user } = await mailContext(workspaceId, true);
    const { data, error } = await client.from("mail_templates").insert({ workspace_id: workspaceId, ...body, created_by: user.id }).select(columns).single();
    databaseError(error);
    return cloudJson({ template: view(data!) }, 201);
  } catch (error) { return cloudError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const { id, ...fields } = await cloudBody(request, Template.extend({ id: z.string().uuid() }));
    const { client } = await mailContext(workspaceId, true);
    const { data, error } = await client.from("mail_templates").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", workspaceId).select(columns).maybeSingle();
    databaseError(error);
    if (!data) throw new RequestError("NOT_FOUND", "This template no longer exists.", 404);
    return cloudJson({ template: view(data) });
  } catch (error) { return cloudError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const { id } = await cloudBody(request, z.object({ id: z.string().uuid() }).strict());
    const { client } = await mailContext(workspaceId, true);
    databaseError((await client.from("mail_templates").delete().eq("id", id).eq("workspace_id", workspaceId)).error);
    return cloudJson({ deleted: id });
  } catch (error) { return cloudError(error); }
}

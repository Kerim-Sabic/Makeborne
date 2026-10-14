import { z } from "zod";
import { cloudBody, cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { SequenceStepsSchema } from "@/lib/mail/compose";
import { normalizeOutreachStage } from "@/lib/client-outreach";
import { mailContext, ownMailbox } from "@/lib/mail/server";
import { mailCapabilities, MANUAL_MAIL_NOTICE } from "@/lib/mail/config";

type Context = { params: Promise<{ workspaceId: string }> };
const Enroll = z.object({ sequenceId: z.string().uuid(), accountId: z.string().uuid(), clientIds: z.array(z.string().uuid()).min(1).max(200),
  /** Optional delayed start (ISO); defaults to now. */ startAt: z.string().datetime().optional() }).strict();
const Change = z.object({ id: z.string().uuid(), action: z.enum(["pause", "resume", "stop"]) }).strict();

/** Enrollments for one sequence (or one client), with client names. */
export async function GET(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const search = new URL(request.url).searchParams;
    const sequenceId = search.get("sequence"), clientId = search.get("client");
    if (!sequenceId && !clientId) throw new RequestError("INVALID_REQUEST", "Choose a sequence or a client.");
    const { client } = await mailContext(workspaceId, false);
    let query = client.from("mail_enrollments").select("id,sequence_id,client_id,account_id,status,next_step,next_send_at,last_error,updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(500);
    if (sequenceId) query = query.eq("sequence_id", z.string().uuid().parse(sequenceId));
    if (clientId) query = query.eq("client_id", z.string().uuid().parse(clientId));
    const { data, error } = await query;
    databaseError(error);
    const ids = [...new Set((data ?? []).map(row => row.client_id))];
    const names = ids.length ? await client.from("clients").select("id,name,email").in("id", ids) : { data: [], error: null };
    databaseError(names.error);
    const byId = new Map((names.data ?? []).map(row => [row.id, row]));
    return cloudJson({ enrollments: (data ?? []).map(row => ({ id: row.id, sequenceId: row.sequence_id, clientId: row.client_id, clientName: byId.get(row.client_id)?.name ?? "Client",
      clientEmail: byId.get(row.client_id)?.email ?? "", accountId: row.account_id, status: row.status, nextStep: row.next_step, nextSendAt: row.next_send_at, lastError: row.last_error })) });
  } catch (error) { return cloudError(error); }
}

/** Adds clients to a sequence from one of the user's own mailboxes. Clients without an email or already in a sequence are skipped and reported. */
export async function POST(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const body = await cloudBody(request, Enroll);
    const { db, user } = await mailContext(workspaceId, true);
    const account = await ownMailbox(db, workspaceId, body.accountId, user.id);
    if (account.status !== "active") throw new RequestError("MAILBOX_NEEDS_RECONNECT", "Reconnect this mailbox before starting a sequence.", 409);
    if (!mailCapabilities(account).canAutomate) throw new RequestError("MAIL_AUTOMATION_UNAVAILABLE", MANUAL_MAIL_NOTICE, 409);
    const { data: sequence, error: sequenceError } = await db.from("mail_sequences").select("id,steps,archived").eq("id", body.sequenceId).eq("workspace_id", workspaceId).maybeSingle();
    databaseError(sequenceError);
    if (!sequence || sequence.archived || !SequenceStepsSchema.safeParse(sequence.steps).success) throw new RequestError("NOT_FOUND", "This sequence isn't available.", 404);
    const { data: clients, error: clientError } = await db.from("clients").select("id,name,email,outreach").eq("workspace_id", workspaceId).in("id", body.clientIds);
    databaseError(clientError);
    const start = body.startAt ? new Date(Math.max(Date.parse(body.startAt), Date.now())).toISOString() : new Date().toISOString();
    const skipped: { clientId: string; name: string; reason: string }[] = [];
    let enrolled = 0;
    for (const target of clients ?? []) {
      const stage = normalizeOutreachStage((target.outreach as { stage?: string } | null)?.stage);
      if (!target.email) { skipped.push({ clientId: target.id, name: target.name, reason: "No email address" }); continue; }
      if (stage === "Won" || stage === "Lost") { skipped.push({ clientId: target.id, name: target.name, reason: `Marked ${stage}` }); continue; }
      const { error } = await db.from("mail_enrollments").insert({ workspace_id: workspaceId, sequence_id: sequence.id, client_id: target.id, account_id: account.id, status: "active",
        next_step: 0, next_send_at: start, created_by: user.id });
      if (error?.code === "23505") { skipped.push({ clientId: target.id, name: target.name, reason: "Already in a sequence" }); continue; }
      databaseError(error);
      enrolled++;
    }
    for (const id of body.clientIds) if (!(clients ?? []).some(row => row.id === id)) skipped.push({ clientId: id, name: "Unknown client", reason: "Not in this workspace" });
    return cloudJson({ enrolled, skipped }, 201);
  } catch (error) { return cloudError(error); }
}

/** Pause, resume or stop one client's sequence. */
export async function PATCH(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const body = await cloudBody(request, Change);
    const { db, user } = await mailContext(workspaceId, true);
    const { data: enrollment, error } = await db.from("mail_enrollments").select("id,account_id,status").eq("id", body.id).eq("workspace_id", workspaceId).maybeSingle();
    databaseError(error);
    if (!enrollment) throw new RequestError("NOT_FOUND", "This sequence enrollment no longer exists.", 404);
    const account = await ownMailbox(db, workspaceId, enrollment.account_id, user.id);
    if (body.action === "resume" && !mailCapabilities(account).canAutomate) throw new RequestError("MAIL_AUTOMATION_UNAVAILABLE", MANUAL_MAIL_NOTICE, 409);
    const allowed = { pause: ["active"], resume: ["paused"], stop: ["active", "paused"] }[body.action];
    if (!allowed.includes(enrollment.status)) throw new RequestError("INVALID_STATE", `This sequence is ${enrollment.status}.`, 409);
    const fields = body.action === "pause" ? { status: "paused" } : body.action === "resume" ? { status: "active", last_error: null, next_send_at: new Date().toISOString() } : { status: "stopped", next_send_at: null };
    databaseError((await db.from("mail_enrollments").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", body.id).eq("status", enrollment.status)).error);
    return cloudJson({ id: body.id, status: fields.status });
  } catch (error) { return cloudError(error); }
}

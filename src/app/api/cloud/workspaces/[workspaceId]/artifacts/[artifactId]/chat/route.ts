import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { ChatAppendSchema } from "@/lib/builder/chat-history";
type Context = { params: Promise<{ workspaceId: string; artifactId: string }> };
async function scope(context: Context) {
  const { workspaceId, artifactId } = await context.params;
  validId(artifactId);
  const auth = await cloudContext(workspaceId);
  const { data, error } = await auth.client.from("artifacts").select("id").eq("id", artifactId).eq("workspace_id", workspaceId).maybeSingle();
  databaseError(error);
  if (!data) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
  return { ...auth, workspaceId, artifactId };
}
export async function GET(request: Request, context: Context) {
  try {
    const { client, user, workspaceId, artifactId } = await scope(context);
    const before = new URL(request.url).searchParams.get("before");
    if (before !== null && (!/^[1-9][0-9]{0,18}$/.test(before) || BigInt(before) > BigInt("9223372036854775807"))) throw new RequestError("INVALID_PAGE", "Choose a valid history page.");
    let query = client.from("artifact_chat_messages").select("id,role,body,sequence").eq("account_id", user.id).eq("workspace_id", workspaceId).eq("artifact_id", artifactId).order("sequence", { ascending: false }).limit(51);
    if (before) query = query.lt("sequence", before);
    const { data, error } = await query;
    databaseError(error);
    const rows = (data ?? []).slice(0, 50);
    return cloudJson({ messages: rows.reverse().map(row => ({ id: row.id, role: row.role, text: row.body })), next: data && data.length > 50 ? String(rows[0].sequence) : null });
  } catch (error) { return cloudError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const body = await cloudBody(request, ChatAppendSchema, 350000);
    const { client, user, workspace, workspaceId, artifactId } = await scope(context);
    if (workspace?.role === "reviewer") throw new RequestError("ACCESS_DENIED", "Reviewers cannot add builder messages.", 403);
    // Unique immutable IDs make retries safe; never replace another device's transcript.
    const rows = body.messages.map(item => ({ id: item.id, role: item.role, body: item.text, account_id: user.id, workspace_id: workspaceId, artifact_id: artifactId }));
    const { error } = await client.from("artifact_chat_messages").upsert(rows, { onConflict: "account_id,workspace_id,artifact_id,id", ignoreDuplicates: true });
    databaseError(error);
    const { data, error: readError } = await client.from("artifact_chat_messages").select("id,role,body").eq("account_id", user.id).eq("workspace_id", workspaceId).eq("artifact_id", artifactId).in("id", rows.map(row => row.id));
    databaseError(readError);
    if (data?.length !== rows.length || rows.some(row => !data.some(saved => saved.id === row.id && saved.role === row.role && saved.body === row.body))) throw new RequestError("CHAT_CONFLICT", "A saved message differs. Reload the conversation before retrying.", 409);
    return cloudJson({ saved: rows.map(row => row.id) });
  } catch (error) { return cloudError(error); }
}

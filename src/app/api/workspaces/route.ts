import { WorkspaceCreateSchema } from "@/lib/cloud/contracts";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, requestKey } from "@/lib/cloud/server";

export async function GET() {
  try {
    const { client, user } = await cloudContext();
    const { data: rows, error } = await client.from("workspaces").select("id,name,owner_id").order("created_at", { ascending: true });
    databaseError(error);
    const { data: members, error: memberError } = await client.from("workspace_members").select("workspace_id,role").eq("user_id", user.id);
    databaseError(memberError);
    const roles = new Map((members ?? []).map((member) => [member.workspace_id, member.role]));
    return cloudJson({ workspaces: (rows ?? []).map((row) => ({ id: row.id, name: row.name, role: row.owner_id === user.id ? "owner" : roles.get(row.id) })) });
  } catch (error) { return cloudError(error); }
}
export async function POST(request: Request) {
  try {
    const { client } = await cloudContext();
    const body = await cloudBody(request, WorkspaceCreateSchema);
    const key = requestKey(request);
    const { data, error } = await client.rpc("makeborne_create_workspace", { p_request_key: key, p_name: body.name });
    databaseError(error);
    return cloudJson({ workspace: { id: data.workspace.id, name: data.workspace.name, role: "owner" }, mutation: { idempotencyKey: key, replayed: data.replayed } }, 201);
  } catch (error) { return cloudError(error); }
}

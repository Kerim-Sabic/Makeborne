import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError } from "@/lib/cloud/server";
import { billingDatabase } from "@/lib/billing/database";
import { RequestError } from "@/lib/server/http";
import { BrandKitSchema, parseBrandKit } from "@/lib/brand/kit";
import { normaliseLogo } from "@/lib/brand/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string }> };
const MISSING_TABLE = ["42P01", "PGRST205"];
const ClientId = z.string().uuid().nullable();

/** Kits are written by owners and editors; reviewers only read. */
async function editor(workspaceId: string) {
  const account = await cloudContext(workspaceId, true);
  if (account.workspace?.role === "reviewer") throw new RequestError("EDITOR_REQUIRED", "Only owners and editors can change brand kits.", 403);
  return account;
}

async function requireClient(client: Awaited<ReturnType<typeof cloudContext>>["client"], workspaceId: string, clientId: string | null) {
  if (!clientId) return;
  const found = await client.from("clients").select("id").eq("workspace_id", workspaceId).eq("id", clientId).maybeSingle();
  databaseError(found.error);
  if (!found.data) throw new RequestError("NOT_FOUND", "This client is unavailable in this workspace.", 404);
}

export async function GET(_request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const { client, workspace } = await cloudContext(workspaceId);
    const [kits, clients] = await Promise.all([
      client.from("brand_kits").select("client_id,kit,updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(500),
      client.from("clients").select("id,name").eq("workspace_id", workspaceId).order("name").limit(500),
    ]);
    // The table arrives with its migration; until then the panel explains that kits are being set up.
    const missing = kits.error && MISSING_TABLE.includes(kits.error.code ?? "");
    if (!missing) databaseError(kits.error);
    databaseError(clients.error);
    const names = new Map((clients.data ?? []).map(row => [row.id as string, row.name as string]));
    return cloudJson({
      available: !missing, canEdit: workspace?.role !== "reviewer",
      clients: (clients.data ?? []).map(row => ({ id: row.id as string, name: row.name as string })),
      kits: missing ? [] : (kits.data ?? []).flatMap(row => {
        const kit = parseBrandKit(row.kit);
        return kit ? [{ clientId: (row.client_id as string | null) ?? null, clientName: row.client_id ? names.get(row.client_id as string) ?? "Client" : null, kit, updatedAt: row.updated_at as string }] : [];
      }),
    });
  } catch (error) { return cloudError(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    // Up to a 2 MB logo upload before it is re-encoded.
    const body = await cloudBody(request, z.object({ clientId: ClientId, kit: z.record(z.string(), z.unknown()) }).strict(), 3_000_000);
    const { client, user } = await editor(workspaceId);
    await requireClient(client, workspaceId, body.clientId);
    const raw = { ...body.kit };
    if (typeof raw.logo === "string") {
      try { raw.logo = await normaliseLogo(raw.logo); }
      catch (error) { throw new RequestError("INVALID_LOGO", error instanceof Error ? error.message : "That logo couldn't be read.", 400); }
    }
    const parsed = BrandKitSchema.safeParse(raw);
    if (!parsed.success) throw new RequestError("INVALID_BRAND_KIT", parsed.error.issues[0]?.message ?? "Check the brand kit fields.", 400);
    const saved = await billingDatabase().from("brand_kits")
      .upsert({ workspace_id: workspaceId, client_id: body.clientId, kit: parsed.data, updated_by: user.id }, { onConflict: "workspace_id,client_id" })
      .select("client_id,kit,updated_at").single();
    if (saved.error && MISSING_TABLE.includes(saved.error.code ?? "")) throw new RequestError("BRAND_KITS_UNAVAILABLE", "Brand kits are being set up. Try again soon.", 503);
    databaseError(saved.error);
    return cloudJson({ kit: { clientId: body.clientId, kit: parsed.data, updatedAt: saved.data!.updated_at } });
  } catch (error) { return cloudError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const body = await cloudBody(request, z.object({ clientId: ClientId }).strict(), 1_000);
    await editor(workspaceId);
    let query = billingDatabase().from("brand_kits").delete().eq("workspace_id", workspaceId);
    query = body.clientId ? query.eq("client_id", body.clientId) : query.is("client_id", null);
    const removed = await query;
    databaseError(removed.error);
    return cloudJson({ removed: true });
  } catch (error) { return cloudError(error); }
}

import "server-only";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  RequestError,
  apiError,
  boundedJson,
  sameOrigin,
} from "@/lib/server/http";
import { CLOUD_SCHEMA_VERSION, getCloudStatus } from "./config";
import type { CloudRole } from "./contracts";
import { requestAccountMatches } from "./request-account";
import { requireCreationAccess } from "@/lib/billing/access";

export function cloudJson(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
export function cloudError(error: unknown) {
  const response = apiError(error instanceof RequestError ? error : new RequestError("CLOUD_OUTCOME_UNKNOWN", "Cloud storage could not confirm the outcome. Keep this draft and retry with the same request key before starting another write.", 503));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}
export function requestKey(request: Request) {
  const result = z.string().uuid().safeParse(request.headers.get("Idempotency-Key"));
  if (!result.success) throw new RequestError("REQUEST_KEY_REQUIRED", "Provide a stable UUID Idempotency-Key for this write.");
  return result.data;
}
export function validId(value: string) {
  if (!z.string().uuid().safeParse(value).success)
    throw new RequestError("INVALID_ID", "Choose a valid workspace or record.");
  return value;
}
export async function cloudBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  limit = 256_000,
): Promise<z.output<T>> {
  sameOrigin(request);
  const result = schema.safeParse(await boundedJson(request, limit));
  if (!result.success)
    throw new RequestError(
      "INVALID_CONTENT",
      "Some fields are missing or exceed the supported limits.",
    );
  return result.data;
}
export function databaseError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "MB402") throw new RequestError("MEMBERSHIP_REQUIRED", "A verified creation membership is required before changing this workspace.", 402);
  if (error.code === "MB412") throw new RequestError("WORKSPACE_EXISTS", "Your private workspace already exists. Reload the workspace list to continue.", 409);
  if (error.code === "MB409") throw new RequestError("IDEMPOTENCY_CONFLICT", "This request key was already used for different content. Review the earlier operation before creating another request.", 409);
  if (error.code === "MB410") throw new RequestError("IDEMPOTENCY_RESULT_EXPIRED", "This request was already committed, but its replay window has ended. Review the saved records; this key cannot create another record.", 410);
  if (error.code === "MB429") throw new RequestError("WRITE_LIMIT", "This workspace has reached its safe write limit. Review queued work before making more changes.", 429);
  if (error.code === "PT409" || error.code === "40001" || error.code === "23505")
    throw new RequestError(
      "REVISION_CONFLICT",
      "This record changed. Reload its latest version before saving.",
      409,
    );
  if (error.code === "42501")
    throw new RequestError(
      "ACCESS_DENIED",
      "You do not have permission to change this work.",
      403,
    );
  if (error.code === "P0002")
    throw new RequestError(
      "NOT_FOUND",
      "This record is unavailable in this workspace.",
      404,
    );
  if (
    error.code === "23503" ||
    error.code === "23514" ||
    error.code === "22023" || error.code === "22P02"
  )
    throw new RequestError(
      "INVALID_REFERENCE",
      "The content or its references are not valid for this project.",
    );
  throw new RequestError(
    "CLOUD_OUTCOME_UNKNOWN",
    "Cloud storage could not confirm this request. Keep your draft and retry with the same request key before starting another write.",
    503,
  );
}

export async function cloudContext(workspaceId?: string, write = false) {
  const status = getCloudStatus();
  if (!status.enabled)
    throw new RequestError(
      "CLOUD_DISABLED",
      status.reason ?? "Cloud storage is unavailable.",
      503,
    );
  const client = await createClient();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user)
    throw new RequestError(
      "AUTH_REQUIRED",
      "Sign in to access your cloud workspace.",
      401,
    );
  // This header can only constrain the authenticated identity, never grant access.
  const expectedAccount = (await headers()).get("X-Makeborne-Account");
  if (!requestAccountMatches(expectedAccount, auth.user.id)) throw new RequestError("ACCOUNT_CHANGED", "Your signed-in account changed. Reopen this view before continuing.", 409);
  if (write) await requireCreationAccess(auth.user);
  const { data: schemaVersion, error: schemaError } = await client.rpc(
    "makeborne_cloud_schema_version",
  );
  if (schemaError || schemaVersion !== CLOUD_SCHEMA_VERSION)
    throw new RequestError(
      "CLOUD_SCHEMA_UNVERIFIED",
      "The cloud database is not ready for this application version.",
      503,
    );
  if (!workspaceId) return { client, user: auth.user, workspace: null };
  validId(workspaceId);
  const { data: row, error } = await client
    .from("workspaces")
    .select("id,name,owner_id")
    .eq("id", workspaceId)
    .maybeSingle();
  databaseError(error);
  if (!row)
    throw new RequestError("NOT_FOUND", "This workspace is unavailable.", 404);
  let role: CloudRole = "owner";
  if (row.owner_id !== auth.user.id) {
    const { data: member, error: memberError } = await client
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    databaseError(memberError);
    if (!member || !["editor", "reviewer"].includes(member.role))
      throw new RequestError(
        "NOT_FOUND",
        "This workspace is unavailable.",
        404,
      );
    role = member.role as CloudRole;
  }
  if (write && role === "reviewer")
    throw new RequestError(
      "ACCESS_DENIED",
      "Reviewers cannot modify client or project content.",
      403,
    );
  return {
    client,
    user: auth.user,
    workspace: { id: row.id as string, name: row.name as string, role },
  };
}

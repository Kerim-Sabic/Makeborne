import { z } from "zod";
import { cloudContext } from "@/lib/cloud/server";
import { boundedJson, sameOrigin, RequestError } from "@/lib/server/http";
import { OperationAuthorizationSchema } from "@/lib/builder/operation-contract";
import { authorizeOperation, cancelOperation, operationApiError, readOperation, recoverOperation } from "@/lib/builder/operation-server";

export const runtime = "nodejs";
const query = z.object({ workspaceId: z.string().uuid(), artifactId: z.string().uuid(), id: z.string().uuid().optional(), actionKey: z.string().uuid().optional() })
  .strict().refine(value => Boolean(value.id) !== Boolean(value.actionKey));
export async function GET(request: Request) {
  try {
    const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new RequestError("INVALID_OPERATION", "Choose the request to recover.");
    const { user } = await cloudContext(parsed.data.workspaceId);
    return Response.json(await readOperation({ ...parsed.data, actor: user.id }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return operationApiError(error); }
}
const cancellation = z.object({ workspaceId: z.string().uuid(), artifactId: z.string().uuid(), id: z.string().uuid().optional(), actionKey: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative().optional() })
  .strict().refine(value => Boolean(value.id) !== Boolean(value.actionKey));
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const parsed = cancellation.safeParse(await boundedJson(request, 4_000));
    if (!parsed.success) throw new RequestError("INVALID_OPERATION", "Choose the request to stop.");
    // Stopping already-authorized work must not require a new paid membership.
    const { user } = await cloudContext(parsed.data.workspaceId);
    return Response.json(await cancelOperation({ ...parsed.data, actor: user.id }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return operationApiError(error); }
}
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const parsed = OperationAuthorizationSchema.safeParse(await boundedJson(request, 4_000));
    if (!parsed.success) throw new RequestError("INVALID_OPERATION_AUTHORIZATION", "Review the additional credit amount before continuing.");
    const { user } = await cloudContext(parsed.data.workspaceId, true);
    return Response.json(await authorizeOperation({ ...parsed.data, actor: user.id }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return operationApiError(error); }
}
const recover = z.object({ workspaceId: z.string().uuid(), artifactId: z.string().uuid(), id: z.string().uuid(), runId: z.string().uuid(), expectedVersion: z.number().int().nonnegative(), acknowledged: z.literal(true) }).strict();
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const parsed = recover.safeParse(await boundedJson(request, 4_000));
    if (!parsed.success) throw new RequestError("INVALID_OPERATION_RECOVERY", "Review the saved candidate and current version before recovering it.");
    const { user } = await cloudContext(parsed.data.workspaceId, true);
    return Response.json(await recoverOperation({ ...parsed.data, actor: user.id }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return operationApiError(error); }
}

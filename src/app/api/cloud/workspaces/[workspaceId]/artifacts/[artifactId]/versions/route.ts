import { VersionSaveSchema } from "@/lib/cloud/contracts";
import { cloudBody, cloudContext, cloudError, cloudJson, databaseError, validId, requestKey } from "@/lib/cloud/server";
import { mapArtifact, mapVersion } from "@/lib/cloud/mappers";
import { RequestError } from "@/lib/server/http";

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; artifactId: string }> }) {
  try {
    const { workspaceId, artifactId } = await context.params;
    validId(artifactId);
    const { client } = await cloudContext(workspaceId, true);
    const body = await cloudBody(request, VersionSaveSchema, 2_000_000);
    const key = requestKey(request);
    const assetIds = new Set(body.assetIds);
    for (const section of body.content.sections) for (const block of section.blocks) {
      if (block.assetId && !assetIds.has(block.assetId)) throw new RequestError("MISSING_ASSET", "Every content image must be included in the saved asset manifest.");
    }
    for (const assetId of body.style.referenceAssetIds) if (!assetIds.has(assetId)) throw new RequestError("MISSING_ASSET", "Style references must be included in the saved asset manifest.");
    const { data, error } = await client.rpc("makeborne_save_artifact_version", {
      p_workspace_id: workspaceId, p_artifact_id: artifactId, p_expected_version: body.expectedVersion,
      p_content: body.content, p_style: body.style, p_asset_ids: body.assetIds, p_change_summary: body.changeSummary,
      p_request_key: key,
    });
    databaseError(error);
    if (!data || typeof data !== "object" || !data.artifact || !data.version) throw new RequestError("CLOUD_UNAVAILABLE", "Cloud storage did not return a valid saved revision.", 503);
    return cloudJson({ artifact: mapArtifact(data.artifact), version: mapVersion(data.version), mutation: { idempotencyKey: key, replayed: data.replayed } }, 201);
  } catch (error) { return cloudError(error); }
}

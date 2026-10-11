import { cloudContext, cloudError, databaseError, validId } from "@/lib/cloud/server";
import { mapVersion } from "@/lib/cloud/mappers";
import { websiteSourceBundle } from "@/lib/generation/website-source-bundle";
import { RequestError } from "@/lib/server/http";
import {resolveWebsiteSourceAssets} from "@/lib/projects/source-assets";
import {websiteProjectSourceBundle} from "@/lib/projects/source-bundle";

export const runtime = "nodejs";

export async function GET(request: Request, context: {params: Promise<{workspaceId: string; artifactId: string}>}) {
  try {
    const {workspaceId, artifactId} = await context.params;
    validId(artifactId);
    const {client, workspace} = await cloudContext(workspaceId);
    if (!workspace || !["owner", "editor"].includes(workspace.role)) {
      throw new RequestError("ACCESS_DENIED", "Only workspace owners and editors can download website source.", 403);
    }
    const requestedVersions = new URL(request.url).searchParams.getAll("version");
    const requestedVersion = requestedVersions[0];
    if (requestedVersions.length !== 1 || !requestedVersion || !/^[1-9][0-9]{0,8}$/.test(requestedVersion)) {
      throw new RequestError("INVALID_VERSION", "Choose a saved website version.", 400);
    }
    const versionNumber = Number(requestedVersion);
    const {data, error} = await client.from("artifact_versions").select("*")
      .eq("workspace_id", workspaceId).eq("artifact_id", artifactId).eq("version_number", versionNumber).maybeSingle();
    databaseError(error);
    if (!data) throw new RequestError("NOT_FOUND", "This saved website version is unavailable.", 404);
    const version = mapVersion(data);
    if (version.artifactId !== artifactId || version.number !== versionNumber) {
      throw new RequestError("SOURCE_UNAVAILABLE", "The saved website version could not be verified.", 503);
    }
    if (version.content.kind !== "website" || (!version.content.website && !version.content.websiteSource)) {
      throw new RequestError("SOURCE_UNAVAILABLE", "Save a generated website design before downloading its source.", 409);
    }
    let bundle;
    if (version.content.websiteSource) {
      const {data: artifact, error: artifactError} = await client.from("artifacts").select("project_id").eq("workspace_id", workspaceId).eq("id", artifactId).maybeSingle();
      databaseError(artifactError);
      if (!artifact) throw new RequestError("NOT_FOUND", "This source project is unavailable.", 404);
      const artwork = await resolveWebsiteSourceAssets(client, {workspaceId, projectId: artifact.project_id}, version.content.websiteSource);
      bundle = await websiteProjectSourceBundle(version, artwork);
    } else bundle = await websiteSourceBundle(version);
    return new Response(new Blob([new Uint8Array(bundle.bytes)], {type: "application/zip"}), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${bundle.filename}"`,
        "Cache-Control": "private, no-store", Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
        "X-Makeborne-Revision": version.id,
        "X-Makeborne-Source-Hash": bundle.manifest.sourceHash,
        "X-Makeborne-Manifest-Hash": bundle.bundleHash,
      },
    });
  } catch (error) {return cloudError(error);}
}

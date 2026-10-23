import { z } from "zod";
import { cloudBody, cloudError, cloudJson } from "@/lib/cloud/server";
import { runDeterministicEdit } from "@/lib/images/edit/deterministic";
import { editContext, sameArtifact } from "../shared";

export const runtime = "nodejs";

/** Resize, crop, compress or exact composite: ordinary processing, no model call and no credits. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; artifactId: string }> }) {
  try {
    const edit = await editContext(context.params, true);
    const body = await cloudBody(request, z.unknown(), 64_000);
    sameArtifact(body, edit.artifactId);
    return cloudJson({ edit: await runDeterministicEdit(body, { assets: edit.assets }) }, 201);
  } catch (error) { return cloudError(error); }
}

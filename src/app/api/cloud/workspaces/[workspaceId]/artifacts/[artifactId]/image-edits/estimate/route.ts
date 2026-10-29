import { z } from "zod";
import { cloudBody, cloudError, cloudJson } from "@/lib/cloud/server";
import { estimateImageEdit } from "@/lib/images/edit/run";
import { editContext, requireEditProviders, requireGeneratedEdits, sameArtifact } from "../shared";

export const runtime = "nodejs";

/** The maximum-credit estimate for an edit, before anything is reserved or called. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; artifactId: string }> }) {
  try {
    requireGeneratedEdits();
    const edit = await editContext(context.params, true);
    const body = await cloudBody(request, z.unknown(), 6_000_000);
    sameArtifact(body, edit.artifactId);
    // An estimate for an edit that could not start now would only fail later.
    await requireEditProviders();
    const estimate = await estimateImageEdit(body, edit.deps());
    return cloudJson({ estimate: { credits: estimate.credits, label: estimate.label, operation: estimate.operation } });
  } catch (error) { return cloudError(error); }
}

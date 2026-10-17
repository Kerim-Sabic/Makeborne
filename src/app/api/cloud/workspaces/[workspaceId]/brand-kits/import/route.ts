import { z } from "zod";
import { cloudBody, cloudContext, cloudError, cloudJson } from "@/lib/cloud/server";
import { RequestError } from "@/lib/server/http";
import { importBrandFromWebsite } from "@/lib/brand/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Reads a public website and returns a draft kit for the owner to review. Nothing is saved and no AI is used. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const body = await cloudBody(request, z.object({ url: z.string().trim().min(3).max(500) }).strict(), 2_000);
    const { workspace } = await cloudContext(workspaceId, true);
    if (workspace?.role === "reviewer") throw new RequestError("EDITOR_REQUIRED", "Only owners and editors can change brand kits.", 403);
    try { return cloudJson(await importBrandFromWebsite(body.url)); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/blocks automated reading/.test(message)) throw new RequestError("IMPORT_FAILED", "This site blocks automated reading. Fill in the kit by hand.", 422);
      const known = /^(Not a valid link|Only web links|Links with credentials|Only standard web ports|Private addresses|Too many redirects|The page answered|Not a web page)/.test(message);
      throw new RequestError("IMPORT_FAILED", known ? message : "That website couldn't be read. Check the address, or fill in the kit by hand.", 422);
    }
  } catch (error) { return cloudError(error); }
}

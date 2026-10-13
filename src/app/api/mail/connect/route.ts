import { randomBytes } from "node:crypto";
import { z } from "zod";
import { apiError, RequestError } from "@/lib/server/http";
import { providerConfig, signState } from "@/lib/mail/config";
import { providerClient } from "@/lib/mail/providers";
import { mailContext } from "@/lib/mail/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts connecting a Gmail or Outlook mailbox to a workspace (OAuth redirect). */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const provider = z.enum(["google", "microsoft"]).parse(url.searchParams.get("provider"));
    const workspaceId = z.string().uuid().parse(url.searchParams.get("workspace"));
    const config = providerConfig(provider);
    if (!config) throw new RequestError("MAIL_NOT_CONFIGURED", `${provider === "google" ? "Gmail" : "Outlook"} connections aren't set up on this server yet.`, 503);
    const { user } = await mailContext(workspaceId, true);
    const state = signState({ userId: user.id, workspaceId, provider, nonce: randomBytes(16).toString("base64url") });
    const target = providerClient(provider).authUrl({ clientId: config.clientId, redirectUri: `${url.origin}/api/mail/callback/${provider}`, state, loginHint: user.email ?? undefined });
    return Response.redirect(target, 302);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(new RequestError("INVALID_REQUEST", "Choose Gmail or Outlook and a workspace."));
    return apiError(error);
  }
}

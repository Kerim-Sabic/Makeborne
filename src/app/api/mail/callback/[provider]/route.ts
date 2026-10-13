import { providerConfig, verifyState, type MailProvider } from "@/lib/mail/config";
import { providerClient } from "@/lib/mail/providers";
import { storeTokens } from "@/lib/mail/engine";
import { mailContext } from "@/lib/mail/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OAuth return: stores the mailbox and its sealed tokens, then goes back to Clients with a result. */
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const url = new URL(request.url);
  const back = (result: string, detail?: string) => Response.redirect(`${url.origin}/studio?tab=clients&mail=${result}${detail ? `&mailDetail=${encodeURIComponent(detail.slice(0, 160))}` : ""}`, 302);
  const { provider } = await context.params;
  if (provider !== "google" && provider !== "microsoft") return back("error", "Unknown mail provider.");
  if (url.searchParams.get("error")) return back("cancelled");
  const state = verifyState(url.searchParams.get("state") ?? "");
  const code = url.searchParams.get("code");
  if (!state || state.provider !== provider || !code) return back("error", "The connection link expired. Try connecting again.");
  const config = providerConfig(provider as MailProvider);
  if (!config) return back("error", "This mail provider isn't set up on the server.");
  try {
    // The person returning must be the person who started the connection.
    const { user, db } = await mailContext(state.workspaceId, true);
    if (user.id !== state.userId) return back("error", "You were signed in as someone else. Sign in as the right account and connect again.");
    const client = providerClient(provider as MailProvider);
    const tokens = await client.exchange({ ...config, redirectUri: `${url.origin}/api/mail/callback/${provider}`, code });
    const profile = await client.profile(tokens.accessToken);
    if (!profile.email) return back("error", "The mailbox didn't share its address.");
    const now = new Date().toISOString();
    const email = profile.email.toLowerCase();
    const changes = { display_name: profile.name.slice(0, 160), status: "active", last_error: null, updated_at: now };
    // Let the unique constraint choose the first owner, including concurrent connects.
    // Reconnects may change metadata only on a row already owned by this user.
    // Never upsert user_id: a prior ownership read cannot protect a later write.
    const inserted = await db.from("mail_accounts").insert({ workspace_id: state.workspaceId, user_id: user.id, provider, email, ...changes }).select("id,user_id").single();
    let account = inserted.data;
    if (inserted.error?.code === "23505") {
      const updated = await db.from("mail_accounts").update(changes)
        .eq("workspace_id", state.workspaceId).eq("provider", provider).eq("email", email).eq("user_id", user.id)
        .select("id,user_id").maybeSingle();
      if (updated.error) return back("error", "The mailbox couldn't be saved. Try again.");
      account = updated.data;
      if (!account) return back("error", "Someone else in this workspace already connected that mailbox.");
    } else if (inserted.error) {
      return back("error", "The mailbox couldn't be saved. Try again.");
    }
    if (!account) return back("error", "The mailbox couldn't be saved. Try again.");
    if (account.user_id !== user.id) return back("error", "Someone else in this workspace already connected that mailbox.");
    await storeTokens({ db }, account.id, tokens.refreshToken, tokens.accessToken, tokens.expiresAt);
    return back("connected", profile.email);
  } catch {
    // Provider and database exceptions can contain credentials or response bodies.
    return back("error", "The mailbox couldn't be connected. Check your workspace access and try again.");
  }
}

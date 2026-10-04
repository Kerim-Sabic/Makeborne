import { createClient } from "@/lib/supabase/server";
import { accountsEnabled, authRedirect, authRequestOrigin } from "@/lib/supabase/auth-server";
import { authDestination, emailAuthDestination } from "@/lib/supabase/auth-flow";
import { boundedJson, sameOrigin } from "@/lib/server/http";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/** Render an intentional confirmation step so email scanners cannot consume the link. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = authRequestOrigin(request);
  const next = url.searchParams.has("next")
    ? authDestination(url.searchParams.get("next"))
    : emailAuthDestination(url.searchParams.get("redirect_to"), origin);
  if (!accountsEnabled()) return authRedirect(origin, `/login?error=cloud-unavailable&next=${encodeURIComponent(next)}`);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (tokenHash && tokenHash.length <= 2048 && (type === "email" || type === "recovery")) {
    const query = new URLSearchParams({ token_hash: tokenHash, type, next });
    return authRedirect(origin, `/auth/verify?${query}`);
  }
  return authRedirect(origin, `/login?error=confirmation&next=${encodeURIComponent(next)}`);
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("origin")) throw new Error("Missing origin");
    sameOrigin(request);
  } catch {
    return Response.json({ error: "Please confirm from the Makeborne website." }, { status: 403, headers: privateHeaders });
  }
  if (!accountsEnabled()) {
    return Response.json({ error: "Account access is temporarily unavailable. Please try again shortly." }, { status: 503, headers: privateHeaders });
  }
  try {
    const body = await boundedJson(request, 8192) as Record<string, unknown>;
    const tokenHash = body.token_hash;
    const type = body.type;
    const next = authDestination(typeof body.next === "string" ? body.next : null);
    if (typeof tokenHash !== "string" || !tokenHash || tokenHash.length > 2048 || (type !== "email" && type !== "recovery")) {
      throw new Error("Invalid confirmation");
    }
    const client = await createClient();
    const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      const destination = type === "recovery" && !next.startsWith("/auth/update-password") ? "/auth/update-password" : next;
      return Response.json({ next: destination }, { headers: privateHeaders });
    }
  } catch {
    // Never expose the token or provider response in public errors.
  }
  return Response.json({ error: "This link has expired or has already been used. Sign in, or request a fresh confirmation email." }, { status: 400, headers: privateHeaders });
}

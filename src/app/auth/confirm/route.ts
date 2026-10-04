import { createClient } from "@/lib/supabase/server";
import { accountsEnabled, authRedirect } from "@/lib/supabase/auth-server";
import { authDestination } from "@/lib/supabase/auth-flow";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = authDestination(url.searchParams.get("next"));
  if (!accountsEnabled()) return authRedirect(url.origin, `/login?error=cloud-unavailable&next=${encodeURIComponent(next)}`);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  // Accept only the email workflows supported by this application.
  if (token_hash && token_hash.length <= 2048 && (type === "email" || type === "recovery")) {
    try {
      const client = await createClient();
      const { error } = await client.auth.verifyOtp({ token_hash, type });
      if (!error) {
        return authRedirect(url.origin, type === "recovery" ? "/auth/update-password" : next);
      }
    } catch {
      // Never expose the token or provider details in a URL or error page.
    }
  }
  return authRedirect(url.origin, `/login?error=confirmation&next=${encodeURIComponent(next)}`);
}

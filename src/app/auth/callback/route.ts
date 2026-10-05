import { createClient } from "@/lib/supabase/server";
import { authDestination } from "@/lib/supabase/auth-flow";
import { accountsEnabled, authRedirect, authRequestOrigin } from "@/lib/supabase/auth-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = authRequestOrigin(request);
  const next = authDestination(url.searchParams.get("next"));
  if (!accountsEnabled()) return authRedirect(origin, `/login?error=cloud-unavailable&next=${encodeURIComponent(next)}`);
  const code = url.searchParams.get("code");
  if (code) {
    try {
      const client = await createClient();
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error)
        return authRedirect(origin, next);
    } catch {
      /* The user receives a safe recovery route. */
    }
  }
  const error = ["google", "github"].includes(url.searchParams.get("provider") ?? "") ? "oauth" : "confirmation";
  return authRedirect(origin, `/login?error=${error}&next=${encodeURIComponent(next)}`);
}

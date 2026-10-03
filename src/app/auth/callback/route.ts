import { createClient } from "@/lib/supabase/server";
import { authDestination } from "@/lib/supabase/auth-flow";
import { accountsEnabled, authRedirect } from "@/lib/supabase/auth-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!accountsEnabled()) return authRedirect(url.origin, "/login?error=cloud-unavailable");
  const code = url.searchParams.get("code");
  if (code) {
    try {
      const client = await createClient();
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error)
        return authRedirect(url.origin, authDestination(url.searchParams.get("next")));
    } catch {
      /* The user receives a safe recovery route. */
    }
  }
  return authRedirect(url.origin, "/login?error=confirmation");
}

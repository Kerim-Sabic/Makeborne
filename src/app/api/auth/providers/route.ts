import { accountsEnabled } from "@/lib/supabase/auth-server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/** Only advertise providers that the configured Auth service actually enables. */
export async function GET() {
  const enabled = accountsEnabled();
  const config = getSupabaseConfig();
  let google = false;
  let github = false;
  if (enabled && config) {
    try {
      const response = await fetch(new URL("/auth/v1/settings", config.url), {
        headers: { apikey: config.key },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        const settings: { external?: { google?: boolean; github?: boolean } } = await response.json();
        google = settings.external?.google === true;
        github = settings.external?.github === true;
      }
    } catch {
      // Email sign-in can still work while provider discovery is unavailable.
    }
  }
  return Response.json({ enabled, google, github }, { headers: { "Cache-Control": "no-store" } });
}

import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseConfig } from "@/lib/supabase/config";
import { RequestError } from "@/lib/server/http";

export function billingDatabase() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key?.startsWith("sb_secret_")) throw new RequestError("BILLING_NOT_CONFIGURED", "Membership verification is not available yet.", 503);
  return createClient(requireSupabaseConfig().url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

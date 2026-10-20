import "server-only";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const CLOUD_SCHEMA_VERSION = "20261003_cloud_v2";

export function getCloudStatus() {
  const configured = getSupabaseConfig() !== null;
  const migrationsVerified = process.env.MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED === "true";
  const enabled = configured && migrationsVerified && process.env.MAKEBORNE_CLOUD_ENABLED === "true";
  return {
    enabled, configured, migrationsVerified,
    reason: enabled ? null : !configured ? "Saving to your account isn’t set up on this server." : !migrationsVerified ? "Saving to your account is waiting for its database check." : "Saving to your account hasn’t been turned on yet.",
  };
}

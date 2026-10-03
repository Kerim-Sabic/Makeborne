import "server-only";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const CLOUD_SCHEMA_VERSION = "20261003_cloud_v2";

export function getCloudStatus() {
  const configured = getSupabaseConfig() !== null;
  const migrationsVerified = process.env.MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED === "true";
  const enabled = configured && migrationsVerified && process.env.MAKEBORNE_CLOUD_ENABLED === "true";
  return {
    enabled, configured, migrationsVerified,
    reason: enabled ? null : !configured ? "Cloud account storage is not configured." : !migrationsVerified ? "Cloud database activation awaits migration and permission verification." : "Cloud account storage has not been enabled.",
  };
}

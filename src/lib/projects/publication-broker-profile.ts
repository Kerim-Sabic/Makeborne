import "server-only";
import {PRODUCTION, STAGING, publicationBrokerOriginAllowed, publicationWorkspaces} from "../../../infra/publication-controller/profiles.mjs";

/** Fail closed before constructing any privileged client. Namespace comes only from server configuration. */
export function publicationBrokerProfile(env: NodeJS.ProcessEnv) {
  const namespace = env.MAKEBORNE_HOSTING_NAMESPACE;
  const origin = env.MAKEBORNE_PUBLICATION_ASSET_BROKER_ORIGIN ?? "";
  if (env.MAKEBORNE_PUBLICATION_ASSET_BROKER_ENABLED !== "true" || !publicationBrokerOriginAllowed(origin, namespace)) throw new Error("PUBLICATION_PROFILE_INVALID");
  // Production only: "entitled" admits every workspace the database authority
  // admits (verified plan access, migration 20261025200000); unset/"allowlist"
  // keeps the exact list. Anything else closes the broker.
  const scope = env.MAKEBORNE_PUBLICATION_WORKSPACE_SCOPE || "allowlist";
  if (scope !== "allowlist" && scope !== "entitled") throw new Error("PUBLICATION_PROFILE_INVALID");
  if (namespace === "staging") {
    if (env.NEXT_PUBLIC_SUPABASE_URL !== `https://${STAGING.projectRef}.supabase.co`
      || env.VERCEL_PROJECT_ID && env.VERCEL_PROJECT_ID !== STAGING.projectId
      || env.MAKEBORNE_PUBLICATION_WORKSPACE_IDS || scope !== "allowlist") throw new Error("PUBLICATION_PROFILE_INVALID");
    return {namespace, origin, workspaceScope: "allowlist", workspaceIds: publicationWorkspaces([env.MAKEBORNE_STAGING_QA_WORKSPACE_ID])} as const;
  }
  if (namespace !== "production" || env.NEXT_PUBLIC_SUPABASE_URL !== `https://${PRODUCTION.projectRef}.supabase.co`
    || env.VERCEL_ENV !== "production" || env.VERCEL_PROJECT_ID !== PRODUCTION.projectId
    || env.MAKEBORNE_STAGING_QA_WORKSPACE_ID) throw new Error("PUBLICATION_PROFILE_INVALID");
  if (scope === "entitled") {
    // A leftover list next to the entitled scope is ambiguous configuration.
    if (env.MAKEBORNE_PUBLICATION_WORKSPACE_IDS) throw new Error("PUBLICATION_PROFILE_INVALID");
    return {namespace, origin, workspaceScope: "entitled", workspaceIds: undefined} as const;
  }
  // No trimming/empty entry forgiveness: malformed rollout configuration closes the broker.
  return {namespace, origin, workspaceScope: "allowlist", workspaceIds: publicationWorkspaces((env.MAKEBORNE_PUBLICATION_WORKSPACE_IDS ?? "").split(","))} as const;
}

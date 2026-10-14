import {billingDatabase} from "@/lib/billing/database";
import {publicationAssetBroker, publicationStorageReader} from "@/lib/projects/publication-asset-broker";
import {assertPublicationBrokerSecret, assertPublicationAssetOrigin} from "@/lib/projects/publication-download-contract";
import {STAGING_SUPABASE_URL} from "../../../../../infra/customer-sites/namespace-policy.js";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const secret = process.env.MAKEBORNE_PUBLICATION_ASSET_BROKER_SECRET ?? "";
  const origin = process.env.MAKEBORNE_PUBLICATION_ASSET_BROKER_ORIGIN ?? "";
  const workspaceId = process.env.MAKEBORNE_STAGING_QA_WORKSPACE_ID ?? "";
  try {
    assertPublicationBrokerSecret(secret); assertPublicationAssetOrigin(origin);
    if (process.env.MAKEBORNE_PUBLICATION_ASSET_BROKER_ENABLED !== "true" || process.env.MAKEBORNE_HOSTING_NAMESPACE !== "staging"
      || process.env.NEXT_PUBLIC_SUPABASE_URL !== STAGING_SUPABASE_URL
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) throw new Error("Disabled");
    // Instantiate privileged access lazily, only after request authentication.
    return await publicationAssetBroker({secret, origin, workspaceId,
      async load(context, signal) {
        const {data, error} = await billingDatabase().rpc("makeborne_load_publication_preparation", {
          p_preparation: context.preparationId, p_worker: context.workerId, p_fence: context.fence,
        }).abortSignal(signal);
        if (error) throw new Error("PUBLICATION_ASSET_UNAVAILABLE");
        return data;
      },
      read: (objectPath, maximum, signal) => publicationStorageReader(process.env.SUPABASE_SECRET_KEY ?? "")(objectPath, maximum, signal),
    })(request);
  } catch {
    return new Response("Private source unavailable.", {status: 503, headers: {"cache-control": "private, no-store"}});
  }
}

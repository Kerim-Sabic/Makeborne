import {billingDatabase} from "@/lib/billing/database";
import {publicationAssetBroker, publicationStorageReader} from "@/lib/projects/publication-asset-broker";
import {assertPublicationBrokerSecret, assertPublicationAssetOrigin} from "@/lib/projects/publication-download-contract";
import {publicationBrokerProfile} from "@/lib/projects/publication-broker-profile";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const secret = process.env.MAKEBORNE_PUBLICATION_ASSET_BROKER_SECRET ?? "";
  const origin = process.env.MAKEBORNE_PUBLICATION_ASSET_BROKER_ORIGIN ?? "";
  try {
    assertPublicationBrokerSecret(secret); assertPublicationAssetOrigin(origin);
    const profile = publicationBrokerProfile(process.env);
    // Instantiate privileged access lazily, only after request authentication.
    return await publicationAssetBroker({secret, origin, namespace: profile.namespace, workspaceIds: profile.workspaceIds, workspaceScope: profile.workspaceScope,
      async load(context, signal) {
        const {data, error} = await billingDatabase().rpc("makeborne_load_publication_preparation", {
          p_preparation: context.preparationId, p_worker: context.workerId, p_fence: context.fence,
        }).abortSignal(signal);
        if (error) throw new Error("PUBLICATION_ASSET_UNAVAILABLE");
        return data;
      },
      read: (objectPath, maximum, signal) => publicationStorageReader(process.env.SUPABASE_SECRET_KEY ?? "", fetch, profile.namespace)(objectPath, maximum, signal),
    })(request);
  } catch {
    return new Response("Private source unavailable.", {status: 503, headers: {"cache-control": "private, no-store"}});
  }
}

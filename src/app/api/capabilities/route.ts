import { getCloudStatus } from "@/lib/cloud/config";
export async function GET() {
  const cloud = getCloudStatus();
  return Response.json(
    {
      localWorkspace: {
        available: true,
        scope: "this browser",
        cloudSync: false,
      },
      aiGeneration: {
        available: false,
        reason:
          "Paid API calls are not authorised; production dispatch is not installed.",
      },
      cloudWorkspace: {
        available: cloud.enabled,
        configured: cloud.configured,
        migrationsVerified: cloud.migrationsVerified,
        reason: cloud.reason,
      },
      manualExports: {
        available: process.env.NODE_ENV !== "production",
        formats: ["html", "pdf", "pptx", "epub"],
        scope: "localhost development",
      },
      publicPublishing: {
        available: false,
        reason: "Verified domain and release runtime are not installed.",
      },
      payments: {
        available: false,
        reason: "Merchant configuration and event verification are pending.",
      },
      kdp: {
        available: false,
        reason: "Print and EPUB validation profiles are pending.",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
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
        available: false,
        reason: "Cloud persistence is not wired to the studio yet.",
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

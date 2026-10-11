import { getCapabilities } from "@/lib/capabilities/server";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const snapshot = getCapabilities({ hostname: new URL(request.url).hostname });
  // Public callers receive no account privileges or operator configuration.
  return Response.json(snapshot.public, { headers: { "Cache-Control": "no-store" } });
}

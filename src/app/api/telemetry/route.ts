import { z } from "zod";
import { IGNORED_CLIENT_ERROR, telemetryPage } from "@/lib/telemetry/scrub";
import { recordError, recordVisit } from "@/lib/telemetry/server";
import { sameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
const LIMIT = 4_096;
const Report = z.discriminatedUnion("type", [
  z.object({ type: z.literal("error"), kind: z.string().max(60).optional(), message: z.string().max(2_000), path: z.string().max(500) }),
  z.object({ type: z.literal("visit"), path: z.string().max(500) }),
]);
const accepted = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

/**
 * Browser telemetry from Makeborne's own pages (instrumentation-client.ts): scrubbed errors and
 * visits to a few allow-listed pages. Same-origin only, small bodies, no cookies read, no ids
 * stored. Always answers 204 so it never affects the page.
 */
export async function POST(request: Request) {
  // Browsers send Origin on every POST; a missing or foreign one is not our page.
  if (!request.headers.get("origin")) return new Response(null, { status: 403 });
  try { sameOrigin(request); } catch { return new Response(null, { status: 403 }); }
  const text = await request.text().catch(() => "");
  if (!text || text.length > LIMIT) return accepted();
  let parsed: z.infer<typeof Report>;
  try { parsed = Report.parse(JSON.parse(text)); } catch { return accepted(); }
  if (parsed.type === "error") {
    if (!IGNORED_CLIENT_ERROR.test(parsed.message)) await recordError({ source: "client", kind: parsed.kind, message: parsed.message, route: parsed.path });
    return accepted();
  }
  const page = telemetryPage(parsed.path);
  if (page && request.headers.get("sec-gpc") !== "1" && request.headers.get("dnt") !== "1") {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
    await recordVisit(page, ip, request.headers.get("user-agent") ?? "");
  }
  return accepted();
}

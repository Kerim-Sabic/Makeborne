import { cookies } from "next/headers";
import { boundedBytes, sameOrigin } from "@/lib/server/http";
import { createClient } from "@/lib/supabase/server";
import { anonymousReviewDatabase, requireReviewToken } from "@/lib/client-review/server";
import { MAX_BEAT_BYTES, ViewBeatSchema } from "@/lib/client-review/views";

export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

/** Public heartbeat from the review page: which slide or page is on screen and
 * for how long. Always 204: view tracking must never affect the review itself
 * (bad input, a missing table, a closed link or a database error look the same). */
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const token = requireReviewToken((await context.params).token);
    // sendBeacon posts a string as text/plain; fetch fallbacks send the same.
    const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (type !== "text/plain" && type !== "application/json") return done();
    const bytes = await boundedBytes(request, MAX_BEAT_BYTES, request.signal);
    const beat = ViewBeatSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (!beat.success) return done();
    // A signed-in visitor's own session lets the database skip the workspace's
    // owner and members previewing their own link. Everyone else is anonymous.
    const signedIn = (await cookies()).getAll().some(cookie => SESSION_COOKIE.test(cookie.name));
    const database = signedIn ? await createClient() : anonymousReviewDatabase();
    await database.rpc("makeborne_record_client_review_view", {
      p_token: token, p_session: beat.data.session, p_device: beat.data.device, p_open: beat.data.open, p_slices: beat.data.slices,
    });
  } catch { /* never surfaces: tracking is best effort */ }
  return done();
}

function done() {
  return new Response(null, { status: 204, headers });
}

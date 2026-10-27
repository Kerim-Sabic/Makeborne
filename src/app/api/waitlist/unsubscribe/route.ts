import { billingDatabase } from "@/lib/billing/database";
import { validUnsubscribe, waitlistSecret } from "@/lib/launch/waitlist";
import { boundedBytes } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Leaves the launch waitlist. The signed link (id + HMAC) is the only authority, so it works from the confirmation
 * page's form and from a mail client's RFC 8058 one-click "List-Unsubscribe-Post". Same answer for unknown ids.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  let id = url.searchParams.get("id"), signature = url.searchParams.get("sig");
  try {
    const body = new URLSearchParams(new TextDecoder().decode(await boundedBytes(request, 2_000, request.signal)));
    id = body.get("id") ?? id; signature = body.get("sig") ?? signature;
  } catch { /* an empty one-click body is fine: the link carries the id */ }
  const secret = waitlistSecret();
  const page = (query: string) => new Response(null, { status: 303, headers: { Location: `/waitlist/unsubscribe?${query}`, "Cache-Control": "no-store" } });
  if (!secret || !validUnsubscribe(secret, id, signature)) return page("status=invalid");
  try {
    const { error } = await billingDatabase().rpc("makeborne_unsubscribe_launch_waitlist", { p_id: id.toLowerCase() });
    if (error) { console.error("launch waitlist: unsubscribe failed", error.code ?? "unknown"); return page("status=error"); }
  } catch { return page("status=error"); }
  return page("status=done");
}

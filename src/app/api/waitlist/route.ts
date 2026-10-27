import { billingDatabase } from "@/lib/billing/database";
import { cleanWaitlistSource, WAITLIST_CONSENT_VERSION } from "@/lib/launch/waitlist-shared";
import { keyedHash, normalizeWaitlistEmail, requestIp, waitlistSecret, WaitlistInput } from "@/lib/launch/waitlist";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const accepted = () => Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
const invalid = () => new RequestError("INVALID_EMAIL", "Enter a valid email address.", 400);
const unavailable = () => new RequestError("WAITLIST_UNAVAILABLE", "The waitlist isn't available right now. Try again shortly.", 503);

/**
 * Join the launch waitlist. Same-origin JSON only. The answer is the same whether or not the address was already on
 * the list, and nothing is echoed back. Raw IPs are never stored: a keyed hash limits each connection to 5 new
 * addresses per 10 minutes (in SQL). Logs carry error codes only, never the address.
 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const parsed = WaitlistInput.safeParse(await boundedJson(request, 4_000));
    if (!parsed.success) throw invalid();
    // Honeypot filled: answer exactly as for a person, store nothing.
    if (parsed.data.company) return accepted();
    const email = normalizeWaitlistEmail(parsed.data.email);
    if (!email) throw invalid();
    const secret = waitlistSecret();
    if (!secret) throw unavailable();
    let database;
    try { database = billingDatabase(); } catch { throw unavailable(); }
    const userAgent = request.headers.get("user-agent");
    const { error } = await database.rpc("makeborne_join_launch_waitlist", {
      p_email: email,
      p_source: cleanWaitlistSource(parsed.data.source),
      p_consent: WAITLIST_CONSENT_VERSION,
      p_ip_hash: keyedHash(secret, "ip", requestIp(request.headers)),
      p_user_agent_hash: userAgent ? keyedHash(secret, "user-agent", userAgent.slice(0, 512)) : null,
    });
    if (error?.code === "MB429") throw new RequestError("WAITLIST_RATE_LIMITED", "Too many attempts from this connection. Try again in a few minutes.", 429);
    if (error?.code === "22023") throw invalid();
    if (error) { console.error("launch waitlist: join failed", error.code ?? "unknown"); throw unavailable(); }
    return accepted();
  } catch (error) { return apiError(error); }
}

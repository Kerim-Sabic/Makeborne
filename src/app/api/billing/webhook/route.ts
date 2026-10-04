import { apiError, RequestError } from "@/lib/server/http";
import { reconcileWhopEvent, verifyWhopEvent } from "@/lib/billing/webhook";

export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 512_000) throw new RequestError("REQUEST_TOO_LARGE", "Webhook exceeds the allowed size.", 413);
    const reader = request.body?.getReader();
    if (!reader) throw new RequestError("EMPTY_WEBHOOK", "Webhook body is missing.", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 512_000) { await reader.cancel(); throw new RequestError("REQUEST_TOO_LARGE", "Webhook exceeds the allowed size.", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const event = verifyWhopEvent(Buffer.concat(chunks).toString("utf8"), request.headers);
    await reconcileWhopEvent(event);
    return Response.json({ received: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

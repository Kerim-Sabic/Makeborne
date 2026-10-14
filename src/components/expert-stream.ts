"use client";

export type StreamOutcome = { text: string; charged: number | null; truncated: boolean; error: { code: string; message: string; retry: boolean } | null };

/** Posts to an expert endpoint and reads its event stream, reporting text as it arrives. */
export async function readExpertStream(url: string, body: unknown, handlers: { onText: (text: string) => void; onStatus?: (status: string) => void; signal: AbortSignal; headers?: Record<string, string> }): Promise<StreamOutcome> {
  const outcome: StreamOutcome = { text: "", charged: null, truncated: false, error: null };
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...handlers.headers }, body: JSON.stringify(body), signal: handlers.signal });
    if (!response.ok || !response.body) {
      const failure = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
      const code = failure?.error?.code ?? "REQUEST_FAILED";
      outcome.error = { code, message: failure?.error?.message ?? "The expert couldn't answer just now. Please try again.", retry: !["INSUFFICIENT_CREDITS", "MEMBERSHIP_REQUIRED", "EDITOR_REQUIRED"].includes(code) };
      return outcome;
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
        if (!chunk.startsWith("data: ")) continue;
        const event = JSON.parse(chunk.slice(6)) as { type: string; delta?: string; message?: string; code?: string; charged?: number; truncated?: boolean; retryable?: boolean };
        if (event.type === "text" && event.delta) { outcome.text += event.delta; handlers.onText(outcome.text); }
        else if (event.type === "status" && event.message) handlers.onStatus?.(event.message);
        else if (event.type === "done") { outcome.charged = event.charged ?? 0; outcome.truncated = !!event.truncated; }
        else if (event.type === "error") outcome.error = { code: event.code ?? "CHAT_FAILED", message: event.message ?? "The expert couldn't answer just now.", retry: event.retryable !== false };
      }
    }
  } catch {
    if (!handlers.signal.aborted) outcome.error = { code: "CONNECTION", message: "The connection dropped. Nothing is charged for an unfinished answer; please try again.", retry: true };
    else outcome.truncated = true;
  }
  return outcome;
}

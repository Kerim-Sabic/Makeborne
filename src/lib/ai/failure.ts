/**
 * Customer-facing results for AI spending controls. Messages are fixed and
 * retryable; they never include limits, amounts or internal reasons (those stay
 * in server logs and the database). Work that never started is never charged.
 */
export type AiStopCode = "AI_PAUSED" | "AI_DAILY_LIMIT" | "AI_UNAVAILABLE";
export const AI_STOP_MESSAGES: Readonly<Record<AiStopCode, string>> = Object.freeze({
  AI_PAUSED: "AI generation is paused right now. Nothing was charged. Please try again later.",
  AI_DAILY_LIMIT: "Today's AI capacity has been reached. Nothing was charged. Please try again later.",
  AI_UNAVAILABLE: "AI generation is temporarily unavailable. Nothing was charged. Please try again shortly.",
});

/** Maps a spending-control error to its customer-facing stop, or null for other errors. */
export function aiStop(error: unknown): { code: AiStopCode; message: string; retryable: true } | null {
  const code = (error as { code?: unknown } | null)?.code;
  const stop: AiStopCode | null = code === "PROVIDER_DISABLED" ? "AI_PAUSED"
    : code === "PROVIDER_LIMIT" ? "AI_DAILY_LIMIT"
    : code === "SPEND_UNAVAILABLE" || code === "UNPRICED_MODEL" || code === "UNSUPPORTED_AI_CONFIG" ? "AI_UNAVAILABLE"
    : null;
  return stop ? { code: stop, message: AI_STOP_MESSAGES[stop], retryable: true } : null;
}

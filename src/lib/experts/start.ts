import "server-only";
import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { RequestError } from "../server/http";
import { HOLD_LIFETIME_MS, reserveCredits } from "../credits/server";
import { CLOCK_SKEW_MS, databaseGate, requireProviderCapacity, SETTLEMENT_WINDOW_MS } from "../ai/live-run";
import { RunSpend } from "../ai/run-spend";
import { requirePricedModel } from "../ai/model-check";
import { CHAT_MODES, type ChatMode, type ExpertId } from "../expert-personas";
import { CHAT_ROUTES, chatCreditRate, expertChatResponse, type ChatTurn } from "./chat-run";

export const chatEnabled = () => process.env.MAKEBORNE_EXPERT_CHAT_ENABLED !== "false" && Boolean(process.env.ANTHROPIC_API_KEY);
/** One reply at a time per account on this server; the credit hold bounds cost regardless. */
const active = new Set<string>();

/**
 * Starts one paid expert reply for an already-authorised user: price check,
 * provider capacity, credit hold, spend limits, then the streamed answer.
 * Nothing is reserved when any check before the hold fails.
 */
export async function startExpertReply(input: { user: User; expert: ExpertId; mode: ChatMode; turns: ChatTurn[]; purpose: string; signal?: AbortSignal; maxDuration: number }): Promise<Response> {
  if (!chatEnabled()) throw new RequestError("CHAT_UNAVAILABLE", "Expert chat isn't connected in this environment.", 503);
  const route = CHAT_ROUTES[input.mode];
  // Unknown pricing fails closed before anything is reserved or sent.
  requirePricedModel(route.model);
  // Paused or exhausted provider spending: a retryable 503 before any credit hold exists.
  await requireProviderCapacity("anthropic");
  if (active.has(input.user.id)) throw new RequestError("CHAT_BUSY", "Wait for the current answer to finish before asking again.", 409);
  active.add(input.user.id);
  try {
    const credits = CHAT_MODES[input.mode].holdCredits;
    const hold = await reserveCredits(input.user.id, credits, `${input.purpose}:${input.expert}:${randomUUID()}`);
    // Chat credits buy provider cost at the chat rate (15x), so caps use that rate. Admins (exempt holds) keep the same provider cap.
    const cap = Math.floor(credits * chatCreditRate(input.mode) * 1e6);
    const spend = new RunSpend({ run: hold.reference, providerCapMicrousd: cap, customerCapMicrousd: hold.exempt ? null : cap, gate: databaseGate(hold.userId),
      deadline: Math.min(Date.now() + (input.maxDuration - 20) * 1000, hold.reservedAt + HOLD_LIFETIME_MS - SETTLEMENT_WINDOW_MS - CLOCK_SKEW_MS) });
    const response = expertChatResponse({ hold, spend, expert: input.expert, mode: input.mode, turns: input.turns, maxDuration: input.maxDuration, signal: input.signal });
    return releaseWhenDone(response, () => active.delete(input.user.id));
  } catch (error) {
    active.delete(input.user.id);
    throw error;
  }
}

function releaseWhenDone(response: Response, release: () => void): Response {
  if (!response.body) { release(); return response; }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { release(); controller.close(); } else controller.enqueue(value);
      } catch (error) { release(); controller.error(error); }
    },
    cancel(reason) { release(); return reader.cancel(reason); },
  });
  return new Response(body, { status: response.status, headers: response.headers });
}

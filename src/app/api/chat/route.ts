import { z } from "zod";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";
import { requireBillingUser, requireCreationAccess } from "@/lib/billing/access";
import { EXPERT_CHAT_LIMITS, EXPERT_IDS } from "@/lib/expert-personas";
import { chatEnabled, startExpertReply } from "@/lib/experts/start";

export const runtime = "nodejs";
export const maxDuration = 300;

const Turn = z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(EXPERT_CHAT_LIMITS.messageCharacters * 3) }).strict();
const ChatRequest = z.object({
  expert: z.enum(EXPERT_IDS),
  mode: z.enum(["standard", "genius"]).default("standard"),
  messages: z.array(Turn).min(1).max(EXPERT_CHAT_LIMITS.historyMessages),
}).strict().superRefine((body, ctx) => {
  const last = body.messages.at(-1)!;
  if (body.messages[0].role !== "user" || last.role !== "user") ctx.addIssue({ code: "custom", message: "The conversation must start and end with your message." });
  if (last.content.length > EXPERT_CHAT_LIMITS.messageCharacters) ctx.addIssue({ code: "custom", message: "Messages are limited to 6,000 characters." });
  if (body.messages.reduce((total, turn) => total + turn.content.length, 0) > EXPERT_CHAT_LIMITS.historyCharacters) ctx.addIssue({ code: "custom", message: "This conversation is too long. Start a new chat." });
});

/** One expert reply, streamed (SSE). Holds the mode's credit limit and charges confirmed usage. */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (!chatEnabled()) throw new RequestError("CHAT_UNAVAILABLE", "Expert chat isn't connected in this environment.", 503);
    const parsed = ChatRequest.safeParse(await boundedJson(request, 400_000));
    // Our own rules carry readable messages; anything else gets a generic one.
    if (!parsed.success) throw new RequestError("INVALID_CHAT_REQUEST", parsed.error.issues.find(issue => issue.code === "custom")?.message ?? "Write a message for the expert.");
    const body = parsed.data;
    const user = await requireBillingUser();
    await requireCreationAccess(user);
    return await startExpertReply({ user, expert: body.expert, mode: body.mode, turns: body.messages, purpose: "chat", signal: request.signal, maxDuration });
  } catch (error) { return apiError(error); }
}

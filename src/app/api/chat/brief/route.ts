import { z } from "zod";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";
import { requireBillingUser, requireCreationAccess } from "@/lib/billing/access";
import { EXPERT_CHAT_LIMITS, EXPERT_IDS } from "@/lib/expert-personas";
import { chatEnabled, startAdvisorBrief } from "@/lib/experts/start";

export const runtime = "nodejs";
export const maxDuration = 120;

const Turn = z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(EXPERT_CHAT_LIMITS.messageCharacters * 3) }).strict();
const BriefRequest = z.object({
  expert: z.enum(EXPERT_IDS),
  messages: z.array(Turn).min(2).max(EXPERT_CHAT_LIMITS.historyMessages),
}).strict().superRefine((body, ctx) => {
  if (body.messages[0].role !== "user") ctx.addIssue({ code: "custom", message: "The conversation must start with your message." });
  if (!body.messages.some(turn => turn.role === "assistant")) ctx.addIssue({ code: "custom", message: "Ask the advisor something before drafting a brief." });
  if (body.messages.reduce((total, turn) => total + turn.content.length, 0) > EXPERT_CHAT_LIMITS.historyCharacters) ctx.addIssue({ code: "custom", message: "This conversation is too long to summarise. Start a new chat." });
});

/**
 * Drafts a structured brief from the advisor conversation (JSON). Read-only advice:
 * it creates no project and starts no build. Holds the Standard maximum (3 credits),
 * charges confirmed usage for a usable brief, and nothing otherwise.
 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (!chatEnabled()) throw new RequestError("CHAT_UNAVAILABLE", "Expert chat isn't connected in this environment.", 503);
    const parsed = BriefRequest.safeParse(await boundedJson(request, 400_000));
    if (!parsed.success) throw new RequestError("INVALID_BRIEF_REQUEST", parsed.error.issues.find(issue => issue.code === "custom")?.message ?? "Ask the advisor something before drafting a brief.");
    const body = parsed.data;
    const user = await requireBillingUser();
    await requireCreationAccess(user);
    const result = await startAdvisorBrief({ user, expert: body.expert, turns: body.messages, signal: request.signal, maxDuration });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { cloudContext, databaseError, validId } from "@/lib/cloud/server";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";
import { HOLD_LIFETIME_MS, releaseRun, reserveCredits } from "@/lib/credits/server";
import { CLOCK_SKEW_MS, databaseGate, requireProviderCapacity, SETTLEMENT_WINDOW_MS } from "@/lib/ai/live-run";
import { RunSpend } from "@/lib/ai/run-spend";
import { requirePricedModel } from "@/lib/ai/model-check";
import { aiCostUsdPerCredit } from "@/lib/builder/pricing";
import { logAiStop } from "@/lib/builder/website-run";
import { aiBriefQuestions, QUESTIONS_MODEL } from "@/lib/builder/ai-brief-questions";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One question request at a time per account on this server; the hold bounds cost regardless. */
const active = new Set<string>();
/** The questions step is free to the client: one credit is held only to cap the call, then released. */
const HOLD_CREDITS = 1;

const QuestionsRequest = z.object({
  workspaceId: z.string().uuid(),
  artifactId: z.string().uuid(),
  kind: z.enum(["website", "presentation", "book"]),
  brief: z.string().trim().min(1).max(8000),
  attachments: z.number().int().min(0).max(20).default(0),
}).strict();

const builderEnabled = () => process.env.MAKEBORNE_LIVE_BUILDER_ENABLED !== "false" && Boolean(process.env.ANTHROPIC_API_KEY);

/**
 * Questions tailored to a first brief (JSON). Free to the client: a one-credit
 * hold caps the provider spend, and the measured cost is recorded as absorbed
 * when the hold is released. Any failure is a non-charging error; the studio
 * then falls back to its on-device questions.
 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (!builderEnabled()) throw new RequestError("BUILDER_UNAVAILABLE", "Tailored questions aren't available in this environment.", 503);
    const parsed = QuestionsRequest.safeParse(await boundedJson(request, 20_000));
    if (!parsed.success) throw new RequestError("INVALID_REQUEST", "Describe what you'd like to make.", 400);
    const body = parsed.data;
    validId(body.artifactId);
    const { client, user, workspace } = await cloudContext(body.workspaceId, true);
    if (workspace?.role === "reviewer") throw new RequestError("EDITOR_REQUIRED", "Only owners and editors can start a build.", 403);
    const { data: artifact, error } = await client.from("artifacts").select("id,kind").eq("workspace_id", body.workspaceId).eq("id", body.artifactId).maybeSingle();
    databaseError(error);
    if (!artifact || artifact.kind !== body.kind) throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
    requirePricedModel(QUESTIONS_MODEL);
    await requireProviderCapacity("anthropic");
    if (active.has(user.id)) throw new RequestError("QUESTIONS_BUSY", "Questions are already being prepared.", 409);
    active.add(user.id);
    try {
      const hold = await reserveCredits(user.id, HOLD_CREDITS, `brief_questions:${randomUUID()}`);
      const rate = aiCostUsdPerCredit(), cap = Math.floor(HOLD_CREDITS * rate * 1e6);
      const deadline = Math.min(Date.now() + (maxDuration - 12) * 1000, hold.reservedAt + HOLD_LIFETIME_MS - SETTLEMENT_WINDOW_MS - CLOCK_SKEW_MS);
      const spend = new RunSpend({ run: hold.reference, providerCapMicrousd: cap, customerCapMicrousd: hold.exempt ? null : cap, gate: databaseGate(hold.userId), deadline, minCallMs: 15_000 });
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), (maxDuration - 8) * 1000);
      request.signal.addEventListener("abort", () => controller.abort(), { once: true });
      let questions = null;
      try { questions = await aiBriefQuestions({ kind: body.kind, brief: body.brief, attachments: body.attachments, spend, signal: controller.signal }); }
      catch (cause) { logAiStop(hold.reference, cause); }
      finally {
        clearTimeout(timeout);
        // Never charged: the measured provider cost is recorded as absorbed. releaseRun takes whole credits (a fractional
        // value was refused and the hold lapsed for 15 minutes with no outcome). A failed release is logged, not hidden;
        // the hold then lapses unspent.
        await releaseRun(hold, spend.customerCredits(rate), "brief_questions", { kind: "brief_questions", calls: spend.calls.length, providerMicrousd: spend.providerMicrousd, uncertainMicrousd: spend.uncertainMicrousd })
          .catch(cause => console.error(JSON.stringify({ event: "brief_questions_release_failed", reference: hold.reference, code: (cause as { code?: string })?.code ?? null })));
      }
      if (!questions) throw new RequestError("QUESTIONS_UNAVAILABLE", "Tailored questions couldn't be prepared. Nothing was charged.", 503);
      return Response.json({ questions }, { headers: { "Cache-Control": "no-store" } });
    } finally { active.delete(user.id); }
  } catch (error) { return apiError(error); }
}

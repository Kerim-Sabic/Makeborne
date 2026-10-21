import { randomUUID } from "node:crypto";
import { z } from "zod";
import { cloudContext, databaseError, validId } from "@/lib/cloud/server";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";
import { HOLD_LIFETIME_MS, releaseRun, reserveCredits, settleRun } from "@/lib/credits/server";
import { CLOCK_SKEW_MS, databaseGate, requireProviderCapacity, SETTLEMENT_WINDOW_MS } from "@/lib/ai/live-run";
import { RunSpend } from "@/lib/ai/run-spend";
import { requirePricedModel } from "@/lib/ai/model-check";
import { aiCostUsdPerCredit } from "@/lib/builder/pricing";
import { logAiStop } from "@/lib/builder/website-run";
import { ENHANCER_MODEL, enhanceBrief } from "@/lib/builder/brief-enhancer";
import { DesignAnswersSchema, ENHANCER_CREDITS, renderEnhancedBrief } from "@/lib/builder/enhanced-brief";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One enhancement at a time per account on this server; the hold bounds cost regardless. */
const active = new Set<string>();

const EnhanceRequest = z.object({
  workspaceId: z.string().uuid(),
  artifactId: z.string().uuid(),
  /** The client's brief with their chosen answers, exactly as it will be sent to the build. */
  brief: z.string().trim().min(1).max(8000),
  design: DesignAnswersSchema.optional(),
  attachments: z.number().int().min(0).max(20).default(0),
}).strict();

const builderEnabled = () => process.env.MAKEBORNE_LIVE_BUILDER_ENABLED !== "false" && Boolean(process.env.ANTHROPIC_API_KEY);

/**
 * The enhanced brief for a first website build (JSON). Priced and bounded like the advisor's
 * replies: a hold of ENHANCER_CREDITS caps the provider spend, confirmed usage is charged only
 * when a usable brief comes back, and every failure releases the hold uncharged. The studio then
 * builds from the client's original brief (fail open) and shows that it did.
 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (!builderEnabled()) throw new RequestError("BUILDER_UNAVAILABLE", "Brief enhancement isn't available in this environment.", 503);
    const parsed = EnhanceRequest.safeParse(await boundedJson(request, 24_000));
    if (!parsed.success) throw new RequestError("INVALID_REQUEST", "Describe the website you'd like to make.", 400);
    const body = parsed.data;
    validId(body.artifactId);
    const { client, user, workspace } = await cloudContext(body.workspaceId, true);
    if (workspace?.role === "reviewer") throw new RequestError("EDITOR_REQUIRED", "Only owners and editors can start a build.", 403);
    const { data: artifact, error } = await client.from("artifacts").select("id,kind,title").eq("workspace_id", body.workspaceId).eq("id", body.artifactId).maybeSingle();
    databaseError(error);
    if (!artifact || artifact.kind !== "website") throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
    requirePricedModel(ENHANCER_MODEL);
    await requireProviderCapacity("anthropic");
    if (active.has(user.id)) throw new RequestError("ENHANCE_BUSY", "Your brief is already being enhanced.", 409);
    active.add(user.id);
    try {
      const hold = await reserveCredits(user.id, ENHANCER_CREDITS, `brief_enhance:${randomUUID()}`);
      const rate = aiCostUsdPerCredit(), cap = Math.floor(ENHANCER_CREDITS * rate * 1e6);
      const deadline = Math.min(Date.now() + (maxDuration - 12) * 1000, hold.reservedAt + HOLD_LIFETIME_MS - SETTLEMENT_WINDOW_MS - CLOCK_SKEW_MS);
      const spend = new RunSpend({ run: hold.reference, providerCapMicrousd: cap, customerCapMicrousd: hold.exempt ? null : cap, gate: databaseGate(hold.userId), deadline, minCallMs: 15_000 });
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), (maxDuration - 8) * 1000);
      request.signal.addEventListener("abort", () => controller.abort(), { once: true });
      const detail = () => ({ kind: "brief_enhance", calls: spend.calls.length, providerMicrousd: spend.providerMicrousd, uncertainMicrousd: spend.uncertainMicrousd });
      let enhanced = null;
      try { enhanced = await enhanceBrief({ brief: body.brief, title: artifact.title, design: body.design, attachments: body.attachments, spend, signal: controller.signal }); }
      catch (cause) { logAiStop(hold.reference, cause); }
      finally { clearTimeout(timeout); }
      if (!enhanced) {
        await releaseRun(hold, spend.customerCredits(rate), "brief_enhance_unusable", detail()).catch(() => undefined);
        throw new RequestError("ENHANCE_UNAVAILABLE", "Your brief couldn't be enhanced just now. Nothing was charged; the build uses your own words.", 503);
      }
      const settled = await settleRun(hold, spend.customerCredits(rate), detail());
      return Response.json({ enhanced, text: renderEnhancedBrief(enhanced), charged: settled.charged, providerMicrousd: spend.providerMicrousd },
        { headers: { "Cache-Control": "no-store" } });
    } finally { active.delete(user.id); }
  } catch (error) { return apiError(error); }
}

import { z } from "zod";
import { cloudContext, databaseError, validId } from "@/lib/cloud/server";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";
import { HOLD_LIFETIME_MS } from "@/lib/credits/server";
import { CLOCK_SKEW_MS, requireProviderCapacity, SETTLEMENT_WINDOW_MS } from "@/lib/ai/live-run";
import { RunSpend } from "@/lib/ai/run-spend";
import { requirePricedModel } from "@/lib/ai/model-check";
import { aiCostUsdPerCredit } from "@/lib/builder/pricing";
import { logAiStop } from "@/lib/builder/website-run";
import { ENHANCER_MODEL, enhanceBrief, unusableReason } from "@/lib/builder/brief-enhancer";
import { DesignAnswersSchema, ENHANCER_CREDITS, renderBriefAnalysis, renderEnhancedBrief, shouldEnhance } from "@/lib/builder/enhanced-brief";
import type { EnhanceAction } from "@/lib/builder/enhance-action";
import {
  cancelEnhancement, claimEnhancement, enhanceActionResponse, enhanceInputDigest, enhancementGate, readEnhancement, recordEnhancement,
  releaseEnhancement, watchEnhancementStop, type EnhanceOutcome, type EnhanceRun, type EnhanceScope,
} from "@/lib/builder/enhance-action-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const EnhanceRequest = z.object({
  workspaceId: z.string().uuid(),
  artifactId: z.string().uuid(),
  /** The client's brief with their chosen answers, exactly as it will be sent to the build. */
  brief: z.string().trim().min(1).max(8000),
  /** The client's own words before any answers were added: decides between enhancing (short) and analysing (detailed). */
  original: z.string().trim().min(1).max(8000).optional(),
  design: DesignAnswersSchema.optional(),
  attachments: z.number().int().min(0).max(20).default(0),
}).strict();
const ActionQuery = z.object({ workspaceId: z.string().uuid(), artifactId: z.string().uuid(), key: z.string().uuid() }).strict();

const builderEnabled = () => process.env.MAKEBORNE_LIVE_BUILDER_ENABLED !== "false" && Boolean(process.env.ANTHROPIC_API_KEY);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The client's action identity. Required: without it a lost reply could not be recovered without running again. */
function actionKey(request: Request) {
  const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!UUID.test(key)) throw new RequestError("IDEMPOTENCY_KEY_REQUIRED", "Reload the studio to improve your brief.", 400);
  return key.toLowerCase();
}

/** Reviewers never start or see prompt help; books and decks have none. Checked before any hold. */
async function websiteScope(workspaceId: string, artifactId: string, key: string, write: boolean) {
  validId(artifactId);
  const { client, user, workspace } = await cloudContext(workspaceId, write);
  if (workspace?.role === "reviewer") throw new RequestError("EDITOR_REQUIRED", "Only owners and editors can improve a brief for this project.", 403);
  const { data: artifact, error } = await client.from("artifacts").select("id,kind,title").eq("workspace_id", workspaceId).eq("id", artifactId).maybeSingle();
  databaseError(error);
  if (!artifact || artifact.kind !== "website") throw new RequestError("NOT_FOUND", "This project is unavailable.", 404);
  return { scope: { actor: user.id, workspaceId, artifactId, key } satisfies EnhanceScope, title: artifact.title as string };
}

const roomMessage = (code: string) => `Your brief wasn't improved: improving it is free, but it briefly sets aside ${ENHANCER_CREDITS} credit (always returned), and ${code === "INSUFFICIENT_CREDITS" ? "your balance has no credits left" : "your monthly credit usage limit has no room left"}. Nothing was charged. A build needs credits too: ${code === "INSUFFICIENT_CREDITS" ? "add credits" : "review your limit in Billing"} to continue.`;

/**
 * Optional prompt help for a first website build, only on the client's explicit request: a short brief is
 * improved; a detailed one is read (a structured reading of the client's verbatim words, never a rewrite).
 * Free to the client. One durable action per Idempotency-Key: claiming it takes a hold of ENHANCER_CREDITS
 * (bounding the provider spend, about $0.001) in the same transaction, so a repeat, a parallel request,
 * another instance or a restart replays the stored action with no second call and no second hold. The
 * result is stored before the hold is returned; only a verified return makes it usable. A failed or
 * anomalous return is kept durably and reported, never hidden.
 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (!builderEnabled()) throw new RequestError("BUILDER_UNAVAILABLE", "Brief improvement isn't available in this environment.", 503);
    const key = actionKey(request);
    const parsed = EnhanceRequest.safeParse(await boundedJson(request, 24_000));
    if (!parsed.success) throw new RequestError("INVALID_REQUEST", "Describe the website you'd like to make.", 400);
    const body = parsed.data;
    const { scope, title } = await websiteScope(body.workspaceId, body.artifactId, key, true);
    const digest = enhanceInputDigest(body);
    const mode = shouldEnhance(body.original ?? body.brief) ? "enhance" as const : "analyze" as const;
    // A request the server already holds is answered from its record: no capacity check, no new work.
    const known = await readEnhancement(scope);
    if (!known) {
      requirePricedModel(ENHANCER_MODEL);
      await requireProviderCapacity("anthropic");
    }
    const rate = aiCostUsdPerCredit(), cap = Math.max(1, Math.floor(ENHANCER_CREDITS * rate * 1e6));
    const claimed = await claimEnhancement(scope, { digest, mode, holdCredits: ENHANCER_CREDITS, providerCapMicrousd: cap }).catch(error => {
      if (error instanceof RequestError && (error.code === "INSUFFICIENT_CREDITS" || error.code === "CREDIT_USAGE_LIMIT")) throw new RequestError(error.code, roomMessage(error.code), 402);
      throw error;
    });
    if (claimed.replayed) return enhanceActionResponse(claimed.action, true);
    return await work(scope, claimed.run, { ...body, mode, title, cap, rate });
  } catch (error) { return apiError(error); }
}

async function work(scope: EnhanceScope, run: EnhanceRun,
  input: z.infer<typeof EnhanceRequest> & { mode: "enhance" | "analyze"; title: string; cap: number; rate: number }) {
  const deadline = Math.min(Date.now() + (maxDuration - 12) * 1000, run.reservedAt + HOLD_LIFETIME_MS - SETTLEMENT_WINDOW_MS - CLOCK_SKEW_MS, run.leaseExpiresAt - SETTLEMENT_WINDOW_MS);
  const spend = new RunSpend({ run: run.reference, providerCapMicrousd: input.cap, customerCapMicrousd: run.exempt ? null : input.cap, gate: enhancementGate(scope, run), deadline, minCallMs: 15_000 });
  // A browser disconnect does not stop the reading (its reply is recovered from the action); only an explicit Stop does.
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), (maxDuration - 8) * 1000);
  let enhanced = null, reply: { text: string; stop: string | null } | null = null, stopped = false, unwatch: () => void = () => {};
  try {
    // Stop before any provider contact: a Stop recorded while the hold was being taken is honoured here.
    const current = await readEnhancement(scope);
    if (!current || current.cancelRequested || current.status !== "running") stopped = true;
    else {
      unwatch = watchEnhancementStop(scope, spend, controller);
      enhanced = await enhanceBrief({ brief: input.brief, title: input.title, design: input.design, attachments: input.attachments, mode: input.mode, spend, signal: controller.signal, onReply: (text, stop) => { reply = { text, stop }; } });
    }
  } catch (cause) {
    stopped = spend.stopped === "CANCELLED";
    // Spend stops are logged by logAiStop; any other failure (provider error, timeout) is logged here, without content.
    if (!stopped && !logAiStop(run.reference, cause)) console.error(JSON.stringify({ event: "brief_enhance_failed", reference: run.reference, mode: input.mode, error: cause instanceof Error ? `${cause.name}: ${cause.message}`.slice(0, 300) : "unknown" }));
  } finally { clearTimeout(timeout); unwatch(); }
  if (spend.stopped === "CANCELLED") stopped = true;
  if (!enhanced && reply && !stopped) {
    const { text, stop } = reply as { text: string; stop: string | null };
    console.error(JSON.stringify({ event: "brief_enhance_unusable", reference: run.reference, mode: input.mode, stop, chars: text.length, reason: unusableReason(text) }));
  }
  const outcome: EnhanceOutcome = stopped ? "cancelled" : enhanced ? "completed" : "failed";
  // 1. The outcome is durable before the hold is touched: a failed or lost release never loses or regenerates it.
  let recorded: EnhanceAction;
  try {
    recorded = await recordEnhancement(scope, run, {
      outcome, measuredCredits: spend.customerCredits(input.rate), providerMicrousd: spend.providerMicrousd,
      result: outcome === "completed" && enhanced ? { mode: input.mode, text: input.mode === "enhance" ? renderEnhancedBrief(enhanced) : renderBriefAnalysis(enhanced), enhanced } : null,
      failure: outcome === "failed" ? { code: "ENHANCE_UNAVAILABLE", message: "Your brief couldn't be improved just now." } : null,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "brief_enhance_record_failed", reference: run.reference, outcome, error: error instanceof RequestError ? error.code : "unknown" }));
    // Refused (the lease ended and the action was closed): its saved state is the answer.
    const saved = await readEnhancement(scope).catch(() => null);
    if (saved && saved.status !== "running") return enhanceActionResponse(saved);
    // Otherwise the action stays running until its lease ends, then its hold is returned; the studio re-reads it.
    return apiError(new RequestError("ENHANCE_STATUS_UNAVAILABLE", "Your brief's improvement couldn't be saved. Check its status in a moment; it will not be run again and nothing more will be charged.", 503));
  }
  // 2. Return the hold exactly once, verified by the database; one immediate retry for a transient failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return enhanceActionResponse((await releaseEnhancement(scope)).action); }
    catch (error) {
      console.error(JSON.stringify({ event: "credit_release_failed", reference: run.reference, attempt, error: error instanceof RequestError ? error.code : error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
    }
  }
  // The release is unconfirmed: the recorded action says so (billing still held); recovery retries it.
  return enhanceActionResponse(recorded);
}

/** The action's saved status: authenticated, scoped to the signed-in account and this project. Never runs anything. */
export async function GET(request: Request) {
  try {
    const parsed = ActionQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new RequestError("INVALID_REQUEST", "Choose the brief improvement to check.", 400);
    const { scope } = await websiteScope(parsed.data.workspaceId, parsed.data.artifactId, parsed.data.key, false);
    const current = await readEnhancement(scope);
    if (!current) throw new RequestError("ENHANCE_NOT_FOUND", "This brief improvement was not received.", 404);
    return enhanceActionResponse(current, true);
  } catch (error) { return apiError(error); }
}

/** Stop. Before the request arrived it is recorded, so a late request never starts; after completion it keeps the result. */
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const parsed = ActionQuery.safeParse(await boundedJson(request, 2_000));
    if (!parsed.success) throw new RequestError("INVALID_REQUEST", "Choose the brief improvement to stop.", 400);
    const { scope } = await websiteScope(parsed.data.workspaceId, parsed.data.artifactId, parsed.data.key, false);
    return enhanceActionResponse(await cancelEnhancement(scope), true);
  } catch (error) { return apiError(error); }
}

/** Recovery: retries returning the hold of a recorded action (idempotent; exactly once in the database). Never regenerates. */
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const parsed = ActionQuery.safeParse(await boundedJson(request, 2_000));
    if (!parsed.success) throw new RequestError("INVALID_REQUEST", "Choose the brief improvement to check.", 400);
    const { scope } = await websiteScope(parsed.data.workspaceId, parsed.data.artifactId, parsed.data.key, false);
    const released = await releaseEnhancement(scope);
    return enhanceActionResponse(released.action, released.replayed);
  } catch (error) { return apiError(error); }
}

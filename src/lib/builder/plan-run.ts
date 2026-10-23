import "server-only";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { EffortLevel } from "../routing/effort";
import type { AnthropicLike } from "../ai/anthropic-call";
import type { RunSpend } from "../ai/run-spend";
import { releaseRun, settleRun, type CreditHold } from "../credits/server";
import { estimatePlanCredits, recommendedEffort, type SitePlan, type StoredPlan } from "./plan";
import { runPlanner, type PlannerEvent } from "./planner";
import { aiCostUsdPerCredit } from "./pricing";
import { logAiStop, logRoute } from "./website-run";
import { routeDetail, runRouted, type ModelRoute, type RouteRecord } from "../ai/model-routing";
import { watchOperationCancellation, finishOperation, operationFailure, operationTerminal, type OperationRun } from "./operation-server";
import { StoredPlanSchema } from "./plan";

export type PlanStreamEvent = PlannerEvent
  | { type: "plan"; stored: StoredPlan; estimate: ReturnType<typeof estimatePlanCredits>; recommended: string; persisted: boolean }
  | { type: "done"; charged: number }
  | { type: "error"; code: string; message: string; retryable?: boolean };

export type PlanRunInput = {
  hold: CreditHold;
  operation?: OperationRun;
  spend: RunSpend;
  context: string;
  message: string;
  previousPlan: SitePlan | null;
  attachments: BetaContentBlockParam[];
  effort: EffortLevel;
  basedOnVersion: number;
  previousRevision: number;
  /** Stores the plan; a failure must not lose a paid plan (the browser still shows it). */
  persist: (stored: StoredPlan) => Promise<boolean>;
  maxDuration: number;
  anthropic?: AnthropicLike;
  /** The stage's model route (../ai/model-routing.ts). Absent: the builder model, one attempt, as before. */
  route?: ModelRoute;
};

/** One planning run (SSE). Charges the measured usage only when a valid plan is produced; otherwise releases the hold. */
export function planStreamResponse(input: PlanRunInput): Response {
  const { hold, spend } = input;
  const rate = input.operation ? input.operation.rateMicrousd / 1e6 : aiCostUsdPerCredit();
  const measured = () => spend.customerCredits(rate);
  let routeRecord: RouteRecord | null = null, routeLogged = false;
  const logRouteOnce = () => { if (!routeLogged) { routeLogged = true; logRoute(hold.reference, "plan", routeRecord); } };
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const stopWatching = watchOperationCancellation(input.operation, spend, controller);
  const timeout = setTimeout(() => controller.abort(), (input.maxDuration - 20) * 1000);
  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      let open = true;
      const emit = (event: PlanStreamEvent | Record<string, unknown>) => {
        if (!open) return;
        try { output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { open = false; }
      };
      const heartbeat = setInterval(() => { if (open) try { output.enqueue(encoder.encode(": keep-alive\n\n")); } catch { open = false; } }, 15_000);
      try {
        if (input.operation) emit({ type: "operation", operation: input.operation.operation });
        emit({ type: "status", message: input.context.includes("<current_files>(empty") ? "Studying your brief…" : "Reading your project…" });
        const attempt = (model?: string) => runPlanner({ context: input.context, request: input.message, previousPlan: input.previousPlan, attachments: input.attachments,
          effort: input.effort, spend, emit, signal: controller.signal, anthropic: input.anthropic, ...(model ? { model } : {}) });
        let result;
        if (!input.route) result = await attempt();
        else {
          // A plan stage produces a valid plan or nothing: a routed attempt without one (or refused) is retried once on the builder model.
          const routed = await runRouted({ route: input.route, stage: "plan", spend, deadline: spend.deadline, signal: controller.signal, emit, attempt: plan => attempt(plan.model),
            evaluate: attempted => attempted.plan ? { kind: "accept" as const, checks: [], problems: [] } : { kind: "incomplete" as const, checks: [], problems: ["no valid plan"] }, reset: () => undefined });
          result = routed.result; routeRecord = routed.record;
        }
        logRouteOnce();
        const detail = { calls: spend.calls.length, providerMicrousd: spend.providerMicrousd, uncertainMicrousd: spend.uncertainMicrousd, stopped: spend.stopped, usage: spend.usageByModel(),
          ...(routeRecord ? { route: routeDetail(routeRecord) } : {}) };
        if (!result.plan) {
          if (input.operation) {
            emit(operationTerminal(await finishOperation(input.operation, spend.chargeableMicrousd, "failed", { ...detail, code: "PLAN_INCOMPLETE", message: "A complete plan was not produced. This step was not charged.", changed: false, finished: false })));
            return;
          }
          await releaseRun(hold, measured(), "plan_incomplete", detail);
          emit({ type: "error", code: "PLAN_INCOMPLETE", message: "I couldn't finish a complete plan. Nothing was charged — try again or add a little more detail." });
          return;
        }
        if (input.operation) {
          const stored: StoredPlan = { plan: result.plan, status: "draft", basedOnVersion: input.basedOnVersion, revision: input.previousRevision + 1, charged: 0 };
          const finalized = await finishOperation(input.operation, spend.chargeableMicrousd, "plan", { ...detail, finished: true, changed: true }, { stored });
          const savedPlan = StoredPlanSchema.safeParse(finalized.result?.stored);
          if (savedPlan.success) emit({ type: "plan", stored: savedPlan.data, estimate: estimatePlanCredits(result.plan), recommended: recommendedEffort(result.plan), persisted: finalized.result?.persisted === true, operation: finalized.operation });
          emit(operationTerminal(finalized));
          return;
        }
        const settled = await settleRun(hold, measured(), { ...detail, kind: "plan" });
        const stored: StoredPlan = { plan: result.plan, status: "draft", basedOnVersion: input.basedOnVersion, revision: input.previousRevision + 1, charged: settled.charged };
        const persisted = await input.persist(stored).catch(() => false);
        emit({ type: "plan", stored, estimate: estimatePlanCredits(result.plan), recommended: recommendedEffort(result.plan), persisted });
        emit({ type: "done", charged: settled.charged });
      } catch (error) {
        routeRecord = (error as { route?: RouteRecord } | null)?.route ?? routeRecord;
        logRouteOnce();
        if (input.operation) {
          const stop = logAiStop(hold.reference, error);
          emit(await operationFailure(input.operation, spend, { code: stop?.code ?? "PLAN_FAILED", message: stop?.message ?? "Planning stopped. Check the saved result and credit charge below.", stopped: spend.stopped, finished: false,
            ...(routeRecord ? { route: routeDetail(routeRecord) } : {}) }));
          return;
        }
        await releaseRun(hold, measured(), "plan_failed", { code: (error as { code?: string })?.code ?? null, stopped: spend.stopped, usage: spend.usageByModel() }).catch(() => undefined);
        const stop = logAiStop(hold.reference, error);
        if (stop) emit({ type: "error", code: stop.code, message: stop.message, retryable: true });
        else emit({ type: "error", code: "PLAN_FAILED", message: (error as { code?: string }).code === "REFUSED" ? "This request can't be planned. Try rephrasing it."
          : "Planning hit a problem and stopped. No credits were charged." });
      } finally {
        stopWatching(); clearTimeout(timeout); clearInterval(heartbeat);
        if (open) try { output.close(); } catch { /* client already gone */ }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}

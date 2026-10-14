import { randomUUID } from "node:crypto";
import { cloudContext, databaseError } from "@/lib/cloud/server";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";
import { chatEnabled } from "@/lib/experts/start";
import { HOLD_LIFETIME_MS, releaseRun, reserveCredits, settleRun } from "@/lib/credits/server";
import { CLOCK_SKEW_MS, databaseGate, requireProviderCapacity, SETTLEMENT_WINDOW_MS } from "@/lib/ai/live-run";
import { RunSpend } from "@/lib/ai/run-spend";
import { requirePricedModel } from "@/lib/ai/model-check";
import { aiCostUsdPerCredit } from "@/lib/builder/pricing";
import { logAiStop } from "@/lib/builder/website-run";
import { existingIndex, gatherLeads, RANK_MODEL, rankLeads } from "@/lib/leads/finder";
import { discover, DISCOVER_MODEL } from "@/lib/leads/discover";
import { LEAD_FINDER, leadFinderMaxCredits, LeadFindRequestSchema, type LeadFindEvent } from "@/lib/leads/finder-types";

export const runtime = "nodejs";
export const maxDuration = 120;

/** One search at a time per account on this server; the hold bounds cost regardless. */
const active = new Set<string>();

/**
 * Lead finder (SSE): finds businesses on the map or reads the user's list,
 * verifies each public page, drops people already in the CRM, then Haiku ranks
 * them against the user's offer. Creators are found with capped web search, which
 * is also the map's fallback. Charges only for leads delivered plus measured AI use.
 */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    sameOrigin(request);
    if (!chatEnabled()) throw new RequestError("FINDER_UNAVAILABLE", "Lead finding isn't connected in this environment.", 503);
    const { workspaceId } = await context.params;
    const parsed = LeadFindRequestSchema.safeParse(await boundedJson(request, 20_000));
    if (!parsed.success) throw new RequestError("INVALID_SEARCH", "Describe the kind of business and a city, or paste up to 40 links or @handles.");
    const input = parsed.data;
    const { client, user, workspace } = await cloudContext(workspaceId, true);
    if (workspace?.role === "reviewer") throw new RequestError("EDITOR_REQUIRED", "Only owners and editors can find leads.", 403);
    requirePricedModel(RANK_MODEL); requirePricedModel(DISCOVER_MODEL);
    await requireProviderCapacity("anthropic");
    const { data: rows, error } = await client.from("clients").select("name,email,website,outreach").eq("workspace_id", workspaceId).limit(5000);
    databaseError(error);
    const existing = existingIndex(rows ?? []);
    if (active.has(user.id)) throw new RequestError("FINDER_BUSY", "Wait for the current search to finish.", 409);
    active.add(user.id);
    let hold;
    try { hold = await reserveCredits(user.id, leadFinderMaxCredits(input.count, input.mode), `lead_find:${randomUUID()}`); }
    catch (cause) { active.delete(user.id); throw cause; }
    // Two capped budgets inside one hold: ranking at the chat rate, web search at its lower rate.
    const deadline = Math.min(Date.now() + (maxDuration - 15) * 1000, hold.reservedAt + HOLD_LIFETIME_MS - SETTLEMENT_WINDOW_MS - CLOCK_SKEW_MS);
    const rate = aiCostUsdPerCredit() / LEAD_FINDER.priceMultiplier, searchRate = aiCostUsdPerCredit() / LEAD_FINDER.searchPriceMultiplier;
    const cap = Math.floor(LEAD_FINDER.rankingCredits * rate * 1e6), searchCap = input.mode === "list" ? 0 : Math.floor(LEAD_FINDER.searchCredits * searchRate * 1e6);
    const spend = new RunSpend({ run: hold.reference, providerCapMicrousd: cap, customerCapMicrousd: hold.exempt ? null : cap, gate: databaseGate(hold.userId), deadline });
    const searchSpend = new RunSpend({ run: hold.reference, providerCapMicrousd: searchCap, customerCapMicrousd: hold.exempt ? null : searchCap, gate: databaseGate(hold.userId), deadline });
    const charged = () => spend.customerCredits(rate) + searchSpend.customerCredits(searchRate);
    const encoder = new TextEncoder(), controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (maxDuration - 12) * 1000);
    request.signal.addEventListener("abort", () => controller.abort(), { once: true });
    const finalHold = hold;
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        let open = true;
        const emit = (event: LeadFindEvent) => { if (open) try { output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { open = false; } };
        const heartbeat = setInterval(() => { if (open) try { output.enqueue(encoder.encode(": keep-alive\n\n")); } catch { open = false; } }, 15_000);
        const detail = (extra: Record<string, unknown> = {}) => ({ kind: "lead_finder", mode: input.mode, calls: spend.calls.length + searchSpend.calls.length,
          providerMicrousd: spend.providerMicrousd + searchSpend.providerMicrousd, uncertainMicrousd: spend.uncertainMicrousd + searchSpend.uncertainMicrousd, ...extra });
        const search = searchCap ? async (request: Parameters<typeof discover>[0]) => {
          try { return await discover(request, { spend: searchSpend, signal: controller.signal, uses: LEAD_FINDER.searchUses[request.kind] }); }
          catch (cause) { logAiStop(finalHold.reference, cause); throw new Error("The web search couldn't finish. Nothing was charged for it; please try again."); }
        } : undefined;
        try {
          const found = await gatherLeads(input, emit, controller.signal, existing, { search });
          if (!found.leads.length) {
            // No leads: nothing is charged, and any search cost is absorbed.
            await releaseRun(finalHold, charged(), "lead_find_empty", detail());
            emit({ type: "results", leads: [], skipped: found.skipped, duplicates: found.duplicates, attribution: found.attribution, place: found.place, category: found.category });
            emit({ type: "done", charged: 0, delivered: 0 });
            return;
          }
          emit({ type: "status", message: input.offer ? "Ranking them for your offer…" : "Ranking them by fit…" });
          emit({ type: "progress", stage: "rank", done: 0, total: found.leads.length });
          try { await rankLeads({ offer: input.offer, leads: found.leads, spend, signal: controller.signal }); }
          catch (cause) {
            // Leads are still worth delivering without the AI read; log why the ranking stopped.
            logAiStop(finalHold.reference, cause);
            emit({ type: "status", message: "Ranking wasn't available, so leads are ordered by how reachable they are." });
          }
          emit({ type: "results", leads: found.leads, skipped: found.skipped, duplicates: found.duplicates, attribution: found.attribution, place: found.place, category: found.category });
          const measured = found.leads.length * LEAD_FINDER.creditsPerLead + charged();
          const settled = await settleRun(finalHold, measured, detail({ delivered: found.leads.length }));
          emit({ type: "done", charged: settled.charged, delivered: found.leads.length });
        } catch (cause) {
          await releaseRun(finalHold, charged(), "lead_find_failed", detail({ code: (cause as { code?: string })?.code ?? null })).catch(() => undefined);
          const message = cause instanceof Error && /map service|business search|web search|Creator search|Couldn’t find|Couldn't find|too large|Describe the kind/.test(cause.message) ? cause.message
            : "The search couldn't finish. Nothing was charged; please try again.";
          emit({ type: "error", code: "FIND_FAILED", message, retryable: true });
        } finally {
          clearTimeout(timeout); clearInterval(heartbeat); active.delete(user.id);
          if (open) try { output.close(); } catch { /* client already gone */ }
        }
      },
      cancel() { controller.abort(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
  } catch (error) { return apiError(error); }
}

import { randomUUID } from "node:crypto";
import { NO_TOKENS, addTokens, type TokenUsage } from "./prices";

/**
 * Per-run spending for the live builder. Two independent limits apply:
 * - provider dollars (`providerCapMicrousd`): what this run may spend at the
 *   providers, from the effort ceiling. Applies to everyone, admins included.
 * - customer credits (`customerCapMicrousd`): the credits held for the run,
 *   in provider dollars. Absent for exempt (unlimited) accounts.
 * Every call reserves its conservative bound before it starts; retries and
 * fallbacks draw on the same remaining amount. A call whose usage is unknown
 * counts at its full worst case against both limits and in provider spend, but
 * only its confirmed part is chargeable to the customer.
 * A call that continues a cached conversation reserves its bound with the
 * cached prefix at the cache-read price, plus its worst case (no cache) for a
 * dropped cache: the worst case is what the database gate reserves and polices,
 * and it must fit the run's allowance plus CACHE_MISS_MARGIN. So the run's
 * provider spend stays within its allowance unless the provider drops a cache it
 * just reported, and never exceeds the allowance plus the margin; settlement
 * never charges more than the hold.
 * The database gate adds platform-wide daily provider limits on top.
 */
export type ProviderName = "anthropic" | "openai";
/** How far past its allowance (a share of it) a run may go when the provider drops a prompt cache a reservation counted on. */
export const CACHE_MISS_MARGIN = 0.5;

export type SpendGate = {
  begin(call: { id: string; run: string; provider: ProviderName; model: string; boundMicrousd: number }): Promise<void>;
  /** actualMicrousd null: usage unknown, the bound is recorded as spent. */
  finish(id: string, outcome: { actualMicrousd: number | null; partialMicrousd: number; detail?: Record<string, unknown> }): Promise<void>;
};

export type SpendStop = "RUN_BUDGET" | "HOLD_EXPIRED" | "OVERRUN" | "CANCELLED";
export class SpendError extends Error {
  constructor(readonly code: SpendStop | "PROVIDER_LIMIT" | "PROVIDER_DISABLED" | "SPEND_UNAVAILABLE" | "ACCESS_REQUIRED", message: string) { super(message); }
  /** Stops that end a run gracefully (keep finished work) rather than failing it. */
  get graceful() { return this.code === "RUN_BUDGET" || this.code === "HOLD_EXPIRED"; }
}

export type CallTicket = { id: string; provider: ProviderName; model: string; boundMicrousd: number; worstCaseMicrousd: number; open: boolean };
/** cacheMiss: cost more than its cache-priced reservation, within its worst case. usage: the tokens the provider reported (null: none). */
export type CallRecord = { id: string; provider: ProviderName; model: string; boundMicrousd: number; worstCaseMicrousd: number; actualMicrousd: number | null; partialMicrousd: number;
  overrun: boolean; cacheMiss: boolean; usage: TokenUsage | null };
export type ModelUsage = TokenUsage & { calls: number; cacheMisses: number };

export class RunSpend {
  confirmedMicrousd = 0;
  uncertainMicrousd = 0;
  pendingMicrousd = 0;
  /** Open calls' worst cases (equal to pendingMicrousd unless a reservation counts on a cached prefix). */
  pendingWorstMicrousd = 0;
  /** Confirmed cost the platform absorbs: a routed attempt that failed and was retried on the primary
   * model (see ../ai/model-routing.ts). It stays provider spend and counts against both limits, but it is
   * never charged to the customer. */
  absorbedMicrousd = 0;
  stopped: SpendStop | null = null;
  readonly calls: CallRecord[] = [];
  private readonly now: () => number;
  private readonly id: () => string;
  /** A temporary lower allowance for one routed attempt (null: none). It can only lower, never raise, the run's limits. */
  private attemptCapMicrousd: number | null = null;

  constructor(private readonly options: {
    run: string; providerCapMicrousd: number; customerCapMicrousd: number | null; gate: SpendGate;
    /** Epoch ms by which every call must have ended (platform limit or hold lifetime). */
    deadline: number;
    /** No call starts with less time than this left (default 30 s). */
    minCallMs?: number; now?: () => number; id?: () => string;
  }) {
    if (!(options.providerCapMicrousd >= 0) || (options.customerCapMicrousd !== null && !(options.customerCapMicrousd >= 0))) throw new Error("Invalid run spending caps.");
    this.now = options.now ?? Date.now;
    this.id = options.id ?? randomUUID;
  }

  get run() { return this.options.run; }
  get deadline() { return this.options.deadline; }
  /** Time a call may still run: providers are given this as a hard timeout. */
  timeLeftMs() { return Math.max(0, this.options.deadline - this.now()); }
  get allowanceMicrousd() { return Math.min(this.options.providerCapMicrousd, this.options.customerCapMicrousd ?? Infinity, this.attemptCapMicrousd ?? Infinity); }
  /** The run's full allowance, ignoring a routed attempt's temporary cap. */
  get runAllowanceMicrousd() { return Math.min(this.options.providerCapMicrousd, this.options.customerCapMicrousd ?? Infinity); }
  get remainingMicrousd() { return Math.max(0, this.allowanceMicrousd - this.confirmedMicrousd - this.uncertainMicrousd - this.pendingMicrousd); }
  /** What a new call's worst case may be: the allowance plus the cache-miss margin, less everything spent and every open call's worst case. */
  get worstCaseRoomMicrousd() {
    return Math.max(0, this.allowanceMicrousd + Math.floor(this.allowanceMicrousd * CACHE_MISS_MARGIN) - this.confirmedMicrousd - this.uncertainMicrousd - this.pendingWorstMicrousd);
  }
  /** Provider dollars this run has incurred or may have incurred. */
  get providerMicrousd() { return this.confirmedMicrousd + this.uncertainMicrousd; }
  /** What settlement may charge the customer: confirmed cost minus what the platform absorbs. */
  get chargeableMicrousd() { return Math.max(0, this.confirmedMicrousd - this.absorbedMicrousd); }

  /** Lowers the allowance for one routed attempt to `capMicrousd` (total run spend, not per attempt); null lifts it. */
  capAttempt(capMicrousd: number | null) {
    if (capMicrousd !== null && !(capMicrousd >= 0)) throw new Error("Invalid attempt cap.");
    this.attemptCapMicrousd = capMicrousd;
  }
  /** Marks confirmed cost as absorbed by the platform (never more than is confirmed). */
  absorb(microusd: number) {
    if (!(microusd >= 0)) throw new Error("Invalid absorbed amount.");
    this.absorbedMicrousd = Math.min(this.confirmedMicrousd, this.absorbedMicrousd + Math.ceil(microusd));
  }

  cancel() { this.stopped = "CANCELLED"; }
  /** A call produced more than its bound allowed (e.g. image output tokens): no further calls in this run. */
  markOverrun() { if (this.stopped !== "CANCELLED") this.stopped = "OVERRUN"; }
  /** A durably renewed lease (operation heartbeat) may move the deadline later, never earlier. */
  extendDeadline(epochMs: number) { if (Number.isFinite(epochMs) && epochMs > this.options.deadline) this.options.deadline = epochMs; }

  /** boundMicrousd is reserved against the run's allowance. worstCaseMicrousd (default: the bound) is what the call can
   * cost if the provider drops the cache the bound counted on; it is what the database gate reserves and polices. */
  async begin(provider: ProviderName, model: string, boundMicrousd: number, options: { worstCaseMicrousd?: number } = {}): Promise<CallTicket> {
    if (this.stopped === "CANCELLED") throw new SpendError("CANCELLED", "This request was stopped.");
    if (!Number.isSafeInteger(boundMicrousd) || boundMicrousd <= 0) throw new Error("A call needs a positive integer bound.");
    const worstCaseMicrousd = options.worstCaseMicrousd ?? boundMicrousd;
    if (!Number.isSafeInteger(worstCaseMicrousd) || worstCaseMicrousd < boundMicrousd) throw new Error("A call's worst case must be an integer no lower than its bound.");
    if (this.stopped === "OVERRUN") throw new SpendError("OVERRUN", "A call cost more than its bound; this run makes no further calls.");
    if (this.timeLeftMs() < (this.options.minCallMs ?? 30_000)) { this.stopped = "HOLD_EXPIRED"; throw new SpendError("HOLD_EXPIRED", "The run's time or credit hold is over; no further calls."); }
    if (boundMicrousd > this.remainingMicrousd) throw new SpendError("RUN_BUDGET", "This call's worst-case cost exceeds what the run has left.");
    if (worstCaseMicrousd > this.worstCaseRoomMicrousd) throw new SpendError("RUN_BUDGET", "This call's cost without the prompt cache exceeds what the run may spend.");
    const ticket: CallTicket = { id: this.id(), provider, model, boundMicrousd, worstCaseMicrousd, open: true };
    this.pendingMicrousd += boundMicrousd;
    this.pendingWorstMicrousd += worstCaseMicrousd;
    try {
      await this.options.gate.begin({ id: ticket.id, run: this.options.run, provider, model, boundMicrousd: worstCaseMicrousd });
    } catch (error) {
      this.pendingMicrousd -= boundMicrousd;
      this.pendingWorstMicrousd -= worstCaseMicrousd;
      if (error instanceof SpendError && error.code === "CANCELLED") this.cancel();
      throw error;
    }
    return ticket;
  }

  /** Records a call once. actual = known billed cost; null = unknown (partial is the confirmed part). usage: the tokens
   * the provider reported, complete or partial, kept on the call record and in the gate's detail. */
  async finish(ticket: CallTicket, outcome: { actualMicrousd: number | null; partialMicrousd?: number; detail?: Record<string, unknown>; usage?: TokenUsage | null }) {
    if (!ticket.open) return;
    ticket.open = false;
    this.pendingMicrousd -= ticket.boundMicrousd;
    this.pendingWorstMicrousd -= ticket.worstCaseMicrousd;
    const partial = Math.max(0, Math.ceil(outcome.partialMicrousd ?? 0));
    let overrun = false, cacheMiss = false;
    if (outcome.actualMicrousd !== null) {
      const actual = Math.max(0, Math.ceil(outcome.actualMicrousd));
      this.confirmedMicrousd += actual;
      overrun = actual > ticket.worstCaseMicrousd;
      // Above the cache-priced reservation but within the worst case: the provider did not serve the cache it reported.
      cacheMiss = !overrun && actual > ticket.boundMicrousd;
      if (overrun) this.stopped = "OVERRUN";
    } else {
      this.confirmedMicrousd += Math.min(partial, ticket.worstCaseMicrousd);
      this.uncertainMicrousd += Math.max(0, ticket.worstCaseMicrousd - partial);
    }
    const usage = outcome.usage ?? null;
    this.calls.push({ id: ticket.id, provider: ticket.provider, model: ticket.model, boundMicrousd: ticket.boundMicrousd, worstCaseMicrousd: ticket.worstCaseMicrousd,
      actualMicrousd: outcome.actualMicrousd === null ? null : Math.ceil(outcome.actualMicrousd), partialMicrousd: partial, overrun, cacheMiss, usage });
    const extra = { ...(usage ? { usage } : {}), ...(ticket.worstCaseMicrousd > ticket.boundMicrousd ? { reservedMicrousd: ticket.boundMicrousd } : {}), ...(cacheMiss ? { cacheMiss } : {}) };
    await this.options.gate.finish(ticket.id, { actualMicrousd: outcome.actualMicrousd === null ? null : Math.ceil(outcome.actualMicrousd), partialMicrousd: partial,
      detail: Object.keys(extra).length ? { ...outcome.detail, ...extra } : outcome.detail });
  }

  /** Tokens per model over this run's calls (failed calls with what they reported), for the run's durable record. */
  usageByModel(): Record<string, ModelUsage> {
    const totals: Record<string, ModelUsage> = {};
    for (const call of this.calls) {
      const row = totals[call.model] ?? { ...NO_TOKENS, calls: 0, cacheMisses: 0 };
      totals[call.model] = { ...addTokens(row, call.usage ?? NO_TOKENS), calls: row.calls + 1, cacheMisses: row.cacheMisses + (call.cacheMiss ? 1 : 0) };
    }
    return totals;
  }

  /** Customer-chargeable usage in credits: confirmed cost (less any absorbed attempt) only, rounded up. */
  customerCredits(usdPerCredit: number) {
    return Math.max(0, Math.ceil(this.chargeableMicrousd / 1e6 / usdPerCredit - 1e-9));
  }
}

/** A gate with no platform limits, for offline harnesses only. */
export function memoryGate(): SpendGate & { log: { begin: unknown[]; finish: unknown[] } } {
  const log = { begin: [] as unknown[], finish: [] as unknown[] };
  return {
    log,
    async begin(call) { log.begin.push(call); },
    async finish(id, outcome) { log.finish.push({ id, ...outcome }); },
  };
}

import { randomUUID } from "node:crypto";

/**
 * Per-run spending for the live builder. Two independent limits apply:
 * - provider dollars (`providerCapMicrousd`): what this run may spend at the
 *   providers, from the effort ceiling. Applies to everyone, admins included.
 * - customer credits (`customerCapMicrousd`): the credits held for the run,
 *   in provider dollars. Absent for exempt (unlimited) accounts.
 * Every call reserves its conservative bound before it starts; retries and
 * fallbacks draw on the same remaining amount. A call whose usage is unknown
 * counts at its full bound against both limits and in provider spend, but only
 * its confirmed part is chargeable to the customer.
 * The database gate adds platform-wide daily provider limits on top.
 */
export type ProviderName = "anthropic" | "openai";

export type SpendGate = {
  begin(call: { id: string; run: string; provider: ProviderName; model: string; boundMicrousd: number }): Promise<void>;
  /** actualMicrousd null: usage unknown, the bound is recorded as spent. */
  finish(id: string, outcome: { actualMicrousd: number | null; partialMicrousd: number; detail?: Record<string, unknown> }): Promise<void>;
};

export type SpendStop = "RUN_BUDGET" | "HOLD_EXPIRED" | "OVERRUN" | "CANCELLED";
export class SpendError extends Error {
  constructor(readonly code: SpendStop | "PROVIDER_LIMIT" | "PROVIDER_DISABLED" | "SPEND_UNAVAILABLE", message: string) { super(message); }
  /** Stops that end a run gracefully (keep finished work) rather than failing it. */
  get graceful() { return this.code === "RUN_BUDGET" || this.code === "HOLD_EXPIRED"; }
}

export type CallTicket = { id: string; provider: ProviderName; model: string; boundMicrousd: number; open: boolean };
export type CallRecord = { id: string; provider: ProviderName; model: string; boundMicrousd: number; actualMicrousd: number | null; partialMicrousd: number; overrun: boolean };

export class RunSpend {
  confirmedMicrousd = 0;
  uncertainMicrousd = 0;
  pendingMicrousd = 0;
  stopped: SpendStop | null = null;
  readonly calls: CallRecord[] = [];
  private readonly now: () => number;
  private readonly id: () => string;

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
  get allowanceMicrousd() { return Math.min(this.options.providerCapMicrousd, this.options.customerCapMicrousd ?? Infinity); }
  get remainingMicrousd() { return Math.max(0, this.allowanceMicrousd - this.confirmedMicrousd - this.uncertainMicrousd - this.pendingMicrousd); }
  /** Provider dollars this run has incurred or may have incurred. */
  get providerMicrousd() { return this.confirmedMicrousd + this.uncertainMicrousd; }

  cancel() { this.stopped = "CANCELLED"; }
  /** A call produced more than its bound allowed (e.g. image output tokens): no further calls in this run. */
  markOverrun() { if (this.stopped !== "CANCELLED") this.stopped = "OVERRUN"; }
  /** A durably renewed lease (operation heartbeat) may move the deadline later, never earlier. */
  extendDeadline(epochMs: number) { if (Number.isFinite(epochMs) && epochMs > this.options.deadline) this.options.deadline = epochMs; }

  async begin(provider: ProviderName, model: string, boundMicrousd: number): Promise<CallTicket> {
    if (this.stopped === "CANCELLED") throw new SpendError("CANCELLED", "This request was stopped.");
    if (!Number.isSafeInteger(boundMicrousd) || boundMicrousd <= 0) throw new Error("A call needs a positive integer bound.");
    if (this.stopped === "OVERRUN") throw new SpendError("OVERRUN", "A call cost more than its bound; this run makes no further calls.");
    if (this.timeLeftMs() < (this.options.minCallMs ?? 30_000)) { this.stopped = "HOLD_EXPIRED"; throw new SpendError("HOLD_EXPIRED", "The run's time or credit hold is over; no further calls."); }
    if (boundMicrousd > this.remainingMicrousd) throw new SpendError("RUN_BUDGET", "This call's worst-case cost exceeds what the run has left.");
    const ticket: CallTicket = { id: this.id(), provider, model, boundMicrousd, open: true };
    this.pendingMicrousd += boundMicrousd;
    try {
      await this.options.gate.begin({ id: ticket.id, run: this.options.run, provider, model, boundMicrousd });
    } catch (error) {
      this.pendingMicrousd -= boundMicrousd;
      if (error instanceof SpendError && error.code === "CANCELLED") this.cancel();
      throw error;
    }
    return ticket;
  }

  /** Records a call once. actual = known billed cost; null = unknown (partial is the confirmed part). */
  async finish(ticket: CallTicket, outcome: { actualMicrousd: number | null; partialMicrousd?: number; detail?: Record<string, unknown> }) {
    if (!ticket.open) return;
    ticket.open = false;
    this.pendingMicrousd -= ticket.boundMicrousd;
    const partial = Math.max(0, Math.ceil(outcome.partialMicrousd ?? 0));
    let overrun = false;
    if (outcome.actualMicrousd !== null) {
      const actual = Math.max(0, Math.ceil(outcome.actualMicrousd));
      this.confirmedMicrousd += actual;
      overrun = actual > ticket.boundMicrousd;
      if (overrun) this.stopped = "OVERRUN";
    } else {
      this.confirmedMicrousd += Math.min(partial, ticket.boundMicrousd);
      this.uncertainMicrousd += Math.max(0, ticket.boundMicrousd - partial);
    }
    this.calls.push({ id: ticket.id, provider: ticket.provider, model: ticket.model, boundMicrousd: ticket.boundMicrousd,
      actualMicrousd: outcome.actualMicrousd === null ? null : Math.ceil(outcome.actualMicrousd), partialMicrousd: partial, overrun });
    await this.options.gate.finish(ticket.id, { actualMicrousd: outcome.actualMicrousd === null ? null : Math.ceil(outcome.actualMicrousd), partialMicrousd: partial, detail: outcome.detail });
  }

  /** Customer-chargeable usage in credits: confirmed cost only, rounded up. */
  customerCredits(usdPerCredit: number) {
    return Math.max(0, Math.ceil(this.confirmedMicrousd / 1e6 / usdPerCredit - 1e-9));
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

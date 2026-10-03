import {
  AttemptSchema, BudgetAccountSchema, ExactAmountSchema, ExecutionSchema, JobSchema,
  LedgerEntrySchema, QuoteSchema, ReservationSchema,
  type BudgetAccount, type DispatchAuthority, type JobExecution, type JobQuote,
} from "./contracts";

const amount = (value: bigint) => ExactAmountSchema.parse(value.toString());
const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value), BigInt(0));
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function timestamp(value: string) { const number = Date.parse(value); assert(Number.isFinite(number), "A valid timestamp is required."); return number; }
function sameScope(first: { workspaceId: string; projectId: string; artifactId: string | null }, second: typeof first) { return first.workspaceId === second.workspaceId && first.projectId === second.projectId && first.artifactId === second.artifactId; }
function copy(input: JobExecution) { return structuredClone(ExecutionSchema.parse(input)); }
function finish(value: JobExecution, now: string) { value.job.revision++; value.job.updatedAt = now; return ExecutionSchema.parse(value); }
function live(state: JobExecution, now: string) { assert(timestamp(now) < timestamp(state.job.deadlineAt), "Job deadline has passed; reconcile already-dispatched work without another dispatch."); }
function authority(value: DispatchAuthority) { assert(value.workspaceAuthorized && value.sourceProcessingAllowed && value.routeAllowed && value.spendingAuthorized, "Dispatch authorisation is missing or was revoked."); }
function uncertain(state: JobExecution) { return state.attempts.some((attempt) => attempt.chargeState === "unknown"); }
function fenced(state: JobExecution, holder: string, fence: number, now: string) { const lease = state.job.lease; assert(lease && lease.holder === holder && lease.fence === fence && timestamp(lease.expiresAt) > timestamp(now), "Worker lease is absent, stale or expired."); }

export function createJob(input: Omit<JobExecution["job"], "status" | "stage" | "revision" | "quoteId" | "reservationId" | "cancelRequestedAt" | "fence" | "lease" | "acceptedAssetIds" | "errorCode">): JobExecution {
  return ExecutionSchema.parse({ job: JobSchema.parse({ ...input, status: "proposed", stage: "proposed", revision: 0, quoteId: null, reservationId: null, cancelRequestedAt: null, fence: 0, lease: null, acceptedAssetIds: [], errorCode: null }), quote: null, reservation: null, attempts: [], ledger: [] });
}

export function quoteJob(input: JobExecution, quoteInput: JobQuote, now: string): JobExecution {
  const state = copy(input); const quote = QuoteSchema.parse(quoteInput); live(state, now);
  assert(["proposed", "quoted"].includes(state.job.status), "Reserved or approved work cannot silently change quote.");
  assert(sameScope(state.job.scope, quote.scope) && quote.inputHash === state.job.inputHash && quote.baseVersionId === state.job.baseVersionId && quote.routeVersion === state.job.routeVersion, "Quote does not match the scoped job.");
  assert(!quote.approvedBy && !quote.approvedAt && timestamp(quote.expiresAt) > timestamp(now), "Draft quote must be unapproved and current.");
  if (state.quote?.id === quote.id) { assert(JSON.stringify(state.quote) === JSON.stringify(quote), "Quote replay differs."); return state; }
  state.quote = quote; state.job.quoteId = quote.id; state.job.status = "quoted"; state.job.stage = "awaiting_quote_approval";
  return finish(state, now);
}

export function approveQuote(input: JobExecution, quoteInput: JobQuote, now: string): JobExecution {
  const state = copy(input); const quote = QuoteSchema.parse(quoteInput); live(state, now);
  assert(["proposed", "quoted", "approved"].includes(state.job.status), "A new quote cannot silently replace reserved or dispatched work.");
  assert(sameScope(state.job.scope, quote.scope), "Quote belongs to another workspace/project/artifact.");
  assert(quote.inputHash === state.job.inputHash && quote.baseVersionId === state.job.baseVersionId && quote.routeVersion === state.job.routeVersion, "Quote no longer matches the job inputs, base version or route.");
  assert(quote.approvedBy && quote.approvedAt && timestamp(quote.approvedAt) <= timestamp(now) && timestamp(quote.expiresAt) > timestamp(now), "Quote needs current scoped approval.");
  if (state.quote?.id === quote.id) {
    if (state.job.status === "quoted") assert(JSON.stringify({ ...state.quote, approvedBy: quote.approvedBy, approvedAt: quote.approvedAt }) === JSON.stringify(quote), "Approval changed the quote's scope or price.");
    else { assert(JSON.stringify(state.quote) === JSON.stringify(quote), "Replayed quote ID has different content."); return state; }
  }
  state.quote = quote; state.job.quoteId = quote.id; state.job.status = "approved"; state.job.stage = "approved";
  return finish(state, now);
}

/** Caller must atomically persist both results with their expected revisions. */
export function reserveJob(input: JobExecution, accountInput: BudgetAccount, reservationId: string, authorized: DispatchAuthority, now: string) {
  const state = copy(input); const account = BudgetAccountSchema.parse(accountInput);
  assert(account.workspaceId === state.job.scope.workspaceId, "Budget belongs to another workspace.");
  if (state.reservation) { assert(state.reservation.id === reservationId && state.reservation.status === "reserved", "Reservation replay conflicts with existing reservation."); return { execution: state, account, expectedAccountRevision: account.revision, expectedJobRevision: state.job.revision, changed: false }; }
  authority(authorized); live(state, now);
  assert(state.job.status === "approved" && state.quote, "Approve a matching quote before reservation.");
  assert(account.workspaceId === state.job.scope.workspaceId, "Budget belongs to another workspace.");
  assert(account.spendingEnabled && !account.emergencyStop, "Spending is disabled or emergency stop is active.");
  assert(account.activeJobs < account.concurrencyLimit, "Workspace concurrency limit reached.");
  assert(timestamp(state.quote.expiresAt) > timestamp(now), "Quote has expired.");
  assert(BigInt(account.vendorSpentMicrousd) + BigInt(account.vendorReservedMicrousd) + BigInt(state.quote.maximumVendorMicrousd) <= BigInt(account.vendorLimitMicrousd), "Vendor budget is insufficient.");
  assert(BigInt(account.customerSpentCredits) + BigInt(account.customerReservedCredits) + BigInt(state.quote.customerCredits) <= BigInt(account.customerLimitCredits), "Customer allowance is insufficient.");
  const expectedAccountRevision = account.revision; const expectedJobRevision = state.job.revision;
  state.reservation = ReservationSchema.parse({ id: reservationId, scope: state.job.scope, jobId: state.job.id, quoteId: state.quote.id, vendorMicrousd: state.quote.maximumVendorMicrousd, customerCredits: state.quote.customerCredits, status: "reserved", createdAt: now, updatedAt: now });
  state.job.reservationId = reservationId; state.job.status = "reserved"; state.job.stage = "reserved";
  account.vendorReservedMicrousd = amount(BigInt(account.vendorReservedMicrousd) + BigInt(state.reservation.vendorMicrousd));
  account.customerReservedCredits = amount(BigInt(account.customerReservedCredits) + BigInt(state.reservation.customerCredits));
  account.activeJobs++; account.revision++;
  return { execution: finish(state, now), account: BudgetAccountSchema.parse(account), expectedAccountRevision, expectedJobRevision, changed: true };
}

export function enqueueJob(input: JobExecution, now: string) {
  const state = copy(input); live(state, now);
  if (state.job.status === "queued") return state;
  assert(state.job.status === "reserved", "Queue dispatch needs a reservation.");
  state.job.status = "queued"; state.job.stage = "queued"; return finish(state, now);
}

/** Lease/fence must be obtained through compare-and-swap in durable storage. */
export function acquireLease(input: JobExecution, holder: string, now: string, expiresAt: string) {
  const state = copy(input); live(state, now);
  assert(["queued", "running", "partial"].includes(state.job.status) && !state.job.cancelRequestedAt, "This job cannot start or resume dispatch.");
  assert(!uncertain(state), "Uncertain external attempts require reconciliation, not queue retry.");
  assert(timestamp(expiresAt) > timestamp(now) && timestamp(expiresAt) <= timestamp(state.job.deadlineAt), "Lease expiry must fall inside the job deadline.");
  if (state.job.lease && timestamp(state.job.lease.expiresAt) > timestamp(now)) { assert(state.job.lease.holder === holder, "Another worker holds the lease."); return state; }
  state.job.fence++; state.job.lease = { holder, fence: state.job.fence, expiresAt }; state.job.status = "running"; state.job.stage = "preparing";
  return finish(state, now);
}

export function prepareAttempt(input: JobExecution, attemptId: string, requestHash: string, maximumVendorMicrousd: string, holder: string, fence: number, authorized: DispatchAuthority, now: string) {
  const state = copy(input); authority(authorized); live(state, now); fenced(state, holder, fence, now);
  const prior = state.attempts.find((attempt) => attempt.id === attemptId);
  if (prior) { assert(prior.maximumVendorMicrousd === maximumVendorMicrousd && prior.requestHash === requestHash, "Attempt replay changed its spend bound or request."); return state; }
  assert(state.job.status === "running" && state.quote && state.reservation?.status === "reserved" && !state.job.cancelRequestedAt, "Job is not dispatchable.");
  assert(!uncertain(state) && !state.attempts.some((attempt) => attempt.state === "prepared"), "Another attempt needs completion or reconciliation first.");
  assert(state.attempts.length < state.job.maxAttempts, "Attempt bound reached.");
  const previous = state.attempts.at(-1);
  if (previous?.state === "failed") assert(previous.failureClass === "transient" || (previous.failureClass === "quality" && state.quote.repairPolicy === "included_within_bound"), "Deterministic/policy failures must not retry unchanged or route around the refusal.");
  const bound = ExactAmountSchema.parse(maximumVendorMicrousd);
  const incurred = sum(state.attempts.map((attempt) => attempt.actualVendorMicrousd ?? "0"));
  assert(incurred + BigInt(bound) <= BigInt(state.reservation.vendorMicrousd), "Attempt and repair exceed the approved vendor reservation; a new quote is required.");
  state.attempts.push(AttemptSchema.parse({ id: attemptId, scope: state.job.scope, jobId: state.job.id, sequence: state.attempts.length + 1, inputHash: state.job.inputHash, requestHash, baseVersionId: state.job.baseVersionId, routeVersion: state.job.routeVersion, provider: state.quote.provider, model: state.quote.model, state: "prepared", chargeState: "not_dispatched", providerRequestId: null, maximumVendorMicrousd: bound, actualVendorMicrousd: null, usageEvidenceId: null, failureClass: null, assetIds: [], createdAt: now, dispatchedAt: null, resolvedAt: null, fence }));
  state.job.stage = "prepared"; return finish(state, now);
}

/** Persist dispatch intent BEFORE making the external call. Replay must not call again. */
export function markDispatchIntent(input: JobExecution, attemptId: string, accountInput: BudgetAccount, holder: string, fence: number, authorized: DispatchAuthority, now: string) {
  const state = copy(input); const attempt = state.attempts.find((item) => item.id === attemptId); assert(attempt, "Attempt not found.");
  if (attempt.state !== "prepared") return { execution: state, shouldDispatch: false };
  authority(authorized); live(state, now); fenced(state, holder, fence, now);
  const account = BudgetAccountSchema.parse(accountInput); assert(account.workspaceId === state.job.scope.workspaceId && account.spendingEnabled && !account.emergencyStop, "Current budget policy blocks dispatch.");
  assert(!state.job.cancelRequestedAt && state.job.status === "running" && attempt.fence === fence, "Cancellation or a stale worker prevents dispatch.");
  assert(state.quote && timestamp(state.quote.expiresAt) > timestamp(now), "Current quote has expired.");
  assert(!uncertain(state), "Unknown provider cost prevents another dispatch.");
  attempt.state = "dispatching"; attempt.chargeState = "unknown"; attempt.dispatchedAt = now; state.job.stage = "provider_dispatch";
  return { execution: finish(state, now), shouldDispatch: true };
}

export function markAttemptUncertain(input: JobExecution, attemptId: string, now: string) {
  const state = copy(input); const attempt = state.attempts.find((item) => item.id === attemptId); assert(attempt, "Attempt not found.");
  if (attempt.state === "uncertain") return state;
  assert(attempt.state === "dispatching" && state.reservation, "Only a dispatched attempt can have uncertain external outcome.");
  attempt.state = "uncertain"; attempt.failureClass = "unknown"; state.reservation.status = "uncertain"; state.reservation.updatedAt = now;
  state.job.status = "awaiting_reconciliation"; state.job.stage = "provider_outcome_unknown"; state.job.lease = null;
  return finish(state, now);
}

export type ConfirmedOutcome = { succeeded: boolean; providerRequestId: string | null; actualVendorMicrousd: string; evidenceId: string; ledgerId: string; assetIds: string[]; failureClass: "transient" | "invalid_input" | "policy" | "quality" | "cancelled" | null };
/** External outcomes must be supported by actual adapter/reconciliation evidence. */
export function confirmAttemptOutcome(input: JobExecution, attemptId: string, outcome: ConfirmedOutcome, now: string) {
  const state = copy(input); const attempt = state.attempts.find((item) => item.id === attemptId); assert(attempt, "Attempt not found.");
  const cost = ExactAmountSchema.parse(outcome.actualVendorMicrousd);
  if (attempt.chargeState === "confirmed") { assert(attempt.actualVendorMicrousd === cost && attempt.usageEvidenceId === outcome.evidenceId && attempt.state === (outcome.succeeded ? "succeeded" : "failed") && attempt.providerRequestId === outcome.providerRequestId && attempt.failureClass === outcome.failureClass && JSON.stringify(attempt.assetIds) === JSON.stringify(outcome.assetIds), "Outcome replay conflicts with the confirmed attempt."); return state; }
  assert(attempt.state === "dispatching" || attempt.state === "uncertain", "Confirm only dispatched or uncertain attempts.");
  assert(outcome.succeeded ? outcome.failureClass === null : outcome.failureClass !== null, "Failure classification must match the outcome.");
  attempt.state = outcome.succeeded ? "succeeded" : "failed"; attempt.chargeState = "confirmed"; attempt.actualVendorMicrousd = cost; attempt.usageEvidenceId = outcome.evidenceId; attempt.providerRequestId = outcome.providerRequestId; attempt.assetIds = outcome.assetIds; attempt.failureClass = outcome.failureClass; attempt.resolvedAt = now;
  state.ledger.push(LedgerEntrySchema.parse({ id: outcome.ledgerId, scope: state.job.scope, jobId: state.job.id, attemptId, eventKey: `provider-cost:${attemptId}`, account: "vendor_microusd", direction: "debit", amount: cost, reason: "provider_cost", evidenceId: outcome.evidenceId, createdAt: now }));
  assert(state.reservation, "Dispatched work must retain its reservation."); state.reservation.status = uncertain(state) ? "uncertain" : "reserved"; state.reservation.updatedAt = now;
  state.job.status = uncertain(state) ? "awaiting_reconciliation" : state.job.cancelRequestedAt ? "cancellation_requested" : outcome.succeeded ? "reviewing" : "partial";
  state.job.stage = outcome.succeeded ? "output_review" : "attempt_failed";
  if (sum(state.attempts.map((item) => item.actualVendorMicrousd ?? "0")) > BigInt(state.reservation.vendorMicrousd)) { state.job.errorCode = "vendor_cost_overrun"; state.job.stage = "cost_overrun_review"; }
  // Incurred cost overruns remain visible; never hide costs or increase customer quote.
  return finish(state, now);
}

export function requestCancellation(input: JobExecution, now: string) {
  const state = copy(input);
  if (state.job.cancelRequestedAt || ["cancelled", "ready", "failed", "reconciled"].includes(state.job.status)) return state;
  state.job.cancelRequestedAt = now; state.job.lease = null;
  for (const attempt of state.attempts) if (attempt.state === "prepared") { attempt.state = "failed"; attempt.failureClass = "cancelled"; attempt.resolvedAt = now; }
  state.job.status = uncertain(state) ? "awaiting_reconciliation" : "cancellation_requested"; state.job.stage = uncertain(state) ? "cancellation_waiting_for_provider" : "cancellation_requested";
  return finish(state, now);
}

/** Reservation release is not a refund. Persist account, job and ledger atomically. */
export function settleExecution(input: JobExecution, accountInput: BudgetAccount, accepted: boolean, acceptedAssetIds: string[], evidenceId: string, customerLedgerId: string, now: string) {
  const state = copy(input); const account = BudgetAccountSchema.parse(accountInput);
  assert(state.reservation && state.quote, "No reservation to settle.");
  if (["settled", "released"].includes(state.reservation.status)) return { execution: state, account, changed: false, expectedAccountRevision: account.revision, expectedJobRevision: state.job.revision };
  assert(account.workspaceId === state.job.scope.workspaceId, "Budget belongs to another workspace.");
  assert(!uncertain(state) && !state.attempts.some((attempt) => attempt.state === "prepared"), "Do not release an unknown charge or prepared attempt.");
  assert(!accepted || (!state.job.cancelRequestedAt && state.attempts.some((attempt) => attempt.state === "succeeded")), "Acceptance needs completed work and no cancellation request.");
  const availableAssets = new Set(state.attempts.filter((attempt) => attempt.state === "succeeded").flatMap((attempt) => attempt.assetIds));
  assert(!accepted || acceptedAssetIds.every((id) => availableAssets.has(id)), "Accepted assets must belong to actual succeeded attempts.");
  const expectedAccountRevision = account.revision; const expectedJobRevision = state.job.revision;
  const vendorCost = sum(state.attempts.map((attempt) => attempt.actualVendorMicrousd ?? "0"));
  account.vendorSpentMicrousd = amount(BigInt(account.vendorSpentMicrousd) + vendorCost);
  account.vendorReservedMicrousd = amount(BigInt(account.vendorReservedMicrousd) - BigInt(state.reservation.vendorMicrousd));
  account.customerReservedCredits = amount(BigInt(account.customerReservedCredits) - BigInt(state.reservation.customerCredits));
  assert(account.activeJobs > 0, "Budget has no active reservation to settle."); account.activeJobs--; account.revision++;
  if (accepted) {
    account.customerSpentCredits = amount(BigInt(account.customerSpentCredits) + BigInt(state.reservation.customerCredits));
    state.ledger.push(LedgerEntrySchema.parse({ id: customerLedgerId, scope: state.job.scope, jobId: state.job.id, attemptId: null, eventKey: `accepted-work:${state.job.id}`, account: "customer_credits", direction: "debit", amount: state.reservation.customerCredits, reason: "accepted_work", evidenceId, createdAt: now }));
  }
  state.reservation.status = accepted || vendorCost > BigInt(0) ? "settled" : "released"; state.reservation.updatedAt = now;
  state.job.status = accepted ? "ready" : state.job.cancelRequestedAt ? "cancelled" : "failed"; state.job.stage = state.job.status; state.job.acceptedAssetIds = accepted ? acceptedAssetIds : state.job.acceptedAssetIds; state.job.lease = null;
  return { execution: finish(state, now), account: BudgetAccountSchema.parse(account), expectedAccountRevision, expectedJobRevision, changed: true };
}

/** Append-only credit adjustment: cancellation by itself never creates this entry. */
export function appendCreditAdjustment(input: JobExecution, entryInput: JobExecution["ledger"][number], now: string) {
  const state = copy(input); const entry = LedgerEntrySchema.parse(entryInput);
  assert(entry.direction === "credit" && ["provider_credit", "customer_refund", "customer_adjustment"].includes(entry.reason), "Use a supported credit adjustment with evidence.");
  assert(entry.reason === "provider_credit" ? entry.account === "vendor_microusd" : entry.account === "customer_credits", "Provider and customer adjustments belong to distinct ledgers.");
  assert(sameScope(entry.scope, state.job.scope) && entry.jobId === state.job.id, "Adjustment belongs to another scope.");
  const prior = state.ledger.find((item) => item.eventKey === entry.eventKey);
  if (prior) { assert(JSON.stringify(prior) === JSON.stringify(entry), "Ledger replay changed the adjustment."); return state; }
  // Account updates require an authorised transaction adapter; never infer a refund.
  state.ledger.push(entry); return finish(state, now);
}

/** Preserve reviewed stage outputs before another bounded stage dispatch. */
export function continueAfterReview(input: JobExecution, assetIds: string[], nextStage: string, now: string) {
  const state = copy(input); live(state, now);
  assert(state.job.status === "reviewing" && !state.job.cancelRequestedAt && !uncertain(state), "Only completed review can advance the job.");
  const produced = new Set(state.attempts.filter((attempt) => attempt.state === "succeeded").flatMap((attempt) => attempt.assetIds));
  assert(assetIds.every((id) => produced.has(id)), "Reviewed assets must come from this job's actual outputs.");
  state.job.acceptedAssetIds = [...new Set([...state.job.acceptedAssetIds, ...assetIds])];
  state.job.status = "queued"; state.job.stage = nextStage; state.job.lease = null;
  return finish(state, now);
}


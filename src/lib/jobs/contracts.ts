import { z } from "zod";

const uuid = z.string().uuid();
const time = z.string().datetime();
const key = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** JSON-safe exact integer accounting; never parse money through Number. */
export const ExactAmountSchema = z.string().max(19).regex(/^(0|[1-9][0-9]*)$/).refine(
  (value) => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= BigInt("9223372036854775807"),
  "Amount exceeds signed database bigint range.",
);
export const ScopeSchema = z.object({ workspaceId: uuid, projectId: uuid, artifactId: uuid.nullable() }).strict();
export type JobScope = z.infer<typeof ScopeSchema>;
export const QuoteSchema = z.object({
  id: uuid, scope: ScopeSchema, version: z.number().int().positive(), inputHash: hash,
  baseVersionId: uuid.nullable(), routeVersion: key,
  provider: key, model: key, maximumVendorMicrousd: ExactAmountSchema,
  customerCredits: ExactAmountSchema, repairPolicy: z.enum(["included_within_bound", "new_quote_required"]),
  approvedBy: uuid.nullable(), approvedAt: time.nullable(), expiresAt: time,
}).strict();
export type JobQuote = z.infer<typeof QuoteSchema>;
export const BudgetAccountSchema = z.object({
  workspaceId: uuid, revision: z.number().int().nonnegative(),
  spendingEnabled: z.boolean().default(false), emergencyStop: z.boolean().default(false),
  vendorLimitMicrousd: ExactAmountSchema, vendorSpentMicrousd: ExactAmountSchema, vendorReservedMicrousd: ExactAmountSchema,
  customerLimitCredits: ExactAmountSchema, customerSpentCredits: ExactAmountSchema, customerReservedCredits: ExactAmountSchema,
  activeJobs: z.number().int().nonnegative(), concurrencyLimit: z.number().int().positive().max(100),
}).strict();
export type BudgetAccount = z.infer<typeof BudgetAccountSchema>;
export const JobSchema = z.object({
  id: uuid, scope: ScopeSchema, kind: z.enum(["website", "book", "presentation", "research", "media"]),
  idempotencyKey: key, inputHash: hash, baseVersionId: uuid.nullable(), routeVersion: key,
  status: z.enum(["proposed", "quoted", "approved", "reserved", "queued", "running", "reviewing", "ready", "partial", "failed", "cancellation_requested", "cancelled", "awaiting_reconciliation", "reconciled"]),
  stage: key, revision: z.number().int().nonnegative(), quoteId: uuid.nullable(), reservationId: uuid.nullable(),
  deadlineAt: time, maxAttempts: z.number().int().min(1).max(10), createdAt: time, updatedAt: time,
  cancelRequestedAt: time.nullable(), fence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lease: z.object({ holder: uuid, fence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), expiresAt: time }).strict().nullable(),
  acceptedAssetIds: z.array(uuid).max(1000).default([]), errorCode: key.nullable(),
}).strict();
export type DurableJob = z.infer<typeof JobSchema>;
export const ReservationSchema = z.object({
  id: uuid, scope: ScopeSchema, jobId: uuid, quoteId: uuid,
  vendorMicrousd: ExactAmountSchema, customerCredits: ExactAmountSchema,
  status: z.enum(["reserved", "uncertain", "settled", "released"]),
  createdAt: time, updatedAt: time,
}).strict();
export type JobReservation = z.infer<typeof ReservationSchema>;
export const AttemptSchema = z.object({
  id: uuid, scope: ScopeSchema, jobId: uuid, sequence: z.number().int().positive(),
  inputHash: hash, requestHash: hash, baseVersionId: uuid.nullable(), routeVersion: key, provider: key, model: key,
  state: z.enum(["prepared", "dispatching", "succeeded", "failed", "uncertain"]),
  chargeState: z.enum(["not_dispatched", "unknown", "confirmed"]),
  providerRequestId: key.nullable(), maximumVendorMicrousd: ExactAmountSchema,
  actualVendorMicrousd: ExactAmountSchema.nullable(), usageEvidenceId: uuid.nullable(),
  failureClass: z.enum(["transient", "invalid_input", "policy", "quality", "cancelled", "unknown"]).nullable(),
  assetIds: z.array(uuid).max(1000), createdAt: time, dispatchedAt: time.nullable(), resolvedAt: time.nullable(),
  fence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((attempt, ctx) => {
  if (attempt.chargeState === "confirmed" && (attempt.actualVendorMicrousd === null || attempt.usageEvidenceId === null)) ctx.addIssue({ code: "custom", message: "Confirmed charges need an exact amount and actual evidence record." });
  if (attempt.state === "uncertain" && attempt.chargeState !== "unknown") ctx.addIssue({ code: "custom", message: "Uncertain provider outcomes must retain unknown charges." });
  if (attempt.state === "prepared" && (attempt.chargeState !== "not_dispatched" || attempt.dispatchedAt !== null)) ctx.addIssue({ code: "custom", message: "Prepared work cannot claim external dispatch or billing." });
  if (["dispatching", "uncertain"].includes(attempt.state) && (attempt.chargeState !== "unknown" || !attempt.dispatchedAt)) ctx.addIssue({ code: "custom", message: "Dispatched unresolved work needs a dispatch timestamp and unknown charge state." });
  if (attempt.state === "succeeded" && attempt.chargeState !== "confirmed") ctx.addIssue({ code: "custom", message: "Succeeded work requires confirmed cost evidence, including a confirmed zero cost." });
});
export type ProviderAttempt = z.infer<typeof AttemptSchema>;
export const LedgerEntrySchema = z.object({
  id: uuid, scope: ScopeSchema, jobId: uuid, attemptId: uuid.nullable(), eventKey: key,
  account: z.enum(["vendor_microusd", "customer_credits"]), direction: z.enum(["debit", "credit"]),
  amount: ExactAmountSchema, reason: z.enum(["provider_cost", "accepted_work", "provider_credit", "customer_refund", "customer_adjustment"]),
  evidenceId: uuid, createdAt: time,
}).strict();
export type UsageLedgerEntry = z.infer<typeof LedgerEntrySchema>;
export const ExecutionSchema = z.object({
  job: JobSchema, quote: QuoteSchema.nullable(), reservation: ReservationSchema.nullable(),
  attempts: z.array(AttemptSchema).max(10), ledger: z.array(LedgerEntrySchema).max(200),
}).strict().superRefine((execution, ctx) => {
  const scope = JSON.stringify(execution.job.scope);
  for (const record of [execution.quote, execution.reservation, ...execution.attempts, ...execution.ledger]) if (record && JSON.stringify(record.scope) !== scope) ctx.addIssue({ code: "custom", message: "All execution records must share the exact job scope." });
  for (const record of [execution.reservation, ...execution.attempts, ...execution.ledger]) if (record && record.jobId !== execution.job.id) ctx.addIssue({ code: "custom", message: "Execution record belongs to another job." });
  if (new Set(execution.attempts.map((attempt) => attempt.id)).size !== execution.attempts.length || new Set(execution.attempts.map((attempt) => attempt.sequence)).size !== execution.attempts.length) ctx.addIssue({ code: "custom", message: "Attempt IDs and sequence numbers must be unique." });
  if (new Set(execution.ledger.map((entry) => entry.eventKey)).size !== execution.ledger.length) ctx.addIssue({ code: "custom", message: "Ledger event keys must be unique." });
  if (new Set(execution.ledger.map((entry) => entry.id)).size !== execution.ledger.length) ctx.addIssue({ code: "custom", message: "Ledger IDs must be unique." });
  if (execution.quote?.id !== (execution.job.quoteId ?? undefined)) ctx.addIssue({ code: "custom", message: "Job quote pointer does not match its quote." });
  if (execution.reservation?.id !== (execution.job.reservationId ?? undefined)) ctx.addIssue({ code: "custom", message: "Job reservation pointer does not match its reservation." });
  if (execution.reservation && (execution.reservation.quoteId !== execution.quote?.id || execution.reservation.vendorMicrousd !== execution.quote.maximumVendorMicrousd || execution.reservation.customerCredits !== execution.quote.customerCredits)) ctx.addIssue({ code: "custom", message: "Reservation does not match the approved quote bounds." });
  if (execution.quote && (execution.quote.inputHash !== execution.job.inputHash || execution.quote.baseVersionId !== execution.job.baseVersionId || execution.quote.routeVersion !== execution.job.routeVersion)) ctx.addIssue({ code: "custom", message: "Quote does not match the job input, base version and route." });
  for (const attempt of execution.attempts) if (!execution.quote || attempt.inputHash !== execution.job.inputHash || attempt.baseVersionId !== execution.job.baseVersionId || attempt.routeVersion !== execution.job.routeVersion || attempt.provider !== execution.quote.provider || attempt.model !== execution.quote.model) ctx.addIssue({ code: "custom", message: "Attempt does not match the approved job and provider route." });
  if (new Set(execution.job.acceptedAssetIds).size !== execution.job.acceptedAssetIds.length) ctx.addIssue({ code: "custom", message: "Accepted assets must be unique." });
  for (const entry of execution.ledger) if (entry.attemptId && !execution.attempts.some((attempt) => attempt.id === entry.attemptId)) ctx.addIssue({ code: "custom", message: "Ledger references an unknown job attempt." });
});
export type JobExecution = z.infer<typeof ExecutionSchema>;

/** Trusted runtime decisions loaded again before dispatch; not browser claims. */
export type DispatchAuthority = { workspaceAuthorized: boolean; sourceProcessingAllowed: boolean; routeAllowed: boolean; spendingAuthorized: boolean };


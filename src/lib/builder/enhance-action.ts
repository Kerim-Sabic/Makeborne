/**
 * The durable brief-improvement action (POST/GET/DELETE/PATCH /api/build/enhance), shared by the
 * route and the studio. One action per client Idempotency-Key, bound on the server to the signed-in
 * account, the workspace, the website and the exact request: a retry, another tab or a reload reads
 * the same action back and never starts a second reading or a second hold.
 *
 * What the studio may say comes only from the action's verified billing state: "nothing was charged"
 * only when its hold was confirmed returned; "unknown" when the reply was lost (re-read, never re-run).
 */
import { z } from "zod";
import { EnhancedBriefSchema, type EnhancedBrief } from "./enhanced-brief";

export const ENHANCE_STATUSES = ["running", "releasing", "completed", "failed", "cancelled", "expired", "needs_review"] as const;
export type EnhanceStatus = (typeof ENHANCE_STATUSES)[number];
/** none: stopped before any hold existed. held: reserved, not yet returned. exempt: unlimited account, nothing held.
 * released: returned and verified. The rest are anomalies found when returning it (never re-charged). */
export const ENHANCE_BILLING = ["none", "held", "exempt", "released", "missing_hold", "released_hold", "expired_hold", "settled_hold"] as const;

export const EnhanceResultSchema = z.object({
  mode: z.enum(["enhance", "analyze"]),
  text: z.string().min(1).max(6000),
  enhanced: EnhancedBriefSchema,
}).strict();
export type EnhanceResult = z.infer<typeof EnhanceResultSchema>;

/** The public action snapshot (the database's internal id, fence, digest and hold reference never leave the server). */
export const EnhanceActionSchema = z.object({
  key: z.string().uuid(),
  status: z.enum(ENHANCE_STATUSES),
  mode: z.enum(["enhance", "analyze"]).nullable(),
  outcome: z.enum(["completed", "failed", "cancelled", "expired"]).nullable(),
  cancelRequested: z.boolean(),
  billing: z.enum(ENHANCE_BILLING),
  holdCredits: z.number().int().nonnegative(),
  /** Known only once the hold was resolved (always 0 today: improving a brief is free). */
  chargedCredits: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
  failure: z.object({ code: z.string().max(80), message: z.string().max(400) }).nullable(),
  result: EnhanceResultSchema.nullable(),
}).strip();
export type EnhanceAction = z.infer<typeof EnhanceActionSchema>;

const credits = (value: number) => `${value} credit${value === 1 ? "" : "s"}`;

/** Server wording for every action state. Only a verified zero says "nothing was charged". */
export function actionMessage(action: EnhanceAction): string {
  const confirmedFree = action.chargedCredits === 0;
  switch (action.status) {
    case "completed": return `Your brief was improved. Improving it charged ${credits(action.chargedCredits ?? 0)}.`;
    case "running": return action.cancelRequested ? "Stopping the improvement of your brief…" : "Your brief is still being improved.";
    case "releasing": return "Your brief was read, but returning its 1-credit hold isn't confirmed yet. Nothing more will be charged; check again in a moment.";
    case "failed": return `Your brief couldn't be improved just now.${confirmedFree ? " Nothing was charged." : ""} The build can use your own words.`;
    case "expired": return `Improving your brief didn't finish.${confirmedFree ? " Its hold was returned and nothing was charged." : ""} The build can use your own words.`;
    case "cancelled": return `Stopped before your brief was improved.${confirmedFree ? " Nothing was charged." : ""}`;
    case "needs_review": return `Improving your brief finished, but its credit hold was not in the expected state, so the improved brief is set aside for review and not used.${confirmedFree ? " No credits were charged for it." : ""} Nothing will be charged again. The build can use your own words.`;
  }
}

/** What the studio shows for a reply (or a lost one). */
export type EnhanceView =
  | { status: "ready"; key: string; enhanced: EnhancedBrief; text: string; charged: number }
  /** Running on the server, or its billing is being confirmed: re-read the action, never re-run it. */
  | { status: "checking"; key: string; reason: "running" | "billing" | "unknown"; message: string }
  /** Ended with no usable result. charged: the verified charge, or null while unknown. */
  | { status: "failed"; key: string | null; message: string; charged: number | null; blocking?: boolean; cancelled?: boolean }
  /** The server has no action for this key: it never arrived (or not yet). Recording a Stop makes that final. */
  | { status: "absent"; key: string };

/** Refusals that stop a build as well as the free improvement, so the studio never offers a start that would fail the same way. */
export const buildRefusedToo = (code: string) => code.startsWith("AI_") || ["INSUFFICIENT_CREDITS", "CREDIT_USAGE_LIMIT", "BUILDER_UNAVAILABLE"].includes(code);

const UNCONFIRMED = new Set(["ENHANCE_STATUS_UNAVAILABLE", "REQUEST_FAILED", "CREDITS_UNAVAILABLE", "ACCOUNT_CHANGED"]);
/** Reads any enhance endpoint's reply. `null` body (transport failure, unreadable JSON) is "unknown": the outcome is re-read by key. */
export function enhanceView(key: string, status: number | null, body: unknown): EnhanceView {
  const value = body && typeof body === "object" ? body as { action?: unknown; error?: { code?: unknown; message?: unknown } } : null;
  const action = EnhanceActionSchema.safeParse(value?.action);
  if (action.success) {
    const item = action.data;
    if (item.status === "completed" && item.result && item.chargedCredits !== null)
      return { status: "ready", key, enhanced: item.result.enhanced, text: item.result.text, charged: item.chargedCredits };
    if (item.status === "running") return { status: "checking", key, reason: "running", message: actionMessage(item) };
    if (item.status === "releasing") return { status: "checking", key, reason: "billing", message: actionMessage(item) };
    return { status: "failed", key, message: actionMessage(item), charged: item.chargedCredits, cancelled: item.status === "cancelled" };
  }
  const code = typeof value?.error?.code === "string" ? value.error.code : "";
  if (status === 404 && code === "ENHANCE_NOT_FOUND") return { status: "absent", key };
  // A refusal before any action existed (no credits, AI paused, not an editor…): nothing was held, so nothing was charged.
  // "Could not confirm" replies are unknown: the action may exist, so it is re-read, never assumed.
  if (status !== null && status >= 400 && code && !UNCONFIRMED.has(code)) {
    const message = typeof value?.error?.message === "string" && value.error.message.trim() ? value.error.message.trim().slice(0, 400) : "Your brief couldn't be improved just now.";
    return { status: "failed", key: null, message, charged: 0, blocking: buildRefusedToo(code) };
  }
  return { status: "checking", key, reason: "unknown", message: "The reply was lost. Checking what happened to your brief's improvement; it will not be run again." };
}

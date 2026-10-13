// Records provider observations only after all required SANDBOX reads succeed.
// Usage: node scripts/observe-whop-sandbox.mjs [--refund pay_xxx]
// Refund is an explicit mutation; a failed/ambiguous request is never retried here.
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const SANDBOX_BASE = "https://sandbox-api.whop.com/api/v1";
export const SANDBOX_COMPANY = "biz_e4w3EGe3izP67k";
const API_VERSION = "2025-01-01";
const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 10_000;
const MESSAGES = Object.freeze({
  TARGET: "Exact sandbox API base and known sandbox company are required.",
  CONFIG: "Sandbox credentials or local configuration are unavailable.",
  ARGUMENT: "Usage: node scripts/observe-whop-sandbox.mjs [--refund pay_xxx]",
  HTTP: "Sandbox request returned an unsuccessful HTTP status.",
  TRANSPORT: "Sandbox request failed, timed out, or refused a redirect; mutation outcome may be unknown.",
  SHAPE: "Sandbox response shape is unverified.",
  BINDING: "Sandbox resource ID or merchant binding does not match.",
  REFUND: "Sandbox payment is not confirmed refundable.",
  PAGINATION: "Sandbox scan is incomplete or has invalid pagination.",
  EVIDENCE: "Local evidence could not be read or saved.",
  INTERNAL: "Sandbox observation failed; no observation was appended.",
});
class ObservationError extends Error {
  constructor(code, status) {
    super(MESSAGES[code]);
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}
const fail = (code, status) => { throw new ObservationError(code, status); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const idMatches = (value, prefix) => typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]{1,100}$`).test(value);
const money = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const token = value => typeof value === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(value);
const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
function optional(value, check) {
  if (value === null || value === undefined) return null;
  if (!check(value)) fail("SHAPE");
  return value;
}
function bound(resource, prefix, expectedId) {
  if (!object(resource) || !idMatches(resource.id, prefix)) fail("SHAPE");
  if (expectedId !== undefined && resource.id !== expectedId) fail("BINDING");
  // Require the documented company relation; contradictory aliases also refuse.
  if (!object(resource.company) || resource.company.id !== SANDBOX_COMPANY
    || (resource.company_id !== undefined && resource.company_id !== SANDBOX_COMPANY)
    || (resource.account !== undefined && resource.account?.id !== SANDBOX_COMPANY)) fail("BINDING");
}
function membershipView(m, expectedId) {
  bound(m, "mem", expectedId);
  if (!["trialing", "active", "past_due", "completed", "canceled", "expired", "unresolved", "drafted", "canceling"].includes(m.status)) fail("SHAPE");
  const plan = optional(m.plan?.id ?? m.plan_id, value => idMatches(value, "plan"));
  if (!plan || (m.plan_id !== undefined && m.plan_id !== plan)) fail("SHAPE");
  return { id: m.id, companyId: SANDBOX_COMPANY, status: m.status, plan,
    cancelAtPeriodEnd: optional(m.cancel_at_period_end, value => typeof value === "boolean"),
    periodStart: optional(m.renewal_period_start, date), periodEnd: optional(m.renewal_period_end, date), updated: optional(m.updated_at, date) };
}
function paymentView(p, expectedId) {
  bound(p, "pay", expectedId);
  if (!["draft", "open", "authorized", "paid", "pending", "uncollectible", "unresolved", "void"].includes(p.status)
    || !money(p.total) || !money(p.refunded_amount) || p.refunded_amount > p.total) fail("SHAPE");
  if (p.membership !== undefined && p.membership !== null && (!object(p.membership) || !idMatches(p.membership.id, "mem"))) fail("SHAPE");
  return { id: p.id, companyId: SANDBOX_COMPANY, status: p.status, substatus: optional(p.substatus, token),
    billingReason: optional(p.billing_reason, token), total: p.total, refunded: p.refunded_amount,
    membership: p.membership?.id ?? null, created: optional(p.created_at, date), paidAt: optional(p.paid_at, date) };
}

// Provider messages, bodies, URLs, headers, credentials and exception causes are never emitted.
export function sanitizedError(error) {
  const known = error instanceof ObservationError;
  return { code: known ? error.code : "INTERNAL", message: known ? error.message : MESSAGES.INTERNAL,
    ...(known && Number.isInteger(error.status) ? { status: error.status } : {}),
    ...(known && error.refundRequestAttempted === true ? { refundRequestAttempted: true,
      refundOutcome: error.refundOutcome === "request_accepted_observation_incomplete" ? "request_accepted_observation_incomplete" : "unknown" } : {}) };
}
export function parseArguments(args) {
  if (args.length === 0) return null;
  if (args.length !== 2 || args[0] !== "--refund" || !idMatches(args[1], "pay")) fail("ARGUMENT");
  return args[1];
}

export async function observeSandbox({ config, refundId = null, fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(), maxPages = MAX_PAGES, timeoutMs = REQUEST_TIMEOUT_MS }) {
  if (!object(config) || config.apiBase !== SANDBOX_BASE || config.companyId !== SANDBOX_COMPANY) fail("TARGET");
  if (typeof config.apiKey !== "string" || !config.apiKey || /[\r\n]/.test(config.apiKey)) fail("CONFIG");
  if (refundId !== null && !idMatches(refundId, "pay")) fail("ARGUMENT");
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > REQUEST_TIMEOUT_MS) fail("CONFIG");
  const startedAt = now();
  async function call(method, path, body) {
    // All paths are generated below, never provided by the provider or CLI.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(SANDBOX_BASE + path, { method,
        headers: { Authorization: `Bearer ${config.apiKey}`, "Api-Version-Date": API_VERSION,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "error", signal: controller.signal });
      if (response.redirected) fail("TRANSPORT");
      if (!response.ok || response.status < 200 || response.status >= 300) fail("HTTP", response.status);
      let result;
      try { result = await response.json(); } catch { fail(controller.signal.aborted ? "TRANSPORT" : "SHAPE"); }
      if (!object(result) || Object.hasOwn(result, "error")) fail("SHAPE");
      return { status: response.status, body: result };
    } catch (error) {
      if (error instanceof ObservationError) throw error;
      fail("TRANSPORT");
    } finally { clearTimeout(timer); }
  }
  async function scan(kind, view) {
    const items = [], cursors = new Set(), ids = new Set();
    let after;
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({ company_id: SANDBOX_COMPANY, first: "50", order: "created_at", direction: "asc" });
      if (kind === "payments") params.set("include_free", "true");
      if (after !== undefined) params.set("after", after);
      const { body } = await call("GET", `/${kind}?${params}`);
      const info = body.page_info;
      if (!Array.isArray(body.data) || body.data.length > 50 || !object(info)
        || typeof info.has_next_page !== "boolean"
        || !(info.end_cursor === null || (typeof info.end_cursor === "string" && info.end_cursor.length <= 2000))) fail("SHAPE");
      for (const raw of body.data) {
        const item = view(raw);
        if (ids.has(item.id)) fail("PAGINATION");
        ids.add(item.id); items.push(item);
      }
      if (!info.has_next_page) return { items, pages: page, complete: true };
      if (!body.data.length || !info.end_cursor || cursors.has(info.end_cursor)) fail("PAGINATION");
      cursors.add(info.end_cursor); after = info.end_cursor;
    }
    fail("PAGINATION");
  }
  // Read both complete lists before any optional mutation; an unavailable scan refuses refund.
  let memberships = await scan("memberships", membershipView);
  let payments = await scan("payments", paymentView);
  const actions = [];
  if (refundId !== null) {
    let mutationAttempted = false;
    let requestAccepted = false;
    try {
      const { body: rawBefore } = await call("GET", `/payments/${refundId}`);
      const before = paymentView(rawBefore, refundId);
      if (!payments.items.some(payment => payment.id === refundId)) fail("BINDING");
      if (rawBefore.refundable !== true || before.status !== "paid" || before.total <= before.refunded) fail("REFUND");
      if (before.membership !== null) {
        const { body } = await call("GET", `/memberships/${before.membership}`);
        membershipView(body, before.membership);
        if (!memberships.items.some(membership => membership.id === before.membership)) fail("BINDING");
      }
      mutationAttempted = true;
      const result = await call("POST", `/payments/${refundId}/refund`, {});
      requestAccepted = true;
      const { body: rawAfter } = await call("GET", `/payments/${refundId}`);
      const after = paymentView(rawAfter, refundId);
      if (after.membership !== before.membership || after.total !== before.total) fail("BINDING");
      const membershipAfter = after.membership === null ? null
        : membershipView((await call("GET", `/memberships/${after.membership}`)).body, after.membership);
      actions.push({ action: "full refund request", payment: refundId, before, status: result.status,
        requestAccepted: true, fullRefundObserved: after.refunded === after.total, after, membershipAfter });
      memberships = await scan("memberships", membershipView);
      payments = await scan("payments", paymentView);
    } catch (error) {
      const safe = error instanceof ObservationError ? error : new ObservationError("INTERNAL");
      if (mutationAttempted) {
        safe.refundRequestAttempted = true;
        safe.refundOutcome = requestAccepted ? "request_accepted_observation_incomplete" : "unknown";
      }
      throw safe;
    }
  }
  return { at: startedAt, completedAt: now(), sandboxOnly: true, readOnly: refundId === null,
    apiBase: SANDBOX_BASE, companyId: SANDBOX_COMPANY, apiVersion: API_VERSION, actions,
    membershipScanComplete: memberships.complete, paymentScanComplete: payments.complete,
    scan: { memberships: { pages: memberships.pages, records: memberships.items.length, complete: true },
      payments: { pages: payments.pages, records: payments.items.length, complete: true, includeFree: true } },
    memberships: memberships.items, payments: payments.items,
    limitations: ["API observation only; not signed webhook or credit delivery evidence.",
      "Cursor pagination completed; the provider lists are not an atomic snapshot.",
      "An accepted refund request does not prove app reconciliation or membership access changes."] };
}

export async function runObserver({ args = process.argv.slice(2), configPath = "work/release-auth-stack/whop-sandbox.json",
  out = "docs/release-review/whop-sandbox-observations.json", config, emit = console.log, ...options } = {}) {
  const refundId = parseArguments(args);
  let log;
  try {
    log = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8"))
      : { sandboxOnly: true, productionTouched: false, realMoneySpent: 0, observations: [] };
    if (!object(log) || log.sandboxOnly !== true || log.productionTouched !== false
      || log.realMoneySpent !== 0 || !Array.isArray(log.observations)) fail("EVIDENCE");
  } catch { fail("EVIDENCE"); }
  if (config === undefined) {
    try { config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")); }
    catch { fail("CONFIG"); }
  }
  const entry = await observeSandbox({ ...options, config, refundId });
  log.observations.push(entry);
  try { fs.writeFileSync(out, JSON.stringify(log, null, 2) + "\n"); } catch {
    const error = new ObservationError("EVIDENCE");
    if (refundId !== null) {
      error.refundRequestAttempted = true;
      error.refundOutcome = "request_accepted_observation_incomplete";
    }
    throw error;
  }
  emit(JSON.stringify(entry, null, 2));
  return entry;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runObserver(); }
  catch (error) { console.error(JSON.stringify(sanitizedError(error))); process.exitCode = 1; }
}

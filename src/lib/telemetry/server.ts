import "server-only";
import { createHash } from "node:crypto";
import { billingDatabase } from "@/lib/billing/database";
import { errorKind, fingerprintSource, routePattern, scrubMessage, type TelemetryPage } from "./scrub";

const release = () => (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 12);

/** Resolves after `ms` at most; telemetry must never slow down or break a request. */
async function bounded(task: PromiseLike<unknown>, ms = 1_500) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([Promise.resolve(task), new Promise(resolve => { timer = setTimeout(resolve, ms); })]); }
  catch { /* telemetry is best effort */ }
  finally { if (timer) clearTimeout(timer); }
}

/** Records one error (scrubbed and grouped). Never throws. */
export async function recordError(input: { source: "server" | "client"; error?: unknown; kind?: string; message?: string; route: string }) {
  try {
    const kind = input.kind && /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(input.kind) ? input.kind : errorKind(input.error);
    const message = scrubMessage(input.message ?? input.error);
    const route = routePattern(input.route);
    const fingerprint = createHash("sha256").update(fingerprintSource(input.source, kind, message, route)).digest("hex");
    await bounded(billingDatabase().rpc("makeborne_record_app_error", { p_fingerprint: fingerprint, p_source: input.source, p_kind: kind, p_message: message, p_route: route, p_release: release() }));
  } catch { /* not configured here, or the database is unreachable */ }
}

/** Counts one visit to an allow-listed page (hashed with a daily salt in the database). Never throws. */
export async function recordVisit(page: TelemetryPage, ip: string, userAgent: string) {
  try { await bounded(billingDatabase().rpc("makeborne_record_studio_visit", { p_page: page, p_ip: ip.slice(0, 64), p_user_agent: userAgent.slice(0, 300) })); }
  catch { /* best effort */ }
}

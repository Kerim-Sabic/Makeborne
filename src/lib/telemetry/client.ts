// Browser side of first-party telemetry (see src/instrumentation-client.ts and /api/telemetry). Client-safe.
import { IGNORED_CLIENT_ERROR, errorKind, scrubMessage, telemetryPage } from "./scrub";

const sent = new Set<string>();
let reports = 0;

export function send(body: Record<string, string>) {
  try {
    const data = new Blob([JSON.stringify(body)], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/telemetry", data)) void fetch("/api/telemetry", { method: "POST", body: data, keepalive: true }).catch(() => undefined);
  } catch { /* telemetry must never break the page */ }
}

/** Reports one browser error (at most 10 distinct ones per page load). Also used by the error pages. */
export function reportClientError(error: unknown) {
  try {
    const message = scrubMessage(error instanceof Error ? error.message : typeof error === "string" ? error : "");
    if (!message || IGNORED_CLIENT_ERROR.test(message) || sent.has(message) || reports >= 10) return;
    sent.add(message); reports++;
    send({ type: "error", kind: errorKind(error), message, path: location.pathname });
  } catch { /* ignore */ }
}

export function visit(path: string) {
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.globalPrivacyControl || nav.doNotTrack === "1" || !telemetryPage(path)) return;
    send({ type: "visit", path });
  } catch { /* ignore */ }
}


// Browser telemetry for Makeborne's own pages: scrubbed error reports and visits to a few
// allow-listed pages, sent with sendBeacon to /api/telemetry. No cookies, no ids, no third party.
import { reportClientError, visit } from "@/lib/telemetry/client";

try {
  window.addEventListener("error", event => {
    // Only errors from our own scripts (extensions and third-party frames are not ours to fix).
    if (event.filename && !event.filename.startsWith(location.origin)) return;
    reportClientError(event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", event => reportClientError(event.reason));
  visit(location.pathname);
} catch { /* ignore */ }

export function onRouterTransitionStart(url: string) {
  try { visit(new URL(url, location.origin).pathname); } catch { /* ignore */ }
}

import type { Instrumentation } from "next";

/** Server errors from pages, route handlers, actions and the proxy go to first-party error tracking (src/lib/telemetry). */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // The runtime check must wrap the import so the edge bundle never includes the Node-only module.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recordError } = await import("./lib/telemetry/server");
    const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : "";
    await recordError({ source: "server", error, message: error instanceof Error ? error.message : digest ? `digest ${digest}` : String(error),
      route: context.routePath || request.path });
  }
};

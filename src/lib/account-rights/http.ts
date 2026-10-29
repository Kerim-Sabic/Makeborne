import "server-only";
import { RequestError, apiError } from "@/lib/server/http";

/** Private, never cached, varies by the signed-in account. */
export function rightsJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}

/** Known refusals keep their message; anything else is a plain "try again" without detail. */
export function rightsError(error: unknown) {
  const response = apiError(error instanceof RequestError ? error
    : new RequestError("ACCOUNT_DATA_UNAVAILABLE", "Your data settings are temporarily unavailable. Nothing was changed. Try again shortly.", 503));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}

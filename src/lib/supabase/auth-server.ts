import "server-only";
import { NextResponse } from "next/server";
import { getSupabaseConfig } from "./config";

export function accountsEnabled() {
  return process.env.MAKEBORNE_CLOUD_ENABLED === "true" &&
    process.env.MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED === "true" &&
    getSupabaseConfig() !== null;
}

export function authRedirect(origin: string, path: string) {
  const response = NextResponse.redirect(new URL(path, origin));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/** Preserve the local browser's loopback alias; production uses the request URL only. */
export function authRequestOrigin(request: Request) {
  const target = new URL(request.url);
  if (process.env.NODE_ENV === "development") {
    try {
      const local = new URL(`${target.protocol}//${request.headers.get("host")}`);
      const loopback = ["localhost", "127.0.0.1", "[::1]"];
      if (loopback.includes(local.hostname) && loopback.includes(target.hostname) && local.port === target.port) return local.origin;
    } catch { /* Use the original request origin. */ }
  }
  return target.origin;
}

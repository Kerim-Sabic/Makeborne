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

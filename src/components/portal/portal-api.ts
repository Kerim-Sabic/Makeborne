"use client";
import { createClient } from "@/lib/supabase/client";
import { contrast } from "@/lib/brand/kit";
import type { PortalBrand } from "@/lib/portal/contracts";

export class PortalError extends Error {
  constructor(readonly status: number, message: string, readonly code = "") { super(message); }
}

let account: Promise<string | null> | null = null;
/** The signed-in account id (sent as X-Makeborne-Account so a switched account can't act on a stale page). */
export function portalAccount(refresh = false) {
  if (!account || refresh) account = createClient().auth.getUser().then(({ data }) => data.user?.id ?? null, () => null);
  return account;
}

/** JSON request to the portal API. Writes carry an Idempotency-Key. */
export async function portalRequest<T>(path: string, init: { method?: string; body?: unknown; key?: string } = {}): Promise<T> {
  const id = await portalAccount();
  const headers: Record<string, string> = {};
  if (id) headers["X-Makeborne-Account"] = id;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.key) headers["Idempotency-Key"] = init.key;
  const response = await fetch(path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), cache: "no-store" });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new PortalError(response.status, value?.error?.message ?? "Something went wrong. Try again.", value?.error?.code ?? "");
  return value as T;
}

/** CSS variables for an agency-branded surface, with readable ink on the primary colour. */
export function brandStyle(brand: PortalBrand | null | undefined): Record<string, string> {
  const valid = (value: string | undefined, fallback: string) => value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const primary = valid(brand?.colors.primary, "#2f4b8a"), background = valid(brand?.colors.background, "#f7f6f2"), text = valid(brand?.colors.text, "#17181c");
  // Dark brand backgrounds make poor form surfaces: keep the portal light and use the brand colour for accents.
  const surface = contrast(background, "#17181c") >= 7 ? background : "#f7f6f2";
  const ink = contrast(text, surface) >= 4.5 ? text : "#17181c";
  return { "--p-primary": primary, "--p-on-primary": contrast(primary, "#ffffff") >= 4.5 ? "#ffffff" : "#17181c", "--p-surface": surface, "--p-ink": ink };
}

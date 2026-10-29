"use client";
import { cloudAccountGuard } from "../cloud-api";
import { crmProtocolHeaders } from "@/lib/crm-protocol";

/** Requests to the CRM research routes. Errors keep their code and any details (duplicate matches, the do-not-contact entry). */
export class CrmRequestError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly details: Record<string, unknown> | null = null) { super(message); }
}
export async function crmCall<T>(accountId: string, path: string, body?: unknown): Promise<T> {
  const guard = cloudAccountGuard(accountId);
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId, ...crmProtocolHeaders } });
  const value = await response.json().catch(() => ({}));
  guard();
  if (!response.ok) throw new CrmRequestError(value?.error?.code ?? "REQUEST_FAILED", value?.error?.message ?? "Something went wrong. Try again.", response.status, value?.error?.details ?? null);
  return value as T;
}
/** Today's date on the person's own calendar (YYYY-MM-DD). */
export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const shortDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

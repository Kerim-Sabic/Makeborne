"use client";

export type MailAccount = { id: string; provider: "google" | "microsoft"; email: string; displayName: string; status: "active" | "error" | "disconnected"; lastError: string | null;
  mine: boolean; dailyLimit: number; lastSyncedAt: string | null; todayQuota: number; sentToday: number };
export type MailTemplate = { id: string; name: string; subject: string; body: string; updatedAt: string };
export type SequenceStep = { delayDays: number; subject: string; body: string };
export type MailSequence = { id: string; name: string; steps: SequenceStep[]; stopOnReply: boolean; updatedAt: string; counts: Record<string, number> };
export type MailReply = { id: string; clientId: string | null; clientName: string; subject: string; snippet: string; from: string; at: string };
export type MailOverview = { availability: { google: boolean; microsoft: boolean }; automation: boolean; accounts: MailAccount[]; templates: MailTemplate[]; sequences: MailSequence[]; replies: MailReply[] };
export type MailMessage = { id: string; direction: "in" | "out"; status: "sending" | "sent" | "failed" | "unknown" | "received"; subject: string; body: string; from: string; to: string; at: string;
  error: string | null; automated: boolean; step: number | null; accountId: string };
export type Enrollment = { id: string; sequenceId: string; clientId: string; clientName: string; clientEmail: string; accountId: string; status: string; nextStep: number; nextSendAt: string | null; lastError: string | null };

export class MailApiError extends Error { constructor(message: string, readonly code: string, readonly status: number) { super(message); } }

/** JSON calls to the workspace email endpoints, bound to the signed-in account. */
export async function mailApi<T>(accountId: string, path: string, method: "GET" | "POST" | "PATCH" | "DELETE" = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, cache: "no-store", headers: { "X-Makeborne-Account": accountId, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => null) as (T & { error?: { code?: string; message?: string } }) | null;
  if (!response.ok) throw new MailApiError(data?.error?.message ?? "Email is temporarily unavailable. Try again.", data?.error?.code ?? "REQUEST_FAILED", response.status);
  return data as T;
}

export const TOKEN_HELP = "{{first_name}} {{name}} {{company}} {{website}} {{sender_name}} {{sender_first_name}} · add a fallback like {{first_name|there}}";
export const providerLabel = (provider: MailAccount["provider"]) => provider === "google" ? "Gmail" : "Outlook";

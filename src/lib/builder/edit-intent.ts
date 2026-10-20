/**
 * Explicit intent for one builder request (audit M08): the exact base version
 * and selected target the request was written against, the approved saved plan
 * revision, the request text kept on this device until its outcome is known,
 * and the version an AI change produced so it can be undone as a new version.
 *
 * Pure rules shared by the builder UI, the build route and offline checks.
 * Nothing here authorizes spending: the server still derives caps, holds and
 * idempotency from its own records.
 */
import { canonicalSourceJson } from "../projects/canonical-json";
import type { SitePlan, StoredPlan } from "./plan";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One element picked in the visual editor, bound to the saved file it was picked from. */
export type EditTarget = { path: string; line: number; label: string; source: string; version: number };

/** How the request text refers to the target (written by the visual editor's "Ask the builder"). */
export const targetReference = (target: Pick<EditTarget, "path" | "line">) => `${target.path} (line ${target.line})`;

/** Null when the selected element is still exactly where the user saw it; otherwise why the request must not be sent. */
export function targetIssue(target: EditTarget | null, text: string, files: Record<string, string>, version: number): string | null {
  if (!target || !text.includes(targetReference(target))) return null;
  const current = files[target.path];
  if (current === undefined) return `${target.path} no longer exists in version ${version}. Select the element again in the preview, or remove the reference from your message.`;
  if (current !== target.source) return `${target.label} in ${target.path} changed after you selected it (you selected it in version ${target.version}; the project is now version ${version}). Select it again in the preview so the builder edits the right element. Nothing was sent.`;
  return null;
}

/** The server refuses a build whose base version is no longer current; this is its customer-facing wording. */
export function staleBaseMessage(expected: number, current: number) {
  return `This request was written for version ${expected}, but version ${current} is now saved. Nothing was sent or charged. Review the latest version, then send your request again.`;
}

/**
 * A build that follows a plan must follow exactly the saved revision the user approved.
 * Null when the approval matches the stored plan; otherwise the refusal message.
 */
export function approvedPlanIssue(stored: StoredPlan | null, approved: { plan: SitePlan; revision: number | undefined }): string | null {
  if (approved.revision === undefined) return "Reload the plan before building it, so the build follows the saved plan you reviewed.";
  if (!stored) return "This plan is no longer saved. Reload it before building.";
  if (stored.revision !== approved.revision) return `The plan changed after you approved it (you approved revision ${approved.revision}; the saved plan is revision ${stored.revision}). Nothing was built or charged. Review the saved plan and build again.`;
  if (stored.status !== "draft") return "This plan revision was already built. Revise the plan or describe the next change.";
  if (canonicalSourceJson(stored.plan) !== canonicalSourceJson(approved.plan)) return "The plan you approved differs from the saved plan. Nothing was built or charged. Wait for your edits to save, then build again.";
  return null;
}

/** One approval of one saved plan revision at one effort on one base version. A repeat of the same approval reuses its request identity. */
export const planApprovalIdentity = (input: { revision: number; effort: string; version: number }) => `${input.revision}:${input.effort}:${input.version}`;

/** Undo restores the version the AI change was based on, as a new version. Null when it may run. */
export function undoIssue(change: { from: number; to: number } | null, input: { version: number; blocked: string | null; available: boolean }): string | null {
  if (!change) return "There is no AI change to undo.";
  if (!input.available) return "Undo isn't available here. Restore an earlier version from History.";
  if (input.version !== change.to) return `Version ${input.version} was saved after this change. Restore an earlier version from History instead.`;
  if (input.blocked) return input.blocked;
  return null;
}

/* ---------- Request text kept until its outcome is known ---------- */

export const PENDING_REQUEST_VERSION = 1;
export const PENDING_REQUEST_TTL_MS = 2 * 24 * 60 * 60 * 1000;
export const PENDING_REQUEST_PREFIX = "makeborne.builder-pending.v1.";
const MAX_TEXT = 8000;

/** What was sent and from where. Text only: no attachments, approvals, quotes, keys or charges. */
export type PendingRequest = { text: string; mode: "create" | "plan"; baseVersion: number; target?: string; sentAt: number };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export function pendingRequestKey(accountId: string, workspaceId: string, artifactId: string) {
  if (![accountId, workspaceId, artifactId].every(id => UUID.test(id))) throw new Error("Invalid builder scope.");
  return `${PENDING_REQUEST_PREFIX}${accountId.toLowerCase()}.${workspaceId.toLowerCase()}.${artifactId.toLowerCase()}`;
}

export function encodePendingRequest(request: PendingRequest, scope: string) {
  return JSON.stringify({ v: PENDING_REQUEST_VERSION, scope, text: request.text.slice(0, MAX_TEXT), mode: request.mode, baseVersion: request.baseVersion,
    ...(request.target ? { target: request.target.slice(0, 300) } : {}), sentAt: request.sentAt });
}

/** Null for anything that must not be shown: another scope or version, expired, future-dated or malformed. */
export function decodePendingRequest(raw: string | null, scope: string, now: number): PendingRequest | null {
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !["v", "scope", "text", "mode", "baseVersion", "target", "sentAt"].includes(key))) return null;
  if (item.v !== PENDING_REQUEST_VERSION || item.scope !== scope) return null;
  if (typeof item.sentAt !== "number" || !Number.isFinite(item.sentAt) || item.sentAt > now + 60_000 || now - item.sentAt > PENDING_REQUEST_TTL_MS) return null;
  if (typeof item.text !== "string" || !item.text.trim() || item.text.length > MAX_TEXT) return null;
  if (item.mode !== "create" && item.mode !== "plan") return null;
  if (typeof item.baseVersion !== "number" || !Number.isInteger(item.baseVersion) || item.baseVersion < 0) return null;
  if (item.target !== undefined && (typeof item.target !== "string" || item.target.length > 300)) return null;
  return { text: item.text, mode: item.mode, baseVersion: item.baseVersion, ...(typeof item.target === "string" ? { target: item.target } : {}), sentAt: item.sentAt };
}

export function readPendingRequest(storage: Storage | null, scope: string, now: number) {
  if (!storage) return null;
  let raw: string | null;
  try { raw = storage.getItem(scope); } catch { return null; }
  const request = decodePendingRequest(raw, scope, now);
  if (raw !== null && !request) try { storage.removeItem(scope); } catch { /* Nothing else to do. */ }
  return request;
}

/** False when this browser refused to keep the copy. */
export function savePendingRequest(storage: Storage | null, scope: string, request: PendingRequest) {
  if (!storage) return false;
  try { storage.setItem(scope, encodePendingRequest(request, scope)); return true; } catch { return false; }
}

export function clearPendingRequest(storage: Storage | null, scope: string) {
  if (!storage) return;
  try { storage.removeItem(scope); } catch { /* A stale copy expires on its own. */ }
}

/**
 * Unsent feedback on a client review page (a comment, its pin, and an open approve /
 * request-changes note), kept in this browser so closing or reloading the page does not
 * lose it. Follows src/lib/unsent-draft.ts:
 *
 * - Scoped to one review link and one version: the key holds a hash of the link token (not
 *   the token) and the version number, and the stored record repeats both, so a draft is
 *   never shown on another link or on another version of the same work.
 * - Schema-versioned and expiring (7 days, or the link's expiry if sooner); anything
 *   unreadable, expired, future-dated or for another scope is removed rather than restored.
 * - Holds only typed text, the pin position and which decision panel was open. Name and
 *   email stay in their separate identity key; nothing is ever posted or decided from here.
 * Client-safe.
 */
export const REVIEW_DRAFT_VERSION = 1;
export const REVIEW_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REVIEW_DRAFT_PREFIX = "makeborne.review-draft.v1.";
const MAX_COMMENT = 2000, MAX_NOTE = 2000, MAX_LABEL = 160;
const DECISIONS = ["approved", "changes_requested"] as const;

export type ReviewDraftPin = { x: number; y: number; ref: string; label: string };
export type ReviewDraftFields = { comment: string; pin: ReviewDraftPin | null; decision: (typeof DECISIONS)[number] | null; note: string };
export type RestoredReviewDraft = { fields: ReviewDraftFields; savedAt: number };
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** FNV-1a, twice: a short, stable id so the raw link token is never used as a storage key (not a security boundary). */
function linkId(token: string) {
  let a = 0x811c9dc5, b = 0x1b873593;
  for (let index = 0; index < token.length; index++) {
    const code = token.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
export const reviewDraftScope = (token: string, version: number) => `${linkId(token)}.${version}`;
export const reviewDraftKey = (scope: string) => `${REVIEW_DRAFT_PREFIX}${scope}`;
export const hasReviewDraftText = (fields: Pick<ReviewDraftFields, "comment" | "note">) => fields.comment.trim().length > 0 || fields.note.trim().length > 0;

const validPin = (pin: unknown): pin is ReviewDraftPin => {
  if (typeof pin !== "object" || pin === null) return false;
  const value = pin as Record<string, unknown>;
  return Object.keys(value).every(key => ["x", "y", "ref", "label"].includes(key))
    && typeof value.x === "number" && value.x >= 0 && value.x <= 1 && typeof value.y === "number" && value.y >= 0 && value.y <= 1
    && typeof value.ref === "string" && /^[A-Za-z0-9:_.-]{1,100}$/.test(value.ref) && typeof value.label === "string" && value.label.length <= MAX_LABEL;
};

export function encodeReviewDraft(fields: ReviewDraftFields, scope: string, now: number) {
  return JSON.stringify({ v: REVIEW_DRAFT_VERSION, scope, savedAt: now, comment: fields.comment.slice(0, MAX_COMMENT),
    pin: fields.pin ? { x: fields.pin.x, y: fields.pin.y, ref: fields.pin.ref, label: fields.pin.label.slice(0, MAX_LABEL) } : null,
    decision: fields.decision, note: fields.decision ? fields.note.slice(0, MAX_NOTE) : "" });
}

/** Null for anything that must not be restored. `expiresAt` is the review link's expiry (ms). */
export function decodeReviewDraft(raw: string | null, scope: string, now: number, expiresAt = Infinity): RestoredReviewDraft | null {
  if (raw === null || now >= expiresAt) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  if (Object.keys(draft).some(key => !["v", "scope", "savedAt", "comment", "pin", "decision", "note"].includes(key))) return null;
  if (draft.v !== REVIEW_DRAFT_VERSION || draft.scope !== scope) return null;
  if (typeof draft.savedAt !== "number" || !Number.isFinite(draft.savedAt) || draft.savedAt > now + 60_000 || now - draft.savedAt > REVIEW_DRAFT_TTL_MS) return null;
  if (typeof draft.comment !== "string" || draft.comment.length > MAX_COMMENT || typeof draft.note !== "string" || draft.note.length > MAX_NOTE) return null;
  if (draft.pin !== null && !validPin(draft.pin)) return null;
  if (draft.decision !== null && !DECISIONS.includes(draft.decision as never)) return null;
  const fields: ReviewDraftFields = { comment: draft.comment, pin: draft.pin as ReviewDraftPin | null, decision: draft.decision as ReviewDraftFields["decision"], note: draft.decision ? draft.note : "" };
  return hasReviewDraftText(fields) ? { fields, savedAt: draft.savedAt } : null;
}

/** Reads this link and version's draft, removing it when it can no longer be restored. Storage failures read as "no draft". */
export function readReviewDraft(storage: DraftStorage, scope: string, now: number, expiresAt?: number) {
  const key = reviewDraftKey(scope);
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return null; }
  const draft = decodeReviewDraft(raw, scope, now, expiresAt);
  if (raw !== null && !draft) try { storage.removeItem(key); } catch { /* Nothing else to do. */ }
  return draft;
}

/** Saves feedback with text, or removes the draft when nothing is typed. Returns false when storage refused. */
export function saveReviewDraft(storage: DraftStorage, scope: string, fields: ReviewDraftFields, now: number) {
  const key = reviewDraftKey(scope);
  try {
    if (hasReviewDraftText(fields)) storage.setItem(key, encodeReviewDraft(fields, scope, now));
    else storage.removeItem(key);
    return true;
  } catch { return false; }
}

export function discardReviewDraft(storage: DraftStorage, scope: string) {
  try { storage.removeItem(reviewDraftKey(scope)); return true; } catch { return false; }
}

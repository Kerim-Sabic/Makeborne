/**
 * Unsent "start a project" composer drafts, kept in this browser so a reload does not
 * lose a typed brief and its format, Plan/Create mode and effort.
 *
 * - Scoped to one owner: a signed-in account (account.<uuid>) or the signed-out device.
 *   One account's draft is never read for another account or for the signed-out device,
 *   and device drafts are never adopted by an account (only an explicit submit hands a
 *   brief to an account, through the existing protected creation draft).
 * - Schema-versioned and expiring; anything unreadable, expired, from another version or
 *   claiming another owner is removed rather than restored.
 * - Holds only text and three settings. Consent, approvals, quotes, request ids and files
 *   are never stored here, and restoring never submits anything.
 */
export const UNSENT_DRAFT_VERSION = 1;
export const UNSENT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const UNSENT_DRAFT_PREFIX = "makeborne.unsent-draft.v1.";
const MAX_TEXT = 20000;
const KINDS = ["website", "book", "presentation"] as const;
const MODES = ["create", "plan"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UnsentDraftSurface = "home" | "studio";
export type UnsentDraftFields<Effort extends string = string> = {
  kind: (typeof KINDS)[number];
  mode: (typeof MODES)[number];
  effort: Effort;
  text: string;
};
export type RestoredUnsentDraft<Effort extends string = string> = { fields: UnsentDraftFields<Effort>; savedAt: number };
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** "account.<uuid>" for a signed-in account, "device" when signed out. Throws for a malformed id. */
export function unsentDraftOwner(accountId: string | null) {
  if (accountId === null) return "device";
  if (!UUID.test(accountId)) throw new Error("Invalid draft account.");
  return `account.${accountId.toLowerCase()}`;
}
export const unsentDraftKey = (surface: UnsentDraftSurface, owner: string) => `${UNSENT_DRAFT_PREFIX}${surface}.${owner}`;

/** Only a brief with words in it is worth keeping; settings alone are not restored. */
export const hasUnsentText = (fields: Pick<UnsentDraftFields, "text">) => fields.text.trim().length > 0;

/** Stable comparison value for the four fields (used to tell local edits from adopted ones). */
export const unsentFieldsSignature = (fields: UnsentDraftFields) => JSON.stringify([fields.kind, fields.mode, fields.effort, fields.text]);

export function encodeUnsentDraft(fields: UnsentDraftFields, owner: string, now: number) {
  return JSON.stringify({ v: UNSENT_DRAFT_VERSION, owner, savedAt: now, kind: fields.kind, mode: fields.mode, effort: fields.effort, text: fields.text.slice(0, MAX_TEXT) });
}

/** Null for anything that must not be restored: wrong version or owner, expired, future-dated or malformed. */
export function decodeUnsentDraft<Effort extends string>(raw: string | null, owner: string, now: number, efforts: readonly Effort[]): RestoredUnsentDraft<Effort> | null {
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  const allowed = ["v", "owner", "savedAt", "kind", "mode", "effort", "text"];
  if (Object.keys(draft).some(key => !allowed.includes(key))) return null;
  if (draft.v !== UNSENT_DRAFT_VERSION || draft.owner !== owner) return null;
  if (typeof draft.savedAt !== "number" || !Number.isFinite(draft.savedAt)) return null;
  // A clock moved backwards by more than a minute makes the age unknowable.
  if (draft.savedAt > now + 60_000 || now - draft.savedAt > UNSENT_DRAFT_TTL_MS) return null;
  if (!KINDS.includes(draft.kind as never) || !MODES.includes(draft.mode as never) || !efforts.includes(draft.effort as Effort)) return null;
  if (typeof draft.text !== "string" || draft.text.length > MAX_TEXT || !draft.text.trim()) return null;
  return { fields: { kind: draft.kind as UnsentDraftFields["kind"], mode: draft.mode as UnsentDraftFields["mode"], effort: draft.effort as Effort, text: draft.text }, savedAt: draft.savedAt };
}

/** Reads this owner's draft, removing it when it can no longer be restored. Storage failures read as "no draft". */
export function readUnsentDraft<Effort extends string>(storage: DraftStorage, surface: UnsentDraftSurface, owner: string, now: number, efforts: readonly Effort[]) {
  const key = unsentDraftKey(surface, owner);
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return null; }
  const draft = decodeUnsentDraft(raw, owner, now, efforts);
  if (raw !== null && !draft) try { storage.removeItem(key); } catch { /* Nothing else to do. */ }
  return draft;
}

/** Saves a brief with text, or removes the draft when the brief is empty. Returns false when storage refused. */
export function saveUnsentDraft(storage: DraftStorage, surface: UnsentDraftSurface, owner: string, fields: UnsentDraftFields, now: number) {
  const key = unsentDraftKey(surface, owner);
  try {
    if (hasUnsentText(fields)) storage.setItem(key, encodeUnsentDraft(fields, owner, now));
    else storage.removeItem(key);
    return true;
  } catch { return false; }
}

export function discardUnsentDraft(storage: DraftStorage, surface: UnsentDraftSurface, owner: string) {
  try { storage.removeItem(unsentDraftKey(surface, owner)); return true; } catch { return false; }
}

/**
 * Another tab changed storage. Tabs converge on whatever storage holds now (last write wins),
 * so this tab adopts the stored value instead of the event payload, which may be stale.
 * Adopting never writes back, so two tabs cannot ping-pong. A key for another surface or
 * owner is ignored. `cleared` means the draft was discarded or submitted elsewhere.
 */
export function remoteUnsentDraft<Effort extends string>(eventKey: string | null, surface: UnsentDraftSurface, owner: string, stored: string | null, now: number, efforts: readonly Effort[]):
  { action: "ignore" } | { action: "adopt"; draft: RestoredUnsentDraft<Effort> } | { action: "cleared" } {
  if (eventKey !== null && eventKey !== unsentDraftKey(surface, owner)) return { action: "ignore" };
  const draft = decodeUnsentDraft(stored, owner, now, efforts);
  return draft ? { action: "adopt", draft } : { action: "cleared" };
}

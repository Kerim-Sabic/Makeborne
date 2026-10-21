"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { EFFORT_LEVELS, type EffortLevel } from "@/lib/routing/effort";
import { discardUnsentDraft, hasUnsentText, readUnsentDraft, remoteUnsentDraft, saveUnsentDraft, unsentDraftKey, unsentDraftOwner, unsentFieldsSignature, type UnsentDraftFields, type UnsentDraftSurface } from "@/lib/unsent-draft";

type Fields = UnsentDraftFields<EffortLevel>;
function browserStorage() { try { return window.localStorage; } catch { return null; } }

/**
 * Keeps one composer's unsent brief across reloads for the current owner only.
 * `account` is null until it is known which account (or signed-out device) owns the composer;
 * nothing is read or written before then. `enabled` is false while the composer is carrying a
 * brief from another flow (for example a home-page handoff), so that brief is never overwritten.
 * Restoring only sets the fields: it never submits, accepts, consents or attaches anything.
 */
export function useUnsentDraft({ surface, account, enabled, fields, defaults, apply }: {
  surface: UnsentDraftSurface;
  account: { accountId: string | null } | null;
  enabled: boolean;
  fields: Fields;
  defaults: Fields;
  apply: (fields: Fields) => void;
}) {
  let owner: string | null = null;
  try { owner = account ? unsentDraftOwner(account.accountId) : null; } catch { owner = null; }
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [storageRefused, setStorageRefused] = useState(false);
  // The owner whose brief the composer currently holds, and the fields last read from or written to storage.
  const heldBy = useRef<string | null>(null);
  const restoredFor = useRef<string | null>(null);
  const synced = useRef<string>(unsentFieldsSignature(defaults));
  // Fields this hook asked the composer to show; until they render, the old (possibly another
  // owner's) fields are on screen and must never be written.
  const awaiting = useRef<string | null>(null);
  const signature = unsentFieldsSignature(fields);
  function show(next: Fields) {
    const shown = unsentFieldsSignature(next);
    synced.current = shown;
    // Already on screen: there is no render to wait for.
    awaiting.current = shown === signature ? null : shown;
    apply(next);
  }
  const applyFields = useEffectEvent(show);

  // Owner resolved or changed: never let one account's brief stay on screen for another, then restore.
  useEffect(() => {
    if (!owner) return;
    const switched = heldBy.current !== null && heldBy.current !== owner;
    if (switched) {
      restoredFor.current = null;
      queueMicrotask(() => { setRestoredAt(null); setStorageRefused(false); });
      applyFields(defaults);
    }
    heldBy.current = owner;
    if (!enabled || restoredFor.current === owner) return;
    restoredFor.current = owner;
    // Text typed while the account was still being checked is this owner's and wins over storage.
    if (!switched && hasUnsentText(fields)) return;
    const storage = browserStorage();
    const draft = storage && readUnsentDraft(storage, surface, owner, Date.now(), EFFORT_LEVELS);
    if (!draft) return;
    applyFields(draft.fields);
    queueMicrotask(() => setRestoredAt(draft.savedAt));
    // Only the owner, surface and enablement decide when to restore; field edits are saved below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, enabled, surface]);

  // Local edits are written straight away so a reload right after typing keeps them.
  useEffect(() => {
    if (awaiting.current !== null) {
      if (awaiting.current !== signature) return;
      awaiting.current = null;
    }
    if (!owner || !enabled || restoredFor.current !== owner || signature === synced.current) return;
    const storage = browserStorage();
    const saved = !!storage && saveUnsentDraft(storage, surface, owner, fields, Date.now());
    if (saved) synced.current = signature;
    queueMicrotask(() => { setStorageRefused(!saved); if (!hasUnsentText(fields)) setRestoredAt(null); });
    // fields is represented by signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, enabled, surface, signature]);

  // Another tab saved, discarded or submitted this owner's brief.
  const onStorage = useEffectEvent((event: StorageEvent) => {
    if (!owner || !enabled || restoredFor.current !== owner) return;
    if (event.storageArea && event.storageArea !== browserStorage()) return;
    // A brief with edits this tab could not save yet is not replaced.
    if (awaiting.current !== null || signature !== synced.current) return;
    const key = unsentDraftKey(surface, owner);
    let stored: string | null = null;
    try { stored = browserStorage()?.getItem(key) ?? null; } catch { return; }
    const remote = remoteUnsentDraft(event.key, surface, owner, stored, Date.now(), EFFORT_LEVELS);
    if (remote.action === "ignore") return;
    const next = remote.action === "adopt" ? remote.draft.fields : defaults;
    if (unsentFieldsSignature(next) === signature) return;
    applyFields(next);
    setRestoredAt(null);
  });
  useEffect(() => {
    const listener = (event: StorageEvent) => onStorage(event);
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, []);

  return {
    restoredAt: restoredAt !== null && hasUnsentText(fields) ? restoredAt : null,
    storageRefused: storageRefused && hasUnsentText(fields),
    /** Explicit discard: clears the composer and the stored copy. */
    discard() {
      const storage = browserStorage();
      if (owner && storage) discardUnsentDraft(storage, surface, owner);
      setRestoredAt(null); setStorageRefused(false);
      show(defaults);
    },
    /** The brief was handed to the protected creation flow; the unsent copy is no longer needed. */
    submitted() {
      const storage = browserStorage();
      if (owner && storage) discardUnsentDraft(storage, surface, owner);
      synced.current = signature;
      setRestoredAt(null); setStorageRefused(false);
    },
  };
}

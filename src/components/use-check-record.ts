"use client";
import { useMemo, useSyncExternalStore } from "react";
import { checkCounts, checkRecordKey, parseCheckRecord, type CheckKind, type CheckRecord, type ScopeIds } from "@/lib/hosting/version-facts";

/** The latest explicit check of a saved version, per account/workspace/website, kept
 * for this browser tab (sessionStorage, with an in-memory copy when storage is
 * unavailable). It is a convenience for the editor header and History, not a
 * server record: another device or a new tab starts with "Not checked yet". */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
function readRaw(key: string) {
  try { return sessionStorage.getItem(key) ?? memory.get(key) ?? null; } catch { return memory.get(key) ?? null; }
}

export function recordCheck(scope: ScopeIds, check: { version: number; dirty: boolean; kind: CheckKind; prepared: boolean }) {
  if (!checkCounts(check.version, check.dirty)) return;
  const key = checkRecordKey(scope), value = JSON.stringify({ version: check.version, kind: check.kind, at: new Date().toISOString(), prepared: check.prepared } satisfies CheckRecord);
  memory.set(key, value);
  try { sessionStorage.setItem(key, value); } catch { /* the in-memory copy still serves this tab */ }
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export function useCheckRecord(scope: ScopeIds): CheckRecord | null {
  const key = checkRecordKey(scope);
  const raw = useSyncExternalStore(subscribe, () => readRaw(key), () => null);
  return useMemo(() => parseCheckRecord(raw), [raw]);
}

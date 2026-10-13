"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { OperationSnapshotSchema, OperationStatusSchema, type OperationRequest, type OperationSnapshot, type OperationStatus } from "@/lib/builder/operation-contract";

type Scope = { accountId: string; workspaceId: string; artifactId: string; channel?: "build" | "plan" };
type Identity = { actionKey: string; id?: string };
const validId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const subscribeStorage = (notify: () => void) => {
  window.addEventListener("storage", notify); window.addEventListener("makeborne-operation-identity", notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener("makeborne-operation-identity", notify); };
};
const noSubscription = () => () => undefined;
const browserReady = () => true;
const serverReady = () => false;
const serverIdentity = () => null;
function readIdentity(raw: string | null): Identity | null {
  try {
    const saved = JSON.parse(raw ?? "null");
    return saved && validId(saved.actionKey) && (saved.id === undefined || validId(saved.id)) ? { actionKey: saved.actionKey, ...(saved.id ? { id: saved.id } : {}) } : null;
  } catch { return null; }
}

/** Only identity is retained. Prompts, attachments, tokens and results remain
 * on their existing server paths; browser storage never authorizes spending. */
export function useBuilderOperation(scope: Scope) {
  const { accountId, workspaceId, artifactId } = scope;
  const key = `makeborne:operation:v1:${accountId}:${workspaceId}:${artifactId}:${scope.channel ?? "build"}`;
  const activeKey = useRef(key);
  const identity = useRef<Identity | null>(null);
  const authorizationKeys = useRef(new Map<string, string>());
  const refreshSequence = useRef(0);
  const ready = useSyncExternalStore(noSubscription, browserReady, serverReady);
  const storageSnapshot = useCallback(() => { try { return sessionStorage.getItem(key); } catch { return null; } }, [key]);
  const deviceIdentity = useSyncExternalStore(subscribeStorage, storageSnapshot, serverIdentity);
  const hasPrevious = Boolean(readIdentity(deviceIdentity));
  const [operationState, setOperationState] = useState<{ key: string; value: OperationSnapshot | null } | null>(null);
  const [checkingState, setCheckingState] = useState<{ key: string; value: boolean } | null>(null);
  const [noticeState, setNoticeState] = useState<{ key: string; value: string } | null>(null);
  const [recoveryState, setRecoveryState] = useState<{ key: string; value: OperationStatus["recovery"] } | null>(null);
  const operation = operationState?.key === key ? operationState.value : null;
  const checking = checkingState?.key === key ? checkingState.value : false;
  const recoveryNotice = noticeState?.key === key ? noticeState.value : "";
  const recovery = recoveryState?.key === key ? recoveryState.value : null;
  const setOperation = useCallback((value: OperationSnapshot | null) => setOperationState({ key, value }), [key]);
  const setChecking = useCallback((value: boolean) => setCheckingState({ key, value }), [key]);
  const setRecoveryNotice = useCallback((value: string) => setNoticeState({ key, value }), [key]);
  const setRecovery = useCallback((value: OperationStatus["recovery"]) => setRecoveryState({ key, value }), [key]);
  const retain = useCallback((value: Identity) => {
    identity.current = value;
    try { sessionStorage.setItem(key, JSON.stringify(value)); window.dispatchEvent(new Event("makeborne-operation-identity")); } catch { /* Durable server status remains authoritative. */ }
  }, [key]);
  const observe = useCallback((value: unknown) => {
    if (activeKey.current !== key) return null;
    const checked = OperationSnapshotSchema.safeParse(value);
    if (!checked.success) return null;
    setOperation(checked.data);
    if (identity.current) retain({ ...identity.current, id: checked.data.id });
    return checked.data;
  }, [key, retain, setOperation]);
  const refresh = useCallback(async (): Promise<OperationStatus | null> => {
    const known = identity.current;
    if (!known) return null;
    const sequence = ++refreshSequence.current;
    setChecking(true);
    try {
      const query = new URLSearchParams({ workspaceId, artifactId, ...(known.id ? { id: known.id } : { actionKey: known.actionKey }) });
      const response = await fetch(`/api/build/operations?${query}`, { cache: "no-store", headers: { "X-Makeborne-Account": accountId } });
      const value = await response.json().catch(() => null);
      if (activeKey.current !== key || identity.current?.actionKey !== known.actionKey || sequence !== refreshSequence.current) return null;
      const parsed = OperationStatusSchema.safeParse(value);
      if (!response.ok || !parsed.success || !observe(parsed.data.operation)) {
        setRecoveryNotice(response.status === 404 ? "No recorded operation was found. Check the project before submitting again." : "The saved result and charge could not be checked. Check again before submitting the same request.");
        return null;
      }
      setRecovery(parsed.data.recovery);
      setRecoveryNotice(parsed.data.operation.status === "running" ? "The request is still running. Checking its status does not start another generation."
        : parsed.data.recovery ? "Finished work is retained for recovery. Preview it before choosing whether to save it over the current version."
        : "Loaded the recorded operation. Reload the project to see its latest saved version.");
      return parsed.data;
    } finally { if (activeKey.current === key && sequence === refreshSequence.current) setChecking(false); }
  }, [accountId, artifactId, key, observe, setChecking, setRecovery, setRecoveryNotice, workspaceId]);
  useEffect(() => {
    activeKey.current = key;
    identity.current = null;
    authorizationKeys.current.clear();
    refreshSequence.current++;
    identity.current = readIdentity(storageSnapshot());
    if (identity.current) void refresh().catch(() => setRecoveryNotice("The previous request could not be checked. Check its status before submitting again."));
  }, [key, refresh, setRecoveryNotice, storageSnapshot]);
  const begin = useCallback((): OperationRequest => {
    refreshSequence.current++;
    const value = { actionKey: crypto.randomUUID(), stepKey: crypto.randomUUID() };
    retain({ actionKey: value.actionKey });
    setOperation(null); setRecoveryNotice(""); setChecking(false); setRecovery(null);
    return value;
  }, [retain, setChecking, setOperation, setRecovery, setRecoveryNotice]);
  const authorize = useCallback(async (current: OperationSnapshot) => {
    const additionalCredits = current.maximumAdditionalCredits;
    if (!current.canContinue || additionalCredits < 1) throw new Error("This operation cannot receive more credits.");
    const intent = `${current.id}:${current.revision}:${additionalCredits}`;
    const authorizationKey = authorizationKeys.current.get(intent) ?? crypto.randomUUID();
    authorizationKeys.current.set(intent, authorizationKey);
    const response = await fetch("/api/build/operations", { method: "PATCH", headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId },
      body: JSON.stringify({ workspaceId, artifactId, id: current.id, expectedRevision: current.revision, authorizationKey, additionalCredits, acknowledged: true }) });
    const value = await response.json().catch(() => null);
    const next = observe(value?.operation);
    if (!response.ok || !next) throw new Error(value?.error?.message ?? "The additional allowance was not confirmed. Check the operation before retrying.");
    return next;
  }, [accountId, artifactId, observe, workspaceId]);
  const recover = useCallback(async (current: OperationSnapshot, runId: string, expectedVersion: number) => {
    const response = await fetch("/api/build/operations", { method: "POST", headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId },
      body: JSON.stringify({ workspaceId, artifactId, id: current.id, runId, expectedVersion, acknowledged: true }) });
    const value = await response.json().catch(() => null);
    const parsed = OperationStatusSchema.safeParse(value);
    if (!response.ok || !parsed.success || !observe(parsed.data.operation)) throw new Error(value?.error?.message ?? "The recovery result was not confirmed. Check its status before retrying.");
    setRecovery(parsed.data.recovery);
    return parsed.data;
  }, [accountId, artifactId, observe, setRecovery, workspaceId]);
  return { operation, recovery, checking, recoveryNotice, ready, hasPrevious, actionKey: readIdentity(deviceIdentity)?.actionKey ?? null, begin, observe, refresh, authorize, recover };
}

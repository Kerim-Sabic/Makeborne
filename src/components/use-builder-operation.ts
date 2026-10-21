"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { OperationSnapshotSchema, OperationStatusSchema, type OperationRequest, type OperationSnapshot, type OperationStatus } from "@/lib/builder/operation-contract";

type Scope = { accountId: string; workspaceId: string; artifactId: string; channel?: "build" | "plan" };
type Identity = { actionKey: string; id?: string; cancelPending?: true };
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
    return saved && validId(saved.actionKey) && (saved.id === undefined || validId(saved.id)) ? { actionKey: saved.actionKey, ...(saved.id ? { id: saved.id } : {}), ...(saved.cancelPending === true ? { cancelPending: true } : {}) } : null;
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
  const cancelFlight = useRef<string | null>(null);
  const autoCancelAttempt = useRef<string | null>(null);
  const latestSnapshot = useRef<{ key: string; value: OperationSnapshot } | null>(null);
  const ready = useSyncExternalStore(noSubscription, browserReady, serverReady);
  const storageSnapshot = useCallback(() => { try { return sessionStorage.getItem(key); } catch { return null; } }, [key]);
  const deviceIdentity = useSyncExternalStore(subscribeStorage, storageSnapshot, serverIdentity);
  const hasPrevious = Boolean(readIdentity(deviceIdentity));
  const [operationState, setOperationState] = useState<{ key: string; value: OperationSnapshot | null } | null>(null);
  const [checkingState, setCheckingState] = useState<{ key: string; value: boolean } | null>(null);
  const [noticeState, setNoticeState] = useState<{ key: string; value: string } | null>(null);
  const [recoveryState, setRecoveryState] = useState<{ key: string; value: OperationStatus["recovery"] } | null>(null);
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);
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
    // A delayed initial SSE event must not undo a newer Stop acknowledgement.
    const latest = latestSnapshot.current;
    if (latest?.key === key && latest.value.id === checked.data.id && latest.value.revision > checked.data.revision) return latest.value;
    latestSnapshot.current = { key, value: checked.data };
    setOperation(checked.data);
    if (identity.current) retain({ actionKey: identity.current.actionKey, id: checked.data.id,
      ...(identity.current.cancelPending && !checked.data.cancelRequested && checked.data.status !== "cancelled" ? { cancelPending: true } : {}) });
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
    latestSnapshot.current = null;
    identity.current = null;
    authorizationKeys.current.clear();
    refreshSequence.current++;
    identity.current = readIdentity(storageSnapshot());
    if (identity.current) void refresh().catch(() => setRecoveryNotice("The previous request could not be checked. Check its status before submitting again."));
  }, [key, refresh, setRecoveryNotice, storageSnapshot]);
  /** A new explicit action. `repeat` reuses one approval's identity, so a repeated
   * click replays the same server operation instead of creating a second one. */
  const begin = useCallback((repeat?: { actionKey: string; stepKey: string }): OperationRequest => {
    refreshSequence.current++;
    latestSnapshot.current = null;
    const value = repeat && validId(repeat.actionKey) && validId(repeat.stepKey) ? { actionKey: repeat.actionKey, stepKey: repeat.stepKey } : { actionKey: crypto.randomUUID(), stepKey: crypto.randomUUID() };
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
  const cancel = useCallback(async () => {
    const known = identity.current;
    if (!known) throw new Error("The request has not been recorded yet. Try Stop again.");
    if (cancelFlight.current === key) return;
    cancelFlight.current = key; setCancellingKey(key);
    // Keep only intent + identity across a reload. This grants no authority and
    // lets the real server state settle even if the initial SSE event is late.
    retain({ ...known, cancelPending: true });
    try {
      const response = await fetch("/api/build/operations", { method: "DELETE", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId },
        body: JSON.stringify({ workspaceId, artifactId, ...(known.id ? { id: known.id, ...(operation?.id === known.id ? { expectedRevision: operation.revision } : {}) } : { actionKey: known.actionKey }) }) });
      const value = await response.json().catch(() => null);
      if (activeKey.current !== key || identity.current?.actionKey !== known.actionKey) return;
      const parsed = OperationStatusSchema.safeParse(value);
      if (!response.ok || !parsed.success) {
        setRecoveryNotice("Stop has not been confirmed yet. Retry Stop or check the recorded result; closing this tab alone does not stop paid work.");
        return;
      }
      const next = observe(parsed.data.operation);
      if (!next) return;
      retain({ actionKey: known.actionKey, id: next.id });
      setRecovery(parsed.data.recovery);
      setRecoveryNotice(next.cancelRequested
        ? next.status === "running" ? "Stop requested. Waiting for the recorded charge and remaining credits to settle." : "Stopped. Check the recorded charge and any recoverable work."
        : "This request already finished. Its recorded result and charge are unchanged.");
    } catch {
      if (activeKey.current === key) setRecoveryNotice("Stop has not been confirmed yet. Retry Stop or check the recorded result; closing this tab alone does not stop paid work.");
    } finally {
      if (cancelFlight.current === key) { cancelFlight.current = null; setCancellingKey(null); }
    }
  }, [accountId, artifactId, key, observe, operation, retain, setRecovery, setRecoveryNotice, workspaceId]);
  const pendingCancel = readIdentity(deviceIdentity)?.cancelPending === true;
  useEffect(() => {
    if (!pendingCancel || !operation || operation.cancelRequested) return;
    const attempt = `${key}:${operation.id}:${operation.revision}`;
    if (autoCancelAttempt.current === attempt) return;
    autoCancelAttempt.current = attempt;
    void cancel();
  }, [cancel, key, operation, pendingCancel]);
  useEffect(() => {
    if (!operation?.cancelRequested || operation.status !== "running") return;
    const timer = window.setTimeout(() => void refresh().catch(() => setRecoveryNotice("Stopped work is still being checked. Use Check saved result & charge again.")), 1000);
    return () => window.clearTimeout(timer);
  }, [operation, refresh, setRecoveryNotice]);
  return { operation, recovery, checking, recoveryNotice, ready, hasPrevious, actionKey: readIdentity(deviceIdentity)?.actionKey ?? null,
    begin, observe, refresh, authorize, recover, cancel, cancelling: cancellingKey === key, pendingCancel };
}

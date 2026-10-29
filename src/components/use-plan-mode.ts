"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdvisorProvenance } from "@/lib/experts/advisor-brief";
import type { EffortLevel } from "@/lib/routing/effort";
import { estimatePlanCredits, parsePlan, recommendedEffort, StoredPlanSchema, type PlanEstimate, type SitePlan, type StoredPlan } from "@/lib/builder/plan";
import { useBuilderOperation } from "./use-builder-operation";
import { serializeBuilderRequest } from "@/lib/builder/attachments";
import { canonicalSourceJson } from "@/lib/projects/canonical-json";

export type ActivePlan = {
  turnId: string;
  stored: StoredPlan;
  estimate: PlanEstimate;
  recommended: EffortLevel;
  save: "saved" | "saving" | "local" | "error";
};
type PlanView = { stored: unknown; persisted?: boolean; error?: { message?: string } };
type Save = { plan: SitePlan; status: "draft" | "built"; edit: number };
type Session = { key: object; live: boolean; active: ActivePlan | null; revision: number | null; edit: number; generation: number; running: boolean;
  blocked: boolean; queue: Save | null; timer: ReturnType<typeof setTimeout> | null; saving: Promise<void> | null };

function readPlanView(value: unknown, turnId: string): ActivePlan | null {
  if (!value || typeof value !== "object") return null;
  const view = value as PlanView, checked = StoredPlanSchema.safeParse(view.stored);
  if (!checked.success) return null;
  return { turnId, stored: checked.data, estimate: estimatePlanCredits(checked.data.plan), recommended: recommendedEffort(checked.data.plan),
    save: view.persisted === false ? "local" : "saved" };
}

function cancelSave(session: Session) {
  if (session.timer) clearTimeout(session.timer);
  session.timer = null; session.queue = null;
}
export type PlanAttachment = { name: string; mediaType: string; data: string } | { name: string; mediaType: string; reference: { assetId: string; sha256: string; bytes: number } };
/** Attached files the user explicitly chose to continue without; recorded in the request. */
export type PlanOmittedSource = { name: string; reason: "left-out" | "unreadable" | "partial" };
export type PlanCallbacks = {
  onText: (delta: string) => void;
  onStatus: (message: string) => void;
  onCredits: (credits: number) => void;
  onPlan: (plan: ActivePlan) => void;
  onDone: (charged: number) => void;
  onError: (message: string) => void;
};

/** Reads a server-sent event stream of JSON `data:` lines. */
export async function readEvents(response: Response, handle: (event: Record<string, unknown> & { type: string }) => void) {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      const line = chunk.split("\n").find(entry => entry.startsWith("data: "));
      if (line) handle(JSON.parse(line.slice(6)));
    }
  }
}

/** Plan mode state for one website: loads the saved plan, runs planning
 * calls, and saves inline edits (debounced). */
export function usePlanMode({ accountId, workspaceId, artifactId }: { accountId: string; workspaceId: string; artifactId: string }) {
  const scope = JSON.stringify([accountId, workspaceId, artifactId]);
  const key = useMemo(() => ({ scope }), [scope]);
  const sessionRef = useRef<Session | null>(null);
  const [state, setState] = useState<{ key: object; active: ActivePlan | null; restored: ActivePlan | null } | null>(null);
  const active = state?.key === key ? state.active : null;
  const restored = state?.key === key ? state.restored : null;
  const { operation, recovery, checking, recoveryNotice, ready, hasPrevious, begin, observe, refresh, recover: recoverOperation, cancel, cancelling, pendingCancel } = useBuilderOperation({ accountId, workspaceId, artifactId, channel: "plan" });
  const recoverablePlan = useMemo(() => recovery?.candidate && typeof recovery.candidate === "object"
    ? readPlanView({ ...recovery.candidate, persisted: false }, "recovered-plan") : null, [recovery]);
  const publish = useCallback((plan: ActivePlan | null, restore = false) => {
    const session = sessionRef.current;
    if (!session?.live || session.key !== key) return;
    session.active = plan;
    setState(current => ({ key, active: plan, restored: restore ? plan : current?.key === key ? current.restored : null }));
  }, [key]);

  useEffect(() => {
    const session: Session = { key, live: true, active: null, revision: null, edit: 0, generation: 0, running: false,
      blocked: false, queue: null, timer: null, saving: null };
    sessionRef.current = session;
    const controller = new AbortController();
    const generation = session.generation;
    const query = new URLSearchParams({ workspaceId, artifactId });
    fetch(`/api/build/plan?${query}`, { cache: "no-store", headers: { "X-Makeborne-Account": accountId }, signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<PlanView> : null)
      .then(view => {
        if (!session.live || controller.signal.aborted || session.generation !== generation || session.edit || !view) return;
        if (view.stored === null) { session.revision = 0; return; }
        const plan = readPlanView(view, "restored-plan");
        if (!plan) return;
        session.revision = plan.stored.revision;
        if (plan.stored.status === "draft") publish(plan, true);
      })
      .catch(() => undefined);
    return () => { session.live = false; session.generation++; cancelSave(session); controller.abort(); };
  }, [accountId, workspaceId, artifactId, publish, key]);

  const flush = useCallback((): Promise<void> => {
    const session = sessionRef.current;
    if (!session?.live || session.key !== key) return Promise.resolve();
    if (session.saving) return session.saving;
    const drain = async () => {
      while (session.live && !session.running && !session.blocked && session.queue) {
        const save = session.queue, generation = session.generation;
        session.queue = null;
        const revision = session.active?.stored.revision ?? session.revision;
        if (revision === null) return;
        try {
          const response = await fetch("/api/build/plan", { method: "PUT", headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId },
            body: JSON.stringify({ workspaceId, artifactId, plan: save.plan, status: save.status, expectedRevision: revision }) });
          const value = await response.json().catch(() => null) as PlanView | null;
          if (!session.live || session.generation !== generation) return;
          const saved = readPlanView(value, session.active?.turnId ?? "restored-plan");
          if (!response.ok || !saved || value?.persisted !== true || saved.stored.revision < revision) throw new Error("Save was not confirmed.");
          // Only this acknowledgement may advance the authority of queued local edits.
          session.revision = saved.stored.revision;
          const current = session.active;
          if (current) publish(session.edit === save.edit ? saved : { ...current, stored: { ...current.stored, revision: saved.stored.revision } });
        } catch {
          if (!session.live || session.generation !== generation) return;
          session.blocked = true; cancelSave(session);
          if (session.active) publish({ ...session.active, save: "error" });
        }
      }
    };
    const pending = drain().finally(() => { if (session.saving === pending) session.saving = null; });
    session.saving = pending;
    return pending;
  }, [accountId, workspaceId, artifactId, publish, key]);

  /** Applies an inline edit locally and saves it shortly after. */
  const edit = useCallback((plan: SitePlan) => {
    const session = sessionRef.current;
    if (!session?.live || session.key !== key || !session.active) return;
    cancelSave(session); session.edit++;
    const checked = parsePlan(plan);
    publish({ ...session.active, stored: { ...session.active.stored, plan, status: "draft" }, save: !checked.plan || session.blocked || session.running ? "error" : "saving" });
    if (!checked.plan || session.blocked || session.running) return;
    const save: Save = { plan: checked.plan, status: "draft", edit: session.edit };
    session.timer = setTimeout(() => { session.timer = null; session.queue = save; void flush(); }, 700);
  }, [flush, publish, key]);

  /** Saves `plan` now when it differs from the saved revision, then returns exactly
   * what is saved. A build approves only this saved revision; an unsaved, failed or
   * superseded edit refuses here instead of being built from local state. */
  const approve = useCallback(async (plan: SitePlan): Promise<{ plan: SitePlan; revision: number }> => {
    const session = sessionRef.current;
    if (!session?.live || session.key !== key || !session.active) throw new Error("Reload the plan before building it.");
    const current = session.active;
    if (current.stored.status !== "draft") throw new Error("This plan was already built. Revise it or describe the next change.");
    if (session.running || session.blocked || current.save === "error" || current.save === "local") throw new Error("This plan isn't saved. Fix the highlighted fields or reload the plan before building.");
    const checked = parsePlan(plan);
    if (!checked.plan) throw new Error(`This plan can't be saved: ${checked.error}`);
    const generation = session.generation;
    if (session.timer || canonicalSourceJson(checked.plan) !== canonicalSourceJson(current.stored.plan)) {
      cancelSave(session); session.edit++;
      publish({ ...current, stored: { ...current.stored, plan: checked.plan, status: "draft" }, save: "saving" });
      session.queue = { plan: checked.plan, status: "draft", edit: session.edit };
    }
    await flush();
    const saved = session.active;
    if (!session.live || session.generation !== generation || session.blocked || session.timer || session.queue || !saved || saved.save !== "saved"
      || saved.stored.status !== "draft" || canonicalSourceJson(saved.stored.plan) !== canonicalSourceJson(checked.plan)) {
      throw new Error("The plan was not confirmed as saved, so it was not built. Check it and try again.");
    }
    return { plan: saved.stored.plan, revision: saved.stored.revision };
  }, [flush, publish, key]);

  const markBuilt = useCallback((plan: SitePlan) => {
    const session = sessionRef.current;
    if (!session?.live || session.key !== key) return;
    const current = session.active;
    // A build completing after another edit must not mark that newer draft built.
    if (!session.live || !current || session.running || session.blocked || JSON.stringify(plan) !== JSON.stringify(current.stored.plan)) return;
    cancelSave(session); session.edit++;
    session.queue = { plan, status: "built", edit: session.edit };
    publish({ ...current, save: "saving" });
    void flush();
  }, [flush, publish, key]);

  const restoreRecorded = useCallback((value: unknown, turnId: string, expectedEdit: number, allowLocal = false) => {
    const session = sessionRef.current;
    if (!session?.live || session.key !== key) return null;
    const plan = readPlanView(value, turnId);
    if (!session.live || !plan) return null;
    if (session.edit !== expectedEdit || (session.active && session.active.save !== "saved" && !session.running && !allowLocal)) return null;
    // A historical operation result cannot replace a newer saved plan.
    if (plan.save === "saved" && session.revision !== null && plan.stored.revision < session.revision) return null;
    cancelSave(session); session.blocked = plan.save !== "saved";
    if (plan.save === "saved") session.revision = plan.stored.revision;
    publish(plan, turnId === "restored-plan");
    return plan;
  }, [publish, key]);

  const refreshOperation = useCallback(async () => {
    const session = sessionRef.current;
    if (!session?.live || session.key !== key) return null;
    const generation = session.generation, edit = session.edit;
    const status = await refresh();
    if (!session.live || session.generation !== generation) return null;
    if (status?.result?.stored) restoreRecorded(status.result, "restored-plan", edit);
    else if (status?.recovery?.candidate && typeof status.recovery.candidate === "object") {
      restoreRecorded({ ...status.recovery.candidate, persisted: false }, "restored-plan", edit);
    }
    return status;
  }, [refresh, restoreRecorded, key]);

  const recoverPlan = useCallback(async (expectedVersion: number) => {
    const session = sessionRef.current;
    if (!session?.live || session.key !== key || !operation || !recovery || !recoverablePlan) return null;
    if (session.running || session.saving || session.timer || session.active?.save === "saving" || session.active?.save === "error") {
      throw new Error("Keep or reload your current plan edits before saving the recovered plan.");
    }
    const edit = session.edit, generation = session.generation;
    session.running = true;
    try {
      const status = await recoverOperation(operation, recovery.runId, expectedVersion);
      if (!session.live || session.generation !== generation) return null;
      if (session.live && session.generation === generation && status?.result?.stored) {
        if (session.edit !== edit) session.blocked = true;
        restoreRecorded(status.result, "recovered-plan", edit, true);
      }
      return status;
    } finally { if (session.live && session.generation === generation) session.running = false; }
  }, [operation, recovery, recoverablePlan, recoverOperation, restoreRecorded, key]);

  /** Runs one planning call. Revises the active draft plan when there is one. */
  const run = useCallback(async (input: { turnId: string; message: string; effort: EffortLevel; expectedVersion: number; attachments: PlanAttachment[]; omittedSources?: PlanOmittedSource[]; revise: SitePlan | null; approvedMaximum: number; provenance?: AdvisorProvenance }, on: PlanCallbacks) => {
    let finished = false;
    const session = sessionRef.current;
    if (!session?.live || session.key !== key || session.running) return;
    const edit = session.edit;
    session.running = true; cancelSave(session);
    // Let a dispatched manual save settle before capturing the generation baseline.
    await session.saving;
    if (!session.live) return;
    if (session.revision === null || session.blocked) {
      session.running = false;
      on.onError("The saved plan could not be confirmed. Reload it before planning again."); return;
    }
    const generation = ++session.generation;
    const isCurrent = () => session.live && session.generation === generation;
    const requestOperation = begin();
    const recover = async () => {
      const status = await refresh().catch(() => null);
      if (!isCurrent()) return false;
      const recorded = status?.result;
      const recovered = recorded?.stored ? restoreRecorded(recorded, input.turnId, edit) : null;
      if (recovered) on.onPlan(recovered);
      // SQL keeps a finished operation active for possible later actions. The
      // persisted run result, with no pending step, confirms this plan finished.
      const recordedPlanFinished = status?.operation.kind === "plan" && status.operation.status !== "running"
        && status.operation.pendingKind === null && !status.operation.canContinue
        && recorded?.persisted === true && Boolean(recorded.runId);
      if (recovered && recordedPlanFinished && Number.isFinite(recorded?.charged)) {
        finished = true; on.onDone(recorded!.charged); return true;
      }
      if (!recovered && status?.recovery?.candidate && typeof status.recovery.candidate === "object") {
        const retained = restoreRecorded({ ...status.recovery.candidate, persisted: false }, input.turnId, edit);
        if (retained) on.onPlan(retained);
      }
      return false;
    };
    try {
      const response = await fetch("/api/build/plan", { method: "POST", headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId },
        body: serializeBuilderRequest({ workspaceId, artifactId, expectedVersion: input.expectedVersion, expectedRevision: session.revision, message: input.message, effort: input.effort, approvedMaximum: input.approvedMaximum,
          operation: requestOperation,
          attachments: input.attachments, ...(input.omittedSources?.length ? { omittedSources: input.omittedSources } : {}), ...(input.revise ? { previousPlan: input.revise } : {}), ...(input.provenance ? { provenance: input.provenance } : {}) }) });
      if (!isCurrent()) return;
      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => null);
        if (failure?.operation) observe(failure.operation);
        throw new Error(failure?.error?.message ?? "Planning couldn't start. Please try again.");
      }
      await readEvents(response, event => {
        if (!isCurrent() || finished) return;
        if (event.operation) observe(event.operation);
        switch (event.type) {
          case "text": on.onText(String(event.delta)); break;
          case "status": on.onStatus(String(event.message)); break;
          case "usage": on.onCredits(Number(event.credits)); break;
          case "plan": {
            if (!readPlanView(event, input.turnId)) throw new Error("The recorded plan is invalid. Check its saved result before retrying.");
            const plan = restoreRecorded(event, input.turnId, edit);
            if (plan) on.onPlan(plan);
            else if (session.edit !== edit && session.active) { session.blocked = true; publish({ ...session.active, save: "error" }); }
            break;
          }
          case "done":
            if (typeof event.charged !== "number" || !Number.isFinite(event.charged) || event.charged < 0) throw new Error("The final charge could not be confirmed. Check its recorded status.");
            finished = true; on.onDone(event.charged); break;
          case "error": finished = true; on.onError(String(event.message)); break;
        }
      });
      if (isCurrent() && !finished) {
        const recovered = await recover();
        if (isCurrent() && !recovered) on.onError("The connection closed before the final result arrived. Check the recorded plan and charge before submitting again.");
      }
    } catch (error) {
      if (isCurrent() && !finished) {
        const recovered = await recover();
        if (isCurrent() && !recovered) on.onError(error instanceof Error ? error.message : "Planning failed.");
      }
    } finally { if (isCurrent()) session.running = false; }
  }, [accountId, workspaceId, artifactId, begin, observe, refresh, publish, restoreRecorded, key]);

  return useMemo(() => ({ active, restored, run, edit, approve, markBuilt, operation, checking, recoveryNotice, ready, hasPrevious, refreshOperation, recoverablePlan, recoverPlan, cancel, cancelling, pendingCancel }), [active, restored, run, edit, approve, markBuilt, operation, checking, recoveryNotice, ready, hasPrevious, refreshOperation, recoverablePlan, recoverPlan, cancel, cancelling, pendingCancel]);
}

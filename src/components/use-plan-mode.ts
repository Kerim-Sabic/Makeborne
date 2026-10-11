"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EffortLevel } from "@/lib/routing/effort";
import { parsePlan, type PlanEstimate, type SitePlan, type StoredPlan } from "@/lib/builder/plan";

export type ActivePlan = {
  turnId: string;
  stored: StoredPlan;
  estimate: PlanEstimate;
  recommended: EffortLevel;
  save: "saved" | "saving" | "local" | "error";
};
type PlanView = { stored: StoredPlan | null; estimate?: PlanEstimate; recommended?: EffortLevel; persisted?: boolean };
export type PlanAttachment = { name: string; mediaType: string; data: string };
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
  const [active, setActive] = useState<ActivePlan | null>(null);
  const [restored, setRestored] = useState<ActivePlan | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/build/plan?workspaceId=${workspaceId}&artifactId=${artifactId}`, { cache: "no-store", headers: { "X-Makeborne-Account": accountId } })
      .then(response => response.ok ? response.json() as Promise<PlanView> : null)
      .then(view => {
        if (cancelled || !view?.stored || view.stored.status !== "draft" || !view.estimate || !view.recommended) return;
        const plan: ActivePlan = { turnId: "restored-plan", stored: view.stored, estimate: view.estimate, recommended: view.recommended, save: "saved" };
        setRestored(plan);
        setActive(current => current ?? plan);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [accountId, workspaceId, artifactId]);

  const persist = useCallback(async (plan: SitePlan, status: "draft" | "built") => {
    const response = await fetch("/api/build/plan", { method: "PUT", headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId },
      body: JSON.stringify({ workspaceId, artifactId, plan, status }) });
    const value = await response.json().catch(() => null) as (PlanView & { error?: { message?: string } }) | null;
    if (!response.ok || !value?.stored) throw new Error(value?.error?.message ?? "The plan couldn't be saved.");
    return value;
  }, [accountId, workspaceId, artifactId]);

  /** Applies an inline edit locally and saves it shortly after. */
  const edit = useCallback((plan: SitePlan) => {
    setActive(current => current && { ...current, stored: { ...current.stored, plan }, save: "saving" });
    if (timer.current) clearTimeout(timer.current);
    const checked = parsePlan(plan);
    if (!checked.plan) { setActive(current => current && { ...current, save: "error" }); return; }
    timer.current = setTimeout(() => {
      persist(checked.plan, "draft")
        .then(value => setActive(current => current && { ...current, estimate: value.estimate ?? current.estimate, recommended: value.recommended ?? current.recommended, save: value.persisted ? "saved" : "local" }))
        .catch(() => setActive(current => current && { ...current, save: "error" }));
    }, 700);
  }, [persist]);

  const markBuilt = useCallback((plan: SitePlan) => {
    setActive(current => current && { ...current, stored: { ...current.stored, status: "built" } });
    void persist(plan, "built").catch(() => undefined);
  }, [persist]);

  /** Runs one planning call. Revises the active draft plan when there is one. */
  const run = useCallback(async (input: { turnId: string; message: string; effort: EffortLevel; expectedVersion: number; attachments: PlanAttachment[]; revise: SitePlan | null }, on: PlanCallbacks) => {
    let finished = false;
    try {
      const response = await fetch("/api/build/plan", { method: "POST", headers: { "Content-Type": "application/json", "X-Makeborne-Account": accountId },
        body: JSON.stringify({ workspaceId, artifactId, expectedVersion: input.expectedVersion, message: input.message, effort: input.effort,
          attachments: input.attachments, ...(input.revise ? { previousPlan: input.revise } : {}) }) });
      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => null);
        throw new Error(failure?.error?.message ?? "Planning couldn't start. Please try again.");
      }
      await readEvents(response, event => {
        switch (event.type) {
          case "text": on.onText(String(event.delta)); break;
          case "status": on.onStatus(String(event.message)); break;
          case "usage": on.onCredits(Number(event.credits)); break;
          case "plan": {
            const plan: ActivePlan = { turnId: input.turnId, stored: event.stored as StoredPlan, estimate: event.estimate as PlanEstimate,
              recommended: event.recommended as EffortLevel, save: event.persisted ? "saved" : "local" };
            setActive(plan); on.onPlan(plan); break;
          }
          case "done": finished = true; on.onDone(Number(event.charged)); break;
          case "error": finished = true; on.onError(String(event.message)); break;
        }
      });
      if (!finished) on.onError("The connection closed before the plan arrived. Nothing was charged unless a plan was saved — reload to check.");
    } catch (error) {
      on.onError(error instanceof Error ? error.message : "Planning failed.");
    }
  }, [accountId, workspaceId, artifactId]);

  return useMemo(() => ({ active, restored, run, edit, markBuilt }), [active, restored, run, edit, markBuilt]);
}

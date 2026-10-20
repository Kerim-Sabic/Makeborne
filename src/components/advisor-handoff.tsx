"use client";
import { useCallback, useEffect, useState } from "react";
import { MessagesSquare, X } from "lucide-react";
import type { EffortLevel } from "@/lib/routing/effort";
import {
  AdvisorProvenanceSchema, handoffSummary, projectProvenanceKey, provenanceLabel, readProjectProvenance, takeProjectHandoff, writeProjectProvenance,
  type AdvisorHandoff, type AdvisorProvenance, type BriefFormat, type BriefMode, type ProjectProvenance,
} from "@/lib/experts/advisor-brief";

function local() { try { return window.localStorage; } catch { return null; } }
function session() { try { return window.sessionStorage; } catch { return null; } }
/** Drops ?handoff= from the address once it has been read, so a reload never applies it again. */
export function forgetHandoffParameter() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("handoff")) return;
    url.searchParams.delete("handoff");
    window.history.replaceState(window.history.state, "", url);
  } catch { /* address unchanged */ }
}

/**
 * The advisor brief handed to one saved project: a single-use composer prefill (text, mode,
 * effort) and the provenance the next new request records. Nothing is sent from here.
 */
export function useProjectAdvisorHandoff({ accountId, workspaceId, artifactId, kind, canBuild, apply, notify }: {
  accountId: string; workspaceId: string; artifactId: string; kind: string; canBuild: boolean;
  apply: (prefill: { key: string; text: string; mode: BriefMode; effort: EffortLevel }) => void;
  notify: (message: string) => void;
}) {
  let key: string | null = null;
  try { key = projectProvenanceKey(accountId, workspaceId, artifactId); } catch { key = null; }
  const [provenance, setProvenance] = useState<ProjectProvenance | null>(null);
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (!current || !key) return;
      const id = new URLSearchParams(window.location.search).get("handoff");
      if (id) {
        forgetHandoffParameter();
        const storage = session();
        const taken = !canBuild ? { issue: "Only owners and editors can build from an advisor brief. Nothing was sent." }
          : storage ? takeProjectHandoff(storage, { id, accountId, workspaceId, artifactId, kind, now: Date.now() })
          : { issue: "This browser could not read the brief. Nothing was sent." };
        if ("issue" in taken) notify(taken.issue);
        else {
          const bound: ProjectProvenance = { provenance: taken.handoff.provenance, status: "pending", boundAt: Date.now(), sentAt: null };
          writeProjectProvenance(local(), key, bound);
          apply({ key: taken.handoff.id, text: taken.handoff.text, mode: taken.handoff.mode, effort: taken.handoff.effort });
        }
      }
      setProvenance(readProjectProvenance(local(), key));
    });
    return () => { current = false; };
    // Read once per opened project; apply and notify are callbacks from the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = useCallback((next: ProjectProvenance | null) => {
    if (!key) return;
    writeProjectProvenance(local(), key, next);
    setProvenance(next);
  }, [key]);
  return { provenance, update };
}

const CREATION_STORE = "makeborne.advisor-creation.v1";
/** A new project started from a brief: remember which creation request carries it (this tab only). */
export function rememberCreationHandoff(requestId: string, kind: BriefFormat, provenance: AdvisorProvenance) {
  try { session()?.setItem(CREATION_STORE, JSON.stringify({ requestId, kind, provenance })); } catch { /* provenance is optional */ }
}
export function forgetCreationHandoff() { try { session()?.removeItem(CREATION_STORE); } catch { /* nothing kept */ } }
/** Once that request saved a project of the same format, bind the brief to it (pending until the first request). */
export function bindCreationHandoff(input: { requestId: string; accountId: string | null; workspaceId: string; artifactId: string; kind: string }) {
  try {
    const raw = session()?.getItem(CREATION_STORE);
    if (!raw || !input.accountId) return;
    const value = JSON.parse(raw) as { requestId?: unknown; kind?: unknown; provenance?: unknown };
    const provenance = AdvisorProvenanceSchema.safeParse(value.provenance);
    if (value.requestId !== input.requestId || value.kind !== input.kind || !provenance.success) return;
    writeProjectProvenance(local(), projectProvenanceKey(input.accountId, input.workspaceId, input.artifactId), { provenance: provenance.data, status: "pending", boundAt: Date.now(), sentAt: null });
    forgetCreationHandoff();
  } catch { /* provenance is optional */ }
}

/** Above the new-project composer: what the advisor handed over, with the current settings and their maximum. */
export function AdvisorHandoffBanner({ handoff, format, mode, effort, onRemove }: { handoff: AdvisorHandoff; format: BriefFormat; mode: BriefMode; effort: EffortLevel; onRemove: () => void }) {
  return <div className="advisor-handoff-banner" role="status">
    <MessagesSquare size={15} aria-hidden="true" />
    <p><strong>From {provenanceLabel(handoff.provenance)}</strong>
      <span>{handoffSummary({ format, mode: format === "website" ? mode : "create", effort })} when you press Send in the builder. Nothing has been sent or charged.</span></p>
    <button type="button" onClick={onRemove} aria-label="Don’t link this brief"><X size={14} /></button>
  </div>;
}

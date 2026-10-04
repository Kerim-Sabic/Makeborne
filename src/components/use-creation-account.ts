"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CloudWorkspace, CloudWorkspaceSnapshot } from "@/lib/cloud/contracts";
import { api, setCloudAccount } from "./cloud-api";
import { creationWorkspace } from "@/lib/cloud/creation-workspace";

export type CreationAccount = {
  ready: boolean; error: string; accountId: string | null;
  workspace: CloudWorkspace | null; clients: CloudWorkspaceSnapshot["clients"];
};
const initial: CreationAccount = { ready: false, error: "", accountId: null, workspace: null, clients: [] };

/** Resolve the save destination before offering account clients or accepting a write. */
export function useCreationAccount(requestedWorkspaceId?: string | null) {
  const [state, setState] = useState<CreationAccount>(initial);
  useEffect(() => {
    let active = true;
    let generation = 0;
    let unsubscribe: (() => void) | undefined;
    let previous: string | null | undefined;
    async function load(accountId: string | null) {
      const version = ++generation;
      if (!active) return;
      setCloudAccount(accountId);
      setState({ ...initial, accountId });
      if (!accountId) { setState(requestedWorkspaceId ? { ...initial, error: "Sign back in to create a project for this account client." } : { ...initial, ready: true }); return; }
      try {
        const { workspaces } = await api<{ workspaces: CloudWorkspace[] }>("/api/workspaces");
        const workspace = creationWorkspace(workspaces, requestedWorkspaceId);
        const clients: CloudWorkspaceSnapshot["clients"] = [];
        if (workspace) {
          let offset: number | null = 0;
          do {
            const snapshot: CloudWorkspaceSnapshot & { pagination: { clients: { nextOffset: number | null } } } = await api(`/api/cloud/workspaces/${workspace.id}?clientsOffset=${offset}`);
            if (!active || version !== generation) return;
            clients.push(...snapshot.clients);
            offset = snapshot.pagination.clients.nextOffset;
          } while (offset !== null);
        }
        if (active && version === generation) setState({ ready: true, error: "", accountId, workspace, clients });
      } catch (error) {
        if (active && version === generation) setState({ ...initial, accountId, error: error instanceof Error ? error.message : "Could not check your account." });
      }
    }
    void (async () => {
      try {
        const response = await fetch("/api/capabilities", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not check account availability. Close and reopen this form to retry.");
        const capabilities = await response.json();
        if (!active) return;
        if (!capabilities.cloudWorkspace?.available) { await load(null); return; }
        const { data } = createClient().auth.onAuthStateChange((_event, session) => {
          const id = session?.user.id ?? null;
          if (id === previous) return;
          previous = id;
          // Never await Supabase operations inside its auth callback.
          queueMicrotask(() => { void load(id); });
        });
        unsubscribe = () => data.subscription.unsubscribe();
      } catch (error) { if (active) setState({ ...initial, error: error instanceof Error ? error.message : "Account connection unavailable." }); }
    })();
    return () => { active = false; generation++; unsubscribe?.(); };
  }, [requestedWorkspaceId]);
  return state;
}

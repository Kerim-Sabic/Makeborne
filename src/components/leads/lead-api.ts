"use client";
import { useEffect, useState } from "react";
import type { Lead } from "@/lib/leads";
import { mailApi } from "../mail/mail-api";

/** Lead details for the clients currently on screen, fetched in one request and refreshed when the set changes. */
export function useLeadMeta(accountId: string, workspaceId: string | undefined, ids: string[], refreshKey = 0) {
  const [leads, setLeads] = useState<Record<string, Lead>>({});
  const key = ids.slice().sort().join(",");
  useEffect(() => {
    if (!workspaceId || !key) return;
    let live = true;
    void mailApi<{ leads: Record<string, Lead> }>(accountId, `/api/cloud/workspaces/${workspaceId}/leads?ids=${key}`)
      .then(result => { if (live) setLeads(current => ({ ...current, ...result.leads })); }).catch(() => undefined);
    return () => { live = false; };
  }, [accountId, workspaceId, key, refreshKey]);
  return { leads, update: (id: string, lead: Lead) => setLeads(current => ({ ...current, [id]: lead })) };
}

export const leadApi = {
  update: (accountId: string, workspaceId: string, clientId: string, change: Partial<{ tags: string[]; dealValue: number | null; dealCurrency: string; source: string;
    insight: { niche: string; audience: string; angle: string; confidence: "high" | "medium" | "low" | "" };
    research: { url: string; platform: string; handle: string | null; followers: string | null; following: string | null; posts: string | null; bio: string } }>) =>
    mailApi<{ lead: Lead }>(accountId, `/api/cloud/workspaces/${workspaceId}/clients/${clientId}/lead`, "PATCH", change),
  research: (accountId: string, workspaceId: string, clientId: string) =>
    mailApi<{ lead: Lead | null; read: number; skipped: { url: string; reason: string }[] }>(accountId, `/api/cloud/workspaces/${workspaceId}/clients/${clientId}/lead/research`, "POST", {}),
  tags: (accountId: string, workspaceId: string) => mailApi<{ tags: { tag: string; count: number }[] }>(accountId, `/api/cloud/workspaces/${workspaceId}/leads?tags=1`),
};

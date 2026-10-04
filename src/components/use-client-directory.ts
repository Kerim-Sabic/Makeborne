"use client";
import { useEffect, useRef, useState } from "react";
import type { CloudClient } from "@/lib/cloud/contracts";
import { api } from "./cloud-api";

type Directory = { clients: CloudClient[]; pagination: { total: number; nextOffset: number | null }; counts: Record<"all" | "overdue" | "today" | "upcoming" | "unscheduled", number> };
export function useClientDirectory(workspaceId: string | undefined, search: string, stage: string, followUp: string, day: string, refreshIdentity: unknown) {
  const path = workspaceId ? `/api/cloud/workspaces/${workspaceId}/clients?${new URLSearchParams({ search, stage, followUp, day })}` : null;
  const [result, setResult] = useState<{ path: string; data: Directory } | null>(null);
  const [error, setError] = useState<{ path: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const paging = useRef(false);
  useEffect(() => {
    const requests = sequence;
    const revision = ++requests.current;
    paging.current = false;
    if (!path) return;
    const timer = window.setTimeout(() => {
      setResult(null); setError(null); setBusy(true);
      void api<Directory>(path).then(data => { if (revision === sequence.current) setResult({ path, data }); })
        .catch(cause => { if (revision === sequence.current) setError({ path, message: cause instanceof Error ? cause.message : "Could not load client directory." }); })
        .finally(() => { if (revision === sequence.current) setBusy(false); });
    }, 250);
    return () => { window.clearTimeout(timer); if (requests.current === revision) requests.current++; };
  }, [path, refreshIdentity]);
  const data = result?.path === path ? result.data : null;
  async function more() {
    if (!path || !data || data.pagination.nextOffset === null || busy || paging.current) return;
    const revision = sequence.current;
    paging.current = true; setBusy(true); setError(null);
    try {
      const next = await api<Directory>(`${path}&offset=${data.pagination.nextOffset}`);
      if (revision !== sequence.current) return;
      setResult({ path, data: { ...next, clients: [...new Map([...data.clients, ...next.clients].map(client => [client.id, client])).values()] } });
    } catch (cause) { if (revision === sequence.current) setError({ path, message: cause instanceof Error ? cause.message : "Could not load more clients." }); }
    finally { if (revision === sequence.current) { paging.current = false; setBusy(false); } }
  }
  const visibleError = error?.path === path ? error.message : "";
  return { data, error: visibleError, busy: !!path && (busy || (!data && !visibleError)), more };
}

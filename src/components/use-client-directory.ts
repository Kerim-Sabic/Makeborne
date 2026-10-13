"use client";
import { useEffect, useRef, useState } from "react";
import type { CloudClient } from "@/lib/cloud/contracts";
import { api } from "./cloud-api";

type Directory = { clients: CloudClient[]; pagination: { total: number; nextOffset: number | null }; counts: Record<"all" | "overdue" | "today" | "upcoming" | "unscheduled", number> };
/** Server-side client directory. While a new search or filter loads, the previous
 * results stay on screen (marked stale) instead of blanking the list. */
export function useClientDirectory(workspaceId: string | undefined, search: string, stage: string, followUp: string, day: string, refreshKey: number) {
  const path = workspaceId ? `/api/cloud/workspaces/${workspaceId}/clients?${new URLSearchParams({ search, stage, followUp, day })}` : null;
  const [result, setResult] = useState<{ path: string; workspaceId: string; data: Directory } | null>(null);
  const [error, setError] = useState<{ path: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const paging = useRef(false);
  const lastSearch = useRef<string | null>(null);
  useEffect(() => {
    const requests = sequence;
    const revision = ++requests.current;
    paging.current = false;
    if (!path || !workspaceId) return;
    // Typing waits for a pause; filters, refreshes and the first load go straight away.
    const delay = lastSearch.current !== null && lastSearch.current !== search ? 250 : 0;
    lastSearch.current = search;
    const timer = window.setTimeout(() => {
      setError(null); setBusy(true);
      void api<Directory>(path).then(data => { if (revision === sequence.current) setResult({ path, workspaceId, data }); })
        .catch(cause => { if (revision === sequence.current) setError({ path, message: cause instanceof Error ? cause.message : "Could not load client directory." }); })
        .finally(() => { if (revision === sequence.current) setBusy(false); });
    }, delay);
    return () => { window.clearTimeout(timer); if (requests.current === revision) requests.current++; };
  }, [path, workspaceId, search, refreshKey]);
  // Results from another workspace are never shown; results for an older search are shown as stale.
  const current = result && result.workspaceId === workspaceId ? result : null;
  const data = current?.data ?? null;
  const stale = !!current && current.path !== path;
  async function more() {
    if (!path || !data || stale || data.pagination.nextOffset === null || busy || paging.current) return;
    const revision = sequence.current;
    paging.current = true; setBusy(true); setError(null);
    try {
      const next = await api<Directory>(`${path}&offset=${data.pagination.nextOffset}`);
      if (revision !== sequence.current) return;
      setResult({ path, workspaceId: workspaceId!, data: { ...next, clients: [...new Map([...data.clients, ...next.clients].map(client => [client.id, client])).values()] } });
    } catch (cause) { if (revision === sequence.current) setError({ path, message: cause instanceof Error ? cause.message : "Could not load more clients." }); }
    finally { if (revision === sequence.current) { paging.current = false; setBusy(false); } }
  }
  /** Reflect a saved client in the visible list without refetching. */
  function patch(client: CloudClient) {
    setResult(previous => previous && { ...previous, data: { ...previous.data, clients: previous.data.clients.map(item => item.id === client.id ? { ...item, ...client } : item) } });
  }
  const visibleError = error?.path === path ? error.message : "";
  return { data, stale, error: visibleError, busy: !!path && (busy || (!data && !visibleError)), loading: !!path && !data && !visibleError, more, patch };
}

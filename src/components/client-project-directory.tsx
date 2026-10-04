"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Globe, Presentation } from "lucide-react";
import type { ClientProjectItem } from "@/lib/cloud/contracts";
import { studioHref, type AccountProjectRoute } from "@/lib/studio-navigation";
import { api } from "./cloud-api";

type Result = { items: ClientProjectItem[]; pagination: { total: number; nextOffset: number | null } };
const icons = { website: Globe, book: BookOpen, presentation: Presentation };
const itemKey = (item: ClientProjectItem) => item.artifactId ?? item.projectId;

/** Mount with a workspace/client key so pending reads cannot populate another client. */
export default function ClientProjectDirectory({ workspaceId, clientId, clientName, onOpenProject }: {
  workspaceId: string; clientId: string; clientName: string; onOpenProject: (route: AccountProjectRoute) => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<Result>(`/api/cloud/workspaces/${workspaceId}/clients/${clientId}/projects?offset=${offset}`)
      .then(page => {
        if (!active) return;
        setResult(previous => ({ ...page, items: offset === 0 ? page.items : [...new Map([...(previous?.items ?? []), ...page.items].map(item => [itemKey(item), item])).values()] }));
      })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Could not load this client's work."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [workspaceId, clientId, offset, retry]);

  return <section className="ac-project-directory" aria-label={`Projects for ${clientName}`}>
    <header><div><h2>Work for {clientName}</h2><p>Every linked website, book, and presentation.</p></div>{result && <span>{result.pagination.total} items</span>}</header>
    {error && <div role="alert"><p>{error}</p><button className="button secondary small" disabled={busy} onClick={() => { setError(""); setBusy(true); setRetry(value => value + 1); }}>Try again</button></div>}
    <div className="ac-project-directory-grid">{result?.items.map(item => {
      const Icon = icons[item.kind];
      const route = item.artifactId ? { workspaceId, artifactId: item.artifactId } : null;
      return <article key={itemKey(item)}>
        <div className="ac-project-meta"><Icon size={19} /><span>{item.kind}</span><small>{item.projectStatus.replaceAll("_", " ")}</small></div>
        <h3>{item.title}</h3>
        {item.title !== item.projectTitle && <p>{item.projectTitle}</p>}
        <div className="ac-project-foot"><span>{item.version === null ? "No document yet" : `Version ${item.version}`}</span><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time></div>
        {route ? <Link href={studioHref({ tab: "projects", projectId: null, clientId: null, account: route })} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenProject(route); }}>Open {item.kind}<ArrowUpRight size={15} /></Link> : <p className="small-note">This project is linked to the client but has no editable document yet.</p>}
      </article>;
    })}</div>
    {busy && <p role="status">Loading client projects…</p>}
    {!busy && !error && result?.items.length === 0 && <div className="ac-empty"><h3>No linked projects yet</h3><p>Create a project for this client to keep their work together here.</p></div>}
    {result && result.items.length > 0 && <p className="small-note">Showing {result.items.length} of {result.pagination.total} items for this client.</p>}
    {result?.pagination.nextOffset != null && !error && <button className="button secondary small" disabled={busy} onClick={() => { setBusy(true); setOffset(result.pagination.nextOffset!); }}>Load more work</button>}
  </section>;
}

"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { studioHref, type AccountProjectRoute } from "@/lib/studio-navigation";
import { ArrowRight, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { CloudArtifact, CloudWorkspace, CloudWorkspaceSnapshot } from "@/lib/cloud/contracts";
import { api, setCloudAccount } from "./cloud-api";
import { icons, kindLabel } from "./studio-model";
import PendingCloudWrites from "./pending-cloud-writes";

const AccountEditor = dynamic(() => import("./cloud-studio").then(module => module.CloudEditor), { loading: () => <p role="status">Opening project…</p> });
type Snapshot = CloudWorkspaceSnapshot & { pagination: { artifacts: { nextOffset: number | null; total: number } } };

/** Account records are read independently: device drafts are never uploaded implicitly. */
export default function AccountProjects({ search, filter, target, navigate }: { search: string; filter: string; target: AccountProjectRoute | null; navigate: (route: AccountProjectRoute | null) => void }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [workspaces, setWorkspaces] = useState<CloudWorkspace[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<CloudArtifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const requestVersion = useRef(0);
  const currentAccount = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/capabilities", { cache: "no-store", signal: abort.signal });
        if (!active) return;
        if (!response.ok || !(await response.json()).cloudWorkspace?.available) { setAuthReady(true); return; }
        const client = createClient();
        const { data } = client.auth.onAuthStateChange((_event, session) => {
          if (!active) return;
          setAuthReady(true);
          const next = session?.user.id ?? null;
          if (currentAccount.current !== next) {
            currentAccount.current = next; requestVersion.current++;
            setSnapshot(null); setSelected(null); setWorkspaces([]); setMessage("");
            setCloudAccount(next); setAccountId(next);
          }
        });
        unsubscribe = () => data.subscription.unsubscribe();
      } catch { if (active) setAuthReady(true); }
    })();
    return () => { active = false; abort.abort(); unsubscribe?.(); };
  }, []);
  useEffect(() => {
    const version = ++requestVersion.current;
    let active = true;
    setCloudAccount(accountId);
    void (async () => {
      setSnapshot(null); setSelected(null); setWorkspaces([]); setMessage("");
      if (!accountId) { setBusy(false); return; }
      setBusy(true);
      try {
        const result = await api<{ workspaces: CloudWorkspace[] }>("/api/workspaces");
        if (!active || version !== requestVersion.current) return;
        setWorkspaces(result.workspaces);
        const requested = target ? result.workspaces.find(workspace => workspace.id === target.workspaceId) : result.workspaces[0];
        if (target && !requested) throw new Error("This project is not available to your account. Check that you’re signed into the right account or ask the owner for access.");
        if (requested) {
          const [data, detail] = await Promise.all([
            api<Snapshot>(`/api/cloud/workspaces/${requested.id}`),
            target?.artifactId ? api<{ artifact: CloudArtifact }>(`/api/cloud/workspaces/${requested.id}/artifacts/${target.artifactId}`) : Promise.resolve(null),
          ]);
          if (active && version === requestVersion.current) {
            setSnapshot(data);
            setSelected(detail?.artifact ?? null);
          }
        }
      } catch (error) {
        if (active && version === requestVersion.current) setMessage(error instanceof Error ? error.message : "Could not load your saved projects.");
      } finally { if (active && version === requestVersion.current) setBusy(false); }
    })();
    return () => { active = false; };
  }, [accountId, target]);
  async function load(workspaceId: string, append = false) {
    const version = ++requestVersion.current;
    setBusy(true); setMessage("");
    const offset = append ? snapshot?.pagination.artifacts.nextOffset : 0;
    try {
      const next = await api<Snapshot>(`/api/cloud/workspaces/${workspaceId}?artifactsOffset=${offset ?? 0}`);
      if (version !== requestVersion.current) return;
      setSnapshot(current => append && current?.workspace.id === workspaceId ? { ...next, artifacts: [...new Map([...current.artifacts, ...next.artifacts].map(artifact => [artifact.id, artifact])).values()] } : next);
    } catch (error) { if (version === requestVersion.current) setMessage(error instanceof Error ? error.message : "Could not load your saved projects."); }
    finally { if (version === requestVersion.current) setBusy(false); }
  }
  if (!accountId) return target ? <section className="account-projects" aria-label="Open saved project">
    <h2>{authReady ? "Sign in to open this project" : "Checking your account…"}</h2>
    {authReady && <><p>Account projects are available to their workspace members.</p><Link className="button primary small" href={`/login?next=${encodeURIComponent(studioHref({ tab: "projects", projectId: null, clientId: null, account: target }))}`}>Sign in</Link></>}
  </section> : null;
  const visible = snapshot?.artifacts.filter(artifact => (filter === "all" || artifact.kind === filter) && artifact.title.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <section className={`account-projects${selected ? " account-project-open" : ""}`} aria-label={selected ? "Project workspace" : "Projects saved to your account"}>
    {!selected && !target?.artifactId && <div className="account-projects-heading"><div><span className="eyebrow">SAVED TO YOUR ACCOUNT</span><h2>Your saved projects</h2></div>
      {snapshot && <button type="button" className="button secondary small" disabled={busy} onClick={() => void load(snapshot.workspace.id)}><RefreshCw size={14} /> Refresh</button>}</div>}
    {!selected && workspaces.length > 1 && <label>Workspace<select disabled={busy} value={snapshot?.workspace.id ?? ""} onChange={event => navigate({ workspaceId: event.target.value, artifactId: null })}>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>}
    {message && <p role="status">{message}</p>}
    {!busy && target?.artifactId && !selected && <button className="button secondary small" onClick={() => navigate(null)}>Back to projects</button>}
    <PendingCloudWrites accountId={accountId} refresh={async () => { if (snapshot) await load(snapshot.workspace.id); else window.location.reload(); }} />
    {busy && <p role="status">Loading your account projects…</p>}
    {selected && snapshot ? <AccountEditor key={`${accountId}:${snapshot.workspace.id}:${selected.id}`} accountId={accountId} workspaceId={snapshot.workspace.id} artifact={selected} project={snapshot.projects.find(project => project.id === selected.projectId)} role={snapshot.workspace.role}
      notify={setMessage} back={() => navigate({ workspaceId: snapshot.workspace.id, artifactId: null })} /> : <>
      <div className="account-project-grid">{visible.map(artifact => { const Icon = icons[artifact.kind]; return <button type="button" className="account-project-card" key={artifact.id} disabled={busy} onClick={() => navigate({ workspaceId: snapshot!.workspace.id, artifactId: artifact.id })}>
        <span className={`account-project-icon ${artifact.kind}`}><Icon size={22} /></span><span><strong>{artifact.title}</strong><small>{kindLabel[artifact.kind]} · {artifact.currentVersion ? `Version ${artifact.currentVersion}` : "New draft"}</small></span><ArrowRight size={16} /></button>; })}</div>
      {!busy && !visible.length && <p>{snapshot ? "No saved projects match this view." : "No account workspace was found. Your device projects remain below."}</p>}
      {snapshot?.pagination.artifacts.nextOffset != null && <button className="button secondary small" type="button" disabled={busy} onClick={() => void load(snapshot.workspace.id, true)}>Load more saved projects</button>}
      {snapshot && <p className="small-note">Search applies to loaded account projects. Load more to include earlier records.</p>}
    </>}
  </section>;
}

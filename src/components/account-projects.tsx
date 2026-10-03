"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { CloudArtifact, CloudWorkspace, CloudWorkspaceSnapshot } from "@/lib/cloud/contracts";
import { api, setCloudAccount } from "./cloud-api";
import { icons, kindLabel } from "./studio-model";
import PendingCloudWrites from "./pending-cloud-writes";

const AccountEditor = dynamic(() => import("./cloud-studio").then(module => module.CloudEditor), { loading: () => <p role="status">Opening project…</p> });
type Snapshot = CloudWorkspaceSnapshot & { pagination: { artifacts: { nextOffset: number | null; total: number } } };

/** Account records are read independently: device drafts are never uploaded implicitly. */
export default function AccountProjects({ search, filter, created }: { search: string; filter: string; created?: { workspaceId: string; artifact: CloudArtifact } | null }) {
  const [accountId, setAccountId] = useState<string | null>(null);
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
        if (!response.ok || !(await response.json()).cloudWorkspace?.available || !active) return;
        const client = createClient();
        const { data } = client.auth.onAuthStateChange((_event, session) => {
          if (!active) return;
          const next = session?.user.id ?? null;
          if (currentAccount.current !== next) {
            currentAccount.current = next; requestVersion.current++;
            setSnapshot(null); setSelected(null); setWorkspaces([]); setMessage("");
            setCloudAccount(next); setAccountId(next);
          }
        });
        unsubscribe = () => data.subscription.unsubscribe();
      } catch { /* The account menu reports connection errors; do not hide device work. */ }
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
        if (result.workspaces.length) {
          const target = result.workspaces.find(workspace => workspace.id === created?.workspaceId) ?? result.workspaces[0];
          const data = await api<Snapshot>(`/api/cloud/workspaces/${target.id}`);
          if (active && version === requestVersion.current) {
            setSnapshot(data);
            if (created?.workspaceId === target.id) setSelected(created.artifact);
          }
        }
      } catch (error) {
        if (active && version === requestVersion.current) setMessage(error instanceof Error ? error.message : "Could not load your saved projects.");
      } finally { if (active && version === requestVersion.current) setBusy(false); }
    })();
    return () => { active = false; };
  }, [accountId, created]);
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
  if (!accountId) return null;
  const visible = snapshot?.artifacts.filter(artifact => (filter === "all" || artifact.kind === filter) && artifact.title.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <section className="account-projects" aria-label="Projects saved to your account">
    <div className="account-projects-heading"><div><span className="eyebrow">SAVED TO YOUR ACCOUNT</span><h2>Your saved projects</h2></div>
      {!selected && snapshot && <button type="button" className="button secondary small" disabled={busy} onClick={() => void load(snapshot.workspace.id)}><RefreshCw size={14} /> Refresh</button>}</div>
    {!selected && workspaces.length > 1 && <label>Workspace<select disabled={busy} value={snapshot?.workspace.id ?? ""} onChange={event => void load(event.target.value)}>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>}
    {message && <p role="status">{message}</p>}
    <PendingCloudWrites accountId={accountId} refresh={async () => { if (snapshot) await load(snapshot.workspace.id); else window.location.reload(); }} />
    {busy && <p role="status">Loading your account projects…</p>}
    {selected && snapshot ? <AccountEditor key={`${accountId}:${snapshot.workspace.id}:${selected.id}`} accountId={accountId} workspaceId={snapshot.workspace.id} artifact={selected} role={snapshot.workspace.role}
      notify={setMessage} back={() => { setSelected(null); void load(snapshot.workspace.id); }} /> : <>
      <div className="account-project-grid">{visible.map(artifact => { const Icon = icons[artifact.kind]; return <button type="button" className="account-project-card" key={artifact.id} disabled={busy} onClick={() => setSelected(artifact)}>
        <span className={`account-project-icon ${artifact.kind}`}><Icon size={22} /></span><span><strong>{artifact.title}</strong><small>{kindLabel[artifact.kind]} · {artifact.currentVersion ? `Version ${artifact.currentVersion}` : "New draft"}</small></span><ArrowRight size={16} /></button>; })}</div>
      {!busy && !visible.length && <p>{snapshot ? "No saved projects match this view." : "No account workspace was found. Your device projects remain below."}</p>}
      {snapshot?.pagination.artifacts.nextOffset != null && <button className="button secondary small" type="button" disabled={busy} onClick={() => void load(snapshot.workspace.id, true)}>Load more saved projects</button>}
      {snapshot && <p className="small-note">Search applies to loaded account projects. Load more to include earlier records.</p>}
    </>}
  </section>;
}

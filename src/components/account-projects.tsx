"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { studioHref, type AccountProjectRoute } from "@/lib/studio-navigation";
import { ArrowRight, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { CloudArtifact, CloudWorkspace, CloudWorkspaceSnapshot } from "@/lib/cloud/contracts";
import { api, setCloudAccount } from "./cloud-api";
import { icons, kindLabel } from "./studio-model";
import PendingCloudWrites from "./pending-cloud-writes";
import { accountLibraryStatus, type AccountLibraryStatus } from "@/lib/projects/library-state";

const AccountEditor = dynamic(() => import("./cloud-studio").then(module => module.CloudEditor), { loading: () => <p role="status">Opening project…</p> });
type Snapshot = CloudWorkspaceSnapshot & { pagination: { artifacts: { nextOffset: number | null; total: number } } };

/** Account records are read independently: device drafts are never uploaded implicitly. */
export default function AccountProjects({ search, filter, target, navigate, onStatus }: { search: string; filter: string; target: AccountProjectRoute | null; /** What this list knows (checking, loading, loaded, failed or unavailable) and for which account, so the studio never shows an empty state that contradicts it. */ onStatus?: (status: AccountLibraryStatus, accountId: string | null) => void; navigate: (route: AccountProjectRoute | null) => void }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloud, setCloud] = useState<"unknown" | "available" | "off" | "error">("unknown");
  const [noWorkspace, setNoWorkspace] = useState(false);
  // Retrying re-runs the same guarded effects; it never bypasses the account or request-version checks.
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [workspaces, setWorkspaces] = useState<CloudWorkspace[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<CloudArtifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const loadedCount = snapshot ? snapshot.artifacts.length : null;
  const failed = Boolean(message) && !snapshot;
  const status = useMemo(() => accountLibraryStatus({ cloud, authReady, accountId, busy, loadedCount, noWorkspace, failed }), [cloud, authReady, accountId, busy, loadedCount, noWorkspace, failed]);
  useEffect(() => { onStatus?.(status, accountId); }, [status, accountId, onStatus]);
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
        // A failed check is not the same as "no account projects": say so and offer Retry.
        if (!response.ok) { setCloud("error"); setAuthReady(true); return; }
        if (!(await response.json()).cloudWorkspace?.available) { if (active) { setCloud("off"); setAuthReady(true); } return; }
        if (!active) return;
        setCloud("available");
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
      } catch { if (active) { setCloud("error"); setAuthReady(true); } }
    })();
    return () => { active = false; abort.abort(); unsubscribe?.(); };
  }, [capabilityAttempt]);
  useEffect(() => {
    const version = ++requestVersion.current;
    let active = true;
    setCloudAccount(accountId);
    void (async () => {
      setSnapshot(null); setSelected(null); setWorkspaces([]); setMessage(""); setNoWorkspace(false);
      if (!accountId) { setBusy(false); return; }
      setBusy(true);
      try {
        const result = await api<{ workspaces: CloudWorkspace[] }>("/api/workspaces");
        if (!active || version !== requestVersion.current) return;
        setWorkspaces(result.workspaces);
        const requested = target ? result.workspaces.find(workspace => workspace.id === target.workspaceId) : result.workspaces[0];
        if (!requested && !target) setNoWorkspace(true);
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
  }, [accountId, target, loadAttempt]);
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
  // A project link uses the open-project layout from its first paint, so the page does not move when the project loads.
  const retryCapabilities = () => { setCloud("unknown"); setAuthReady(false); setCapabilityAttempt(attempt => attempt + 1); };
  if (cloud === "error") return <section className="account-projects account-projects-failed" aria-label="Projects saved to your account">
    <p role="alert">We couldn’t check for projects saved to your account, so this list may be incomplete. Projects on this device are not affected.</p>
    <button type="button" className="button secondary small" onClick={retryCapabilities}><RefreshCw size={14} /> Retry</button>
  </section>;
  if (!accountId && !target && !authReady) return <p className="account-projects-checking" role="status">Checking for saved projects…</p>;
  if (!accountId) return target ? <section className={`account-projects${target.artifactId ? " account-project-open" : ""}`} aria-label="Open saved project">
    <h2>{authReady ? "Sign in to open this project" : "Checking your account…"}</h2>
    {authReady && <><p>Account projects are available to their workspace members.</p><Link className="button primary small" href={`/login?next=${encodeURIComponent(studioHref({ tab: "projects", projectId: null, clientId: null, account: target }))}`}>Sign in</Link></>}
  </section> : null;
  const visible = snapshot?.artifacts.filter(artifact => (filter === "all" || artifact.kind === filter) && artifact.title.toLowerCase().includes(search.toLowerCase())) ?? [];
  // A brand-new account has nothing saved yet: let the studio's single welcome state speak instead of two empty panels.
  if (snapshot && !busy && !message && !selected && !target?.artifactId && snapshot.artifacts.length === 0 && workspaces.length <= 1)
    return <PendingCloudWrites accountId={accountId} refresh={async () => { await load(snapshot.workspace.id); }} />;
  return <section className={`account-projects${selected || target?.artifactId ? " account-project-open" : ""}`} aria-label={selected ? "Project workspace" : "Projects saved to your account"}>
    {!selected && !target?.artifactId && <div className="account-projects-heading"><div><span className="eyebrow">SAVED TO YOUR ACCOUNT</span><h2>Your saved projects</h2></div>
      {snapshot && <button type="button" className="button secondary small" disabled={busy} onClick={() => void load(snapshot.workspace.id)}><RefreshCw size={14} /> Refresh</button>}</div>}
    {!selected && workspaces.length > 1 && <label>Workspace<select disabled={busy} value={snapshot?.workspace.id ?? ""} onChange={event => navigate({ workspaceId: event.target.value, artifactId: null })}>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>}
    {message && (failed ? <div className="account-projects-error"><p role="alert">{message} Your saved projects haven’t loaded, so this list may be incomplete.</p>
      <button type="button" className="button secondary small" disabled={busy} onClick={() => setLoadAttempt(attempt => attempt + 1)}><RefreshCw size={14} /> Retry</button></div> : <p role="status">{message}</p>)}
    {!busy && target?.artifactId && !selected && <button className="button secondary small" onClick={() => navigate(null)}>Back to projects</button>}
    <PendingCloudWrites accountId={accountId} refresh={async () => { if (snapshot) await load(snapshot.workspace.id); else window.location.reload(); }} />
    {busy && <p role="status">Loading your account projects…</p>}
    {selected && snapshot ? <AccountEditor key={`${accountId}:${snapshot.workspace.id}:${selected.id}`} accountId={accountId} workspaceId={snapshot.workspace.id} artifact={selected} project={snapshot.projects.find(project => project.id === selected.projectId)} role={snapshot.workspace.role}
      notify={setMessage} back={() => navigate({ workspaceId: snapshot.workspace.id, artifactId: null })} /> : <>
      <div className="account-project-grid">{visible.map(artifact => { const Icon = icons[artifact.kind]; return <button type="button" className="account-project-card" key={artifact.id} disabled={busy} onClick={() => navigate({ workspaceId: snapshot!.workspace.id, artifactId: artifact.id })}>
        <span className={`account-project-icon ${artifact.kind}`}><Icon size={22} /></span><span><strong>{artifact.title}</strong><small>{kindLabel[artifact.kind]} · {artifact.currentVersion ? `Version ${artifact.currentVersion}` : "New draft"}</small></span><ArrowRight size={16} /></button>; })}</div>
      {!busy && !visible.length && (snapshot || noWorkspace) && <p>{snapshot ? "No saved projects match this view." : "No account workspace was found. Your device projects remain below."}</p>}
      {snapshot?.pagination.artifacts.nextOffset != null && <button className="button secondary small" type="button" disabled={busy} onClick={() => void load(snapshot.workspace.id, true)}>Load more saved projects</button>}
      {snapshot && <p className="small-note">Search applies to loaded account projects. Load more to include earlier records.</p>}
    </>}
  </section>;
}

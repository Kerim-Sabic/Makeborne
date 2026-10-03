"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Plus, RefreshCw, Search, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { CloudClient, CloudWorkspace, CloudWorkspaceSnapshot } from "@/lib/cloud/contracts";
import { outreachStages } from "@/lib/client-outreach";
import { studioHref, type AccountClientRoute } from "@/lib/studio-navigation";
import { api, CloudError, getPendingCloudWrites, setCloudAccount } from "./cloud-api";
import CloudClientOutreach from "./cloud-client-outreach";
import PendingCloudWrites from "./pending-cloud-writes";
import "@/app/account-clients.css";

const ClientDetails = dynamic(() => import("./cloud-studio").then(module => module.CloudClientDetails));
type Page = { nextOffset: number | null; total: number };
type Snapshot = CloudWorkspaceSnapshot & { pagination: Record<"clients" | "projects" | "artifacts", Page> };

/** Account changes unmount every client draft and invalidate outstanding reads. */
type ClientNavigation = { target: AccountClientRoute | null; navigate: (route: AccountClientRoute | null) => void };
export default function AccountClients({ deviceClients, target, navigate, initialDevice = false }: ClientNavigation & { deviceClients: ReactNode; initialDevice?: boolean }) {
  const [account, setAccount] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [devicePreference, setDevice] = useState(initialDevice);
  const device = devicePreference && !target;
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const response = await fetch("/api/capabilities", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not check account availability. Refresh to try again.");
        const capabilities = await response.json();
        if (!active) return;
        if (!capabilities.cloudWorkspace?.available) { setReady(true); return; }
        const { data } = createClient().auth.onAuthStateChange((_event, session) => {
          if (!active) return;
          const next = session?.user.id ?? null;
          setCloudAccount(next); setAccount(next); setReady(true);
        });
        unsubscribe = () => data.subscription.unsubscribe();
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Account connection unavailable."); }
    })();
    return () => { active = false; unsubscribe?.(); };
  }, []);
  if (error) return <section className="ac-workspace"><p role="alert">{error}</p><button className="button secondary" onClick={() => window.location.reload()}>Refresh</button></section>;
  if (!ready) return <p role="status">Loading your clients…</p>;
  if (!account && target) return <section className="ac-workspace"><h1>Sign in to open this client</h1><p>Client records are available to members of their workspace.</p><Link className="button primary" href={`/login?next=${encodeURIComponent(studioHref({ tab: "clients", projectId: null, clientId: null, accountClient: target }))}`}>Sign in</Link></section>;
  if (!account) return <><p className="small-note">These clients are saved on this device. <Link href="/login">Sign in</Link> to manage account clients.</p>{deviceClients}</>;
  return <><div className="ac-source" aria-label="Client storage"><button disabled={saving} aria-pressed={!device} onClick={() => { setDevice(false); if (initialDevice) navigate(null); }}>Account clients</button><button disabled={saving} aria-pressed={device} onClick={() => { setDevice(true); navigate(null); }}>On this device</button></div>
    {device ? <><p className="small-note">These records stay on this device and are not uploaded automatically.</p>{deviceClients}</> : <SavedClients key={account} accountId={account} target={target} navigate={navigate} onSaving={setSaving} />}</>;
}

function SavedClients({ accountId, onSaving, target, navigate }: ClientNavigation & { accountId: string; onSaving: (value: boolean) => void }) {
  const [saving, setSaving] = useState(false);
  function savingChanged(value: boolean) { setSaving(value); onSaving(value); }
  const [workspaces, setWorkspaces] = useState<CloudWorkspace[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<CloudClient | null>(null);
  const [view, setView] = useState<"outreach" | "details" | "projects">("outreach");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("All stages");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const generation = useRef(0);
  const writeLock = useRef(false);
  useEffect(() => {
    const requests = generation;
    const version = ++requests.current;
    void (async () => {
      setBusy(true); setSelected(null); setSnapshot(null); setMessage(""); setAdding(false);
      try {
        const result = await api<{ workspaces: CloudWorkspace[] }>("/api/workspaces");
        if (version !== generation.current) return;
        setWorkspaces(result.workspaces);
        const workspace = target ? result.workspaces.find(item => item.id === target.workspaceId) : result.workspaces.find(item => item.role === "owner") ?? result.workspaces[0];
        if (target && !workspace) throw new Error("This client workspace is not available to your account. Check your account or ask the owner for access.");
        if (workspace) {
          const [data, detail] = await Promise.all([
            api<Snapshot>(`/api/cloud/workspaces/${workspace.id}`),
            target?.clientId ? api<{ client: CloudClient }>(`/api/cloud/workspaces/${workspace.id}/clients/${target.clientId}`) : Promise.resolve(null),
          ]);
          if (version === generation.current) { setSnapshot(data); setSelected(detail?.client ?? null); }
        }
      } catch (cause) { if (version === generation.current) setMessage(cause instanceof Error ? cause.message : "Could not load clients."); }
      finally { if (version === generation.current) setBusy(false); }
    })();
    return () => { requests.current++; };
  }, [accountId, target]);
  async function load(workspaceId: string, collection?: "clients" | "projects" | "artifacts") {
    const version = ++generation.current;
    setBusy(true); setMessage("");
    if (!collection) { setSelected(null); setSnapshot(null); setAdding(false); }
    try {
      const offset = collection ? snapshot?.pagination[collection].nextOffset : null;
      const data = await api<Snapshot>(`/api/cloud/workspaces/${workspaceId}${collection ? `?${collection}Offset=${offset ?? 0}` : ""}`);
      if (version !== generation.current) return;
      if (!collection && target?.workspaceId === workspaceId && target.clientId) {
        const detail = await api<{ client: CloudClient }>(`/api/cloud/workspaces/${workspaceId}/clients/${target.clientId}`);
        if (version !== generation.current) return;
        setSelected(detail.client);
      }
      setSnapshot(current => collection && current?.workspace.id === workspaceId ? {
        ...current, [collection]: [...new Map([...current[collection], ...data[collection]].map(item => [item.id, item])).values()],
        pagination: { ...current.pagination, [collection]: data.pagination[collection] },
      } : data);
    } catch (cause) { if (version === generation.current) setMessage(cause instanceof Error ? cause.message : "Could not load clients."); }
    finally { if (version === generation.current) setBusy(false); }
  }
  async function open(id: string, nextView = view) {
    if (!snapshot) return;
    if (target?.workspaceId !== snapshot.workspace.id || target?.clientId !== id) {
      setView(nextView); navigate({ workspaceId: snapshot.workspace.id, clientId: id }); return;
    }
    const version = ++generation.current;
    setBusy(true); setMessage(""); setSelected(null);
    try {
      const result = await api<{ client: CloudClient }>(`/api/cloud/workspaces/${snapshot.workspace.id}/clients/${id}`);
      if (version === generation.current) { setSelected(result.client); setView(nextView); }
    } catch (cause) { if (version === generation.current) setMessage(cause instanceof Error ? cause.message : "Could not open client."); }
    finally { if (version === generation.current) setBusy(false); }
  }
  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!snapshot || writeLock.current || snapshot.workspace.role === "reviewer") return;
    if (getPendingCloudWrites(accountId).some(item => item.path.endsWith("/clients"))) { setUncertain(true); setMessage("Resolve the unconfirmed client save below before adding another client."); return; }
    writeLock.current = true; savingChanged(true); setBusy(true); setMessage("");
    const version = generation.current;
    try {
      const result = await api<{ client: CloudClient }>(`/api/cloud/workspaces/${snapshot.workspace.id}/clients`, { name, email, company: "", website: "", notes: "" });
      if (version !== generation.current) return;
      setSnapshot(current => current ? { ...current, clients: [result.client, ...current.clients.filter(item => item.id !== result.client.id)] } : current);
      setSelected(result.client); setView("details"); navigate({ workspaceId: snapshot.workspace.id, clientId: result.client.id }); setAdding(false); setName(""); setEmail(""); setMessage("Client saved to your account.");
    } catch (cause) {
      if (version !== generation.current) return;
      if (cause instanceof CloudError && cause.uncertain) setUncertain(true);
      setMessage(cause instanceof Error ? cause.message : "Client could not be saved.");
    } finally { writeLock.current = false; savingChanged(false); if (version === generation.current) setBusy(false); }
  }
  async function createWorkspace() {
    if (writeLock.current || workspaces.length) return;
    if (getPendingCloudWrites(accountId).some(item => item.path === "/api/workspaces")) { setMessage("Resolve your unconfirmed workspace request below before creating another."); return; }
    writeLock.current = true; savingChanged(true); setBusy(true); setMessage("");
    const version = generation.current;
    try {
      const result = await api<{ workspace: CloudWorkspace }>("/api/workspaces", { name: "My workspace" });
      if (version !== generation.current) return;
      setWorkspaces([result.workspace]);
      await load(result.workspace.id);
    } catch (cause) { if (version === generation.current) setMessage(cause instanceof Error ? cause.message : "Could not prepare your workspace."); }
    finally { writeLock.current = false; savingChanged(false); setBusy(false); }
  }
  const canEdit = snapshot?.workspace.role !== "reviewer";
  const clients = snapshot?.clients.filter(client => `${client.name} ${client.company} ${client.email}`.toLowerCase().includes(search.toLowerCase()) && (stage === "All stages" || (client.outreachSummary?.stage ?? client.outreach?.stage ?? "Lead") === stage)) ?? [];
  return <section className="ac-workspace" aria-label="Account clients">
    <header className="ac-heading"><div><span className="eyebrow">YOUR CLIENT RELATIONSHIPS</span><h1>{selected ? selected.name : "Good work starts with people."}</h1><p>{selected ? "Contact details, conversations, and the work you create together." : "Keep every conversation, next step, and project together."}</p></div>
      {!selected && snapshot && canEdit && <button className="button primary" disabled={busy || adding} onClick={() => setAdding(true)}><Plus size={16} /> Add client</button>}</header>
    {!selected && <div className="ac-toolbar">
      <label className="ac-search"><Search size={16} /><input aria-label="Search account clients" placeholder="Search name, company, or email" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <select aria-label="Outreach stage" value={stage} onChange={event => setStage(event.target.value)}><option>All stages</option>{outreachStages.map(item => <option key={item}>{item}</option>)}</select>
      {workspaces.length > 1 && <select aria-label="Client workspace" disabled={busy || adding} value={snapshot?.workspace.id ?? ""} onChange={event => navigate({ workspaceId: event.target.value, clientId: null })}>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <button className="button secondary small" disabled={busy || adding} aria-label="Refresh account clients" onClick={() => snapshot ? void load(snapshot.workspace.id) : window.location.reload()}><RefreshCw size={16} /></button>
    </div>}
    {message && <p role="status">{message}</p>}
    {!busy && target?.clientId && !selected && <button className="button secondary" onClick={() => navigate(null)}>Back to clients</button>}
    <PendingCloudWrites accountId={accountId} refresh={async () => { setUncertain(false); if (snapshot) await load(snapshot.workspace.id); else window.location.reload(); }} />
    {adding && <form className="ac-add" onSubmit={add}><h2>Add a client</h2><p>Start with their name. You can add details and outreach history next.</p><label>Name<input required maxLength={120} value={name} disabled={busy || uncertain} onChange={event => setName(event.target.value)} /></label><label>Email (optional)<input type="email" value={email} disabled={busy || uncertain} onChange={event => setEmail(event.target.value)} /></label><div className="button-row"><button className="button primary" disabled={busy || uncertain || !name.trim()}>{busy ? "Saving…" : "Save client"}</button><button className="button secondary" type="button" disabled={busy} onClick={() => setAdding(false)}>Cancel</button></div></form>}
    {busy && <p role="status">Loading…</p>}
    {selected && snapshot ? <div className="ac-detail">
      <button className="button ghost small" disabled={busy || saving} onClick={() => navigate({ workspaceId: snapshot.workspace.id, clientId: null })}><ArrowLeft size={15} /> All clients</button>
      <nav className="ac-source" aria-label="Client sections">{(["outreach", "details", "projects"] as const).map(item => <button key={item} disabled={busy || saving} aria-pressed={view === item} onClick={() => void open(selected.id, item)}>{item === "outreach" ? "Outreach & activity" : item === "details" ? "Contact details" : "Projects"}</button>)}</nav>
      {view === "outreach" && <CloudClientOutreach key={`${selected.id}:${selected.updatedAt}`} initialClient={selected} onSaving={savingChanged} workspaceId={snapshot.workspace.id} canEdit={canEdit} close={() => navigate({ workspaceId: snapshot.workspace.id, clientId: null })} onSaved={client => { setSelected(client); setSnapshot(current => current ? { ...current, clients: current.clients.map(item => item.id === client.id ? { ...client, outreachSummary: client.outreach ? { stage: client.outreach.stage, nextFollowUp: client.outreach.nextFollowUp } : undefined } : item) } : current); }} />}
      {view === "details" && <ClientDetails key={`${selected.id}:${selected.updatedAt}`} client={selected} onSaving={savingChanged} workspaceId={snapshot.workspace.id} canEdit={canEdit} close={() => navigate({ workspaceId: snapshot.workspace.id, clientId: null })} notify={setMessage} saved={async () => { await load(snapshot.workspace.id); setMessage("Client details saved to your account."); }} />}
      {view === "projects" && <div className="ac-projects"><h2>Projects for {selected.name}</h2>{snapshot.projects.filter(project => project.clientId === selected.id).map(project => <article key={project.id}><strong>{project.title}</strong><small>{project.kind} · {project.status}</small>{snapshot.artifacts.filter(artifact => artifact.projectId === project.id).map(artifact => <Link key={artifact.id} href={studioHref({ tab: "projects", projectId: null, clientId: null, account: { workspaceId: snapshot.workspace.id, artifactId: artifact.id } })}>{artifact.title}<ArrowUpRight size={14} /></Link>)}</article>)}
        {!snapshot.projects.some(project => project.clientId === selected.id) && <p>No linked projects in the loaded records. Assign this client when creating a project.</p>}
        {(["projects", "artifacts"] as const).map(collection => snapshot.pagination[collection].nextOffset !== null && <button key={collection} className="button secondary small" disabled={busy} onClick={() => void load(snapshot.workspace.id, collection)}>Load more {collection}</button>)}
      </div>}
    </div> : !adding && <><div className="ac-list">{clients.map(client => <button className="ac-row" key={client.id} disabled={busy} onClick={() => void open(client.id, "outreach")}><span className="ac-avatar">{client.name.slice(0, 1).toUpperCase()}</span><span className="ac-person"><strong>{client.name}</strong><small>{client.company || client.email || "Add contact details"}</small></span><span className="ac-stage">{client.outreachSummary?.stage ?? client.outreach?.stage ?? "Lead"}</span><small className="ac-followup">{(client.outreachSummary?.nextFollowUp ?? client.outreach?.nextFollowUp) ? `Follow up ${client.outreachSummary?.nextFollowUp ?? client.outreach?.nextFollowUp}` : "No follow-up set"}</small><ArrowUpRight size={16} /></button>)}</div>
      {!busy && !clients.length && !message && <div className="ac-empty"><Users size={28} /><h2>{snapshot ? "A place for your next client." : "Start your client workspace."}</h2><p>{snapshot ? "Add a client or adjust your filters to start tracking the relationship." : "Keep client relationships and their projects saved to your account."}</p>{!snapshot && !workspaces.length && <button onClick={() => void createWorkspace()} className="button primary">Set up client workspace</button>}</div>}
      {snapshot?.pagination.clients.nextOffset !== null && snapshot && <button className="button secondary small" disabled={busy} onClick={() => void load(snapshot.workspace.id, "clients")}>Load more clients</button>}
      {snapshot && <p className="small-note">Saved to your account · Filters apply to the {snapshot.clients.length} loaded clients.</p>}
    </>}
  </section>;
}

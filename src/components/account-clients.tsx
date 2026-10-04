"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Plus, RefreshCw, Search, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { CloudClient, CloudWorkspace, CloudWorkspaceSnapshot } from "@/lib/cloud/contracts";
import { outreachStages } from "@/lib/client-outreach";
import { followUpBucket, followUpLabel, localCalendarDay, type FollowUpBucket } from "@/lib/client-followups";
import { studioHref, type AccountClientRoute, type AccountProjectRoute } from "@/lib/studio-navigation";
import { api, CloudError, getPendingCloudWrites, setCloudAccount } from "./cloud-api";
import CloudClientOutreach from "./cloud-client-outreach";
import { useClientDirectory } from "./use-client-directory";
import ClientProjectDirectory from "./client-project-directory";
import PendingCloudWrites from "./pending-cloud-writes";
import "@/app/account-clients.css";

const ClientDetails = dynamic(() => import("./cloud-studio").then(module => module.CloudClientDetails));
type Page = { nextOffset: number | null; total: number };
type Snapshot = CloudWorkspaceSnapshot & { pagination: Record<"clients" | "projects" | "artifacts", Page> };

/** Account changes unmount every client draft and invalidate outstanding reads. */
type ClientCreation = { onOpenProject: (route: AccountProjectRoute) => void; onCreate: (workspaceId: string, client: CloudClient) => void };
type ClientNavigation = { target: AccountClientRoute | null; navigate: (route: AccountClientRoute | null) => void };
export default function AccountClients({ deviceClients, target, navigate, onCreate, onOpenProject, initialDevice = false }: ClientNavigation & ClientCreation & { deviceClients: ReactNode; initialDevice?: boolean }) {
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
    {device ? <><p className="small-note">These records stay on this device and are not uploaded automatically.</p>{deviceClients}</> : <SavedClients key={account} accountId={account} target={target} navigate={navigate} onCreate={onCreate} onOpenProject={onOpenProject} onSaving={setSaving} />}</>;
}

function SavedClients({ accountId, onSaving, target, navigate, onCreate, onOpenProject }: ClientNavigation & ClientCreation & { accountId: string; onSaving: (value: boolean) => void }) {
  const [saving, setSaving] = useState(false);
  function savingChanged(value: boolean) { setSaving(value); onSaving(value); }
  const [workspaces, setWorkspaces] = useState<CloudWorkspace[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<CloudClient | null>(null);
  const [view, setView] = useState<"outreach" | "details" | "projects">("outreach");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("All stages");
  const [followUp, setFollowUp] = useState<"all" | Exclude<FollowUpBucket, "closed">>("all");
  const [today, setToday] = useState(() => localCalendarDay(new Date()));
  useEffect(() => {
    const update = () => setToday(localCalendarDay(new Date()));
    const timer = window.setInterval(update, 60000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
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
  const directory = useClientDirectory(snapshot?.workspace.id, search, stage, followUp, today, snapshot?.clients);
  const canEdit = snapshot?.workspace.role !== "reviewer";
  const summary = (client: CloudClient) => client.outreachSummary ?? client.outreach;
  const followUps = ([['all', 'All clients'], ['overdue', 'Overdue'], ['today', 'Due today'], ['upcoming', 'Upcoming'], ['unscheduled', 'Not scheduled']] as const).map(([id, label]) => ({ id, label, count: directory.data?.counts[id] }));
  const clients = directory.data?.clients ?? [];
  return <section className="ac-workspace" aria-label="Account clients">
    <header className="ac-heading"><div><span className="eyebrow">YOUR CLIENT RELATIONSHIPS</span><h1>{selected ? selected.name : "Good work starts with people."}</h1><p>{selected ? "Contact details, conversations, and the work you create together." : "Keep every conversation, next step, and project together."}</p></div>
      {!selected && snapshot && canEdit && <button className="button primary" disabled={busy || adding} onClick={() => setAdding(true)}><Plus size={16} /> Add client</button>}</header>
    {selected && snapshot && canEdit && <button className="button primary" disabled={busy || saving} onClick={() => onCreate(snapshot.workspace.id, selected)}><Plus size={16} /> Create for this client</button>}
    {!selected && snapshot && <><div className="ac-followup-tabs" aria-label="Follow-up views">{followUps.map(item => <button type="button" key={item.id} aria-pressed={followUp === item.id} onClick={() => setFollowUp(item.id)}><span>{item.label}</span><strong>{item.count ?? "—"}</strong></button>)}</div><p className="small-note">Follow-ups across this workspace · Dates use your local calendar. Won and lost clients are excluded from follow-up views.</p></>}
    {!selected && <div className="ac-toolbar">
      <label className="ac-search"><Search size={16} /><input aria-label="Search account clients" maxLength={200} placeholder="Search name, company, or email" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <select aria-label="Outreach stage" value={stage} onChange={event => setStage(event.target.value)}><option>All stages</option>{outreachStages.map(item => <option key={item}>{item}</option>)}</select>
      {workspaces.length > 1 && <select aria-label="Client workspace" disabled={busy || adding} value={snapshot?.workspace.id ?? ""} onChange={event => navigate({ workspaceId: event.target.value, clientId: null })}>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <button className="button secondary small" disabled={busy || adding} aria-label="Refresh account clients" onClick={() => snapshot ? void load(snapshot.workspace.id) : window.location.reload()}><RefreshCw size={16} /></button>
    </div>}
    {message && <p role="status">{message}</p>}
    {!selected && directory.error && <p role="alert">{directory.error}</p>}
    {!selected && directory.busy && <p role="status">Searching your client workspace…</p>}
    {!busy && target?.clientId && !selected && <button className="button secondary" onClick={() => navigate(null)}>Back to clients</button>}
    <PendingCloudWrites accountId={accountId} refresh={async () => { setUncertain(false); if (snapshot) await load(snapshot.workspace.id); else window.location.reload(); }} />
    {adding && <form className="ac-add" onSubmit={add}><h2>Add a client</h2><p>Start with their name. You can add details and outreach history next.</p><label>Name<input required maxLength={120} value={name} disabled={busy || uncertain} onChange={event => setName(event.target.value)} /></label><label>Email (optional)<input type="email" value={email} disabled={busy || uncertain} onChange={event => setEmail(event.target.value)} /></label><div className="button-row"><button className="button primary" disabled={busy || uncertain || !name.trim()}>{busy ? "Saving…" : "Save client"}</button><button className="button secondary" type="button" disabled={busy} onClick={() => setAdding(false)}>Cancel</button></div></form>}
    {busy && <p role="status">Loading…</p>}
    {selected && snapshot ? <div className="ac-detail">
      <button className="button ghost small" disabled={busy || saving} onClick={() => navigate({ workspaceId: snapshot.workspace.id, clientId: null })}><ArrowLeft size={15} /> All clients</button>
      <nav className="ac-source" aria-label="Client sections">{(["outreach", "details", "projects"] as const).map(item => <button key={item} disabled={busy || saving} aria-pressed={view === item} onClick={() => void open(selected.id, item)}>{item === "outreach" ? "Outreach & activity" : item === "details" ? "Contact details" : "Projects"}</button>)}</nav>
      {view === "outreach" && <CloudClientOutreach key={`${selected.id}:${selected.updatedAt}`} initialClient={selected} onSaving={savingChanged} workspaceId={snapshot.workspace.id} canEdit={canEdit} close={() => navigate({ workspaceId: snapshot.workspace.id, clientId: null })} onSaved={client => { setSelected(client); setSnapshot(current => current ? { ...current, clients: current.clients.map(item => item.id === client.id ? { ...client, outreachSummary: client.outreach ? { stage: client.outreach.stage, nextFollowUp: client.outreach.nextFollowUp } : undefined } : item) } : current); }} />}
      {view === "details" && <ClientDetails key={`${selected.id}:${selected.updatedAt}`} client={selected} onSaving={savingChanged} workspaceId={snapshot.workspace.id} canEdit={canEdit} close={() => navigate({ workspaceId: snapshot.workspace.id, clientId: null })} notify={setMessage} saved={async () => { await load(snapshot.workspace.id); setMessage("Client details saved to your account."); }} />}
      {view === "projects" && <ClientProjectDirectory key={`${snapshot.workspace.id}:${selected.id}`} workspaceId={snapshot.workspace.id} clientId={selected.id} clientName={selected.name} onOpenProject={onOpenProject} />}
    </div> : !adding && <><div className="ac-list">{clients.map(client => <button className="ac-row" key={client.id} disabled={busy || directory.busy} onClick={() => void open(client.id, "outreach")}><span className="ac-avatar">{client.name.slice(0, 1).toUpperCase()}</span><span className="ac-person"><strong>{client.name}</strong><small>{client.company || client.email || "Add contact details"}</small></span><span className="ac-stage">{client.outreachSummary?.stage ?? client.outreach?.stage ?? "Lead"}</span><small className={`ac-followup ac-followup-${followUpBucket(summary(client), today)}`}>{followUpLabel(summary(client), today)}</small><ArrowUpRight size={16} /></button>)}</div>
      {!busy && !directory.busy && !directory.error && !clients.length && !message && <div className="ac-empty"><Users size={28} /><h2>{snapshot ? (search || stage !== "All stages" || followUp !== "all" ? "No clients match this view." : "A place for your next client.") : "Start your client workspace."}</h2><p>{snapshot ? "Add a client or adjust your filters to start tracking the relationship." : "Keep client relationships and their projects saved to your account."}</p>{snapshot && (search || stage !== "All stages" || followUp !== "all") && <button className="button secondary" onClick={() => { setSearch(""); setStage("All stages"); setFollowUp("all"); }}>Clear filters</button>}{!snapshot && !workspaces.length && <button onClick={() => void createWorkspace()} className="button primary">Set up client workspace</button>}</div>}
      {directory.data?.pagination.nextOffset != null && <button className="button secondary small" disabled={busy || directory.busy} onClick={() => void directory.more()}>Load more clients</button>}
      {directory.data && <p className="small-note">Showing {clients.length} of {directory.data.pagination.total} matching clients · Search and filters cover the whole workspace.</p>}
    </>}
  </section>;
}

"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, Columns3, Download, List, Mail, Plus, RefreshCw, Search, Sparkles, Upload, Users } from "lucide-react";
import MailCenter from "./mail/mail-center";
import ClientEmail from "./mail/client-email";
import BulkEnroll from "./mail/bulk-enroll";
import LeadProfileCard from "./leads/lead-profile";
import { leadApi, useLeadMeta } from "./leads/lead-api";
import { compactCount, countValue, formatMoney, scoreLead, type Lead } from "@/lib/leads";
import { mapImport, parseCsv, toCsv, type ImportedClient } from "@/lib/client-csv";
import ClientBoard from "./client-board";
const LeadFinder = dynamic(() => import("./leads/lead-finder"), { ssr: false });
import ClientCommandPalette, { type PaletteAction } from "./client-command-palette";
import { addDays, nextMonday, quickUpdate, type QuickChange } from "./client-quick-actions";
import { createClient } from "@/lib/supabase/client";
import type { CloudClient, CloudWorkspace, CloudWorkspaceSnapshot } from "@/lib/cloud/contracts";
import { emptyOutreach, outreachStages } from "@/lib/client-outreach";
import { followUpBucket, followUpLabel, localCalendarDay, type FollowUpBucket } from "@/lib/client-followups";
import { studioHref, type AccountClientRoute, type AccountProjectRoute } from "@/lib/studio-navigation";
import { api, CloudError, getPendingCloudWrites, setCloudAccount } from "./cloud-api";
import CloudClientOutreach from "./cloud-client-outreach";
import { useClientDirectory } from "./use-client-directory";
import ClientProjectDirectory from "./client-project-directory";
import ClientReviewFeed from "./client-review-feed";
import ClientFollowUpDraft from "./client-follow-up-draft";
import PendingCloudWrites from "./pending-cloud-writes";
import "@/app/account-clients.css";

const ClientDetails = dynamic(() => import("./cloud-studio").then(module => module.CloudClientDetails), { loading: () => <DetailSkeleton /> });
type Page = { nextOffset: number | null; total: number };
type Snapshot = CloudWorkspaceSnapshot & { pagination: Record<"clients" | "projects" | "artifacts", Page> };
type ClientView = "outreach" | "email" | "details" | "projects" | "reviews";
type Layout = "list" | "board" | "email";
const DEVICE_PREFERENCE = "makeborne.clients.device";
const LAYOUT_KEY = "makeborne.clients.layout";
const readDevicePreference = () => { try { return typeof window !== "undefined" && window.sessionStorage.getItem(DEVICE_PREFERENCE) === "1"; } catch { return false; } };
const writeDevicePreference = (value: boolean) => { try { window.sessionStorage.setItem(DEVICE_PREFERENCE, value ? "1" : "0"); } catch { /* private mode */ } };

/** Account changes unmount every client draft and invalidate outstanding reads. */
type ClientCreation = { onOpenProject: (route: AccountProjectRoute) => void; onCreate: (workspaceId: string, client: CloudClient) => void };
type ClientNavigation = { target: AccountClientRoute | null; navigate: (route: AccountClientRoute | null) => void };
export default function AccountClients({ deviceClients, target, navigate, onCreate, onOpenProject, initialDevice = false }: ClientNavigation & ClientCreation & { deviceClients: ReactNode; initialDevice?: boolean }) {
  const [account, setAccount] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  // The device/account choice survives navigation: opening a device client and
  // returning to "All clients" stays on the device list.
  const [devicePreference, setDevice] = useState(() => initialDevice || readDevicePreference());
  const [seenInitialDevice, setSeenInitialDevice] = useState(initialDevice);
  if (seenInitialDevice !== initialDevice) { setSeenInitialDevice(initialDevice); if (initialDevice) setDevice(true); }
  const device = devicePreference && !target;
  const chooseDevice = (value: boolean) => { setDevice(value); writeDevicePreference(value); };
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
  if (!ready) return <ListSkeleton label="Loading your clients" />;
  if (!account && target) return <section className="ac-workspace"><h1>Sign in to open this client</h1><p>Client records are available to members of their workspace.</p><Link className="button primary" href={`/login?next=${encodeURIComponent(studioHref({ tab: "clients", projectId: null, clientId: null, accountClient: target }))}`}>Sign in</Link></section>;
  if (!account) return <><p className="small-note">These clients are saved on this device. <Link href="/login">Sign in</Link> to manage account clients.</p>{deviceClients}</>;
  return <><div className="ac-source" aria-label="Client storage"><button disabled={saving} aria-pressed={!device} onClick={() => { chooseDevice(false); if (initialDevice) navigate(null); }}>Account clients</button><button disabled={saving} aria-pressed={device} onClick={() => { chooseDevice(true); navigate(null); }}>On this device</button></div>
    {device ? <><p className="small-note">These records stay on this device and are not uploaded automatically.</p>{deviceClients}</> : <SavedClients key={account} accountId={account} target={target} navigate={navigate} onCreate={onCreate} onOpenProject={onOpenProject} onSaving={setSaving} />}</>;
}

function ListSkeleton({ label }: { label: string }) {
  return <div className="ac-skeleton" role="status" aria-label={label}>{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>;
}
function DetailSkeleton() {
  return <div className="ac-skeleton ac-skeleton-detail" role="status" aria-label="Loading client"><span /><span /><span /></div>;
}
/** The element that actually scrolls the studio content. */
function scrollParent(element: HTMLElement | null): HTMLElement {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

function SavedClients({ accountId, onSaving, target, navigate, onCreate, onOpenProject }: ClientNavigation & ClientCreation & { accountId: string; onSaving: (value: boolean) => void }) {
  const [saving, setSaving] = useState(false);
  function savingChanged(value: boolean) { setSaving(value); onSaving(value); }
  const [workspaces, setWorkspaces] = useState<CloudWorkspace[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  // Full client records by id. The list only carries summaries.
  const [loaded, setLoaded] = useState<Record<string, CloudClient>>({});
  const [detailError, setDetailError] = useState<{ id: string; message: string } | null>(null);
  // Editable panels mount only on a record fetched during this visit, never a cached one.
  const [fresh, setFresh] = useState<string | null>(null);
  // Bumped when the record changes outside the outreach panel, so the panel re-reads it.
  const [outreachRevision, setOutreachRevision] = useState(0);
  const [view, setView] = useState<ClientView>("outreach");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("All stages");
  const [followUp, setFollowUp] = useState<"all" | Exclude<FollowUpBucket, "closed">>("all");
  const [today, setToday] = useState(() => localCalendarDay(new Date()));
  const [refreshKey, setRefreshKey] = useState(0);
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
  const root = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const listScroll = useRef<{ element: HTMLElement; top: number } | null>(null);
  const snapshotWorkspace = useRef<string | null>(null);
  const requestedWorkspace = target?.workspaceId ?? null;
  const clientId = target?.clientId ?? null;
  const [visited, setVisited] = useState(clientId);
  if (visited !== clientId) { setVisited(clientId); setFresh(null); }

  // The workspace loads once per account/workspace. Opening a client or going back
  // never reloads it, so the list stays on screen.
  useEffect(() => {
    if (snapshotWorkspace.current && (!requestedWorkspace || requestedWorkspace === snapshotWorkspace.current)) return;
    const requests = generation;
    const version = ++requests.current;
    void (async () => {
      setBusy(true); setMessage(""); setAdding(false);
      try {
        const result = await api<{ workspaces: CloudWorkspace[] }>("/api/workspaces");
        if (version !== generation.current) return;
        setWorkspaces(result.workspaces);
        const workspace = requestedWorkspace ? result.workspaces.find(item => item.id === requestedWorkspace) : result.workspaces.find(item => item.role === "owner") ?? result.workspaces[0];
        if (requestedWorkspace && !workspace) throw new Error("This client workspace is not available to your account. Check your account or ask the owner for access.");
        if (workspace) {
          const data = await api<Snapshot>(`/api/cloud/workspaces/${workspace.id}`);
          if (version === generation.current) { snapshotWorkspace.current = workspace.id; setSnapshot(data); }
        }
      } catch (cause) { if (version === generation.current) setMessage(cause instanceof Error ? cause.message : "Could not load clients."); }
      finally { if (version === generation.current) setBusy(false); }
    })();
    return () => { requests.current++; };
  }, [accountId, requestedWorkspace]);

  const directory = useClientDirectory(snapshot?.workspace.id, search, stage, followUp, today, refreshKey);
  // Tag filter: clients carrying one tag (up to 200), shown instead of the paged directory.
  const [tagFilter, setTagFilter] = useState("");
  const [allTags, setAllTags] = useState<{ tag: string; count: number }[]>([]);
  const [tagged, setTagged] = useState<{ tag: string; clients: CloudClient[] } | null>(null);
  useEffect(() => {
    const id = snapshot?.workspace.id;
    if (!id) return;
    let live = true;
    void leadApi.tags(accountId, id).then(result => { if (live) setAllTags(result.tags); }).catch(() => undefined);
    return () => { live = false; };
  }, [accountId, snapshot?.workspace.id, refreshKey]);
  useEffect(() => {
    const id = snapshot?.workspace.id;
    if (!id || !tagFilter) return;
    let live = true;
    void fetch(`/api/cloud/workspaces/${id}/leads?tag=${encodeURIComponent(tagFilter)}`, { headers: { "X-Makeborne-Account": accountId }, cache: "no-store" })
      .then(response => response.json()).then((result: { clients?: CloudClient[] }) => { if (live) setTagged({ tag: tagFilter, clients: result.clients ?? [] }); }).catch(() => undefined);
    return () => { live = false; };
  }, [accountId, snapshot?.workspace.id, tagFilter, refreshKey]);
  const listedIds = (tagFilter ? tagged?.tag === tagFilter ? tagged.clients : [] : directory.data?.clients ?? []).map(client => client.id);
  const leadMeta = useLeadMeta(accountId, snapshot?.workspace.id, target?.clientId ? [target.clientId] : listedIds, refreshKey);
  // Returning from connecting a mailbox opens Email with the result.
  const [connectResult] = useState(() => { if (typeof window === "undefined") return null; const query = new URLSearchParams(window.location.search), result = query.get("mail"); return result ? { result, detail: query.get("mailDetail") ?? "" } : null; });
  const [layout, setLayout] = useState<Layout>(() => { if (connectResult) return "email"; try { const saved = typeof window !== "undefined" ? window.localStorage.getItem(LAYOUT_KEY) : null; return saved === "board" || saved === "email" ? saved : "list"; } catch { return "list"; } });
  const chooseLayout = (next: Layout) => { setLayout(next); try { window.localStorage.setItem(LAYOUT_KEY, next); } catch { /* storage unavailable */ } };
  useEffect(() => { if (!connectResult) return; const url = new URL(window.location.href); url.searchParams.delete("mail"); url.searchParams.delete("mailDetail"); window.history.replaceState(window.history.state, "", url); }, [connectResult]);
  // Selected clients (kept with their details so bulk actions work across pages and filters).
  const [picked, setPicked] = useState<Map<string, { id: string; name: string; email: string; company: string }>>(new Map());
  const togglePick = (client: CloudClient) => setPicked(current => { const next = new Map(current); if (next.has(client.id)) next.delete(client.id); else next.set(client.id, { id: client.id, name: client.name, email: client.email, company: client.company }); return next; });
  const [palette, setPalette] = useState(false);
  const [finding, setFinding] = useState(false);
  const [pendingRows, setPendingRows] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState<{ file: string; clients: ImportedClient[]; skipped: { row: number; reason: string }[]; columns: Partial<Record<keyof ImportedClient, string>>; progress: number | null } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  // Rendered only in the browser (after the account check), so the platform is known.
  const shortcutKey = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  // Ctrl/⌘+K opens the client palette from the list.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !clientId && snapshotWorkspace.current) { event.preventDefault(); setPalette(open => !open); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clientId]);
  const workspaceId = snapshot?.workspace.id;

  // Load the full record for the open client; the list row is shown meanwhile.
  useEffect(() => {
    if (!workspaceId || !clientId) return;
    let active = true;
    void api<{ client: CloudClient }>(`/api/cloud/workspaces/${workspaceId}/clients/${clientId}`)
      .then(result => { if (active) { setLoaded(current => ({ ...current, [result.client.id]: result.client })); setDetailError(null); setFresh(result.client.id); } })
      .catch(cause => { if (active) setDetailError({ id: clientId, message: cause instanceof Error ? cause.message : "Could not open client." }); });
    return () => { active = false; };
  }, [workspaceId, clientId]);

  // Returning to the list restores where the reader was.
  useEffect(() => {
    if (clientId || !listScroll.current) return;
    const { element, top } = listScroll.current;
    listScroll.current = null;
    requestAnimationFrame(() => element.scrollTo({ top }));
  }, [clientId]);

  // Keyboard: "/" searches the list, Escape returns to it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
      if (event.key === "/" && !typing && !clientId) { event.preventDefault(); searchInput.current?.focus(); }
      else if (event.key === "Escape" && clientId && !typing && !saving && workspaceId) navigate({ workspaceId, clientId: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clientId, saving, workspaceId, navigate]);

  const listed = clientId ? directory.data?.clients.find(item => item.id === clientId) : undefined;
  const full = clientId ? loaded[clientId] : undefined;
  const opened = full ?? listed ?? null;
  const openError = clientId && detailError?.id === clientId ? detailError.message : "";

  async function refresh() {
    if (!snapshot) { window.location.reload(); return; }
    const version = ++generation.current;
    setBusy(true); setMessage("");
    try {
      const data = await api<Snapshot>(`/api/cloud/workspaces/${snapshot.workspace.id}`);
      if (version !== generation.current) return;
      setSnapshot(data); setRefreshKey(key => key + 1);
      if (clientId) {
        const detail = await api<{ client: CloudClient }>(`/api/cloud/workspaces/${snapshot.workspace.id}/clients/${clientId}`);
        if (version === generation.current) setLoaded(current => ({ ...current, [detail.client.id]: detail.client }));
      }
    } catch (cause) { if (version === generation.current) setMessage(cause instanceof Error ? cause.message : "Could not load clients."); }
    finally { if (version === generation.current) setBusy(false); }
  }
  function open(id: string) {
    if (!snapshot) return;
    if (root.current) { const element = scrollParent(root.current); listScroll.current = { element, top: element.scrollTop }; }
    setView("outreach"); setMessage("");
    navigate({ workspaceId: snapshot.workspace.id, clientId: id });
  }
  function saved(client: CloudClient) {
    setLoaded(current => ({ ...current, [client.id]: client }));
    directory.patch({ ...client, outreachSummary: client.outreach ? { stage: client.outreach.stage, nextFollowUp: client.outreach.nextFollowUp } : client.outreachSummary });
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
      setLoaded(current => ({ ...current, [result.client.id]: result.client })); setRefreshKey(key => key + 1);
      setAdding(false); setName(""); setEmail(""); setMessage("Client saved to your account.");
      setView("details"); navigate({ workspaceId: snapshot.workspace.id, clientId: result.client.id });
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
    const version = ++generation.current;
    try {
      const result = await api<{ workspace: CloudWorkspace }>("/api/workspaces", { name: "My workspace" });
      if (version !== generation.current) return;
      setWorkspaces([result.workspace]);
      const data = await api<Snapshot>(`/api/cloud/workspaces/${result.workspace.id}`);
      if (version === generation.current) { snapshotWorkspace.current = result.workspace.id; setSnapshot(data); }
    } catch (cause) { if (version === generation.current) setMessage(cause instanceof Error ? cause.message : "Could not prepare your workspace."); }
    finally { writeLock.current = false; savingChanged(false); setBusy(false); }
  }
  const canEdit = snapshot?.workspace.role !== "reviewer";
  const summary = (client: CloudClient) => client.outreachSummary ?? client.outreach;
  const followUps = ([['all', 'All clients'], ['overdue', 'Overdue'], ['today', 'Due today'], ['upcoming', 'Upcoming'], ['unscheduled', 'Not scheduled']] as const).map(([id, label]) => ({ id, label, count: directory.data?.counts[id] }));
  const clients = tagFilter ? (tagged?.tag === tagFilter ? tagged.clients : []) : directory.data?.clients ?? [];
  const leadChips = (lead: Lead | undefined, client: CloudClient, bucket: string) => {
    if (!lead) return null;
    const score = scoreLead({ stage: String(summary(client)?.stage ?? "Lead"), hasEmail: !!client.email, lead, overdue: bucket === "overdue" });
    const followers = countValue(lead.profile.research?.followers);
    return <span className="ac-lead-chips">
      {score && <span className={`ac-score is-${score.tier}`} title={`Lead score: ${score.reasons.join(" · ")}`}>{score.value}</span>}
      {followers !== null && <span className="ac-chip" title={lead.profile.research?.platform}>{compactCount(followers)} followers</span>}
      {lead.dealValue ? <span className="ac-chip is-money">{formatMoney(lead.dealValue, lead.dealCurrency)}</span> : null}
      {lead.tags.slice(0, 2).map(tag => <span key={tag} className="ac-chip is-tag">{tag}</span>)}
    </span>;
  };
  const filtered = search || stage !== "All stages" || followUp !== "all";
  const backToList = () => snapshot && navigate({ workspaceId: snapshot.workspace.id, clientId: null });
  /** One-click follow-up actions: shown at once, saved with history, rolled back if refused. */
  async function quick(client: CloudClient, change: QuickChange, done: string) {
    if (!snapshot || pendingRows.has(client.id)) return;
    const before = client;
    const optimistic = change.kind === "snooze" ? change.nextFollowUp : change.kind === "contacted" ? change.nextFollowUp : summary(client)?.nextFollowUp ?? null;
    directory.patch({ ...client, outreachSummary: { stage: change.kind === "stage" ? change.stage : (summary(client)?.stage === "Lead" && change.kind === "contacted" ? "Contacted" : (summary(client)?.stage ?? "Lead")), nextFollowUp: optimistic } as CloudClient["outreachSummary"] });
    setPendingRows(set => new Set(set).add(client.id)); setMessage("");
    try {
      const updated = await quickUpdate(snapshot.workspace.id, client.id, change, today);
      saved(updated); setMessage(done);
      // Counts and filtered views change with the follow-up date.
      setRefreshKey(key => key + 1);
    } catch (cause) {
      directory.patch(before);
      setMessage(cause instanceof Error ? cause.message : `Couldn't update ${client.name}. Nothing changed.`);
    } finally { setPendingRows(set => { const next = new Set(set); next.delete(client.id); return next; }); }
  }
  async function exportCsv() {
    if (!snapshot || exporting) return;
    setExporting(true); setMessage("");
    try {
      const rows: CloudClient[] = [];
      for (let offset = 0; offset < 5000;) {
        const page = await api<{ clients: CloudClient[]; pagination: { nextOffset: number | null } }>(`/api/cloud/workspaces/${snapshot.workspace.id}/clients?${new URLSearchParams({ search, stage, followUp, day: today })}${offset ? `&offset=${offset}` : ""}`);
        rows.push(...page.clients);
        if (page.pagination.nextOffset == null) break;
        offset = page.pagination.nextOffset;
      }
      const csv = toCsv(["Name", "Company", "Email", "Website", "Stage", "Next follow-up", "Notes"],
        rows.map(client => [client.name, client.company, client.email, client.website, summary(client)?.stage ?? "Lead", summary(client)?.nextFollowUp ?? "", client.notes]));
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), link = document.createElement("a");
      link.href = url; link.download = `makeborne-clients-${today}.csv`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setMessage(`Exported ${rows.length} client${rows.length === 1 ? "" : "s"}${filtered ? " matching your filters" : ""}.`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The export could not finish."); }
    finally { setExporting(false); }
  }
  async function previewImport(file: File) {
    if (file.size > 2_000_000) { setMessage("That file is over 2 MB. Split it into smaller files."); return; }
    const result = mapImport(parseCsv(await file.text()));
    setAdding(false); setImporting({ file: file.name, ...result, progress: null });
  }
  async function runImport() {
    if (!snapshot || !importing || importing.progress !== null || writeLock.current) return;
    writeLock.current = true; savingChanged(true);
    let created = 0, failed = 0;
    setImporting(current => current && { ...current, progress: 0 });
    for (const client of importing.clients) {
      try {
        const { profileUrl, tags, ...fields } = client;
        const result = await api<{ client: CloudClient }>(`/api/cloud/workspaces/${snapshot.workspace.id}/clients`, fields); created++;
        // Profile links and tags are added after the client exists (best effort; the client is already saved).
        if (profileUrl) await api(`/api/cloud/workspaces/${snapshot.workspace.id}/clients/${result.client.id}`, { outreach: { ...emptyOutreach(), profileUrl, channel: /instagram/i.test(profileUrl) ? "Instagram" : "Other" }, expectedUpdatedAt: result.client.updatedAt }, "PATCH").catch(() => undefined);
        if (tags.length) await leadApi.update(accountId, snapshot.workspace.id, result.client.id, { tags }).catch(() => undefined);
      }
      catch (cause) { failed++; if (cause instanceof CloudError && cause.uncertain) break; }
      setImporting(current => current && { ...current, progress: created + failed });
    }
    writeLock.current = false; savingChanged(false);
    setImporting(null); setRefreshKey(key => key + 1);
    setMessage(failed ? `Imported ${created} client${created === 1 ? "" : "s"}; ${failed} could not be saved. Check them and import those rows again.` : `Imported ${created} client${created === 1 ? "" : "s"}.`);
  }
  const tabs: { id: ClientView; label: string }[] = [{ id: "outreach", label: "Outreach & activity" }, { id: "email", label: "Email" }, { id: "details", label: "Contact details" }, { id: "projects", label: "Projects" }, { id: "reviews", label: "Client reviews" }];

  if (clientId) return <section className="ac-workspace" aria-label="Account client" ref={root}>
    <button className="button ghost small ac-back" disabled={saving} onClick={backToList}><ArrowLeft size={15} /> All clients</button>
    <header className="ac-heading"><div><span className="eyebrow">CLIENT</span><h1>{opened?.name ?? "Client"}</h1><p>{opened ? [opened.company, opened.email].filter(Boolean).join(" · ") || "Contact details, conversations, and the work you create together." : "Opening client…"}</p></div>
      {opened && snapshot && canEdit && <button className="button primary" disabled={saving} onClick={() => onCreate(snapshot.workspace.id, opened)}><Plus size={16} /> Create for this client</button>}</header>
    {message && <p role="status">{message}</p>}
    {openError && <div className="ac-notice" role="alert"><p>{openError}</p><button className="button secondary small" onClick={backToList}>Back to clients</button></div>}
    <PendingCloudWrites accountId={accountId} refresh={async () => { setUncertain(false); await refresh(); }} />
    <nav className="ac-source ac-tabs" aria-label="Client sections">{tabs.map(item => <button key={item.id} disabled={saving} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}</nav>
    <div className="ac-detail">
      {!full || !snapshot || fresh !== full.id ? !openError && <DetailSkeleton /> : <>
        {view === "outreach" && <LeadProfileCard key={`lead:${full.id}`} accountId={accountId} workspaceId={snapshot.workspace.id} clientId={full.id} lead={leadMeta.leads[full.id]}
          stage={String(full.outreach?.stage ?? "Lead")} hasEmail={!!full.email} overdue={followUpBucket(full.outreach, today) === "overdue"} canEdit={canEdit} onChange={lead => leadMeta.update(full.id, lead)} />}
        {view === "outreach" && canEdit && <ClientFollowUpDraft accountId={accountId} workspaceId={snapshot.workspace.id} client={full} onLogged={client => { saved(client); setOutreachRevision(value => value + 1); setMessage("Logged as sent. The next follow-up is scheduled."); }} />}
        {view === "outreach" && <CloudClientOutreach embedded key={`${full.id}:${outreachRevision}`} initialClient={full} onSaving={savingChanged} workspaceId={snapshot.workspace.id} canEdit={canEdit} close={backToList} onSaved={saved} />}
        {view === "details" && <ClientDetails key={full.id} client={full} onSaving={savingChanged} workspaceId={snapshot.workspace.id} canEdit={canEdit} close={backToList} notify={setMessage} saved={async () => {
          try { const detail = await api<{ client: CloudClient }>(`/api/cloud/workspaces/${snapshot.workspace.id}/clients/${full.id}`); saved(detail.client); setMessage("Client details saved to your account."); }
          catch { setMessage("Client details saved. Refresh to see the latest version."); }
        }} />}
        {view === "reviews" && <ClientReviewFeed key={`${snapshot.workspace.id}:${full.id}:reviews`} accountId={accountId} workspaceId={snapshot.workspace.id} clientId={full.id} clientName={full.name} canEdit={canEdit} onOpenProject={onOpenProject} />}
        {view === "email" && <ClientEmail key={full.id} accountId={accountId} workspaceId={snapshot.workspace.id} client={{ id: full.id, name: full.name, email: full.email }} canEdit={canEdit}
          onSent={() => void api<{ client: CloudClient }>(`/api/cloud/workspaces/${snapshot.workspace.id}/clients/${full.id}`).then(result => { saved(result.client); setOutreachRevision(value => value + 1); }).catch(() => undefined)}
          onOpenEmailCenter={() => { chooseLayout("email"); backToList(); }} />}
        {view === "projects" && <ClientProjectDirectory key={`${snapshot.workspace.id}:${full.id}`} workspaceId={snapshot.workspace.id} clientId={full.id} clientName={full.name} onOpenProject={onOpenProject} />}
      </>}
    </div>
  </section>;

  const paletteActions: PaletteAction[] = [
    ...(canEdit ? [{ id: "add", label: "Add a client", icon: "add" as const }, { id: "find", label: "Find new leads", hint: "Map search or your list", icon: "add" as const }] : []),
    { id: "overdue", label: "Show overdue follow-ups", hint: directory.data ? `${directory.data.counts.overdue} overdue` : undefined, icon: "overdue" },
    layout === "list" ? { id: "board", label: "Switch to pipeline board", icon: "board" } : { id: "list", label: "Switch to list", icon: "list" },
    ...(layout !== "email" ? [{ id: "email", label: "Open Email: mailboxes, sequences, replies", icon: "email" as const }] : []),
    { id: "export", label: "Export clients to CSV", icon: "export" },
    ...(canEdit ? [{ id: "import", label: "Import clients from CSV", icon: "import" as const }] : []),
  ];
  function runAction(id: string) {
    if (id === "add") { chooseLayout("list"); setAdding(true); }
    else if (id === "find") setFinding(true);
    else if (id === "overdue") { chooseLayout("list"); setFollowUp("overdue"); }
    else if (id === "board" || id === "list" || id === "email") chooseLayout(id);
    else if (id === "export") void exportCsv();
    else if (id === "import") importInput.current?.click();
  }

  return <section className="ac-workspace" aria-label="Account clients" ref={root}>
    <header className="ac-heading"><div><span className="eyebrow">YOUR CLIENT RELATIONSHIPS</span><h1>Good work starts with people.</h1><p>Keep every conversation, next step, and project together.</p></div>
      <div className="ac-heading-actions">
        {snapshot && <button type="button" className="ac-palette-hint" onClick={() => setPalette(true)} aria-label="Find a client or action (Ctrl+K)"><Search size={14} />Find<kbd>{shortcutKey}K</kbd></button>}
        {snapshot && canEdit && <button type="button" className="button secondary ac-find-leads" disabled={busy} onClick={() => setFinding(true)}><Sparkles size={15} />Find leads</button>}
        {snapshot && canEdit && <button className="button primary" disabled={busy || adding} onClick={() => setAdding(true)}><Plus size={16} /> Add client</button>}
      </div></header>
    {snapshot && layout === "list" && <><div className="ac-followup-tabs" aria-label="Follow-up views">{followUps.map(item => <button type="button" key={item.id} aria-pressed={followUp === item.id} onClick={() => setFollowUp(item.id)}><span>{item.label}</span><strong>{item.count ?? "—"}</strong></button>)}</div><p className="small-note">Follow-ups across this workspace · Dates use your local calendar. Won, delivered and lost clients are excluded from follow-up views.</p>
      {allTags.length > 0 && <div className="ac-tag-filter" role="group" aria-label="Filter by tag"><span>Tags</span>{allTags.slice(0, 14).map(item => <button type="button" key={item.tag} aria-pressed={tagFilter === item.tag} onClick={() => { setTagFilter(current => current === item.tag ? "" : item.tag); setPicked(new Map()); }}>{item.tag}<small>{item.count}</small></button>)}
        {tagFilter && <button type="button" className="ac-tag-clear" onClick={() => setTagFilter("")}>Clear</button>}</div>}</>}
    {snapshot && <div className="ac-toolbar">
      <div className="ac-layout" role="radiogroup" aria-label="Client layout">
        <button type="button" role="radio" aria-checked={layout === "list"} onClick={() => chooseLayout("list")}><List size={15} />List</button>
        <button type="button" role="radio" aria-checked={layout === "board"} onClick={() => chooseLayout("board")}><Columns3 size={15} />Pipeline</button>
        <button type="button" role="radio" aria-checked={layout === "email"} onClick={() => chooseLayout("email")}><Mail size={15} />Email</button>
      </div>
      {layout !== "email" && <label className="ac-search"><Search size={16} /><input ref={searchInput} aria-label="Search account clients" maxLength={200} placeholder="Search name, company, or email" value={search} onChange={event => setSearch(event.target.value)} /><kbd aria-hidden="true">/</kbd></label>}
      {layout === "list" && <select aria-label="Outreach stage" value={stage} onChange={event => setStage(event.target.value)}><option>All stages</option>{outreachStages.map(item => <option key={item}>{item}</option>)}</select>}
      {workspaces.length > 1 && <select aria-label="Client workspace" disabled={busy || adding} value={snapshot.workspace.id} onChange={event => navigate({ workspaceId: event.target.value, clientId: null })}>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <div className="ac-tool-icons">
      <button className="button secondary small" disabled={exporting} aria-label="Export clients to CSV" title="Export to CSV" onClick={() => void exportCsv()}><Download size={16} /></button>
      {canEdit && <button className="button secondary small" disabled={!!importing} aria-label="Import clients from CSV" title="Import from CSV" onClick={() => importInput.current?.click()}><Upload size={16} /></button>}
      <input ref={importInput} type="file" accept=".csv,text/csv" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void previewImport(file); }} />
      <button className="button secondary small" disabled={busy || adding} aria-label="Refresh account clients" onClick={() => void refresh()}><RefreshCw size={16} className={busy || directory.busy ? "ac-spin" : undefined} /></button>
      </div>
    </div>}
    {message && <p role="status" className="ac-message">{message}</p>}
    {directory.error && <p role="alert">{directory.error}</p>}
    <PendingCloudWrites accountId={accountId} refresh={async () => { setUncertain(false); await refresh(); }} />
    {importing && <section className="ac-import" aria-labelledby="ac-import-title">
      <h2 id="ac-import-title">Import {importing.clients.length} client{importing.clients.length === 1 ? "" : "s"}</h2>
      <p>From <strong>{importing.file}</strong>. Columns found: {Object.entries(importing.columns).map(([field, column]) => `${field} ← “${column}”`).join(", ") || "none"}.</p>
      {importing.skipped.length > 0 && <details><summary>{importing.skipped.length} row{importing.skipped.length === 1 ? "" : "s"} will be skipped</summary><ul>{importing.skipped.slice(0, 50).map(item => <li key={`${item.row}-${item.reason}`}>Row {item.row}: {item.reason}</li>)}</ul></details>}
      {importing.clients.length > 0 && <ul className="ac-import-preview">{importing.clients.slice(0, 5).map((client, index) => <li key={index}><strong>{client.name}</strong><span>{[client.company, client.email].filter(Boolean).join(" · ")}</span></li>)}{importing.clients.length > 5 && <li className="small-note">…and {importing.clients.length - 5} more</li>}</ul>}
      {importing.progress !== null && <div className="ac-progress" role="progressbar" aria-valuemin={0} aria-valuemax={importing.clients.length} aria-valuenow={importing.progress}><span style={{ width: `${(importing.progress / Math.max(1, importing.clients.length)) * 100}%` }} /></div>}
      <div className="button-row">
        <button className="button primary" disabled={!importing.clients.length || importing.progress !== null} onClick={() => void runImport()}>{importing.progress !== null ? `Importing ${importing.progress} of ${importing.clients.length}…` : `Import ${importing.clients.length}`}</button>
        <button className="button secondary" disabled={importing.progress !== null} onClick={() => setImporting(null)}>Cancel</button>
      </div>
    </section>}
    {adding && <form className="ac-add" onSubmit={add}><h2>Add a client</h2><p>Start with their name. You can add details and outreach history next.</p><label>Name<input required autoFocus maxLength={120} value={name} disabled={busy || uncertain} onChange={event => setName(event.target.value)} /></label><label>Email (optional)<input type="email" value={email} disabled={busy || uncertain} onChange={event => setEmail(event.target.value)} /></label><div className="button-row"><button className="button primary" disabled={busy || uncertain || !name.trim()}>{busy ? "Saving…" : "Save client"}</button><button className="button secondary" type="button" disabled={busy} onClick={() => setAdding(false)}>Cancel</button></div></form>}
    {snapshot && layout === "email" && !adding ? <MailCenter accountId={accountId} workspaceId={snapshot.workspace.id} canEdit={canEdit} connectResult={connectResult} onOpenClient={id => { open(id); setView("email"); }} />
    : snapshot && layout === "board" && !adding ? <ClientBoard accountId={accountId} workspaceId={snapshot.workspace.id} search={search} today={today} canEdit={canEdit} refreshKey={refreshKey} onOpen={open}
      onChanged={client => saved(client)} onError={setMessage} />
    : (busy && !snapshot) || directory.loading ? <ListSkeleton label="Loading clients" /> : !adding && <>
      {picked.size > 0 && snapshot && <BulkEnroll accountId={accountId} workspaceId={snapshot.workspace.id} clients={[...picked.values()]} onDone={setMessage} onClear={() => setPicked(new Map())} onOpenEmailCenter={() => chooseLayout("email")} />}
      <div className={`ac-list${directory.stale ? " is-stale" : ""}`} aria-busy={directory.stale}>{clients.map(client => {
        const bucket = followUpBucket(summary(client), today), open_ = !["Won", "Lost"].includes(String(summary(client)?.stage ?? "Lead"));
        return <div className={`ac-row${pendingRows.has(client.id) ? " is-saving" : ""}${picked.has(client.id) ? " is-picked" : ""}`} key={client.id}>
          {canEdit && <input type="checkbox" className="ac-row-check" checked={picked.has(client.id)} onChange={() => togglePick(client)} aria-label={`Select ${client.name}`} />}
          <button type="button" className="ac-row-open" onClick={() => open(client.id)}><span className="ac-avatar">{client.name.slice(0, 1).toUpperCase()}</span><span className="ac-person"><strong>{client.name}</strong><small>{client.company || client.email || "Add contact details"}</small></span><span className="ac-stage">{summary(client)?.stage ?? "Lead"}</span>{leadChips(leadMeta.leads[client.id], client, bucket)}<small className={`ac-followup ac-followup-${bucket}`}>{followUpLabel(summary(client), today)}</small><ArrowUpRight size={16} /></button>
          {canEdit && open_ && <div className="ac-row-actions">
            <button type="button" disabled={pendingRows.has(client.id)} onClick={() => void quick(client, { kind: "contacted", nextFollowUp: addDays(today, 3) }, `Logged contact with ${client.name}. Next follow-up in 3 days.`)} title="Log a contact today and follow up in 3 days" aria-label={`Mark ${client.name} as contacted`}><Check size={15} /></button>
            <select aria-label={`Snooze the follow-up for ${client.name}`} value="" disabled={pendingRows.has(client.id)} onChange={event => { const day = event.target.value; if (day) void quick(client, { kind: "snooze", nextFollowUp: day }, `Follow-up for ${client.name} moved to ${day}.`); }}>
              <option value="">Snooze…</option><option value={addDays(today, 1)}>Tomorrow</option><option value={addDays(today, 3)}>In 3 days</option><option value={nextMonday(today)}>Next Monday</option><option value={addDays(today, 14)}>In 2 weeks</option>
            </select>
          </div>}
        </div>;
      })}</div>
      {!busy && !directory.busy && !directory.error && !clients.length && !message && <div className="ac-empty"><Users size={28} /><h2>{snapshot ? (filtered ? "No clients match this view." : "A place for your next client.") : "Start your client workspace."}</h2><p>{snapshot ? (filtered ? "Adjust your filters, or add a client." : "Add a client, or import your list from a CSV file.") : "Keep client relationships and their projects saved to your account."}</p>{snapshot && filtered && <button className="button secondary" onClick={() => { setSearch(""); setStage("All stages"); setFollowUp("all"); }}>Clear filters</button>}{snapshot && !filtered && canEdit && <button className="button secondary" onClick={() => importInput.current?.click()}><Upload size={15} /> Import CSV</button>}{!snapshot && !workspaces.length && <button onClick={() => void createWorkspace()} className="button primary">Set up client workspace</button>}</div>}
      {tagFilter && <p className="small-note" aria-live="polite">{tagged?.tag === tagFilter ? `${clients.length} client${clients.length === 1 ? "" : "s"} tagged “${tagFilter}”` : "Loading tagged clients…"}</p>}
      {!tagFilter && directory.data?.pagination.nextOffset != null && !directory.stale && <button className="button secondary small" disabled={directory.busy} onClick={() => void directory.more()}>Load more clients</button>}
      {!tagFilter && directory.data && <p className="small-note" aria-live="polite">{directory.stale ? "Updating…" : `Showing ${clients.length} of ${directory.data.pagination.total} matching clients · Search and filters cover the whole workspace.`}</p>}
    </>}
    {finding && snapshot && <LeadFinder accountId={accountId} workspaceId={snapshot.workspace.id} onClose={() => setFinding(false)} onAdded={(count, tag) => {
      setFinding(false); chooseLayout("list"); if (tag) setTagFilter(tag); setRefreshKey(key => key + 1);
      setMessage(`Added ${count} new lead${count === 1 ? "" : "s"} to your clients${tag ? `, tagged “${tag}”` : ""}. Select them and choose “Write personal emails” to reach out.`);
    }} />}
    {palette && snapshot && <ClientCommandPalette workspaceId={snapshot.workspace.id} today={today} actions={paletteActions} onOpenClient={open} onAction={runAction} onClose={() => setPalette(false)} />}
  </section>;
}

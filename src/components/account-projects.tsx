"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { studioHref, type AccountProjectRoute } from "@/lib/studio-navigation";
import { ArrowRight, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { CloudArtifact, CloudWorkspace, CloudWorkspaceSnapshot } from "@/lib/cloud/contracts";
import { api, CloudError, setCloudAccount } from "./cloud-api";
import { kindLabel } from "./studio-model";
import PendingCloudWrites from "./pending-cloud-writes";
import LibraryCardPreview from "./library-card-preview";
import { clearCardPreviews, retainCardPreviews, setCardPreviewScope } from "./card-preview-store";
import { readCardMeta } from "./card-preview-api";
import { DEFAULT_LIBRARY_SCOPE, LIBRARY_SORTS, PUBLICATION_LABEL, cardFacts, cardMetaChunks, libraryListPath, libraryScopeKey, readLibraryView, writeLibraryView, type CardMetaItem, type LibraryScope, type LibrarySort, type LibraryView } from "@/lib/projects/library-card-meta";
import { accountLibraryStatus, type AccountLibraryStatus } from "@/lib/projects/library-state";
import { savedSourceMeta, shortDate } from "@/lib/projects/project-labels";
import { currentMatches, failedSearch, firstPage, idleTitleSearch, loadedTitleMatches, nextPage, normalizeTitleQuery, titleSearchKey, titleSearchNotice, titleSearchPath, type TitleSearch, type TitleSearchPage } from "@/lib/projects/title-search";

const AccountEditor = dynamic(() => import("./cloud-studio").then(module => module.CloudEditor), { loading: () => <p role="status">Opening project…</p> });
type Snapshot = CloudWorkspaceSnapshot & { pagination: { artifacts: { nextOffset: number | null; total: number } } };
const deviceStorage = () => { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } };
type CardMetaState = { scope: string | null; items: Map<string, CardMetaItem>; failed: boolean };
const noCardMeta: CardMetaState = { scope: null, items: new Map(), failed: false };

/** Account records are read independently: device drafts are never uploaded implicitly. */
export default function AccountProjects({ search, filter, target, navigate, onStatus, onClearSearch, scope: scopeProp, onScopeChange }: { search: string; filter: string; target: AccountProjectRoute | null;
  /** Clears the studio's search field and returns focus to it. */ onClearSearch?: () => void;
  /** Whole-workspace sort and client filter (the studio mirrors them in the URL); kept here when not supplied. */ scope?: LibraryScope; onScopeChange?: (scope: LibraryScope) => void; /** What this list knows (checking, loading, loaded, failed or unavailable) and for which account, so the studio never shows an empty state that contradicts it. */ onStatus?: (status: AccountLibraryStatus, accountId: string | null) => void; navigate: (route: AccountProjectRoute | null) => void }) {
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
  // Title search over every saved project in the workspace (server-side), bound to account + workspace + type + query.
  const [titleSearch, setTitleSearch] = useState<TitleSearch<CloudArtifact>>(idleTitleSearch);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const shownSearch = useRef<string | null>(null);
  // Whole-workspace listing scope: the server sorts and filters by client, so it covers every saved project, not only loaded ones.
  const [ownScope, setOwnScope] = useState<LibraryScope>(DEFAULT_LIBRARY_SCOPE);
  const scope = scopeProp ?? ownScope;
  const setScope = onScopeChange ?? setOwnScope;
  const scopeRef = useRef(scope), setScopeRef = useRef(setScope);
  useEffect(() => { scopeRef.current = scope; setScopeRef.current = setScope; });
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  // Grid or list, remembered per device and per account (cleared on sign-out).
  const [viewChoice, setViewChoice] = useState<{ account: string; view: LibraryView } | null>(null);
  const view: LibraryView = accountId && viewChoice?.account === accountId ? viewChoice.view : readLibraryView(deviceStorage(), accountId);
  const chooseView = (next: LibraryView) => { if (!accountId) return; writeLibraryView(deviceStorage(), accountId, next); setViewChoice({ account: accountId, view: next }); };
  // Publication state and client labels for shown cards, bound to account + workspace.
  const [cardMeta, setCardMeta] = useState<CardMetaState>(noCardMeta);
  const [metaAttempt, setMetaAttempt] = useState(0);
  const metaRequested = useRef<{ scope: string | null; ids: Set<string> }>({ scope: null, ids: new Set() });
  const shownMetaScope = useRef<string | null>(null);
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
            const previous = currentAccount.current;
            currentAccount.current = next; requestVersion.current++;
            // Another account (or none): no preview from the previous one stays visible or cached.
            clearCardPreviews();
            // A client filter belongs to one workspace of one account: dropped when an account signs out or another signs in
            // (the first sign-in of this page keeps a filter restored from the URL).
            if (previous !== null && scopeRef.current.client !== "all") setScopeRef.current({ ...scopeRef.current, client: "all" });
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
          const listed = scopeRef.current;
          const [data, detail] = await Promise.all([
            api<Snapshot>(libraryListPath(requested.id, { sort: listed.sort, client: listed.client })),
            target?.artifactId ? api<{ artifact: CloudArtifact }>(`/api/cloud/workspaces/${requested.id}/artifacts/${target.artifactId}`) : Promise.resolve(null),
          ]);
          if (active && version === requestVersion.current) {
            setSnapshot(data); setLoadedScope(libraryScopeKey(listed));
            setSelected(detail?.artifact ?? null);
          }
        }
      } catch (error) {
        if (active && version === requestVersion.current) setMessage(error instanceof Error ? error.message : "Could not load your saved projects.");
      } finally { if (active && version === requestVersion.current) setBusy(false); }
    })();
    return () => { active = false; };
  }, [accountId, target, loadAttempt]);
  async function load(workspaceId: string, append = false, listed: LibraryScope = scope) {
    const version = ++requestVersion.current;
    // Refresh re-authorizes every preview and card detail; Load more keeps the ones already shown.
    if (!append) { clearCardPreviews(); metaRequested.current = { scope: null, ids: new Set() }; setCardMeta(noCardMeta); }
    setBusy(true); setMessage("");
    const offset = append ? snapshot?.pagination.artifacts.nextOffset : 0;
    try {
      const next = await api<Snapshot>(libraryListPath(workspaceId, { offset: offset ?? 0, sort: listed.sort, client: listed.client }));
      if (version !== requestVersion.current) return;
      setLoadedScope(libraryScopeKey(listed));
      setSnapshot(current => append && current?.workspace.id === workspaceId ? { ...next, artifacts: [...new Map([...current.artifacts, ...next.artifacts].map(artifact => [artifact.id, artifact])).values()] } : next);
    } catch (error) { if (version === requestVersion.current) {
      setLoadedScope(libraryScopeKey(listed));
      // Access lost (revoked, workspace deleted): nothing from the old list or its previews stays on screen.
      if (error instanceof CloudError && (error.status === 403 || error.status === 404)) { setSnapshot(null); setSelected(null); clearCardPreviews(); metaRequested.current = { scope: null, ids: new Set() }; setCardMeta(noCardMeta); }
      setMessage(error instanceof Error ? error.message : "Could not load your saved projects."); } }
    finally { if (version === requestVersion.current) setBusy(false); }
  }
  // A new sort or client (chosen here, or restored from the URL on Back/Forward) reloads the first page in that scope.
  const wantedScope = libraryScopeKey(scope), shownWorkspace = snapshot?.workspace.id ?? null;
  useEffect(() => {
    if (shownWorkspace && loadedScope !== null && loadedScope !== wantedScope) void load(shownWorkspace, false, scopeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is re-created each render; the scope key decides.
  }, [wantedScope, loadedScope, shownWorkspace]);
  // Previews are cached for one account + workspace only, and only for projects still listed.
  useEffect(() => {
    setCardPreviewScope(accountId, snapshot?.workspace.id ?? null);
    if (snapshot) retainCardPreviews(snapshot.artifacts.map(artifact => artifact.id));
  }, [accountId, snapshot]);
  useEffect(() => () => clearCardPreviews(), []);
  const query = normalizeTitleQuery(search);
  const searchWorkspace = snapshot?.workspace.id ?? null;
  const searchKey = accountId && searchWorkspace && query ? titleSearchKey(accountId, searchWorkspace, filter, query) : null;
  useEffect(() => {
    shownSearch.current = searchKey;
    if (!searchKey || !searchWorkspace) return;
    const key = searchKey;
    // A short pause while typing. A response is accepted only while its own key is still shown, so an older
    // query, another workspace or a previous account can never fill the list.
    const timer = setTimeout(() => {
      api<TitleSearchPage<CloudArtifact>>(titleSearchPath(searchWorkspace, query, filter))
        .then(page => setTitleSearch(current => firstPage(current, shownSearch.current, key, page)))
        .catch(() => setTitleSearch(current => failedSearch(current, shownSearch.current, key, false)));
    }, 250);
    return () => clearTimeout(timer);
  }, [searchKey, searchWorkspace, query, filter, searchAttempt]);
  const retrySearch = () => { if (searchKey) { setTitleSearch({ status: "loading", key: searchKey }); setSearchAttempt(attempt => attempt + 1); } };
  async function moreMatches() {
    if (titleSearch.status !== "ready" || titleSearch.key !== searchKey || !titleSearch.nextCursor || titleSearch.more === "loading" || !searchWorkspace) return;
    const key = titleSearch.key, cursor = titleSearch.nextCursor;
    setTitleSearch(current => current.status === "ready" && current.key === key ? { ...current, more: "loading" } : current);
    try { const page = await api<TitleSearchPage<CloudArtifact>>(titleSearchPath(searchWorkspace, query, filter, cursor)); setTitleSearch(current => nextPage(current, shownSearch.current, key, page)); }
    catch { setTitleSearch(current => failedSearch(current, shownSearch.current, key, true)); }
  }
  const searchNotice = titleSearchNotice(titleSearch, searchKey);
  // While the full search runs, or if it fails, loaded projects that match this exact query are shown (and said to be loaded only).
  const visible = !snapshot ? [] : !query ? snapshot.artifacts.filter(artifact => filter === "all" || artifact.kind === filter)
    : searchNotice === "searching" || searchNotice === "error" ? loadedTitleMatches(snapshot.artifacts, query, filter) : currentMatches(titleSearch, searchKey);
  const searchReady = titleSearch.status === "ready" && titleSearch.key === searchKey ? titleSearch : null;
  const metaScope = accountId && snapshot ? `${accountId}\n${snapshot.workspace.id}` : null;
  const visibleIds = visible.map(artifact => artifact.id).join(",");
  const metaWorkspace = snapshot?.workspace.id ?? null;
  useEffect(() => {
    shownMetaScope.current = metaScope;
    if (!metaScope || !accountId || !metaWorkspace) return;
    if (metaRequested.current.scope !== metaScope) metaRequested.current = { scope: metaScope, ids: new Set() };
    const ids = visibleIds.split(",").filter(id => id && !metaRequested.current.ids.has(id));
    if (!ids.length) return;
    ids.forEach(id => metaRequested.current.ids.add(id));
    const requested = metaScope;
    void (async () => {
      for (const chunk of cardMetaChunks(ids)) {
        try {
          const items = await readCardMeta(accountId, metaWorkspace, chunk);
          // Accepted only while the same account + workspace is shown.
          setCardMeta(current => shownMetaScope.current !== requested ? current : { scope: requested, items: new Map([...(current.scope === requested ? current.items : []), ...items.map(item => [item.artifactId, item] as const)]), failed: current.scope === requested && current.failed });
        } catch {
          chunk.forEach(id => metaRequested.current.ids.delete(id));
          setCardMeta(current => shownMetaScope.current !== requested ? current : { scope: requested, items: current.scope === requested ? current.items : new Map(), failed: true });
        }
      }
    })();
  }, [metaScope, visibleIds, accountId, metaWorkspace, metaAttempt]);
  const shownMeta = cardMeta.scope === metaScope ? cardMeta : noCardMeta;
  const retryMeta = () => { metaRequested.current = { scope: null, ids: new Set() }; setCardMeta(noCardMeta); setMetaAttempt(attempt => attempt + 1); };
  const knownClient = scope.client === "all" || scope.client === "none" || !!snapshot?.clients.some(item => item.id === scope.client);
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
  // A brand-new account has nothing saved yet: let the studio's single welcome state speak instead of two empty panels.
  if (snapshot && !busy && !message && !selected && !target?.artifactId && snapshot.artifacts.length === 0 && workspaces.length <= 1 && scope.client === "all")
    return <PendingCloudWrites accountId={accountId} refresh={async () => { await load(snapshot.workspace.id); }} />;
  return <section className={`account-projects${selected || target?.artifactId ? " account-project-open" : ""}`} aria-label={selected ? "Project workspace" : "Projects saved to your account"}>
    {!selected && !target?.artifactId && <div className="account-projects-heading"><div><span className="eyebrow">SAVED TO YOUR ACCOUNT</span><h2>Your saved projects</h2></div>
      {snapshot && <button type="button" className="button secondary small" disabled={busy} onClick={() => void load(snapshot.workspace.id)}><RefreshCw size={14} /> Refresh</button>}</div>}
    {!selected && !target?.artifactId && snapshot && <div className="account-projects-controls">
      {(snapshot.clients.length > 0 || scope.client !== "all") && <label>Client<select disabled={busy || Boolean(query)} value={scope.client} onChange={event => setScope({ ...scope, client: event.target.value })}>
        <option value="all">All clients</option><option value="none">No client</option>{!knownClient && <option value={scope.client}>Client not in this workspace</option>}
        {snapshot.clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label>Sort<select disabled={busy || Boolean(query)} value={scope.sort} onChange={event => setScope({ ...scope, sort: event.target.value as LibrarySort })}>
        {(Object.keys(LIBRARY_SORTS) as LibrarySort[]).map(key => <option key={key} value={key}>{LIBRARY_SORTS[key]}</option>)}</select></label>
      <div className="account-projects-view" role="group" aria-label="Layout">
        <button type="button" aria-pressed={view === "grid"} onClick={() => chooseView("grid")}>Grid</button><button type="button" aria-pressed={view === "list"} onClick={() => chooseView("list")}>List</button></div>
      {query && <p className="small-note">Search covers every client and lists matches newest first.</p>}
    </div>}
    {shownMeta.failed && snapshot && !selected && <div className="account-projects-error"><p role="alert">Publication status and client names couldn’t load, so cards don’t show them.</p>
      <button type="button" className="button secondary small" onClick={retryMeta}><RefreshCw size={14} /> Retry</button></div>}
    {!selected && workspaces.length > 1 && <label>Workspace<select disabled={busy} value={snapshot?.workspace.id ?? ""} onChange={event => { if (scope.client !== "all") setScope({ ...scope, client: "all" }); navigate({ workspaceId: event.target.value, artifactId: null }); }}>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>}
    {message && (failed ? <div className="account-projects-error"><p role="alert">{message} Your saved projects haven’t loaded, so this list may be incomplete.</p>
      <button type="button" className="button secondary small" disabled={busy} onClick={() => setLoadAttempt(attempt => attempt + 1)}><RefreshCw size={14} /> Retry</button></div> : <p role="status">{message}</p>)}
    {!busy && target?.artifactId && !selected && <button className="button secondary small" onClick={() => navigate(null)}>Back to projects</button>}
    <PendingCloudWrites accountId={accountId} refresh={async () => { if (snapshot) await load(snapshot.workspace.id); else window.location.reload(); }} />
    {busy && <p role="status">Loading your account projects…</p>}
    {selected && snapshot ? <AccountEditor key={`${accountId}:${snapshot.workspace.id}:${selected.id}`} accountId={accountId} workspaceId={snapshot.workspace.id} artifact={selected} project={snapshot.projects.find(project => project.id === selected.projectId)} role={snapshot.workspace.role}
      notify={setMessage} back={() => navigate({ workspaceId: snapshot.workspace.id, artifactId: null })} /> : <>
      {query && snapshot && <div className="account-projects-search">
        {searchNotice === "searching" && <p role="status">Searching the titles of all saved projects in {snapshot.workspace.name}…</p>}
        {searchNotice === "error" && <div className="account-projects-error"><p role="alert">We couldn’t search all saved projects. Showing title matches among the {snapshot.artifacts.length} loaded {snapshot.artifacts.length === 1 ? "project" : "projects"} only.</p>
          <button type="button" className="button secondary small" onClick={retrySearch}><RefreshCw size={14} /> Retry</button></div>}
        {searchReady && <p role="status">{searchReady.total === 0 ? `No saved project titles in ${snapshot.workspace.name} contain “${query}”.` : `${searchReady.total} saved ${searchReady.total === 1 ? "project" : "projects"} in ${snapshot.workspace.name} with “${query}” in the title.`}</p>}
        {searchReady?.total === 0 && onClearSearch && <button type="button" className="button secondary small" onClick={onClearSearch}>Clear search</button>}
      </div>}
      <div className={`account-project-grid${view === "list" ? " list" : ""}`}>{visible.map(artifact => { const meta = savedSourceMeta(artifact, shortDate), described = `card-preview-${artifact.id}`, facts = cardFacts(shownMeta.items, artifact); return <div className="account-project-card" key={artifact.id}>
        <LibraryCardPreview accountId={accountId} workspaceId={snapshot!.workspace.id} artifact={artifact} canCapture={snapshot!.workspace.role !== "reviewer"} descriptionId={described} />
        <button type="button" className="account-project-open" aria-describedby={described} disabled={busy} onClick={() => navigate({ workspaceId: snapshot!.workspace.id, artifactId: artifact.id })}>
          <span><strong>{artifact.title}</strong><small>{kindLabel[artifact.kind]} · <time dateTime={meta.at}>{meta.label}</time></small>
            {facts && <small className="account-project-facts"><span className={`account-project-state ${facts.publication.state}`}>{PUBLICATION_LABEL[facts.publication.state]}</span>{facts.client && <span className="account-project-client"><span className="account-project-sep">, </span>Client: {facts.client.name}</span>}</small>}</span><ArrowRight size={16} /></button></div>; })}</div>
      {!busy && !query && !visible.length && (snapshot || noWorkspace) && <p>{snapshot ? "No saved projects match this view." : "No account workspace was found. Your device projects remain below."}</p>}
      {searchReady?.more === "error" && <p role="alert">More matches couldn’t load. Try again.</p>}
      {searchReady?.nextCursor && <button className="button secondary small" type="button" disabled={searchReady.more === "loading"} onClick={() => void moreMatches()}>{searchReady.more === "loading" ? "Loading more matches…" : "Show more matches"}</button>}
      {!query && snapshot?.pagination.artifacts.nextOffset != null && <button className="button secondary small" type="button" disabled={busy} onClick={() => void load(snapshot.workspace.id, true)}>Load more saved projects</button>}
      {snapshot && <p className="small-note">Search looks through the titles of every saved project in this workspace, including ones not loaded yet. Briefs, notes and project content aren’t searched.</p>}
    </>}
  </section>;
}

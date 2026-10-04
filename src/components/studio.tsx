"use client";
import "@/app/studio-refresh.css";
import { z } from "zod";
import Link from "next/link";
import Image from "next/image";
import { creationStyles, retainCreationStyle, styleConcept } from "@/lib/creation-styles";
import BrandMark from "./brand-mark";
import StudioAccount from "./studio-account";
import ComposerControls from "./composer-controls";
import CreationSource from "./creation-source";
import AccountProjects from "./account-projects";
import AccountClients from "./account-clients";
import { useCreationAccount, type CreationAccount } from "./use-creation-account";
import { api, CloudError, getPendingCloudWrites, setCloudAccount } from "./cloud-api";
import { createClient } from "@/lib/supabase/client";
import { buildCreationPayload } from "@/lib/cloud/creation-payload";
import { readWizardDraft, writeWizardDraft, clearWizardDrafts, wizardDraftScope } from "@/lib/wizard-draft-storage";
import type { CloudArtifact, CloudWorkspace } from "@/lib/cloud/contracts";
import {
  LocalWorkspaceSchema,
  LocalStyleSchema,
  baseStyles,
  emptyWorkspace,
  uid,
  now,
  icons,
  kindLabel,
  storageKey,
  saveLocalWorkspace,
  type Kind,
  type Block,
  type Client,
  type Style,
  type Project,
  type ProjectTask,
  type Workspace,
} from "./studio-model";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import WebsiteSections from "./website-sections";
import TemplateGallery from "./template-gallery";
import ClientWorkspace from "./client-workspace";
import ClientOpportunity from "./client-opportunity";
import EffortControl from "./effort-control";
import { EffortLevelSchema, DEFAULT_EFFORT, type EffortLevel } from "@/lib/routing/effort";
import { creationPlan } from "@/lib/creation-plan";
import "@/app/creation-plan.css";
import ProjectTasks from "./project-tasks";
import WebsiteRecordPanel from "./website-record";
import { WebsiteRecordSchema, reviseWebsiteRecord, type WebsiteRecord } from "@/lib/website-record";
import { readStudioRoute, studioHref, studioTab, type StudioRoute, type AccountProjectRoute, type AccountClientRoute } from "@/lib/studio-navigation";
import { restoreContentVersion } from "@/lib/restore-content-version";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen as BookOpenIcon,
  Check,
  CreditCard,
  Download,
  FileText,
  FolderOpen,
  Globe,
  ImagePlus,
  Menu,
  MoreHorizontal,
  MessageCircle,
  Palette,
  Plus,
  Presentation,
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
  Users,
  X,
} from "lucide-react";

function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function date(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function Studio() {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [accountClientRoute, setAccountClientRoute] = useState<AccountClientRoute | null>(null);
  const [accountRoute, setAccountRoute] = useState<AccountProjectRoute | null>(null);
  const [persistenceAllowed, setPersistenceAllowed] = useState(false);
  const [initialStyle, setInitialStyle] = useState("editorial");
  const [initialBrief, setInitialBrief] = useState("");
  const [initialTitle, setInitialTitle] = useState("");
  const [initialWorkspaceId, setInitialWorkspaceId] = useState<string | null>(null);
  const [initialClient, setInitialClient] = useState("");
  const [draftBrief, setDraftBrief] = useState("");
  const [draftKind, setDraftKind] = useState<Kind>("website");
  const [directStart, setDirectStart] = useState(false);
  const [creationMode, setCreationMode] = useState<"create" | "plan">("create");
  const [creationEffort, setCreationEffort] = useState<EffortLevel>(DEFAULT_EFFORT);
  const [creationRequestId, setCreationRequestId] = useState("");
  const [homeHandoff, setHomeHandoff] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("projects");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<Kind | null>(null);
  const [clientModal, setClientModal] = useState<Client | null | "new">(null);
  const [styleModal, setStyleModal] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const [saveInvalid, setSaveInvalid] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [clientDetail, setClientDetail] = useState<string | null>(null);
  const [opportunityClient, setOpportunityClient] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!mobileNav) return;
    const closeNavigation = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNav(false);
    };
    window.addEventListener("keydown", closeNavigation);
    return () => window.removeEventListener("keydown", closeNavigation);
  }, [mobileNav]);
  useEffect(() => {
    queueMicrotask(() => {
      let restored = emptyWorkspace();
      let readable = true;
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = LocalWorkspaceSchema.safeParse(JSON.parse(saved));
          if (parsed.success) {
            restored = parsed.data;
            setWorkspace(parsed.data);
            setPersistenceAllowed(true);
          } else {
            readable = false;
            setTab("settings");
            setNotice(
              "Your saved workspace could not be loaded. Its original browser data is preserved; download the original data from Settings.",
            );
          }
        } else setPersistenceAllowed(true);
      } catch {
        readable = false;
        setTab("settings");
        setNotice(
          "Your saved workspace could not be read. Its original data has not been overwritten.",
        );
      }
      setLoaded(true);
      const parameters = new URLSearchParams(window.location.search);
      if (readable) {
        const route = readStudioRoute(window.location.search, restored);
        setTab(route.tab); setSelected(route.projectId); setClientDetail(route.clientId); setAccountRoute("account" in route ? route.account ?? null : null); setAccountClientRoute("accountClient" in route ? route.accountClient ?? null : null);
        if (route.notice) setNotice(route.notice);
      }
      const kind = parameters.get("create");
      if (parameters.get("from") === "home") {
        try {
          const raw = sessionStorage.getItem("makeborne.creation-draft.v1");
          if (raw) {
            const draft = z
              .object({
                kind: z.enum(["website", "book", "presentation"]),
                brief: z.string().trim().min(1).max(20000),
                styleId: z.string().min(1).max(100).optional(),
                style: LocalStyleSchema.optional(),
                mode: z.enum(["create", "plan"]).default("create"),
                effort: EffortLevelSchema.default(DEFAULT_EFFORT),
                requestId: z.string().uuid().optional(),
              })
              .strict()
              .safeParse(JSON.parse(raw));
            if (draft.success && draft.data.kind === kind) {
              setInitialBrief(draft.data.brief);
              setCreationMode(draft.data.mode); setCreationEffort(draft.data.effort);
              setCreationRequestId(draft.data.requestId ?? crypto.randomUUID());
              setDirectStart(true);
              setInitialTitle(`Untitled ${draft.data.kind}`);
              setDraftBrief(draft.data.brief);
              setDraftKind(draft.data.kind);
              if (draft.data.style) {
                const style = draft.data.style;
                setWorkspace((current) => ({
                  ...current,
                  styles: current.styles.some(
                    (existing) => existing.id === style.id,
                  )
                    ? current.styles.map((existing) =>
                        existing.id === style.id ? style : existing,
                      )
                    : [...current.styles, style],
                }));
                setInitialStyle(style.id);
              } else if (
                draft.data.styleId &&
                baseStyles.some((style) => style.id === draft.data.styleId)
              )
                setInitialStyle(draft.data.styleId);
              setHomeHandoff(true);
            } else
              setNotice(
                "The saved creation brief could not be safely loaded. Its original session data has been preserved.",
              );
          }
        } catch {
          setNotice(
            "The saved creation brief could not be read. You can enter it again in the studio.",
          );
        }
      }
      if (kind === "book" || kind === "website" || kind === "presentation")
        setCreating(kind);
    });
  }, []);
  const restoreHistory = useEffectEvent(() => {
    if (!loaded) return;
    const route = persistenceAllowed
      ? readStudioRoute(window.location.search, workspace)
      : { tab: "settings", projectId: null, clientId: null } as const;
    setTab(route.tab); setSelected(route.projectId); setClientDetail(route.clientId); setAccountRoute("account" in route ? route.account ?? null : null); setAccountClientRoute("accountClient" in route ? route.accountClient ?? null : null);
    // Keep unsaved client/style forms mounted when the underlying route changes.
    setCreating(null); setInitialWorkspaceId(null); setInitialClient(""); setMobileNav(false);
    if ("notice" in route && route.notice) setNotice(route.notice);
  });
  useEffect(() => {
    const restore = () => restoreHistory();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    if (loaded && persistenceAllowed)
      try {
        saveLocalWorkspace(workspace, localStorage);
        queueMicrotask(() => { setSaveFailed(false); setSaveInvalid(false); });
      } catch (error) {
        queueMicrotask(() => { setSaveFailed(true); setSaveInvalid(error instanceof z.ZodError); });
      }
  }, [workspace, loaded, persistenceAllowed]);
  useEffect(() => {
    if (!saveFailed) return;
    const protectUnsavedWork = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedWork);
    return () => window.removeEventListener("beforeunload", protectUnsavedWork);
  }, [saveFailed]);
  function retrySave() {
    try {
      saveLocalWorkspace(workspace, localStorage);
      setSaveFailed(false);
      setSaveInvalid(false);
      toast("Your workspace is saved in this browser.");
    } catch (error) {
      setSaveFailed(true);
      setSaveInvalid(error instanceof z.ZodError);
    }
  }
  const project = workspace.projects.find((p) => p.id === selected);
  function mutateProject(
    p: Project | ((current: Project) => Project),
    targetId?: string,
  ) {
    setWorkspace((w) => ({
      ...w,
      projects: w.projects.map((current) =>
        current.id === (typeof p === "function" ? targetId : p.id)
          ? typeof p === "function"
            ? p(current)
            : p
          : current,
      ),
    }));
  }
  function toast(text: string) {
    setNotice(text);
  }
  function restoreVersion(projectId: string, versionId: string): boolean {
    if (!persistenceAllowed) {
      toast("Recover your workspace in Settings before restoring a version.");
      return false;
    }
    const current = workspace.projects.find(item => item.id === projectId);
    if (!current) return false;
    let restored: Project;
    try {
      restored = restoreContentVersion(current, versionId, uid(), now());
    } catch (error) {
      toast(error instanceof Error ? error.message : "This version could not be restored.");
      return false;
    }
    const next = { ...workspace, projects: workspace.projects.map(item => item.id === projectId ? restored : item) };
    if (!LocalWorkspaceSchema.safeParse(next).success) {
      toast("This workspace could not be validated. Download a backup before restoring content.");
      return false;
    }
    try {
      saveLocalWorkspace(next, localStorage);
    } catch {
      toast("There is not enough available browser storage to save the safety copy. Your current content is unchanged. Download a workspace backup before continuing.");
      return false;
    }
    setWorkspace(next);
    setSaveFailed(false);
    toast("Version restored. Your previous content is preserved in a safety copy in History & review.");
    return true;
  }
  function saveWebsiteRecord(projectId: string, record: WebsiteRecord): boolean {
    if (!persistenceAllowed) { toast("Recover your workspace in Settings before saving website details."); return false; }
    const current = workspace.projects.find(item => item.id === projectId);
    if (!current || current.kind !== "website") return false;
    const parsed = WebsiteRecordSchema.safeParse(record);
    if (!parsed.success) { toast("Check the website links and details before saving."); return false; }
    const at = now();
    let revision: ReturnType<typeof reviseWebsiteRecord>;
    try { revision = reviseWebsiteRecord(current.websiteRecord, current.websiteHistory ?? [], parsed.data, uid(), at); }
    catch (error) { toast(error instanceof Error ? error.message : "Website history could not be saved."); return false; }
    if (!revision.changed) return true;
    const next = { ...workspace, projects: workspace.projects.map(item => item.id === projectId ? {
      ...item, websiteRecord: revision.record, websiteHistory: revision.history, updatedAt: at,
      activity: [...item.activity, { at, text: "Updated website preview, live link, or hosting details (user-recorded; deployment not verified)." }],
    } : item) };
    try { saveLocalWorkspace(next, localStorage); }
    catch { toast("Website details could not be saved. Keep the form open and download a workspace backup before retrying."); return false; }
    setWorkspace(next); setSaveFailed(false);
    return true;
  }
  function saveTasks(projectId: string, tasks: ProjectTask[], message: string): boolean {
    if (!persistenceAllowed) { toast("Recover your workspace in Settings before saving tasks."); return false; }
    const current = workspace.projects.find(item => item.id === projectId);
    if (!current) return false;
    const at = now();
    const next = { ...workspace, projects: workspace.projects.map(item => item.id === projectId ? { ...item, tasks, updatedAt: at, activity: [...item.activity, { at, text: message }] } : item) };
    if (!LocalWorkspaceSchema.safeParse(next).success) { toast("This task could not be saved. Check the date and project history limits, then try again."); return false; }
    try { saveLocalWorkspace(next, localStorage); }
    catch { toast("Browser storage could not save the task. Download a workspace backup and try again when storage is available."); return false; }
    setWorkspace(next); setSaveFailed(false);
    return true;
  }
  function openRoute(route: StudioRoute, replace = false) {
    setOpportunityClient(null);
    const href = studioHref(route);
    if (window.location.pathname + window.location.search !== href)
      window.history[replace ? "replaceState" : "pushState"](null, "", href);
    setTab(route.tab);
    setSelected(route.projectId);
    setAccountRoute(route.account ?? null);
    setAccountClientRoute(route.accountClient ?? null);
    setClientDetail(route.clientId);
    setMobileNav(false);
  }
  function navigate(name: string) {
    openRoute({ tab: studioTab(name), projectId: null, clientId: null });
  }
  function createProject(values: {
    effort: EffortLevel;
    title: string;
    brief: string;
    audience: string;
    purpose: string;
    styleId: string;
    clientId: string;
    wording: string;
    content: string;
    kind: Kind;
  }) {
    const t = now();
    const lines = values.content.split(/\n\s*\n/).filter(Boolean);
    const blocks: Block[] = lines.map((text, i) => ({
      id: uid(),
      type: i === 0 ? "heading" : "paragraph",
      text,
    }));
    if (!blocks.length)
      blocks.push({ id: uid(), type: "heading", text: values.title });
    const p: Project = {
      ...values,
      id: uid(),
      clientId: values.clientId || null,
      status: "draft",
      blocks,
      versions: [],
      activity: [{ at: t, text: "Project created in your local workspace" }],
      createdAt: t,
      updatedAt: t,
    };
    if (!persistenceAllowed) {
      toast(
        "Recover your saved workspace before creating a project. Your creation draft remains available.",
      );
      return false;
    }
    const nextWorkspace = {
      ...workspace,
      projects: [p, ...workspace.projects],
      styles: workspace.styles,
    };
    try {
      nextWorkspace.styles = retainCreationStyle(workspace.styles, values.styleId);
      saveLocalWorkspace(nextWorkspace, localStorage);
    } catch {
      toast(
        "This browser could not save the project. Your creation draft remains available; download a backup from Settings.",
      );
      return false;
    }
    setWorkspace(nextWorkspace);
    setDirectStart(false);
    openRoute({ tab: "projects", projectId: p.id, clientId: null }, directStart || homeHandoff);
    setCreating(null);
    if (homeHandoff && persistenceAllowed) {
      try {
        sessionStorage.removeItem("makeborne.creation-draft.v1");
        setHomeHandoff(false);
      } catch {
        /* A retained session draft is safe to keep. */
      }
    }
    setInitialBrief("");
    setInitialTitle("");
    setInitialClient("");
    setDraftBrief("");
    toast(
      "Project created. Your supplied content is ready to edit. No AI generation was performed.",
    );
    return true;
  }
  async function importBackup(file: File) {
    try {
      if (file.size > 10_000_000) throw new Error("Backup too large");
      const data = LocalWorkspaceSchema.parse(JSON.parse(await file.text()));
      if (
        !window.confirm(
          "Replace this device’s workspace with the imported backup? Download your current backup first if you need it.",
        )
      )
        return;
      try {
        saveLocalWorkspace(data, localStorage);
      } catch {
        toast("This browser could not save the imported backup. Your current workspace has been kept. Keep the backup file and try again when browser storage is available.");
        return;
      }
      setWorkspace(data);
      setSaveFailed(false);
      setPersistenceAllowed(true);
      openRoute({ tab: "projects", projectId: null, clientId: null }, true);
      toast("Workspace backup restored on this device.");
    } catch {
      toast("This is not a valid Makeborne workspace backup.");
    }
  }
  function chooseDirection(
    kind: Kind,
    brief: string,
    styleId: string,
    selectedStyle?: Style,
  ) {
    if (selectedStyle) {
      const parsed = LocalStyleSchema.safeParse(selectedStyle);
      if (!parsed.success) {
        toast("This direction could not be safely loaded.");
        return;
      }
      const style = parsed.data;
      setWorkspace((current) => ({
        ...current,
        styles: current.styles.some((existing) => existing.id === style.id)
          ? current.styles.map((existing) =>
              existing.id === style.id ? style : existing,
            )
          : [...current.styles, style],
      }));
    }
    setDraftKind(kind);
    setDraftBrief(brief);
    setInitialBrief(brief);
    setInitialTitle(`Untitled ${kind}`);
    setInitialStyle(styleId);
    setCreating(kind);
  }

  const creationView = creating && (
        <CreateModal
          directStart={directStart}
          initialMode={creationMode}
          initialEffort={creationEffort}
          requestId={creationRequestId}
          initialClient={initialClient}
          initialWorkspaceId={initialWorkspaceId}
          initialStyle={initialStyle}
          initialBrief={initialBrief}
          initialTitle={initialTitle}
          kind={creating}
          onKind={setCreating}
          clients={workspace.clients}
          styles={creationStyles(workspace.styles, creating)}
          close={() => { if (directStart) openRoute({ tab: "projects", projectId: null, clientId: null }, true); setCreating(null); setDirectStart(false); setInitialWorkspaceId(null); setInitialClient(""); }}
          create={createProject}
          accountCreated={(workspaceId, artifact) => {
            setCreating(null); setDirectStart(false); setInitialWorkspaceId(null); setInitialClient(""); setInitialBrief("");
            try { sessionStorage.removeItem("makeborne.creation-draft.v1"); } catch { /* Saved project takes precedence. */ } setInitialTitle(""); setDraftBrief("");
            openRoute({ tab: "projects", projectId: null, clientId: null, account: { workspaceId, artifactId: artifact.id } }, directStart || homeHandoff);
            toast("Project saved to your account. Your supplied content is ready to edit; AI generation has not run.");
          }}
        />
      );
  if (directStart && creating) return <div className="studio-shell creation-route">{creationView}</div>;
  return (
    <div className="studio-shell">
      {mobileNav && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside
        id="studio-navigation"
        className={`sidebar ${mobileNav ? "open" : ""}`}
      >
        <Link className="wordmark" href="/">
          <BrandMark size={27} />
          Makeborne
        </Link>
        <button className="sidebar-close icon-button" aria-label="Close sidebar" onClick={() => setMobileNav(false)}><X size={18} /></button>
        <Link className="button create-button" href="/">
          <Plus size={18} /> New project
        </Link>
        <div className="nav-label">My workspace</div>
        <nav className="studio-nav" aria-label="Workspace">
          {[
            [FolderOpen, "projects", "Projects"],
            [Users, "clients", "Clients"],
            [Palette, "styles", "Styles"],
          ].map(([Icon, id, label]) => {
            const I = Icon as typeof FolderOpen;
            return (
              <button
                key={String(id)}
                className={tab === id ? "active" : ""}
                aria-current={tab === id ? "page" : undefined}
                onClick={() => navigate(String(id))}
              >
                <I size={18} />
                {String(label)}
              </button>
            );
          })}
          <Link href="/chat" className="studio-chat-link"><MessageCircle size={18} />Expert chat</Link>
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`sidebar-settings ${tab === "settings" ? "active" : ""}`}
            aria-current={tab === "settings" ? "page" : undefined}
            onClick={() => navigate("settings")}
          >
            <Settings size={18} /> Settings
          </button>
          <Link className="sidebar-home" href="/billing"><CreditCard size={16} /> Plan & credits <ArrowUpRight size={14} /></Link>
          {process.env.NODE_ENV === "development" && <Link className="sidebar-home" href="/admin"><Settings size={16} /> Admin <ArrowUpRight size={14} /></Link>}
          <div className="sidebar-device">
            <span className="sidebar-device-label"><span className="status-dot" /> Device backup & recovery</span>
            <button type="button" onClick={() => navigate("settings")}>Backup & recovery <ArrowUpRight size={12} /></button>
          </div>
        </div>
      </aside>
      <div className="studio-main">
        <header className="studio-topbar">
          <button
            className="icon-button mobile-toggle"
            aria-expanded={mobileNav}
            aria-controls="studio-navigation"
            aria-label="Toggle navigation"
            onClick={() => setMobileNav(!mobileNav)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            {project
              ? project.title
              : tab === "projects"
                ? "Projects"
                : tab === "clients"
                  ? "Clients"
                  : tab === "styles"
                    ? "Styles"
                    : "Settings"}
          </div>
          <div className="studio-topbar-actions">
            <StudioAccount />
          </div>
        </header>
        {loaded && !persistenceAllowed && (
          <div className="notice" role="alert">
            Saving is paused to protect unreadable original data. Download
            recovery data and restore a valid backup in Settings.
          </div>
        )}
        {saveFailed && (
          <div className="save-recovery-banner" role="alert">
            <div><strong>Your latest changes are not saved.</strong><p>{saveInvalid ? "These changes exceed workspace limits or contain invalid data. The last valid save is protected. Keep this page open and download your current data for recovery." : "Keep this page open. Download a backup now, or retry when browser storage is available."}</p></div>
            <div className="save-recovery-actions">
              <button className="button secondary small" onClick={retrySave}>Retry save</button>
              <button className="button primary small" onClick={() => download(new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json" }), "makeborne-unsaved-workspace.json")}><Download size={16} /> Download backup</button>
            </div>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {!loaded ? (
          <div className="loading-state">Opening your workspace…</div>
        ) : project ? (
          <ProjectEditor
            key={project.id}
            project={project}
            styles={workspace.styles}
            clients={workspace.clients}
            sound={workspace.sound}
            update={mutateProject}
            restoreVersion={restoreVersion}
            saveTasks={saveTasks}
            saveWebsiteRecord={saveWebsiteRecord}
            back={() => navigate("projects")}
            notify={toast}
          />
        ) : (
          <div
            className={`workspace-content ${tab === "projects" && workspace.projects.length === 0 ? "fresh-workspace" : ""}`}
          >
            {tab === "projects" && (
              <>
                {!accountRoute?.artifactId && <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">YOUR CREATION STUDIO</div>
                    <h1>What will you make next?</h1>
                    <p>Your ideas, projects, and clients. All in one place.</p>
                  </div>
                  <Link className="button primary" href="/">
                    <Plus size={17} /> New project
                  </Link>
                </div>
                <section
                  className="studio-composer"
                  aria-label="Start with a brief"
                >
                  <div className="composer-format-tabs">
                    {(["website", "book", "presentation"] as Kind[]).map(
                      (k) => {
                        const Icon = icons[k];
                        return (
                          <button
                            key={k}
                            className={draftKind === k ? "active" : ""}
                            onClick={() => setDraftKind(k)}
                          >
                            <Icon size={16} />
                            {kindLabel[k]}
                          </button>
                        );
                      },
                    )}
                    <span>Your next project starts here</span>
                  </div>
                  <label className="composer-input-label">
                    <span className="sr-only">Describe your next project</span>
                    <textarea
                      id="studio-brief"
                      value={draftBrief}
                      maxLength={20000}
                      onChange={(e) => setDraftBrief(e.target.value)}
                      placeholder={
                        draftKind === "website"
                          ? "Describe the website you want to create…"
                          : draftKind === "book"
                            ? "What knowledge do you want to turn into a book?"
                            : "What would you like your presentation to say?"
                      }
                    />
                  </label>
                  <div className="composer-bottom">
                    <ComposerControls mode={creationMode} onMode={setCreationMode} effort={creationEffort} onEffort={setCreationEffort} />
                    <button
                      className="button primary"
                      disabled={!draftBrief.trim()}
                      aria-label={creationMode === "plan" ? "Plan this project" : "Create this project"}
                      onClick={() => {
                        setDirectStart(true); setCreationRequestId(crypto.randomUUID());
                        setInitialBrief(draftBrief.trim());
                        setInitialTitle(`Untitled ${draftKind}`);
                        setCreating(draftKind);
                      }}
                    >
                      <ArrowUp size={19} />
                    </button>
                  </div>
                </section>
                <div className="composer-note">
                  Your brief becomes a saved project. Live AI generation is not
                  enabled.
                </div>
                <div
                  className="brief-suggestions"
                  aria-label="Brief suggestions"
                >
                  {[
                    {
                      label: "A website for a client",
                      kind: "website" as Kind,
                      brief:
                        "Help me plan a website for a client. I will provide their business, services, brand direction, and approved content.",
                    },
                    {
                      label: "Turn knowledge into a book",
                      kind: "book" as Kind,
                      brief:
                        "Help me shape my knowledge into a practical book. I will provide the topic, intended reader, and source material.",
                    },
                    {
                      label: "Present an idea clearly",
                      kind: "presentation" as Kind,
                      brief:
                        "Help me structure a presentation that explains my idea clearly. I will provide the audience, purpose, and key points.",
                    },
                  ].map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion.kind}
                      onClick={() => {
                        setDraftKind(suggestion.kind);
                        setDraftBrief(suggestion.brief);
                        document.getElementById("studio-brief")?.focus();
                      }}
                    >
                      {suggestion.label}
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
                <div className="list-toolbar">
                  <div className="filter-tabs">
                    {["all", "website", "book", "presentation"].map((f) => (
                      <button
                        className={filter === f ? "active" : ""}
                        key={f}
                        onClick={() => setFilter(f)}
                      >
                        {f === "all"
                          ? "All projects"
                          : kindLabel[f as Kind] + "s"}
                      </button>
                    ))}
                  </div>
                  <label className="search-field">
                    <Search size={16} />
                    <input
                      aria-label="Search projects"
                      placeholder="Find a project…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                </>}
                <AccountProjects search={search} filter={filter} target={accountRoute} navigate={account => openRoute({ tab: "projects", projectId: null, clientId: null, account })} />
                {!accountRoute?.artifactId && (workspace.projects.length === 0 ? (
                  <Empty
                    icon={FolderOpen}
                    title="Your projects will live here."
                    text="Start with a brief above, or bring your existing content into a new project."
                    action="Create your first project"
                    onClick={() => setCreating("website")}
                  />
                ) : (
                  <div className="project-grid">
                    {workspace.projects
                      .filter(
                        (p) =>
                          (filter === "all" || p.kind === filter) &&
                          p.title.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((p) => {
                        const Icon = icons[p.kind];
                        return (
                          <button
                            className="project-card"
                            key={p.id}
                            onClick={() => openRoute({ tab: "projects", projectId: p.id, clientId: null })}
                          >
                            <div className={`project-cover ${p.styleId}`}>
                              <span className="cover-type">
                                <Icon size={15} />
                                {kindLabel[p.kind]}
                              </span>
                              <h3>{p.title}</h3>
                              <span className="cover-number">
                                {String(p.blocks.length).padStart(2, "0")}{" "}
                                {p.kind === "presentation"
                                  ? "SLIDE BLOCKS"
                                  : "CONTENT BLOCKS"}
                              </span>
                            </div>
                            <div className="project-info">
                              <div>
                                <strong>{p.title}</strong>
                                <span>
                                  {workspace.clients.find(
                                    (c) => c.id === p.clientId,
                                  )?.name || "Personal project"}
                                </span>
                              </div>
                              <MoreHorizontal size={18} />
                            </div>
                            <div className="project-meta">
                              <span className={`status-label ${p.status}`}>
                                {p.status.replace("_", " ")}
                              </span>
                              <span>Updated {date(p.updatedAt)}</span>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                ))}
                {!accountRoute?.artifactId && workspace.projects.length === 0 && (
                  <TemplateGallery onChoose={chooseDirection} />
                )}
              </>
            )}
            {tab === "clients" && opportunityClient && <ClientOpportunity clientName={workspace.clients.find(client => client.id === opportunityClient)?.name} onClose={() => setOpportunityClient(null)} onCreateBrief={(kind, brief, title) => {
              setInitialClient(opportunityClient); setInitialBrief(brief); setInitialTitle(title); setInitialStyle("editorial"); setHomeHandoff(false); setCreating(kind); setOpportunityClient(null);
            }} />}
            {tab === "clients" && !opportunityClient && (
              <AccountClients key={clientDetail ? "device" : "account"} initialDevice={!!clientDetail} onOpenProject={account => openRoute({ tab: "projects", projectId: null, clientId: null, account })} onCreate={(workspaceId, client) => {
                setInitialWorkspaceId(workspaceId); setInitialClient(client.id); setInitialBrief(""); setInitialTitle(""); setInitialStyle("editorial"); setHomeHandoff(false); setCreating("website");
              }} target={accountClientRoute} navigate={accountClient => openRoute({ tab: "clients", projectId: null, clientId: null, accountClient })} deviceClients={
              <ClientWorkspace
                clients={workspace.clients}
                projects={workspace.projects}
                selectedClientId={clientDetail}
                onSelectClient={(id) => openRoute({ tab: "clients", projectId: null, clientId: id })}
                onEditClient={setClientModal}
                onAddClient={() => setClientModal("new")}
                onUpdateClient={(client) => {
                  if (!persistenceAllowed || !workspace.clients.some(item => item.id === client.id)) return false;
                  const next = { ...workspace, clients: workspace.clients.map(item => item.id === client.id ? client : item) };
                  try { saveLocalWorkspace(next, localStorage); } catch { return false; }
                  setWorkspace(next);
                  toast("Client outreach saved on this device.");
                  return true;
                }}
                onAnalyseClient={setOpportunityClient}
                onOpenProject={(id) => openRoute({ tab: "projects", projectId: id, clientId: null })}
                onCreateProject={(clientId) => {
                  setInitialClient(clientId);
                  setHomeHandoff(false);
                  setInitialBrief(""); setInitialTitle(""); setInitialStyle("editorial");
                  setCreating("website");
                }}
              />
              } />
            )}
            {tab === "styles" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">A CLEAR CREATIVE DIRECTION</div>
                    <h1>Choose a creative direction.</h1>
                    <p>
                      Give every project a coherent character. Save custom
                      directions for your clients.
                    </p>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => setStyleModal(true)}
                  >
                    <Plus size={17} /> Custom style
                  </button>
                </div>
                <TemplateGallery onChoose={chooseDirection} />
                {workspace.styles.some(
                  (style) =>
                    !["editorial", "venture", "studio"].includes(style.id),
                ) && (
                  <section className="saved-style-directions">
                    <h2>Your saved directions</h2>
                    <div className="saved-style-grid">
                      {workspace.styles
                        .filter(
                          (style) =>
                            !["editorial", "venture", "studio"].includes(
                              style.id,
                            ),
                        )
                        .map((style) => (
                          <button
                            type="button"
                            key={style.id}
                            onClick={() =>
                              chooseDirection(styleConcept(style)?.kind ?? "website", "", style.id, style)
                            }
                          >
                            <span className="saved-style-preview" style={{ background: style.background, color: style.textColor, fontFamily: style.font === "serif" ? "Georgia, serif" : "Arial, sans-serif" }}>
                              {styleConcept(style) ? <Image src={`/gallery/${styleConcept(style)!.id}.png`} alt="" fill sizes="(max-width: 700px) 90vw, 320px" /> : <><small>YOUR CREATIVE DIRECTION</small><b>A different<br />point of view.</b><i style={{ background: style.color }} /></>}
                            </span>
                            <span className="saved-style-caption"><strong>{style.name}</strong><small>{style.description || "Your palette and typography, ready to use."}</small><span className="saved-style-colors" aria-label="Style palette">{[style.background, style.textColor, style.color].map((color, index) => <i key={index} style={{ background: color }} />)}</span></span>
                            <ArrowUpRight size={17} />
                          </button>
                        ))}
                    </div>
                  </section>
                )}
              </>
            )}
            {tab === "settings" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">MAKE YOURSELF AT HOME</div>
                    <h1>Workspace settings.</h1>
                    <p>
                      Keep your local work safe and control how the studio
                      feels.
                    </p>
                  </div>
                </div>
                <div className="settings-panel">
                  <section>
                    <h2>Workspace storage</h2>
                    <p>
                      This preview stores projects and client details in this
                      browser on this device. It does not sync to the cloud.
                      Clearing browser data will remove this workspace.
                    </p>
                    <div className="button-row">
                      {!persistenceAllowed && (
                        <button
                          className="button secondary"
                          onClick={() => {
                            const original = localStorage.getItem(storageKey);
                            if (original)
                              download(
                                new Blob([original], {
                                  type: "application/json",
                                }),
                                "makeborne-original-recovery.json",
                              );
                          }}
                        >
                          Download original recovery data
                        </button>
                      )}
                      <button
                        className="button secondary"
                        onClick={() =>
                          download(
                            new Blob([JSON.stringify(workspace, null, 2)], {
                              type: "application/json",
                            }),
                            "makeborne-workspace.json",
                          )
                        }
                      >
                        <Download size={17} /> Download backup
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => importRef.current?.click()}
                      >
                        Restore backup
                      </button>
                      <input
                        ref={importRef}
                        type="file"
                        accept="application/json"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) importBackup(file);
                          e.target.value = "";
                        }}
                      />
                    </div>
                  </section>
                  <section>
                    <h2>Studio sounds</h2>
                    <p>
                      A gentle confirmation when you save a version. Always
                      optional.
                    </p>
                    <button
                      className={`toggle ${workspace.sound ? "enabled" : ""}`}
                      aria-pressed={workspace.sound}
                      onClick={() =>
                        setWorkspace((w) => ({ ...w, sound: !w.sound }))
                      }
                    >
                      <span />
                      {workspace.sound ? "Sounds on" : "Sounds off"}
                    </button>
                  </section>
                  <section>
                    <h2>Account storage</h2>
                    <p>
                      New projects created while signed in save to your account.
                      Open them in Projects to edit with automatic saving.
                      Existing device drafts remain on this browser until you
                      explicitly import them. Client and import tools remain available below during this transition.
                    </p>
                    <Link className="text-link" href="/studio/cloud">Previously saved account records <ArrowUpRight size={14} /></Link>
                  </section>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {creationView}
      {clientModal && (
        <ClientModal
          existing={clientModal === "new" ? null : clientModal}
          close={() => setClientModal(null)}
          save={(c) => {
            if (!persistenceAllowed) return "Restore your workspace from Settings before saving client details. Your entries are still here.";
            const next = LocalWorkspaceSchema.safeParse({
              ...workspace,
              clients: workspace.clients.some((x) => x.id === c.id)
                ? workspace.clients.map((x) => (x.id === c.id ? c : x))
                : [c, ...workspace.clients],
            });
            if (!next.success) return "Check the client details. A name is required, and the workspace must stay within its supported limits.";
            try { saveLocalWorkspace(next.data, localStorage); }
            catch { return "Your browser could not save these details. Keep this form open and free storage or export a workspace backup before retrying."; }
            setWorkspace(next.data);
            setClientModal(null);
            toast("Client details saved on this device.");
            return null;
          }}
        />
      )}
      {styleModal && (
        <StyleModal
          close={() => setStyleModal(false)}
          save={(s) => {
            setWorkspace((w) => ({ ...w, styles: [...w.styles, s] }));
            setStyleModal(false);
            toast("Custom style saved.");
          }}
        />
      )}
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
  action,
  onClick,
}: {
  icon: typeof FolderOpen;
  title: string;
  text: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-symbol">
        <Icon size={30} />
      </div>
      <span className="eyebrow">A FRESH START</span>
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="button secondary" onClick={onClick}>
        <Plus size={17} />
        {action}
      </button>
    </div>
  );
}
function Modal({
  children,
  close,
  title,
}: {
  children: React.ReactNode;
  close: () => void;
  title: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeFromKeyboard = useEffectEvent(() => close());
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          "button,input,textarea,select,a[href],[tabindex]",
        ) || [],
      ).filter(
        (node) =>
          !node.matches(":disabled,[aria-disabled='true']") &&
          node.tabIndex >= 0 &&
          node.getClientRects().length > 0 &&
          getComputedStyle(node).visibility !== "hidden",
      );
    (focusable()[0] || ref.current)?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeFromKeyboard();
      }
      if (e.key === "Tab") {
        const nodes = focusable();
        if (!nodes.length) {
          e.preventDefault();
          ref.current?.focus();
          return;
        }
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        const current = document.activeElement;
        if (!nodes.includes(current as HTMLElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && current === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && current === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`modal ${title === "Create a project" ? "creation-modal" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <button
          className="icon-button modal-close"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </button>
        {children}
      </div>
    </div>
  );
}
const WizardDraftSchema = z
  .object({
    effort: EffortLevelSchema.default(DEFAULT_EFFORT),
    seed: z.string().max(100),
    kind: z.enum(["website", "book", "presentation"]),
    step: z.number().int().min(1).max(4),
    mode: z.enum(["plan", "create"]).default("create"),
    requirements: z.string().max(4000).default(""),
    outline: z.string().max(2000).nullable().default(null),
    title: z.string().max(160),
    brief: z.string().max(20000),
    content: z.string().max(50000),
    audience: z.string().max(5000),
    purpose: z.string().max(5000),
    wording: z.enum(["preserve", "improve", "summarise"]),
    styleId: z.string().min(1).max(100),
    clientId: z.union([z.literal(""), z.string().uuid()]),
  })
  .strict();
function creationSeed(brief: string, title: string, style: string) {
  const value = JSON.stringify([brief, title, style]);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36) + "-" + value.length;
}

function CreationSession({ children, close }: { children: React.ReactNode; close: () => void; title?: string }) {
  return <main className="creation-session"><header><Link href="/" aria-label="Makeborne home"><BrandMark size={25} />Makeborne</Link><button type="button" onClick={close}><ArrowLeft size={15} />Back to projects</button></header><section className="creation-session-content">{children}</section></main>;
}

function CreateModal(props: Omit<Parameters<typeof CreationWizard>[0], "account">) {
  const account = useCreationAccount(props.initialWorkspaceId);
  const LoadingFrame = props.directStart ? CreationSession : Modal;
  if (!account.ready) return <LoadingFrame close={props.close} title="Create a project"><h2>{account.error ? "Account unavailable" : "Opening your project…"}</h2><p role="status">{account.error || "Checking where your project and draft will be saved."}</p><button className="button secondary" onClick={props.close}>Back</button></LoadingFrame>;
  return <CreationWizard {...props} account={account} key={`${account.accountId ?? "device"}:${account.workspace?.id ?? "new"}`} />;
}

function CreationWizard({
  directStart, initialMode, initialEffort, requestId,
  account,
  initialWorkspaceId,
  initialClient,
  initialBrief,
  initialTitle,
  initialStyle,
  kind,
  onKind,
  clients: deviceClients,
  styles,
  close,
  create,
  accountCreated,
}: {
  directStart: boolean; initialMode: "create" | "plan"; initialEffort: EffortLevel; requestId: string;
  account: CreationAccount;
  initialWorkspaceId: string | null;
  initialClient: string;
  initialBrief: string;
  initialTitle: string;
  initialStyle: string;
  kind: Kind;
  onKind: (k: Kind) => void;
  clients: Client[];
  styles: Style[];
  close: () => void;
  accountCreated: (workspaceId: string, artifact: CloudArtifact) => void;
  create: (v: {
    effort: EffortLevel;
    title: string;
    brief: string;
    audience: string;
    purpose: string;
    styleId: string;
    clientId: string;
    wording: string;
    content: string;
    kind: Kind;
  }) => boolean;
}) {
  const clients = account.accountId ? account.clients : deviceClients;
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ accountId: string; workspaceId: string; body: ReturnType<typeof buildCreationPayload> } | null>(null);
  const step = 1; // Retain compatibility with saved drafts from the previous wizard.
  const [mode, setMode] = useState<"plan" | "create">(initialMode);
  const [effort, setEffort] = useState<EffortLevel>(initialEffort);
  const [requirements, setRequirements] = useState("");
  const [outline, setOutline] = useState<string | null>(null);
  const wizardContent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    wizardContent.current?.scrollTo({ top: 0, behavior: "instant" });
    wizardContent.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [step]);
  const [title, setTitle] = useState(
    initialTitle || (initialBrief.trim() ? `Untitled ${kind}` : ""),
  );
  const [brief, setBrief] = useState(initialBrief);
  const [content, setContent] = useState("");
  const [audience, setAudience] = useState("");
  const [purpose, setPurpose] = useState("");
  const [wording, setWording] = useState("preserve");
  const [requestedStyleId, setStyle] = useState(initialStyle);
  const selectedStyle = styles.find(style => style.id === requestedStyleId) || styles[0];
  const styleId = selectedStyle?.id ?? "";
  const [clientId, setClient] = useState(initialClient);
  const [seed] = useState(() =>
    creationSeed(initialBrief, initialTitle, (directStart ? requestId : "") + initialStyle + (initialClient ? `::${initialClient}` : "") + (initialWorkspaceId ? `::workspace:${initialWorkspaceId}` : "")),
  );
  const storageSeed = wizardDraftScope(seed, account.accountId, account.workspace?.id ?? null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftWritable, setDraftWritable] = useState(true);
  const [draftNotice, setDraftNotice] = useState("");
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const { raw, kind: savedKind } = readWizardDraft(sessionStorage, storageSeed, kind);
        if (raw) {
          if (raw.length > 200000) throw new Error("Draft too large");
          const parsed = WizardDraftSchema.safeParse(JSON.parse(raw));
          if (
            !parsed.success ||
            parsed.data.seed !== seed ||
            parsed.data.kind !== savedKind
          )
            throw new Error("Invalid draft");
          const draft = parsed.data;
          onKind(savedKind);
          setEffort(draft.effort);

          setMode(draft.mode); setRequirements(draft.requirements);
          setOutline(draft.outline);
          setTitle(draft.title);
          setBrief(draft.brief);
          setContent(draft.content);
          setAudience(draft.audience);
          setPurpose(draft.purpose);
          setWording(draft.wording);
          if (styles.some((style) => style.id === draft.styleId))
            setStyle(draft.styleId);
          // Membership is checked after account loading and again before saving.
          // Do not erase a restored client while the account list is still loading.
          setClient(draft.clientId);
          setDraftNotice(
            "Your saved creation draft has been restored in this tab.",
          );
        }
      } catch {
        setDraftWritable(false);
        setDraftNotice(
          "The saved draft could not be read. Its original data is preserved. New edits cannot replace it in this tab.",
        );
      }
      setDraftLoaded(true);
    });
    // Restore once per opened dialog; format changes preserve current answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!draftLoaded || !draftWritable) return;
    try {
      const draft = WizardDraftSchema.parse({
        effort,
        mode, requirements, outline,
        seed,
        kind,
        step,
        title,
        brief,
        content,
        audience,
        purpose,
        wording,
        styleId,
        clientId,
      });
      writeWizardDraft(sessionStorage, storageSeed, kind, JSON.stringify(draft));
    } catch {
      queueMicrotask(() => {
        setDraftWritable(false);
        setDraftNotice(
          "This tab could not save your draft. Keep this dialog open or copy your content before leaving.",
        );
      });
    }
  }, [
    draftLoaded,
    draftWritable,
    storageSeed,
    seed,
    kind,
    step,
    title,
    brief,
    content,
    audience,
    purpose,
    wording,
    styleId,
    clientId,
    mode, requirements, outline, effort,
  ]);
  const plan = creationPlan({ kind, title, brief, audience, purpose, requirements, outline, style: selectedStyle?.name || "Custom direction" });
  const needsPlanAnswers = mode === "plan" && plan.structure.length === 0;
  async function submitProject() {
            if (savingRef.current) return;
            savingRef.current = true; setSaving(true); setSaveError("");
            const values = {
              effort,
              kind,
              title: title.trim() || `Untitled ${kind}`,
              brief: mode === "plan" ? plan.brief : [brief, requirements && `Requirements: ${requirements}`].filter(Boolean).join("\n\n"),
              audience,
              purpose,
              wording,
              styleId,
              clientId,
              content,
            };
            let saved = false;
            try {
              if (initialWorkspaceId && (!account.accountId || account.workspace?.id !== initialWorkspaceId)) throw new Error("The selected client workspace is unavailable. Close and reopen this form from Clients.");
              if (account.accountId) {
                const verified = await createClient().auth.getUser();
                if (verified.error || verified.data.user?.id !== account.accountId) throw new Error("Your account changed. Close this form and reopen it before saving.");
                if (pending.current && pending.current.accountId !== account.accountId) throw new Error("Retry this draft from the account that started it.");
                setCloudAccount(account.accountId);
                if (!pending.current) {
                  if (getPendingCloudWrites(account.accountId).some(item => item.path.endsWith("/studio-projects"))) throw new Error("An earlier project save needs confirmation. Close this form and retry that exact request in Projects before creating another project.");
                  if (values.clientId && !account.clients.some(client => client.id === values.clientId)) throw new Error("Choose an account client or select no client. Device-only clients are not uploaded automatically.");
                  if (!selectedStyle || selectedStyle.id !== values.styleId) throw new Error("Choose an available style before creating.");
                  const body = buildCreationPayload(values, selectedStyle);
                  const target = account.workspace ?? (await api<{ workspace: CloudWorkspace }>("/api/workspaces", { name: "My workspace" })).workspace;
                  pending.current = { accountId: account.accountId, workspaceId: target.id, body };
                }
                const request = pending.current;
                const result = await api<{ artifact: CloudArtifact }>(`/api/cloud/workspaces/${request.workspaceId}/studio-projects`, request.body);
                saved = true; pending.current = null; setUncertain(false);
                accountCreated(request.workspaceId, result.artifact);
              } else {
                if (pending.current) throw new Error("Sign back into the account that started this save to retry it.");
                saved = create(values);
              }
            } catch (error) {
              const unknown = !!pending.current && error instanceof CloudError && error.uncertain;
              if (!unknown && !uncertain) pending.current = null;
              setUncertain(unknown || uncertain);
              setSaveError(error instanceof z.ZodError ? "Some details exceed the supported limits. Shorten the title or content and try again." : error instanceof Error ? error.message : "Could not save. Your draft is preserved.");
            } finally { savingRef.current = false; setSaving(false); }
            if (saved) {
              try {
                clearWizardDrafts(sessionStorage, storageSeed);
              } catch {
                /* A retained draft is safe; the created project is saved. */
              }
            }
  }
  const Frame = directStart ? CreationSession : Modal;
  const started = useRef(false);
  const startDirect = useEffectEvent(() => { void submitProject(); });
  useEffect(() => {
    if (!directStart || mode !== "create" || !draftLoaded || !draftWritable || !account.ready || started.current) return;
    started.current = true; startDirect();
  }, [directStart, mode, draftLoaded, draftWritable, account.ready]);
  return (
    <Frame close={() => { if (!savingRef.current) close(); }} title="Create a project">
      <p className="small-note" role="status">{account.error || (!account.ready ? "Checking your account…" : account.accountId ? `Saving to ${account.workspace?.name ?? "your new account workspace"}` : "Saved on this device. Sign in to save new projects to your account.")}</p>
      {saveError && <p role="alert" className="small-note">{saveError}</p>}
      <div className="wizard-content" ref={wizardContent} inert={saving || uncertain || !account.ready}>
        <h2 tabIndex={-1}>{directStart ? mode === "plan" ? "Let’s shape your idea" : "Opening your project" : "What would you like to make?"}</h2>
        <p className={directStart ? "creation-user-message" : "modal-intro"}>{directStart ? brief : "Start with your idea. Everything else can be refined as you go."}</p>
        {draftNotice && <p className="wizard-draft-notice" role="status">{draftNotice}</p>}
        {directStart && mode === "plan" && <div className="form-grid"><label>Who is it for?<input value={audience} onChange={e => setAudience(e.target.value)} maxLength={1000} placeholder="Your audience" /></label><label>What should it achieve?<input value={purpose} onChange={e => setPurpose(e.target.value)} maxLength={2000} placeholder="The outcome you want" /></label></div>}
        {!directStart && <>
        <div className="prompt-format-switch" role="group" aria-label="Project format">
          {(["website", "book", "presentation"] as Kind[]).map(k => {
            const Icon = icons[k];
            return <button type="button" key={k} aria-pressed={kind === k} onClick={() => onKind(k)}><Icon size={16} />{kindLabel[k]}</button>;
          })}
        </div>
        <label className="prompt-main-label">Your idea
          <textarea className="prompt-main-input" value={brief} onChange={e => setBrief(e.target.value)} rows={5} maxLength={20000} placeholder={`Describe the ${kind} you have in mind…`} />
        </label>
        <div className="prompt-mode-switch" role="group" aria-label="Creation mode">
          <button type="button" aria-pressed={mode === "create"} onClick={() => setMode("create")}>Create</button>
          <button type="button" aria-pressed={mode === "plan"} onClick={() => setMode("plan")}>Plan first</button>
          <span>{mode === "create" ? "Open your project directly" : "Review a starting outline below"}</span>
        </div>
        <CreationSource kind={kind} content={content} wording={wording} onContent={setContent} onWording={setWording} />
        <details className="prompt-options">
          <summary><span>Style <small>{selectedStyle?.name}</small></span><span>Browse all {styles.length}</span></summary>
          <p className="creation-style-note">Choose a style for your {kind}. You can refine it in the editor.</p>
          <div className="prompt-style-grid" role="group" aria-label="Project style">
            {styles.map(s => {
              const concept = styleConcept(s);
              return <button type="button" key={s.id} aria-pressed={selectedStyle?.id === s.id} onClick={() => setStyle(s.id)}>
                <span className="prompt-style-visual" style={{ background: s.background, color: s.textColor }} aria-hidden="true">
                  {concept ? <Image src={`/gallery/${concept.id}.png`} alt="" fill sizes="(max-width: 600px) 42vw, 220px" /> : <span className={`prompt-style-composition composition-${kind}`} style={{ fontFamily: s.font === "serif" ? "Georgia, serif" : "Arial, sans-serif" }}><i style={{ background: s.color }} /><small>MAKE SOMETHING MEANINGFUL</small><b>{kind === "book" ? "A new perspective." : kind === "presentation" ? "Ideas worth sharing." : "A different point of view."}</b><span style={{ background: s.color }} /><em>Thoughtfully made. Uniquely yours.</em></span>}
                </span>
                <span className="prompt-style-caption"><strong>{s.name}</strong>{selectedStyle?.id === s.id && <Check size={15} />}</span>
                <small>{concept ? "Artwork concept" : "Palette & typography"}</small>
              </button>;
            })}
          </div>
          <p className="creation-style-note">Concept artwork is inspiration. Palette and typography are applied to your project; example images are not included.</p>
        </details>
        <details className="prompt-options">
          <summary><span>Project details</span><span>Optional</span></summary>
          <label>Project title<input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} placeholder="Name it now or later" /></label>
          <label>Client<select value={clientId} onChange={e => setClient(e.target.value)}><option value="">For myself</option>{clientId && !clients.some(c => c.id === clientId) && <option value={clientId} disabled>Client unavailable — choose another</option>}{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <div className="form-grid"><label>Audience<input value={audience} onChange={e => setAudience(e.target.value)} maxLength={1000} placeholder="Who is it for?" /></label><label>Outcome<input value={purpose} onChange={e => setPurpose(e.target.value)} maxLength={2000} placeholder="What should it achieve?" /></label></div>
          <label>Requirements<textarea value={requirements} onChange={e => setRequirements(e.target.value)} maxLength={4000} rows={3} placeholder="Anything to include or avoid" /></label>
        </details>
        <details className="prompt-options"><summary><span>Creative effort</span><span>{effort.replaceAll("_", " ")}</span></summary><EffortControl value={effort} onChange={setEffort} /></details>
        </>}
        {mode === "plan" && <div className="creation-plan"><h3>Your starting plan</h3><label className="creation-outline">Sections to include<textarea rows={6} maxLength={2000} value={outline ?? plan.structure.join("\n")} onChange={e => setOutline(e.target.value)} /></label><p>Edit one section, chapter, or slide per line. This is a starter outline, not AI research. Confirming saves it with your brief.</p></div>}
        <p className="creation-plan-note">Your brief and source text will be saved in an editable project. Live AI generation is not connected yet.</p>
      </div>
      <div className="modal-actions">
        <button
          className="button secondary"
          disabled={saving || uncertain}
          onClick={close}
        >
          Cancel
        </button>
        <button
          className="button primary"
          disabled={saving || (directStart && mode === "create" && !saveError && draftWritable) || !account.ready || (!brief.trim() && !content.trim()) || !draftLoaded || needsPlanAnswers}
          onClick={() => void submitProject()}
        >
          {saving ? "Saving project…" : uncertain ? "Retry the same save" : mode === "plan" ? "Confirm plan & create" : "Create project"}
          <ArrowRight size={16} />
        </button>
      </div>
    </Frame>
  );
}
function ClientModal({
  existing,
  close,
  save,
}: {
  existing: Client | null;
  close: () => void;
  save: (c: Client) => string | null;
}) {
  const [name, setName] = useState(existing?.name || "");
  const [company, setCompany] = useState(existing?.company || "");
  const [email, setEmail] = useState(existing?.email || "");
  const [website, setWebsite] = useState(existing?.website || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [error, setError] = useState("");
  return (
    <Modal close={close} title="Client details">
      <span className="eyebrow">CLIENT RELATIONSHIPS</span>
      <h2>{existing ? "A little more detail." : "Make room for a client."}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const problem = save({
            ...existing,
            id: existing?.id || uid(),
            name: name.trim(),
            company,
            email,
            website,
            notes,
            createdAt: existing?.createdAt || now(),
          });
          if (problem) setError(problem);
        }}
      >
        {error && <p className="form-error" role="alert">{error}</p>}
        <label>
          Name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Client name"
          />
        </label>
        <div className="form-grid">
          <label>
            Company
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              maxLength={160}
              placeholder="Optional"
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.com"
            />
          </label>
        </div>
        <label>
          Website
          <input
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://"
          />
        </label>
        <label>
          Internal notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="What matters to this client?"
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={close}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!name.trim()}
            type="submit"
          >
            Save client <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function StyleModal({
  close,
  save,
}: {
  close: () => void;
  save: (s: Style) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#3358d4");
  const [font, setFont] = useState("serif");
  return (
    <Modal close={close} title="Custom style">
      <span className="eyebrow">YOUR OWN DIRECTION</span>
      <h2>A style with a point of view.</h2>
      <label>
        Style name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="e.g. North Studio"
        />
      </label>
      <label>
        Describe the direction
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Mood, audience, image treatment, layout preferences…"
          maxLength={2000}
        />
      </label>
      <div className="form-grid">
        <label>
          Accent colour
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label>
          Type character
          <select value={font} onChange={(e) => setFont(e.target.value)}>
            <option value="serif">Editorial serif</option>
            <option value="sans">Contemporary sans</option>
          </select>
        </label>
      </div>
      <div className="modal-actions">
        <button className="button secondary" onClick={close}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!name.trim()}
          onClick={() =>
            save({ id: uid(), name: name.trim(), description, color, font })
          }
        >
          Save style <Check size={16} />
        </button>
      </div>
    </Modal>
  );
}
function ProjectEditor({
  project,
  styles,
  clients,
  sound,
  update,
  restoreVersion,
  saveTasks,
  saveWebsiteRecord,
  back,
  notify,
}: {
  sound: boolean;
  project: Project;
  styles: Style[];
  clients: Client[];
  update: (
    p: Project | ((current: Project) => Project),
    targetId?: string,
  ) => void;
  back: () => void;
  restoreVersion: (projectId: string, versionId: string) => boolean;
  saveTasks: (projectId: string, tasks: ProjectTask[], message: string) => boolean;
  saveWebsiteRecord: (projectId: string, record: WebsiteRecord) => boolean;
  notify: (s: string) => void;
}) {
  const bookAuthor = project.bookMetadata?.author ?? "";
  const bookLanguage = project.bookMetadata?.language ?? "en";
  function updateBookMetadata(values: Partial<{ author: string; language: string }>) {
    update((current) => ({
      ...current,
      bookMetadata: { author: "", language: "en", ...current.bookMetadata, ...values },
      updatedAt: now(),
      status: current.status === "approved" ? "in_progress" : current.status,
    }), project.id);
  }
  const [active, setActive] = useState(project.blocks[0]?.id || "");
  const [view, setView] = useState("edit");
  const [panel, setPanel] = useState("content");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Block[][]>([]);
  const [versionNote, setVersionNote] = useState("");
  const [comment, setComment] = useState("");
  const [previewWidth, setPreviewWidth] = useState("desktop");
  const fileRef = useRef<HTMLInputElement>(null);
  const latestProject = useRef(project);
  useEffect(() => {
    latestProject.current = project;
  }, [project]);
  const style = styles.find((s) => s.id === project.styleId) || baseStyles[0];
  const block = project.blocks.find((b) => b.id === active);
  const client = clients.find((c) => c.id === project.clientId);
  function change(blocks: Block[]) {
    setHistory((h) => [...h.slice(-29), project.blocks]);
    update({
      ...project,
      blocks,
      updatedAt: now(),
      status: project.status === "approved" ? "in_progress" : project.status,
    });
  }
  function editBlock(values: Partial<Block>) {
    change(
      project.blocks.map((b) => (b.id === active ? { ...b, ...values } : b)),
    );
  }
  function changeBlockType(type: Block["type"]) {
    if (!block || type === block.type) return;
    if (block.image && type !== "image") {
      if (project.versions.length >= 100) {
        notify(
          "Save a workspace backup before converting this artwork block: the project already has 100 versions.",
        );
        return;
      }
      if (
        !window.confirm(
          "Convert this artwork block to text? The image will be removed from this block. A saved version will preserve the artwork so you can restore it from History & review.",
        )
      )
        return;
      const at = now();
      setHistory((history) => [...history.slice(-29), project.blocks]);
      update({
        ...project,
        blocks: project.blocks.map((current) => {
          if (current.id !== block.id) return current;
          const converted = { ...current, type };
          delete converted.image;
          return converted;
        }),
        versions: [
          ...project.versions,
          {
            id: uid(),
            at,
            blocks: structuredClone(project.blocks),
            note: "Artwork preserved before conversion to text",
          },
        ],
        activity: [
          ...project.activity.slice(-999),
          { at, text: "Saved artwork version and converted a block to text" },
        ],
        updatedAt: at,
        status: project.status === "approved" ? "in_progress" : project.status,
      });
      notify(
        "Artwork preserved in a saved version. The current block is now text.",
      );
      return;
    }
    editBlock({ type });
  }
  function addBlock(type: Block["type"]) {
    const b: Block = { id: uid(), type, text: "" };
    change([...project.blocks, b]);
    setActive(b.id);
    setPanel("content");
  }
  function reorder(id: string, dir: number) {
    const index = project.blocks.findIndex((b) => b.id === id);
    const next = index + dir;
    if (next < 0 || next >= project.blocks.length) return;
    const blocks = [...project.blocks];
    [blocks[index], blocks[next]] = [blocks[next], blocks[index]];
    change(blocks);
  }
  function saveVersion() {
    if (project.versions.length >= 100) {
      notify(
        "This project has reached 100 saved versions. Download a workspace backup before starting a new project.",
      );
      return;
    }
    if (sound) {
      try {
        const audio = new AudioContext();
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(440, audio.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(
          554,
          audio.currentTime + 0.12,
        );
        gain.gain.setValueAtTime(0.025, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.2);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start();
        oscillator.stop(audio.currentTime + 0.22);
        oscillator.onended = () => audio.close();
      } catch {
        /* Audio remains optional. */
      }
    }
    const at = now();
    update({
      ...project,
      versions: [
        ...project.versions,
        {
          id: uid(),
          at,
          blocks: structuredClone(project.blocks),
          note: versionNote.trim() || "Saved version",
        },
      ],
      activity: [
        ...project.activity,
        { at, text: versionNote.trim() || "Saved a content version" },
      ],
      updatedAt: at,
    });
    setVersionNote("");
    notify("Version saved. You can restore it from the project history.");
  }
  function setStatus(status: Project["status"]) {
    const at = now();
    update({
      ...project,
      status,
      updatedAt: at,
      activity: [
        ...project.activity,
        {
          at,
          text: `Locally marked ${status.replace("_", " ")}. This is an internal record, not a client signature.`,
        },
      ],
    });
    notify("Project status updated locally.");
  }
  async function generate() {
    setBusy(true);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: project.kind,
          brief: project.brief,
          audience: project.audience,
          purpose: project.purpose,
          styleId: project.styleId,
          content: project.blocks.map((b) => b.text).join("\n\n"),
          mode: project.wording,
        }),
      });
      const result = await response.json();
      notify(
        result.error?.message ||
          "No generation result was returned. Your existing content has been preserved.",
      );
    } catch {
      notify(
        "Could not reach the generation service. Your content has been preserved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function exportFile(format: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          kind: project.kind,
          title: project.title,
          styleId: project.styleId,
          style: {
            id: style.id,
            name: style.name,
            color: style.color,
            font: style.font,
            background: style.background,
            textColor: style.textColor,
          },
          presentationMode: "native",
          documentId: project.id,
          author: bookAuthor.trim() || undefined,
          language: bookLanguage,
          blocks: project.blocks,
        }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(
          result.error?.message || result.error || "Export unavailable",
        );
      }
      download(
        await response.blob(),
        `${project.title.replace(/[^a-z0-9 -]/gi, "").slice(0, 70) || "makeborne"}.${format}`,
      );
      notify(
        `${format.toUpperCase()} downloaded. This is an export of your manually authored content.`,
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Export could not complete.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function addImage(file: File) {
    if (
      file.size > 3_000_000 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      notify("Choose a PNG, JPEG, or WebP image smaller than 3 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const b: Block = {
        id: uid(),
        type: "image",
        text: file.name,
        image: String(reader.result),
      };
      setHistory((history) => [
        ...history.slice(-29),
        latestProject.current.blocks,
      ]);
      update(
        (current) => ({
          ...current,
          blocks: [...current.blocks, b],
          updatedAt: now(),
          status:
            current.status === "approved" ? "in_progress" : current.status,
        }),
        project.id,
      );
      setActive(b.id);
    };
    reader.readAsDataURL(file);
  }
  return (
    <div className="editor">
      <div className="editor-heading">
        <button
          className="icon-button"
          aria-label="Back to projects"
          onClick={back}
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <input
            className="title-input"
            aria-label="Project title"
            maxLength={160}
            value={project.title}
            onChange={(e) =>
              update({
                ...project,
                title: e.target.value.trim() ? e.target.value : project.title,
                updatedAt: now(),
              })
            }
          />
          <p>
            {kindLabel[project.kind]} · {client?.name || "Personal project"} ·
            Saved on this device
          </p>
        </div>
        <div className="editor-actions">
          <button className="button secondary" onClick={saveVersion}>
            <Save size={16} /> Save version
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              exportFile(
                project.kind === "presentation"
                  ? "pptx"
                  : project.kind === "website"
                    ? "html"
                    : "pdf",
              )
            }
          >
            <Download size={16} /> Export
          </button>
        </div>
      </div>
      <div className="editor-toolbar">
        <div className="filter-tabs">
          <button
            className={view === "edit" ? "active" : ""}
            onClick={() => setView("edit")}
          >
            Edit
          </button>
          <button
            className={view === "preview" ? "active" : ""}
            onClick={() => setView("preview")}
          >
            Preview
          </button>
          <button
            className={view === "history" ? "active" : ""}
            onClick={() => setView("history")}
          >
            History & review
          </button>
        </div>
        <div className="editor-toolbar-right">
          <span className="status-label">
            {project.status.replace("_", " ")}
          </span>
          <button
            className="icon-button"
            aria-label="Undo last content change"
            disabled={!history.length}
            onClick={() => {
              const previous = history[history.length - 1];
              if (previous) {
                update({ ...project, blocks: previous, updatedAt: now() });
                setHistory((h) => h.slice(0, -1));
              }
            }}
          >
            <Undo2 size={17} />
          </button>
          <select
            aria-label="Project style"
            value={project.styleId}
            onChange={(e) =>
              update({ ...project, styleId: e.target.value, updatedAt: now() })
            }
          >
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {view === "history" ? (
        <div className="review-layout">
          <section>
            <div className="eyebrow">CONTENT VERSIONS</div>
            <h2>A record of your decisions.</h2>
            <label>
              Version note
              <input
                value={versionNote}
                maxLength={2000}
                onChange={(e) => setVersionNote(e.target.value)}
                placeholder="What changed in this version?"
              />
            </label>
            <button className="button secondary" onClick={saveVersion}>
              <Save size={16} /> Save current version
            </button>
            {project.versions.length === 0 ? (
              <p className="muted">
                No snapshots yet. Save a version before making a major change.
              </p>
            ) : (
              <div className="version-list">
                {[...project.versions].reverse().map((v, i) => (
                  <article key={v.id}>
                    <span className="version-number">
                      {project.versions.length - i}
                    </span>
                    <div>
                      <strong>{v.note}</strong>
                      <p>
                        {new Date(v.at).toLocaleString()} · {v.blocks.length}{" "}
                        blocks
                      </p>
                    </div>
                    <button
                      className="button secondary small"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Restore this content snapshot? Your current content will first be saved as a safety copy in History & review. Your project details and style stay the same.",
                          )
                        ) {
                          if (restoreVersion(project.id, v.id)) {
                            setHistory((items) => [...items.slice(-29), project.blocks]);
                            setActive(v.blocks[0]?.id || "");
                          }
                        }
                      }}
                    >
                      Restore
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section>
            {project.kind === "website" && <WebsiteRecordPanel value={project.websiteRecord} history={project.websiteHistory ?? []} save={record => saveWebsiteRecord(project.id, record)} />}
            <ProjectTasks tasks={project.tasks ?? []} save={(tasks, message) => saveTasks(project.id, tasks, message)} />
            <div className="eyebrow">INTERNAL REVIEW</div>
            <h2>What happens next?</h2>
            <p className="muted">
              These are your local records. Client sharing and signed approvals
              are not enabled.
            </p>
            <label>
              Project status
              <select
                value={project.status}
                onChange={(e) => setStatus(e.target.value as Project["status"])}
              >
                <option value="draft">Draft</option>
                <option value="in_progress">In progress</option>
                <option value="review">Ready for review</option>
                <option value="approved">Internally approved</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label>
              Record feedback or a next step
              <textarea
                rows={4}
                value={comment}
                maxLength={10000}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add an internal review note…"
              />
            </label>
            <button
              className="button secondary"
              disabled={!comment.trim()}
              onClick={() => {
                const at = now();
                update({
                  ...project,
                  activity: [...project.activity, { at, text: comment.trim() }],
                  updatedAt: at,
                });
                setComment("");
              }}
            >
              Add note
            </button>
            <div className="activity-list">
              {[...project.activity].reverse().map((a, i) => (
                <div key={i}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>{a.text}</strong>
                    <p>{new Date(a.at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div
          className={`editor-workbench ${view === "preview" ? "preview-only" : ""}`}
        >
          {view === "edit" && (
            <aside className="outline-panel">
              <div className="outline-heading">
                <span className="eyebrow">
                  {project.kind === "presentation" ? "SLIDE BLOCKS" : "OUTLINE"}
                </span>
                <span>{project.blocks.length}</span>
              </div>
              <div className="outline-list">
                {project.blocks.map((b, i) => (
                  <div
                    className={`outline-item ${active === b.id ? "active" : ""}`}
                    key={b.id}
                  >
                    <button onClick={() => setActive(b.id)}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      <span>
                        {b.text ||
                          (b.type === "image" && "Image") ||
                          "Empty " + b.type}
                      </span>
                    </button>
                    <div>
                      <button
                        className="icon-button"
                        disabled={i === 0}
                        aria-label={`Move block ${i + 1} up`}
                        onClick={() => reorder(b.id, -1)}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={i === project.blocks.length - 1}
                        aria-label={`Move block ${i + 1} down`}
                        onClick={() => reorder(b.id, 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="outline-add"
                onClick={() => addBlock("paragraph")}
              >
                <Plus size={16} /> Add content block
              </button>
              <button
                className="outline-add"
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus size={16} /> Upload artwork
              </button>
              <input
                type="file"
                ref={fileRef}
                hidden
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  if (e.target.files?.[0]) addImage(e.target.files[0]);
                  e.target.value = "";
                }}
              />
              <div className="outline-footnote">
                Your own content and uploaded artwork. No AI generation has been
                performed.
              </div>
            </aside>
          )}
          <div className="artifact-canvas">
            <div className="canvas-toolbar">
              <span>
                {view === "preview"
                  ? "CONTENT PREVIEW"
                  : "LIVE CONTENT PREVIEW"}
              </span>
              <div>
                {project.kind === "website" && (
                  <>
                    <button
                      className={previewWidth === "desktop" ? "selected" : ""}
                      onClick={() => setPreviewWidth("desktop")}
                    >
                      Desktop
                    </button>
                    <button
                      className={previewWidth === "mobile" ? "selected" : ""}
                      onClick={() => setPreviewWidth("mobile")}
                    >
                      Mobile
                    </button>
                  </>
                )}
                <span>{style.name}</span>
              </div>
            </div>
            <ArtifactPreview
              project={project}
              style={style}
              width={previewWidth}
              active={active}
              select={view === "edit" ? setActive : undefined}
            />
            {view === "preview" && (
              <div className="preview-disclaimer">
                This is a local content preview. Publishing, live forms, and
                client access require configured cloud services.
              </div>
            )}
          </div>
          {view === "edit" && (
            <aside className="inspector-panel">
              <div className="filter-tabs">
                <button
                  className={panel === "content" ? "active" : ""}
                  onClick={() => setPanel("content")}
                >
                  Content
                </button>
                <button
                  className={panel === "brief" ? "active" : ""}
                  onClick={() => setPanel("brief")}
                >
                  Brief
                </button>
              </div>
              {panel === "content" ? (
                <>
                  {block ? (
                    <>
                      <label>
                        Block type
                        <select
                          value={block.type}
                          onChange={(e) =>
                            changeBlockType(e.target.value as Block["type"])
                          }
                        >
                          <option value="heading">Heading</option>
                          <option value="paragraph">Paragraph</option>
                          <option value="quote">Quote</option>
                          {block.image && <option value="image">Image</option>}
                        </select>
                      </label>
                      <label>
                        {block.type === "image"
                          ? "Image description"
                          : "Content"}
                        <textarea
                          value={block.text}
                          onChange={(e) => editBlock({ text: e.target.value })}
                          rows={10}
                          placeholder="Make it your own…"
                          maxLength={15000}
                        />
                      </label>
                      {block.image && (
                        <img
                          className="inspector-image"
                          src={block.image}
                          alt={block.text}
                        />
                      )}
                      <button
                        className="text-link danger"
                        onClick={() => {
                          if (
                            window.confirm(
                              "Remove this block? You can undo this change.",
                            )
                          ) {
                            change(
                              project.blocks.filter((b) => b.id !== active),
                            );
                            setActive(
                              project.blocks.find((b) => b.id !== active)?.id ||
                                "",
                            );
                          }
                        }}
                      >
                        <Trash2 size={14} /> Remove block
                      </button>
                    </>
                  ) : (
                    <p>Select or add a content block.</p>
                  )}
                  <div className="inspector-divider" />
                  {project.kind === "website" && (
                    <WebsiteSections
                      add={(blocks) => {
                        const added = blocks.map((b) => ({ ...b, id: uid() }));
                        change([...project.blocks, ...added]);
                        setActive(added[0].id);
                        notify(
                          "Section scaffold added. Replace the guidance with your own verified content.",
                        );
                      }}
                    />
                  )}
                  <h3>Expand your content</h3>
                  <div className="inspector-add">
                    <button onClick={() => addBlock("heading")}>
                      <Plus size={14} /> Heading
                    </button>
                    <button onClick={() => addBlock("paragraph")}>
                      <Plus size={14} /> Paragraph
                    </button>
                    <button onClick={() => addBlock("quote")}>
                      <Plus size={14} /> Quote
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label>
                    Brief
                    <textarea
                      value={project.brief}
                      maxLength={30000}
                      onChange={(e) =>
                        update({
                          ...project,
                          brief: e.target.value,
                          updatedAt: now(),
                        })
                      }
                      rows={5}
                    />
                  </label>
                  <label>
                    Audience
                    <input
                      value={project.audience}
                      maxLength={5000}
                      onChange={(e) =>
                        update({
                          ...project,
                          audience: e.target.value,
                          updatedAt: now(),
                        })
                      }
                    />
                  </label>
                  <label>
                    Purpose
                    <input
                      value={project.purpose}
                      maxLength={5000}
                      onChange={(e) =>
                        update({
                          ...project,
                          purpose: e.target.value,
                          updatedAt: now(),
                        })
                      }
                    />
                  </label>
                  <EffortControl value={project.effort ?? DEFAULT_EFFORT} onChange={effort => update({ ...project, effort, updatedAt: now() })} />
                  <label>
                    Client
                    <select
                      value={project.clientId || ""}
                      onChange={(e) =>
                        update({
                          ...project,
                          clientId: e.target.value || null,
                          updatedAt: now(),
                        })
                      }
                    >
                      <option value="">Personal project</option>
                      {clients.map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <div className="ai-panel">
                <Sparkles size={19} />
                <h3>A thoughtful next draft.</h3>
                <p>
                  Live AI generation is not enabled. Keep writing here, or save
                  your brief for later.
                </p>
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={generate}
                >
                  {busy ? "Checking service…" : "Check generation availability"}
                </button>
              </div>
              <div className="export-options">
                {project.kind === "book" && (
                  <div className="book-export-details">
                    <label>
                      Book language
                      <select
                        value={bookLanguage}
                        onChange={(e) => updateBookMetadata({ language: e.target.value })}
                      >
                        {!["en", "bs", "hr", "sr", "pl", "de", "fr", "es", "it", "pt", "ar", "ja"].includes(bookLanguage) && (
                          <option value={bookLanguage}>{bookLanguage} (saved language)</option>
                        )}
                        <option value="en">English (default)</option>
                        <option value="bs">Bosnian</option>
                        <option value="hr">Croatian</option>
                        <option value="sr">Serbian</option>
                        <option value="pl">Polish</option>
                        <option value="de">German</option>
                        <option value="fr">French</option>
                        <option value="es">Spanish</option>
                        <option value="it">Italian</option>
                        <option value="pt">Portuguese</option>
                        <option value="ar">Arabic</option>
                        <option value="ja">Japanese</option>
                      </select>
                    </label>
                    <label>
                      Author (optional)
                      <input
                        value={bookAuthor}
                        onChange={(e) => updateBookMetadata({ author: e.target.value })}
                        maxLength={200}
                        placeholder="Use the real author's name"
                      />
                    </label>
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() => exportFile("epub")}
                    >
                      <BookOpenIcon size={15} /> Download EPUB
                    </button>
                    <p>
                      EPUB export does not establish Amazon acceptance. Review
                      the file in your target reader.
                    </p>
                  </div>
                )}

                <span className="eyebrow">MANUAL CONTENT EXPORT</span>
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() => exportFile("pdf")}
                >
                  <FileText size={15} /> Download PDF
                </button>
                {project.kind === "presentation" && (
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() => exportFile("pptx")}
                  >
                    <Presentation size={15} /> Download editable PowerPoint
                  </button>
                )}
                {project.kind === "website" && (
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() => exportFile("html")}
                  >
                    <Globe size={15} /> Download HTML
                  </button>
                )}
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
function ArtifactPreview({
  project,
  style,
  width,
  active,
  select,
}: {
  project: Project;
  style: Style;
  width: string;
  active: string;
  select?: (id: string) => void;
}) {
  const css = {
    "--artifact-accent": style.color,
    "--artifact-background": style.background,
    "--artifact-ink": style.textColor,
    background: style.background,
    color: style.textColor,
    "--artifact-font":
      style.font === "serif" ? "var(--font-serif)" : "var(--font-inter)",
  } as React.CSSProperties;
  function renderBlock(b: Block) {
    return b.type === "image" ? (
      <figure>
        <img src={b.image} alt={b.text} />
        <figcaption>{b.text}</figcaption>
      </figure>
    ) : b.type === "heading" ? (
      <h2>{b.text || "Your heading"}</h2>
    ) : b.type === "quote" ? (
      <blockquote>{b.text || "Your quote"}</blockquote>
    ) : (
      <p>{b.text || "Write your next paragraph…"}</p>
    );
  }
  function editableBlock(
    block: Block,
    content: React.ReactNode = renderBlock(block),
  ) {
    return (
      <div
        className={`artifact-content-block ${active === block.id && select ? "selected-block" : ""}`}
        key={block.id}
        onClick={select ? () => select(block.id) : undefined}
        role={select ? "button" : undefined}
        aria-label={
          select
            ? `Edit ${block.type}: ${block.text.slice(0, 100) || "Untitled block"}`
            : undefined
        }
        tabIndex={select ? 0 : undefined}
        onKeyDown={
          select
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  select(block.id);
                }
              }
            : undefined
        }
      >
        {content}
      </div>
    );
  }
  if (project.kind === "presentation") {
    const groups: Block[][] = [];
    for (const block of project.blocks) {
      if (block.type === "heading" || groups.length === 0) groups.push([block]);
      else groups[groups.length - 1].push(block);
    }
    return (
      <div className="deck-preview" style={css}>
        <p className="preview-layout-note">
          Each heading begins a slide. Native PowerPoint layout is rendered
          separately.
        </p>
        {groups.length === 0 ? (
          <div
            className="slide-preview"
            style={{ background: style.background, color: style.textColor }}
          >
            Add your first slide block.
          </div>
        ) : (
          groups.map((group, i) => (
            <div
              className={`slide-preview ${style.id}`}
              key={group[0].id}
              style={{ background: style.background, color: style.textColor }}
            >
              <div className="slide-meta">
                <span>{project.title}</span>
                <span>{String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="slide-content">
                {group.map((b) => (
                  <div
                    className={
                      active === b.id && select ? "selected-block" : ""
                    }
                    key={b.id}
                    onClick={() => select?.(b.id)}
                    tabIndex={select ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") select?.(b.id);
                    }}
                  >
                    {renderBlock(b)}
                  </div>
                ))}
              </div>
              <div className="slide-footer">MAKEBORNE / MANUALLY AUTHORED</div>
            </div>
          ))
        )}
      </div>
    );
  }
  if (project.kind === "website") {
    const sections: { heading?: Block; blocks: Block[] }[] = [];
    for (const block of project.blocks) {
      if (block.type === "heading" || !sections.length)
        sections.push({
          heading: block.type === "heading" ? block : undefined,
          blocks: block.type === "heading" ? [] : [block],
        });
      else sections[sections.length - 1].blocks.push(block);
    }
    const hero = sections[0];
    const heroImage = hero?.blocks.find((block) => block.type === "image");
    return (
      <div
        className={`site-preview ${width === "mobile" ? "mobile" : ""} ${style.id}`}
        style={css}
      >
        <nav aria-label="Website preview navigation">
          <strong>{project.title}</strong>
          <span>
            {sections.slice(1, 4).map((section, index) => (
              <a
                key={section.heading?.id || index}
                href={`#site-section-${index}`}
              >
                {section.heading?.text || `Section ${index + 1}`}
              </a>
            ))}
            <a href="#site-contact">Contact</a>
          </span>
        </nav>
        <main className="site-layout-content" id="site-content">
          <section
            className={`authored-site-hero ${heroImage ? "has-image" : ""}`}
          >
            <div className="authored-site-hero-copy">
              <span className="artifact-direction-label">{style.name}</span>
              {hero?.heading ? (
                editableBlock(
                  hero.heading,
                  <h1>{hero.heading.text || project.title}</h1>,
                )
              ) : (
                <h1>{project.title}</h1>
              )}
              {hero?.blocks
                .filter((block) => block !== heroImage)
                .map((block) => editableBlock(block))}
            </div>
            {heroImage && (
              <div className="authored-site-hero-art">
                {editableBlock(heroImage)}
              </div>
            )}
          </section>
          {sections.slice(1).map((section, index) => (
            <section
              className="authored-site-section"
              id={`site-section-${index}`}
              key={section.heading?.id || index}
            >
              <div className="authored-site-section-heading">
                {section.heading && editableBlock(section.heading)}
              </div>
              <div className="authored-site-section-body">
                {section.blocks.map((block) => editableBlock(block))}
              </div>
            </section>
          ))}
        </main>
        <div className="site-contact" id="site-contact">
          <h3>Let’s start a conversation.</h3>
          <p>A live contact form requires a configured destination.</p>
          <label>
            Email
            <input type="email" placeholder="you@example.com" disabled />
          </label>
          <button disabled>Contact form not connected</button>
        </div>
        <footer>{project.title} · Local content preview</footer>
      </div>
    );
  }
  const coverImage =
    project.blocks[0]?.type === "image" ? project.blocks[0] : undefined;
  const chapters = project.blocks.filter((block) => block.type === "heading");
  return (
    <div className={`book-preview ${style.id}`} style={css}>
      <section
        className={`authored-book-cover ${coverImage ? "has-image" : ""}`}
        aria-label="Book cover"
      >
        <span className="artifact-direction-label">{style.name}</span>
        <h1>{project.title}</h1>
        {coverImage && (
          <div className="authored-book-cover-art">
            {editableBlock(coverImage)}
          </div>
        )}
        <div className="authored-book-cover-rule" />
      </section>
      {chapters.length > 1 && (
        <section className="authored-book-contents" aria-label="Book contents">
          <h2>Contents</h2>
          <ol>
            {chapters.map((chapter) => (
              <li key={chapter.id}>
                {select ? (
                  <button type="button" onClick={() => select(chapter.id)}>
                    {chapter.text || "Untitled chapter"}
                  </button>
                ) : (
                  <a href={`#chapter-${chapter.id}`}>
                    {chapter.text || "Untitled chapter"}
                  </a>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      <div className="book-running">
        {project.title}
        <span>CONTENT PREVIEW</span>
      </div>
      <div className="authored-book-body">
        {project.blocks
          .filter((block) => block !== coverImage)
          .map((block) => (
            <div
              id={block.type === "heading" ? `chapter-${block.id}` : undefined}
              className={
                block.type === "heading" ? "authored-book-chapter" : ""
              }
              key={block.id}
            >
              {editableBlock(block)}
            </div>
          ))}
      </div>
      <div className="book-page-end">MAKEBORNE / MANUALLY AUTHORED CONTENT</div>
    </div>
  );
}

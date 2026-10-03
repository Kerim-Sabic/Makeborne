"use client";
import "@/app/studio-refresh.css";
import { z } from "zod";
import Link from "next/link";
import BrandMark from "./brand-mark";
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
  type Kind,
  type Block,
  type Client,
  type Style,
  type Project,
  type Workspace,
} from "./studio-model";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import WebsiteSections from "./website-sections";
import TemplateGallery from "./template-gallery";
import ClientWorkspace from "./client-workspace";
import { readStudioRoute, studioHref, studioTab, type StudioRoute } from "@/lib/studio-navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen as BookOpenIcon,
  Check,
  ChevronDown,
  Cloud as CloudIcon,
  Download,
  FileText,
  FolderOpen,
  Globe,
  ImagePlus,
  Menu,
  MoreHorizontal,
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
  const [persistenceAllowed, setPersistenceAllowed] = useState(false);
  const [initialStyle, setInitialStyle] = useState("editorial");
  const [initialBrief, setInitialBrief] = useState("");
  const [initialTitle, setInitialTitle] = useState("");
  const [initialClient, setInitialClient] = useState("");
  const [draftBrief, setDraftBrief] = useState("");
  const [draftKind, setDraftKind] = useState<Kind>("website");
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
  const [mobileNav, setMobileNav] = useState(false);
  const [clientDetail, setClientDetail] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
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
        setTab(route.tab); setSelected(route.projectId); setClientDetail(route.clientId);
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
              })
              .strict()
              .safeParse(JSON.parse(raw));
            if (draft.success && draft.data.kind === kind) {
              setInitialBrief(draft.data.brief);
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
    setTab(route.tab); setSelected(route.projectId); setClientDetail(route.clientId);
    // Keep unsaved client/style forms mounted when the underlying route changes.
    setCreating(null); setInitialClient(""); setMobileNav(false);
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
        localStorage.setItem(storageKey, JSON.stringify(workspace));
      } catch {
        queueMicrotask(() =>
          setNotice(
            "This browser could not save your changes. Download a workspace backup now.",
          ),
        );
      }
  }, [workspace, loaded, persistenceAllowed]);
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
  function openRoute(route: StudioRoute, replace = false) {
    const href = studioHref(route);
    if (window.location.pathname + window.location.search !== href)
      window.history[replace ? "replaceState" : "pushState"](null, "", href);
    setTab(route.tab);
    setSelected(route.projectId);
    setClientDetail(route.clientId);
    setMobileNav(false);
  }
  function navigate(name: string) {
    openRoute({ tab: studioTab(name), projectId: null, clientId: null });
  }
  function createProject(values: {
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
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(nextWorkspace));
    } catch {
      toast(
        "This browser could not save the project. Your creation draft remains available; download a backup from Settings.",
      );
      return false;
    }
    setWorkspace(nextWorkspace);
    openRoute({ tab: "projects", projectId: p.id, clientId: null });
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
      setWorkspace(data);
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

  return (
    <div className="studio-shell">
      <aside
        id="studio-navigation"
        className={`sidebar ${mobileNav ? "open" : ""}`}
      >
        <Link className="wordmark" href="/">
          <BrandMark size={27} />
          Makeborne
        </Link>
        <button
          className="workspace-switch"
          onClick={() => navigate("settings")}
          aria-label="Manage local workspace"
        >
          <span className="workspace-initial">M</span>
          <span>
            My studio<small>Local workspace</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <button
          className="button primary create-button"
          onClick={() => setCreating("website")}
        >
          <Plus size={18} /> Create something
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav className="studio-nav">
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
                onClick={() => navigate(String(id))}
              >
                <I size={18} />
                {String(label)}
                {id === "projects" && workspace.projects.length > 0 && (
                  <span>{workspace.projects.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-notice">
            <span className="status-dot" />
            <strong>Your work, on this device.</strong>
            <p>Saved in this browser. Export a backup to keep it safe.</p>
          </div>
          <button
            className={`sidebar-settings ${tab === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings size={18} /> Settings
          </button>
          <Link className="sidebar-home" href="/studio/cloud">
            <CloudIcon size={15} /> Cloud studio <ArrowUpRight size={14} />
          </Link>
          <Link className="sidebar-home" href="/">
            Back to Makeborne <ArrowUpRight size={14} />
          </Link>
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
            My studio <span>/</span>{" "}
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
          <span className="local-pill">
            <span className="status-dot" /> Local preview
          </span>
          <span className="avatar">M</span>
        </header>
        {loaded && !persistenceAllowed && (
          <div className="notice" role="alert">
            Saving is paused to protect unreadable original data. Download
            recovery data and restore a valid backup in Settings.
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
            back={() => navigate("projects")}
            notify={toast}
          />
        ) : (
          <div
            className={`workspace-content ${tab === "projects" && workspace.projects.length === 0 ? "fresh-workspace" : ""}`}
          >
            {tab === "projects" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">YOUR CREATION STUDIO</div>
                    <h1>What will you make next?</h1>
                    <p>Your ideas, projects, and clients. All in one place.</p>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => setCreating("website")}
                  >
                    <Plus size={17} /> New project
                  </button>
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
                    <span>
                      <Sparkles size={14} /> Set the direction. Keep control of
                      the details.
                    </span>
                    <button
                      className="button primary"
                      aria-label="Continue with this brief"
                      onClick={() => {
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
                {workspace.projects.length === 0 ? (
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
                )}
                {workspace.projects.length === 0 && (
                  <TemplateGallery onChoose={chooseDirection} />
                )}
              </>
            )}
            {tab === "clients" && (
              <ClientWorkspace
                clients={workspace.clients}
                projects={workspace.projects}
                selectedClientId={clientDetail}
                onSelectClient={(id) => openRoute({ tab: "clients", projectId: null, clientId: id })}
                onEditClient={setClientModal}
                onAddClient={() => setClientModal("new")}
                onOpenProject={(id) => openRoute({ tab: "projects", projectId: id, clientId: null })}
                onCreateProject={(clientId) => {
                  setInitialClient(clientId);
                  setHomeHandoff(false);
                  setInitialBrief(""); setInitialTitle(""); setInitialStyle("editorial");
                  setCreating("website");
                }}
              />
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
                              chooseDirection("website", "", style.id)
                            }
                          >
                            <span
                              className="saved-style-swatch"
                              style={{ background: style.color }}
                            />
                            <span>
                              <strong>{style.name}</strong>
                              <small>{style.description}</small>
                            </span>
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
                    <h2>Cloud services</h2>
                    <p>
                      Cloud accounts are available through the separate Cloud
                      studio when configured. Live AI generation, client
                      sharing, custom domains, and payments require configured
                      integrations. This local preview does not claim those
                      services are active.
                    </p>
                  </section>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {creating && (
        <CreateModal
          initialClient={initialClient}
          initialStyle={initialStyle}
          initialBrief={initialBrief}
          initialTitle={initialTitle}
          kind={creating}
          onKind={setCreating}
          clients={workspace.clients}
          styles={workspace.styles}
          close={() => { setCreating(null); setInitialClient(""); }}
          create={createProject}
        />
      )}
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
            try { localStorage.setItem(storageKey, JSON.stringify(next.data)); }
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
    seed: z.string().max(100),
    kind: z.enum(["website", "book", "presentation"]),
    step: z.number().int().min(1).max(3),
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

function CreateModal({
  initialClient,
  initialBrief,
  initialTitle,
  initialStyle,
  kind,
  onKind,
  clients,
  styles,
  close,
  create,
}: {
  initialClient: string;
  initialBrief: string;
  initialTitle: string;
  initialStyle: string;
  kind: Kind;
  onKind: (k: Kind) => void;
  clients: Client[];
  styles: Style[];
  close: () => void;
  create: (v: {
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
  const [step, setStep] = useState(initialBrief.trim() ? 2 : 1);
  const wizardContent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    wizardContent.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);
  const [title, setTitle] = useState(
    initialTitle || (initialBrief.trim() ? `Untitled ${kind}` : ""),
  );
  const [brief, setBrief] = useState(initialBrief);
  const [content, setContent] = useState("");
  const [audience, setAudience] = useState("");
  const [purpose, setPurpose] = useState("");
  const [wording, setWording] = useState("preserve");
  const [styleId, setStyle] = useState(initialStyle);
  const [clientId, setClient] = useState(initialClient);
  const [seed] = useState(() =>
    creationSeed(initialBrief, initialTitle, initialStyle + (initialClient ? `::${initialClient}` : "")),
  );
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftWritable, setDraftWritable] = useState(true);
  const [draftNotice, setDraftNotice] = useState("");
  const draftKey = (draftKind: Kind) =>
    `makeborne.wizard-draft.v1.${draftKind}.${seed}`;
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = sessionStorage.getItem(
          `makeborne.wizard-draft.v1.${kind}.${seed}`,
        );
        if (raw) {
          if (raw.length > 200000) throw new Error("Draft too large");
          const parsed = WizardDraftSchema.safeParse(JSON.parse(raw));
          if (
            !parsed.success ||
            parsed.data.seed !== seed ||
            parsed.data.kind !== kind
          )
            throw new Error("Invalid draft");
          const draft = parsed.data;
          setStep(draft.step);
          setTitle(draft.title);
          setBrief(draft.brief);
          setContent(draft.content);
          setAudience(draft.audience);
          setPurpose(draft.purpose);
          setWording(draft.wording);
          if (styles.some((style) => style.id === draft.styleId))
            setStyle(draft.styleId);
          setClient(
            clients.some((client) => client.id === draft.clientId)
              ? draft.clientId
              : "",
          );
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
      sessionStorage.setItem(
        `makeborne.wizard-draft.v1.${kind}.${seed}`,
        JSON.stringify(draft),
      );
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
  ]);
  const selectedStyle =
    styles.find((style) => style.id === styleId) || styles[0];
  return (
    <Modal close={close} title="Create a project">
      <div className="wizard-content" ref={wizardContent}>
        <div className="eyebrow">
          {["", "SOURCE", "DIRECTION", "STYLE"][step]} · STEP {step} OF 3
        </div>
        <h2>
          {step === 1
            ? "What are we making?"
            : step === 2
              ? "Give it a direction."
              : "Choose its character."}
        </h2>
        <p className="modal-intro">
          {step === 1
            ? "Start with what you know. You can refine everything later."
            : step === 2
              ? "A clear brief makes thoughtful work possible."
              : "These authored styles are a starting point, not a limit."}
        </p>
        {draftNotice && (
          <p className="wizard-draft-notice" role="status">
            {draftNotice}
          </p>
        )}
        <div className="step-track">
          <span className={step >= 1 ? "active" : ""} />
          <span className={step >= 2 ? "active" : ""} />
          <span className={step >= 3 ? "active" : ""} />
        </div>
        {step === 1 ? (
          <>
            <div className="format-picker">
              {(["website", "book", "presentation"] as Kind[]).map((k) => {
                const Icon = icons[k];
                return (
                  <button
                    className={kind === k ? "selected" : ""}
                    aria-pressed={kind === k}
                    key={k}
                    onClick={() => onKind(k)}
                  >
                    <Icon size={22} />
                    {kindLabel[k]}
                  </button>
                );
              })}
            </div>
            <label>
              Project title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  kind === "website"
                    ? "e.g. Website for your next client"
                    : kind === "book"
                      ? "e.g. The practical photography guide"
                      : "e.g. A workshop worth remembering"
                }
                maxLength={160}
              />
            </label>
            <label>
              Client
              <select
                value={clientId}
                onChange={(e) => setClient(e.target.value)}
              >
                <option value="">For myself</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Your material
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Paste your text here. Separate sections with a blank line, or start with a title and write in the editor."
                rows={5}
                maxLength={50000}
              />
            </label>
            <label>
              How should AI handle your wording?
              <select
                value={wording}
                onChange={(e) => setWording(e.target.value)}
              >
                <option value="preserve">Preserve my wording</option>
                <option value="improve">Improve my wording</option>
                <option value="summarise">Summarise my material</option>
              </select>
            </label>
          </>
        ) : step === 2 ? (
          <>
            <label>
              What should this project achieve?
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Describe the idea, what matters, and what the finished work should do."
                rows={5}
                maxLength={20000}
              />
            </label>
            <div className="form-grid">
              <label>
                Who is it for?
                <input
                  value={audience}
                  maxLength={5000}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder="e.g. First-time founders"
                />
              </label>
              <label>
                Intended outcome
                <input
                  value={purpose}
                  maxLength={5000}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g. Book a consultation"
                />
              </label>
            </div>
            <div className="inline-info">
              <Sparkles size={18} />
              <p>
                Your brief is saved for later generation. Live AI is not enabled
                in this preview; no content will be invented automatically.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="style-picker">
              {styles.map((s) => (
                <button
                  key={s.id}
                  className={styleId === s.id ? "selected" : ""}
                  aria-pressed={styleId === s.id}
                  onClick={() => setStyle(s.id)}
                >
                  <span
                    className="style-chip"
                    style={{ background: s.color }}
                  />
                  <strong>{s.name}</strong>
                  <small>{s.description}</small>
                  {styleId === s.id && <Check size={16} />}
                </button>
              ))}
            </div>
            <div
              className="theme-live-preview"
              style={{
                background: selectedStyle?.background || "#ffffff",
                color: selectedStyle?.textColor || "#171717",
                fontFamily:
                  selectedStyle?.font === "serif"
                    ? "var(--font-serif), Georgia, serif"
                    : "var(--font-inter), Arial, sans-serif",
              }}
            >
              <span
                className="theme-preview-label"
                style={{ color: selectedStyle?.color }}
              >
                YOUR SELECTED DIRECTION · {kindLabel[kind]}
              </span>
              <h3>{title || `Untitled ${kind}`}</h3>
              <p>
                A clear headline, thoughtful spacing, and content that feels
                like you.
              </p>
              <div
                className="theme-preview-rule"
                style={{ background: selectedStyle?.color }}
              />
              <small>
                Palette and typography preview. Your own content appears in the
                editor.
              </small>
            </div>
            <div className="creation-summary">
              <span className="eyebrow">YOUR STARTING POINT</span>
              <strong>{title || "Untitled project"}</strong>
              <p>
                {kindLabel[kind]} ·{" "}
                {clients.find((c) => c.id === clientId)?.name ||
                  "Personal project"}{" "}
                · {styles.find((s) => s.id === styleId)?.name}
              </p>
              <p>
                {content
                  ? "Your supplied content will be added to the editor."
                  : "Start with a title and add your own content."}
              </p>
            </div>
          </>
        )}
      </div>
      <div className="modal-actions">
        <button
          className="button secondary"
          onClick={() => (step === 1 ? close() : setStep(step - 1))}
        >
          {step === 1 ? "Cancel" : "Back"}
        </button>
        <button
          className="button primary"
          disabled={!title.trim() || !draftLoaded}
          onClick={() => {
            if (step < 3) {
              setStep(step + 1);
              return;
            }
            const saved = create({
              kind,
              title: title.trim(),
              brief,
              audience,
              purpose,
              wording,
              styleId,
              clientId,
              content,
            });
            if (saved) {
              try {
                (["website", "book", "presentation"] as Kind[]).forEach(
                  (format) => sessionStorage.removeItem(draftKey(format)),
                );
              } catch {
                /* A retained draft is safe; the created project is saved. */
              }
            }
          }}
        >
          {step === 3 ? "Create project" : "Continue"}
          <ArrowRight size={16} />
        </button>
      </div>
    </Modal>
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
  notify: (s: string) => void;
}) {
  const [bookAuthor, setBookAuthor] = useState("");
  const [bookLanguage, setBookLanguage] = useState("en");
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
                            "Restore this content snapshot? The current content will remain available through Undo.",
                          )
                        ) {
                          change(structuredClone(v.blocks));
                          notify("Saved content snapshot restored.");
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
                      onChange={(e) =>
                        update({
                          ...project,
                          purpose: e.target.value,
                          updatedAt: now(),
                        })
                      }
                    />
                  </label>
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
                        onChange={(e) => setBookLanguage(e.target.value)}
                      >
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
                        onChange={(e) => setBookAuthor(e.target.value)}
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

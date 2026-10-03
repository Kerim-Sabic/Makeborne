"use client";
import Link from "next/link";
import BrandMark from "./brand-mark";
import {
  LocalWorkspaceSchema,
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
import { useEffect, useRef, useState } from "react";
import WebsiteSections from "./website-sections";
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
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = LocalWorkspaceSchema.safeParse(JSON.parse(saved));
          if (parsed.success) {
            setWorkspace(parsed.data);
            setPersistenceAllowed(true);
          } else {
            setTab("settings");
            setNotice(
              "Your saved workspace could not be loaded. Its original browser data is preserved; download the original data from Settings.",
            );
          }
        } else setPersistenceAllowed(true);
      } catch {
        setTab("settings");
        setNotice(
          "Your saved workspace could not be read. Its original data has not been overwritten.",
        );
      }
      setLoaded(true);
      const kind = new URLSearchParams(window.location.search).get("create");
      if (kind === "book" || kind === "website" || kind === "presentation")
        setCreating(kind);
    });
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
  function mutateProject(p: Project) {
    setWorkspace((w) => ({
      ...w,
      projects: w.projects.map((x) => (x.id === p.id ? p : x)),
    }));
  }
  function toast(text: string) {
    setNotice(text);
  }
  function navigate(name: string) {
    setTab(name);
    setSelected(null);
    setClientDetail(null);
    setMobileNav(false);
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
    setWorkspace((w) => ({ ...w, projects: [p, ...w.projects] }));
    setSelected(p.id);
    setTab("projects");
    setCreating(null);
    toast(
      "Project created. Your supplied content is ready to edit. No AI generation was performed.",
    );
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
      setSelected(null);
      toast("Workspace backup restored on this device.");
    } catch {
      toast("This is not a valid Makeborne workspace backup.");
    }
  }
  return (
    <div className="studio-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
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
            back={() => setSelected(null)}
            notify={toast}
          />
        ) : (
          <div className="workspace-content">
            {tab === "projects" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">YOUR CREATION STUDIO</div>
                    <h1>A place for your next idea.</h1>
                    <p>
                      Bring your work together. Make something you’re proud to
                      share.
                    </p>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => setCreating("website")}
                  >
                    <Plus size={17} /> New project
                  </button>
                </div>
                <div className="quick-create">
                  {(["website", "book", "presentation"] as Kind[]).map(
                    (kind) => {
                      const Icon = icons[kind];
                      return (
                        <button key={kind} onClick={() => setCreating(kind)}>
                          <span className={`format-icon ${kind}`}>
                            <Icon size={23} />
                          </span>
                          <span>
                            <strong>{kindLabel[kind]}</strong>
                            <small>
                              {kind === "website"
                                ? "Build a home for a business."
                                : kind === "book"
                                  ? "Give your knowledge a shape."
                                  : "Make your ideas land."}
                            </small>
                          </span>
                          <ArrowUpRight size={18} />
                        </button>
                      );
                    },
                  )}
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
                    title="The beginning of something good."
                    text="Your first project starts with an idea, a brief, or something you’ve already written."
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
                            onClick={() => setSelected(p.id)}
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
              </>
            )}
            {tab === "clients" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">WORK, WITH PEOPLE</div>
                    <h1>
                      {clientDetail
                        ? workspace.clients.find((c) => c.id === clientDetail)
                            ?.name
                        : "Keep your clients close."}
                    </h1>
                    <p>
                      One place for their projects, details, and what happens
                      next.
                    </p>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => setClientModal("new")}
                  >
                    <Plus size={17} /> Add client
                  </button>
                </div>
                {clientDetail ? (
                  <>
                    <button
                      className="text-link"
                      onClick={() => setClientDetail(null)}
                    >
                      <ArrowLeft size={16} /> All clients
                    </button>
                    <div className="client-profile">
                      <div>
                        <span className="eyebrow">CLIENT DETAILS</span>
                        <h2>
                          {workspace.clients.find((c) => c.id === clientDetail)
                            ?.company || "Independent client"}
                        </h2>
                        <p>
                          {workspace.clients.find((c) => c.id === clientDetail)
                            ?.email || "No email added"}
                        </p>
                        <p>
                          {
                            workspace.clients.find((c) => c.id === clientDetail)
                              ?.website
                          }
                        </p>
                        <p>
                          {workspace.clients.find((c) => c.id === clientDetail)
                            ?.notes || "No notes added."}
                        </p>
                        <button
                          className="button secondary"
                          onClick={() =>
                            setClientModal(
                              workspace.clients.find(
                                (c) => c.id === clientDetail,
                              )!,
                            )
                          }
                        >
                          Edit details
                        </button>
                      </div>
                      <div>
                        <span className="eyebrow">CONNECTED PROJECTS</span>
                        {workspace.projects.filter(
                          (p) => p.clientId === clientDetail,
                        ).length === 0 ? (
                          <p>
                            No projects linked yet. Choose this client when
                            creating a project.
                          </p>
                        ) : (
                          workspace.projects
                            .filter((p) => p.clientId === clientDetail)
                            .map((p) => (
                              <button
                                className="client-project"
                                key={p.id}
                                onClick={() => {
                                  setSelected(p.id);
                                  setTab("projects");
                                }}
                              >
                                <span>
                                  <strong>{p.title}</strong>
                                  <small>
                                    {kindLabel[p.kind]} ·{" "}
                                    {p.status.replace("_", " ")} · Updated{" "}
                                    {date(p.updatedAt)}
                                  </small>
                                </span>
                                <ArrowRight size={18} />
                              </button>
                            ))
                        )}
                      </div>
                    </div>
                    <h2 className="subheading">Recent activity</h2>
                    <div className="activity-list">
                      {workspace.projects
                        .filter((p) => p.clientId === clientDetail)
                        .flatMap((p) =>
                          p.activity.map((a) => ({ ...a, project: p.title })),
                        )
                        .sort((a, b) => b.at.localeCompare(a.at))
                        .map((a, i) => (
                          <div key={i}>
                            <span className="timeline-dot" />
                            <div>
                              <strong>{a.text}</strong>
                              <p>
                                {a.project} · {new Date(a.at).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        ))}
                    </div>
                  </>
                ) : workspace.clients.length === 0 ? (
                  <Empty
                    icon={Users}
                    title="Every client deserves a clear picture."
                    text="Save their details and connect every website, book, and presentation to the right person."
                    action="Add your first client"
                    onClick={() => setClientModal("new")}
                  />
                ) : (
                  <div className="client-grid">
                    {workspace.clients.map((c) => (
                      <button
                        className="client-card"
                        key={c.id}
                        onClick={() => setClientDetail(c.id)}
                      >
                        <div className="client-card-top">
                          <span className="client-avatar">
                            {c.name.slice(0, 2).toUpperCase()}
                          </span>
                          <ArrowUpRight size={18} />
                        </div>
                        <h3>{c.name}</h3>
                        <p>{c.company || "Independent client"}</p>
                        <div className="client-card-meta">
                          <span>
                            {
                              workspace.projects.filter(
                                (p) => p.clientId === c.id,
                              ).length
                            }{" "}
                            projects
                          </span>
                          <span>
                            {
                              workspace.projects.filter(
                                (p) =>
                                  p.clientId === c.id && p.kind === "website",
                              ).length
                            }{" "}
                            websites
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {tab === "styles" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">A CLEAR CREATIVE DIRECTION</div>
                    <h1>Find your point of view.</h1>
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
                <div className="style-grid">
                  {workspace.styles.map((s) => (
                    <article className="style-card" key={s.id}>
                      <div
                        className={`style-sample ${s.id}`}
                        style={
                          { "--style-color": s.color } as React.CSSProperties
                        }
                      >
                        <span>MAKEBORNE / {s.name.toUpperCase()}</span>
                        <h2
                          style={{
                            fontFamily:
                              s.font === "serif"
                                ? "var(--font-serif)"
                                : "var(--font-inter)",
                          }}
                        >
                          A different
                          <br />
                          <em>kind of good.</em>
                        </h2>
                        <div className="style-shape" />
                      </div>
                      <div>
                        <h3>{s.name}</h3>
                        <p>{s.description}</p>
                        <button
                          className="text-link"
                          onClick={() => {
                            setInitialStyle(s.id);
                            setCreating("website");
                          }}
                        >
                          Start with this direction <ArrowRight size={16} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
            {tab === "settings" && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">MAKE YOURSELF AT HOME</div>
                    <h1>Your workspace, your way.</h1>
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
          initialStyle={initialStyle}
          kind={creating}
          onKind={setCreating}
          clients={workspace.clients}
          styles={workspace.styles}
          close={() => setCreating(null)}
          create={createProject}
        />
      )}
      {clientModal && (
        <ClientModal
          existing={clientModal === "new" ? null : clientModal}
          close={() => setClientModal(null)}
          save={(c) => {
            setWorkspace((w) => ({
              ...w,
              clients: w.clients.some((x) => x.id === c.id)
                ? w.clients.map((x) => (x.id === c.id ? c : x))
                : [c, ...w.clients],
            }));
            setClientModal(null);
            toast("Client details saved on this device.");
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
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    ref.current
      ?.querySelector<HTMLElement>("button,input,textarea,select")
      ?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          "button,input,textarea,select,a[href]",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
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
  }, [close]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
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
function CreateModal({
  initialStyle,
  kind,
  onKind,
  clients,
  styles,
  close,
  create,
}: {
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
  }) => void;
}) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [content, setContent] = useState("");
  const [audience, setAudience] = useState("");
  const [purpose, setPurpose] = useState("");
  const [wording, setWording] = useState("preserve");
  const [styleId, setStyle] = useState(initialStyle);
  const [clientId, setClient] = useState("");
  return (
    <Modal close={close} title="Create a project">
      <div className="eyebrow">A NEW POSSIBILITY · STEP {step} OF 3</div>
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
              maxLength={6000}
            />
          </label>
          <div className="form-grid">
            <label>
              Who is it for?
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. First-time founders"
              />
            </label>
            <label>
              Intended outcome
              <input
                value={purpose}
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
                onClick={() => setStyle(s.id)}
              >
                <span className="style-chip" style={{ background: s.color }} />
                <strong>{s.name}</strong>
                <small>{s.description}</small>
                {styleId === s.id && <Check size={16} />}
              </button>
            ))}
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
      <div className="modal-actions">
        <button
          className="button secondary"
          onClick={() => (step === 1 ? close() : setStep(step - 1))}
        >
          {step === 1 ? "Cancel" : "Back"}
        </button>
        <button
          className="button primary"
          disabled={!title.trim()}
          onClick={() =>
            step < 3
              ? setStep(step + 1)
              : create({
                  kind,
                  title: title.trim(),
                  brief,
                  audience,
                  purpose,
                  wording,
                  styleId,
                  clientId,
                  content,
                })
          }
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
  save: (c: Client) => void;
}) {
  const [name, setName] = useState(existing?.name || "");
  const [company, setCompany] = useState(existing?.company || "");
  const [email, setEmail] = useState(existing?.email || "");
  const [website, setWebsite] = useState(existing?.website || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  return (
    <Modal close={close} title="Client details">
      <span className="eyebrow">CLIENT RELATIONSHIPS</span>
      <h2>{existing ? "A little more detail." : "Make room for a client."}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({
            id: existing?.id || uid(),
            name: name.trim(),
            company,
            email,
            website,
            notes,
            createdAt: existing?.createdAt || now(),
          });
        }}
      >
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
  update: (p: Project) => void;
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
      change([...project.blocks, b]);
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
                            editBlock({ type: e.target.value as Block["type"] })
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
          <div className="slide-preview">Add your first slide block.</div>
        ) : (
          groups.map((group, i) => (
            <div className={`slide-preview ${style.id}`} key={group[0].id}>
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
  if (project.kind === "website")
    return (
      <div
        className={`site-preview ${width === "mobile" ? "mobile" : ""} ${style.id}`}
        style={css}
      >
        <nav>
          <strong>{project.title}</strong>
          <span>
            <a href="#site-content">Explore</a> &nbsp;{" "}
            <a href="#site-contact">Contact</a>
          </span>
        </nav>
        <div className="site-blocks" id="site-content">
          {project.blocks.map((b) => (
            <div
              className={active === b.id && select ? "selected-block" : ""}
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
  return (
    <div className={`book-preview ${style.id}`} style={css}>
      <div className="book-running">
        {project.title}
        <span>CONTENT PREVIEW</span>
      </div>
      {project.blocks.map((b) => (
        <div
          className={active === b.id && select ? "selected-block" : ""}
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
      <div className="book-page-end">MAKEBORNE / MANUALLY AUTHORED CONTENT</div>
    </div>
  );
}

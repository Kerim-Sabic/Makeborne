"use client";
import Link from "next/link";
import BrandMark from "./brand-mark";
import PendingCloudWrites from "./pending-cloud-writes";
import CloudClientOutreach from "./cloud-client-outreach";
import AccountExport from "./account-export";
import AccountPreview from "./account-preview";
import AccountStyleEditor from "./account-style-editor";
import { prepareVersionRestore } from "@/lib/cloud/version-restore";
import { moveAccountBlock, removeAccountBlock, restoreAccountBlock, type RemovedAccountBlock } from "@/lib/cloud/block-actions";
import { accountStyleFromStudio } from "@/lib/cloud/editor-bridge";
import { canAutosave, settleAccountSave } from "@/lib/cloud/autosave";
import { api, CloudError, setCloudAccount } from "./cloud-api";
import { useCallback, useEffect, useEffectEvent, useState, useRef } from "react";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Trash2,
  Undo2,
  ArrowRight,
  Cloud,
  FileText,
  FolderOpen,
  LogOut,
  Plus,
  Save,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { z } from "zod";
import {
  ArtifactContentSchema,
  StyleProfileSchema,
  type ArtifactContent,
  type ArtifactVersion,
  type Client,
  type Project,
  type StyleProfile,
} from "@/lib/domain";
import {
  type CloudClient,
  CloudProjectCreateSchema,
} from "@/lib/cloud/contracts";
import {
  baseStyles,
  LocalWorkspaceSchema,
  storageKey,
  type Workspace as LocalWorkspace,
} from "./studio-model";
type WorkspaceSummary = {
  id: string;
  name: string;
  role: "owner" | "editor" | "reviewer";
};
type CloudArtifact = {
  id: string;
  projectId: string;
  title: string;
  kind: "book" | "website" | "presentation";
  currentVersion: number;
  updatedAt: string;
};
type Collection = "clients" | "projects" | "artifacts";
type CloudOverview = {
  workspace: WorkspaceSummary;
  clients: CloudClient[];
  projects: Project[];
  artifacts: CloudArtifact[];
  pagination?: Record<
    Collection,
    { offset: number; total: number; nextOffset: number | null }
  >;
};
type State = "checking" | "unavailable" | "signedout" | "ready";
export default function CloudStudio() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [state, setState] = useState<State>("checking");
  const [message, setMessage] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [overview, setOverview] = useState<CloudOverview | null>(null);
  const createBusy = useRef(false);
  const [uncertainCreation, setUncertainCreation] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"projects" | "clients">("projects");
  const [projectTitle, setProjectTitle] = useState("");
  const [kind, setKind] = useState<"website" | "book" | "presentation">(
    "website",
  );
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [editingClient, setEditingClient] = useState<CloudClient | null>(null);
  const [outreachClient, setOutreachClient] = useState<CloudClient | null>(null);
  const clientLoadVersion = useRef(0);
  const [loadingClient, setLoadingClient] = useState(false);
  const [selected, setSelected] = useState<CloudArtifact | null>(null);
  const [importPreview, setImportPreview] = useState<LocalWorkspace | null>(
    null,
  );
  const [importProjectId, setImportProjectId] = useState("");
  const [importLog, setImportLog] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    fetch("/api/capabilities", { cache: "no-store" })
      .then((r) => r.json())
      .then(async (c) => {
        if (!active) return;
        if (!c.cloudWorkspace?.available) {
          setState("unavailable");
          setMessage(
            c.cloudWorkspace?.reason || "Cloud workspace is not enabled.",
          );
          return;
        }
        try {
          const { data, error } = await createClient().auth.getUser();
          if (!active) return;
          if (error || !data.user) {
            setState("signedout");
            return;
          }
          setCloudAccount(data.user.id);
          setAccountId(data.user.id);
          const result = await api<{ workspaces: WorkspaceSummary[] }>(
            "/api/workspaces",
          );
          if (active) {
            setWorkspaces(result.workspaces);
            setState("ready");
          }
        } catch (error) {
          if (active) {
            setState("unavailable");
            setMessage(
              error instanceof Error
                ? error.message
                : "Cloud access could not be verified.",
            );
          }
        }
      })
      .catch(() => {
        if (active) {
          setState("unavailable");
          setMessage("Could not verify cloud availability.");
        }
      });
    return () => {
      active = false;
    };
  }, []);
  async function choose(id: string) {
    clientLoadVersion.current += 1;
    setLoadingClient(false);
    setBusy(true);
    setSelected(null);
    setEditingClient(null);
    setOutreachClient(null);
    setMessage("");
    try {
      setOverview(await api<CloudOverview>(`/api/cloud/workspaces/${id}`));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Workspace could not load.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function openClient(id: string, view: "details" | "outreach") {
    if (!overview) return;
    const version = ++clientLoadVersion.current;
    setLoadingClient(true); setEditingClient(null); setOutreachClient(null);
    try {
      const result = await api<{ client: CloudClient }>(`/api/cloud/workspaces/${overview.workspace.id}/clients/${id}`);
      if (version !== clientLoadVersion.current) return;
      if (view === "outreach") setOutreachClient(result.client);
      else setEditingClient(result.client);
    } catch (error) {
      if (version === clientLoadVersion.current) setMessage(error instanceof Error ? error.message : "Could not load this client.");
    } finally {
      if (version === clientLoadVersion.current) setLoadingClient(false);
    }
  }
  async function loadMore(collection: Collection) {
    if (!overview) return;
    const offset = overview.pagination?.[collection]?.nextOffset;
    if (offset === null || offset === undefined) return;
    setBusy(true);
    try {
      const next = await api<CloudOverview>(
        `/api/cloud/workspaces/${overview.workspace.id}?${collection}Offset=${offset}`,
      );
      setOverview((current) => {
        if (!current || current.workspace.id !== next.workspace.id)
          return current;
        const merged = new Map(
          [...current[collection], ...next[collection]].map((item) => [
            item.id,
            item,
          ]),
        );
        return {
          ...current,
          [collection]: [...merged.values()],
          pagination: {
            ...current.pagination!,
            [collection]: next.pagination![collection],
          },
        };
      });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "More records could not load.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (createBusy.current || uncertainCreation) return;
    createBusy.current = true;
    setBusy(true);
    try {
      const result = await api<{ workspace: WorkspaceSummary }>(
        "/api/workspaces",
        { name: name.trim() },
      );
      setWorkspaces((w) => [...w, result.workspace]);
      setName("");
      await choose(result.workspace.id);
    } catch (error) {
      if (error instanceof CloudError && error.uncertain)
        setUncertainCreation(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Workspace could not be created.",
      );
    } finally {
      createBusy.current = false;
      setBusy(false);
    }
  }
  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!overview) return;
    if (createBusy.current || uncertainCreation) return;
    createBusy.current = true;
    setBusy(true);
    try {
      const result = await api<{ project: Project }>(
        `/api/cloud/workspaces/${overview.workspace.id}/projects`,
        {
          title: projectTitle,
          kind,
          clientId: clientId || null,
          styleId: "editorial",
          brief: "",
        },
      );
      const art = await api<{ artifact: CloudArtifact }>(
        `/api/cloud/workspaces/${overview.workspace.id}/projects/${result.project.id}/artifacts`,
        { title: result.project.title, kind },
      );
      await choose(overview.workspace.id);
      setSelected(art.artifact);
      setProjectTitle("");
    } catch (error) {
      if (error instanceof CloudError && error.uncertain)
        setUncertainCreation(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Project creation could not complete. Check the project list before retrying.",
      );
    } finally {
      createBusy.current = false;
      setBusy(false);
    }
  }
  async function setupContent(project: Project) {
    if (!overview) return;
    if (createBusy.current || uncertainCreation) return;
    createBusy.current = true;
    setBusy(true);
    try {
      const result = await api<{ artifact: CloudArtifact }>(
        `/api/cloud/workspaces/${overview.workspace.id}/projects/${project.id}/artifacts`,
        { title: project.title, kind: project.kind },
      );
      await choose(overview.workspace.id);
      setSelected(result.artifact);
    } catch (error) {
      if (error instanceof CloudError && error.uncertain)
        setUncertainCreation(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Content setup failed. Check the project before retrying.",
      );
    } finally {
      createBusy.current = false;
      setBusy(false);
    }
  }
  async function createClientRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!overview) return;
    if (createBusy.current || uncertainCreation) return;
    createBusy.current = true;
    setBusy(true);
    try {
      await api(`/api/cloud/workspaces/${overview.workspace.id}/clients`, {
        name: clientName,
        email: clientEmail,
        company: "",
        website: "",
        notes: "",
      });
      setClientName("");
      setClientEmail("");
      await choose(overview.workspace.id);
    } catch (error) {
      if (error instanceof CloudError && error.uncertain)
        setUncertainCreation(true);
      setMessage(
        error instanceof Error ? error.message : "Client could not be saved.",
      );
    } finally {
      createBusy.current = false;
      setBusy(false);
    }
  }
  async function logout() {
    clientLoadVersion.current += 1;
    setLoadingClient(false);
    setEditingClient(null); setOutreachClient(null);
    setBusy(true);
    try {
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
      setCloudAccount(null);
      setAccountId(null);
      setOverview(null);
      setSelected(null);
      setState("signedout");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign out failed.");
    } finally {
      setBusy(false);
    }
  }
  function previewImport() {
    try {
      const value = localStorage.getItem(storageKey);
      if (!value) {
        setMessage("There is no local workspace to import.");
        return;
      }
      const data = LocalWorkspaceSchema.parse(JSON.parse(value));
      setImportPreview(data);
      setImportProjectId(data.projects[0]?.id || "");
      setImportLog([]);
    } catch {
      setMessage(
        "Your local workspace could not be safely read. It has not been changed.",
      );
    }
  }
  async function importOne() {
    if (!overview || !importPreview) return;
    const local = importPreview.projects.find((p) => p.id === importProjectId);
    if (!local) return;
    if (
      !CloudProjectCreateSchema.safeParse({
        title: local.title,
        kind: local.kind,
        clientId: null,
        styleId: baseStyles.some((s) => s.id === local.styleId)
          ? local.styleId
          : "editorial",
        brief: local.brief,
        audience: local.audience,
        purpose: local.purpose,
        wording: local.wording,
      }).success
    ) {
      setMessage(
        "This local project exceeds supported cloud brief limits. Shorten its audience or purpose before importing. Nothing has been transferred.",
      );
      return;
    }
    if (local.blocks.some((b) => b.type === "image")) {
      setMessage(
        "This project contains inline artwork. Cloud artwork upload must be enabled before importing it; nothing has been imported.",
      );
      return;
    }
    if (
      new TextEncoder().encode(
        JSON.stringify({ blocks: local.blocks, brief: local.brief }),
      ).byteLength > 1_800_000
    ) {
      setMessage(
        "This project exceeds the cloud import size limit. Nothing has been transferred.",
      );
      return;
    }
    setBusy(true);
    const log: string[] = [];
    setImportLog([...log]);
    try {
      const reviewKey = `makeborne.import.${overview.workspace.id}.${local.id}`;
      if (localStorage.getItem(reviewKey)) {
        throw new Error(
          "This project already has an import record on this device. Review the recorded cloud project before importing again.",
        );
      }
      localStorage.setItem(
        reviewKey,
        JSON.stringify({
          startedAt: new Date().toISOString(),
          completed: false,
        }),
      );
      let mappedClient: string | null = null;
      const sourceClient = importPreview.clients.find(
        (c) => c.id === local.clientId,
      );
      if (sourceClient) {
        const existing = overview.clients.find(
          (c) =>
            c.email &&
            c.email === sourceClient.email &&
            c.name === sourceClient.name,
        );
        if (existing) mappedClient = existing.id;
        else {
          const {
            id: ignoredId,
            createdAt: ignoredDate,
            outreach: ignoredOutreach,
            ...fields
          } = sourceClient;
          void ignoredId;
          void ignoredDate;
          void ignoredOutreach;
          const saved = await api<{ client: Client }>(
            `/api/cloud/workspaces/${overview.workspace.id}/clients`,
            fields,
          );
          mappedClient = saved.client.id;
          log.push(`Created client: ${saved.client.name}`);
          setImportLog([...log]);
        }
      }
      const { project } = await api<{ project: Project }>(
        `/api/cloud/workspaces/${overview.workspace.id}/projects`,
        {
          title: local.title,
          kind: local.kind,
          clientId: mappedClient,
          styleId: baseStyles.some((s) => s.id === local.styleId)
            ? local.styleId
            : "editorial",
          brief: local.brief,
          audience: local.audience,
          purpose: local.purpose,
          wording: local.wording,
        },
      );
      localStorage.setItem(
        reviewKey,
        JSON.stringify({
          projectId: project.id,
          createdAt: new Date().toISOString(),
          completed: false,
        }),
      );
      log.push(`Created cloud project: ${project.title}`);
      setImportLog([...log]);
      const { artifact } = await api<{ artifact: CloudArtifact }>(
        `/api/cloud/workspaces/${overview.workspace.id}/projects/${project.id}/artifacts`,
        { title: local.title, kind: local.kind },
      );
      const localStyle =
        importPreview.styles.find((s) => s.id === local.styleId) ||
        baseStyles[0];
      const style = accountStyleFromStudio(localStyle);
      const content: ArtifactContent = {
        schemaVersion: 1,
        title: local.title,
        kind: local.kind,
        sections: [
          {
            id: crypto.randomUUID(),
            title: "Imported content",
            blocks: local.blocks.map((b) => ({
              id: crypto.randomUUID(),
              type: b.type,
              text: b.text,
              assetId: null,
              locked: false,
              sourceIds: [],
            })),
          },
        ],
      };
      await api(
        `/api/cloud/workspaces/${overview.workspace.id}/artifacts/${artifact.id}/versions`,
        {
          expectedVersion: 0,
          content,
          style,
          assetIds: [],
          changeSummary:
            "Explicitly imported current local content; local history remains on the device.",
        },
      );
      localStorage.setItem(
        reviewKey,
        JSON.stringify({
          projectId: project.id,
          artifactId: artifact.id,
          completed: true,
        }),
      );
      log.push("Current content saved. Your local workspace is unchanged.");
      setImportLog([...log]);
      await choose(overview.workspace.id);
      setMessage(
        "Project imported. Local versions, internal activity, and uploaded artwork have not been transferred.",
      );
    } catch (error) {
      log.push(
        error instanceof Error ? error.message : "Import could not complete.",
      );
      setImportLog([...log]);
      setMessage(
        "Import stopped. Completed cloud records are shown below; check them before taking another action.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cloud-shell">
      <header className="marketing-nav">
        <Link className="wordmark" href="/">
          <BrandMark size={29} />
          Makeborne
        </Link>
        <nav>
          <Link href="/studio">Local studio</Link>
          {state === "ready" ? (
            <button
              className="button secondary small"
              disabled={busy}
              onClick={logout}
            >
              <LogOut size={15} /> Sign out
            </button>
          ) : (
            <Link href="/login">Account</Link>
          )}
        </nav>
      </header>
      <main className="cloud-content">
        <span className="eyebrow">YOUR CLOUD WORKSPACE</span>
        <div className="page-heading">
          <div>
            <h1>Work that stays connected.</h1>
            <p>
              Cloud projects are separate from the work saved on this device.
            </p>
          </div>
          <span className="local-pill">
            <Cloud size={14} />{" "}
            {state === "ready" ? "Account connected" : "Cloud setup"}
          </span>
        </div>
        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}
        {state === "checking" ? (
          <p>Verifying cloud availability and your account…</p>
        ) : state === "unavailable" ? (
          <div className="empty-state">
            <Cloud size={32} />
            <h2>Cloud setup is still in progress.</h2>
            <p>{message} No local projects have been uploaded.</p>
            <Link className="button primary" href="/studio">
              Continue locally <ArrowRight size={16} />
            </Link>
          </div>
        ) : state === "signedout" ? (
          <div className="empty-state">
            <Cloud size={32} />
            <h2>Open your connected workspace.</h2>
            <p>
              Sign in to access your cloud projects. Local work stays on this
              device until you explicitly import it.
            </p>
            <Link className="button primary" href="/login">
              Sign in <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <>
            {!selected && accountId && (
              <PendingCloudWrites
                accountId={accountId}
                refresh={async () => {
                  const result = await api<{ workspaces: WorkspaceSummary[] }>(
                    "/api/workspaces",
                  );
                  setWorkspaces(result.workspaces);
                  if (overview) await choose(overview.workspace.id);
                  setUncertainCreation(false);
                }}
              />
            )}
            {uncertainCreation && (
              <div className="cloud-conflict" role="alert">
                <h3>The last creation needs a review.</h3>
                <p>
                  The server may have completed it. Your inputs remain on this
                  screen. Check the cloud records before creating anything else.
                </p>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await api<{
                        workspaces: WorkspaceSummary[];
                      }>("/api/workspaces");
                      setWorkspaces(result.workspaces);
                      if (overview) await choose(overview.workspace.id);
                      if (
                        window.confirm(
                          "Have you reviewed the saved records? Continuing allows another create action; use an existing record if the previous operation completed.",
                        )
                      )
                        setUncertainCreation(false);
                    } catch (error) {
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : "Cloud records could not be reviewed.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Review saved records
                </button>
              </div>
            )}
            {workspaces.some((w) => w.role === "owner") && (
              <p className="small-note">
                Your account already has an owner workspace. Select it below to
                resume your work.
              </p>
            )}
            <div className="cloud-workspace-bar">
              <label>
                Select workspace
                <select
                  value={overview?.workspace.id || ""}
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.value) choose(e.target.value);
                  }}
                >
                  <option value="">Choose a workspace</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} · {w.role}
                    </option>
                  ))}
                </select>
              </label>
              <form onSubmit={createWorkspace}>
                <label>
                  Initial owner workspace
                  <input
                    required
                    value={name}
                    maxLength={120}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Your studio"
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={
                    busy ||
                    uncertainCreation ||
                    !name.trim() ||
                    workspaces.some((w) => w.role === "owner")
                  }
                >
                  <Plus size={16} /> Create
                </button>
              </form>
            </div>
            {selected && overview ? (
              <CloudEditor
                key={selected.id}
                accountId={accountId!}
                workspaceId={overview.workspace.id}
                artifact={selected}
                role={overview.workspace.role}
                back={() => setSelected(null)}
                notify={setMessage}
              />
            ) : overview ? (
              <>
                <div className="list-toolbar">
                  <div className="filter-tabs">
                    <button
                      className={tab === "projects" ? "active" : ""}
                      onClick={() => setTab("projects")}
                    >
                      <FolderOpen size={14} /> Projects
                    </button>
                    <button
                      className={tab === "clients" ? "active" : ""}
                      onClick={() => setTab("clients")}
                    >
                      <Users size={14} /> Clients
                    </button>
                  </div>
                  {overview.workspace.role !== "reviewer" && (
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={previewImport}
                    >
                      Review local import
                    </button>
                  )}
                </div>
                {tab === "projects" ? (
                  <>
                    <form
                      className="cloud-create-form"
                      onSubmit={createProject}
                    >
                      <label>
                        Project title
                        <input
                          required
                          value={projectTitle}
                          maxLength={160}
                          onChange={(e) => setProjectTitle(e.target.value)}
                          placeholder="Your next project"
                        />
                      </label>
                      <label>
                        Format
                        <select
                          value={kind}
                          onChange={(e) =>
                            setKind(e.target.value as typeof kind)
                          }
                        >
                          <option value="website">Website</option>
                          <option value="book">Book</option>
                          <option value="presentation">Presentation</option>
                        </select>
                      </label>
                      <label>
                        Client
                        <select
                          value={clientId}
                          onChange={(e) => setClientId(e.target.value)}
                        >
                          <option value="">Personal project</option>
                          {overview.clients.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="button primary"
                        disabled={
                          busy ||
                          !projectTitle.trim() ||
                          overview.workspace.role === "reviewer"
                        }
                      >
                        <Plus size={16} /> Create
                      </button>
                    </form>
                    <div className="cloud-project-list">
                      {overview.projects.length === 0 ? (
                        <p>No projects yet. Your first one starts above.</p>
                      ) : (
                        overview.projects.map((p) => (
                          <article key={p.id}>
                            <div>
                              <span className="eyebrow">{p.kind}</span>
                              <h3>{p.title}</h3>
                              <p>
                                {overview.clients.find(
                                  (c) => c.id === p.clientId,
                                )?.name || "Personal project"}{" "}
                                · {p.status.replace("_", " ")}
                              </p>
                            </div>
                            <div>
                              {overview.artifacts
                                .filter((a) => a.projectId === p.id)
                                .map((a) => (
                                  <button
                                    className="button secondary small"
                                    key={a.id}
                                    onClick={() => setSelected(a)}
                                  >
                                    Open content <ArrowRight size={14} />
                                  </button>
                                ))}
                              {overview.artifacts.every(
                                (a) => a.projectId !== p.id,
                              ) && (
                                <button
                                  className="button secondary small"
                                  disabled={
                                    busy ||
                                    overview.workspace.role === "reviewer" ||
                                    (overview.pagination?.artifacts
                                      ?.nextOffset !== null &&
                                      overview.pagination?.artifacts
                                        ?.nextOffset !== undefined)
                                  }
                                  onClick={() => setupContent(p)}
                                >
                                  Set up content <Plus size={14} />
                                </button>
                              )}
                            </div>
                          </article>
                        ))
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <form
                      className="cloud-create-form"
                      onSubmit={createClientRecord}
                    >
                      <label>
                        Client name
                        <input
                          required
                          maxLength={120}
                          value={clientName}
                          onChange={(e) => setClientName(e.target.value)}
                        />
                      </label>
                      <label>
                        Email
                        <input
                          type="email"
                          value={clientEmail}
                          onChange={(e) => setClientEmail(e.target.value)}
                        />
                      </label>
                      <button
                        className="button primary"
                        disabled={
                          busy ||
                          !clientName.trim() ||
                          overview.workspace.role === "reviewer"
                        }
                      >
                        <Plus size={16} /> Add client
                      </button>
                    </form>
                    <div className="client-grid">
                      {overview.clients.map((c) => (
                        <article className="client-card" key={c.id}>
                          <h3>{c.name}</h3>
                          <p>{c.email || "No email added"}</p>
                          <p className="small-note">{(c.outreach ?? c.outreachSummary)?.stage ?? "Lead"}{(c.outreach ?? c.outreachSummary)?.nextFollowUp ? ` · Follow up ${(c.outreach ?? c.outreachSummary)?.nextFollowUp}` : ""}</p>
                          <span className="small-note">
                            {
                              overview.projects.filter(
                                (p) => p.clientId === c.id,
                              ).length
                            }{" "}
                            linked projects �{" "}
                            {
                              overview.projects.filter(
                                (p) =>
                                  p.clientId === c.id && p.kind === "website",
                              ).length
                            }{" "}
                            websites
                          </span>
                          <button
                            className="text-link"
                            disabled={loadingClient || busy}
                            onClick={() => void openClient(c.id, "details")}
                          >
                            Client details <ArrowRight size={14} />
                          </button>
                          <button className="text-link" disabled={loadingClient || busy} onClick={() => void openClient(c.id, "outreach")}>Outreach & follow-ups <ArrowRight size={14} /></button>
                        </article>
                      ))}
                    </div>
                  </>
                )}
                {outreachClient && <CloudClientOutreach key={`${overview.workspace.id}:${outreachClient.id}`} initialClient={outreachClient}
                  workspaceId={overview.workspace.id} canEdit={overview.workspace.role !== "reviewer"}
                  close={() => setOutreachClient(null)} onSaved={client => setOverview(current => current?.workspace.id === overview.workspace.id ? { ...current, clients: current.clients.map(item => item.id === client.id ? client : item) } : current)} />}
                {loadingClient && <p role="status">Loading the latest client record…</p>}
                {editingClient && (
                  <CloudClientDetails
                    key={editingClient.id}
                    client={editingClient}
                    workspaceId={overview.workspace.id}
                    canEdit={overview.workspace.role !== "reviewer"}
                    close={() => setEditingClient(null)}
                    saved={async () => {
                      setEditingClient(null);
                      await choose(overview.workspace.id);
                      setMessage("Client details saved to the cloud.");
                    }}
                    notify={setMessage}
                  />
                )}
                <div className="cloud-pagination">
                  {(["projects", "clients", "artifacts"] as Collection[]).map(
                    (collection) =>
                      overview.pagination?.[collection]?.nextOffset !== null &&
                      overview.pagination?.[collection]?.nextOffset !==
                        undefined ? (
                        <button
                          key={collection}
                          className="button secondary small"
                          disabled={busy}
                          onClick={() => loadMore(collection)}
                        >
                          Load more{" "}
                          {collection === "artifacts"
                            ? "content records"
                            : collection}
                        </button>
                      ) : null,
                  )}
                </div>
                {importPreview && (
                  <section className="import-review">
                    <span className="eyebrow">EXPLICIT IMPORT REVIEW</span>
                    <h2>Choose what moves to the cloud.</h2>
                    <p>
                      This imports one project’s current text, linked client
                      details, brief, and style. Local outreach tracking, history and internal
                      activity remain on this device. Projects with inline
                      artwork are blocked until cloud asset upload is supported.
                      The local workspace is never removed.
                    </p>
                    <label>
                      Project
                      <select
                        value={importProjectId}
                        onChange={(e) => setImportProjectId(e.target.value)}
                      >
                        {importPreview.projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="import-data-summary">
                      {(() => {
                        const project = importPreview.projects.find(
                          (p) => p.id === importProjectId,
                        );
                        const client = importPreview.clients.find(
                          (c) => c.id === project?.clientId,
                        );
                        return (
                          <>
                            <strong>
                              {project?.title || "No project selected"}
                            </strong>
                            <p>
                              {project?.blocks.length || 0} current content
                              blocks � {project?.kind}
                            </p>
                            {client && (
                              <>
                                <h3>Client details to be copied</h3>
                                <p>
                                  {client.name} � {client.company}
                                  <br />
                                  {client.email}
                                  <br />
                                  {client.website}
                                </p>
                                <p>Internal notes: {client.notes || "None"}</p>
                              </>
                            )}
                            <p>Brief: {project?.brief || "None"}</p>
                          </>
                        );
                      })()}
                    </div>
                    <div className="button-row">
                      <button
                        className="button primary"
                        disabled={busy || !importProjectId}
                        onClick={importOne}
                      >
                        Import this reviewed project
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => setImportPreview(null)}
                        disabled={busy}
                      >
                        Close
                      </button>
                    </div>
                    {importLog.length > 0 && (
                      <ul>
                        {importLog.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
              </>
            ) : (
              <div className="empty-state">
                <h2>Make room for your work.</h2>
                <p>
                  Create or select a cloud workspace to begin. Your device’s
                  drafts remain separate.
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
const RecoveryDraftSchema = z.object({
  schemaVersion: z.literal(1),
  basedOnVersion: z.number().int().nonnegative(),
  content: ArtifactContentSchema,
  style: StyleProfileSchema,
  assetIds: z.array(z.string().uuid()),
  note: z.string().max(2000),
});
type RecoveryDraft = z.infer<typeof RecoveryDraftSchema>;
export function CloudEditor({
  accountId,
  workspaceId,
  artifact,
  role,
  back,
  notify,
}: {
  accountId: string;
  workspaceId: string;
  artifact: CloudArtifact;
  role: WorkspaceSummary["role"];
  back: () => void;
  notify: (s: string) => void;
}) {
  const recoveryKey = `makeborne.cloud-draft.${accountId}.${workspaceId}.${artifact.id}`;
  const [recovery, setRecovery] = useState<RecoveryDraft | null>(null);
  const saveBusy = useRef(false);
  const editRevision = useRef(0);
  const pendingSave = useRef<{ revision: number; payload: { expectedVersion: number; content: ArtifactContent; style: StyleProfile; assetIds: string[]; changeSummary: string } } | null>(null);
  const [savePaused, setSavePaused] = useState(false);
  const [uncertainSave, setUncertainSave] = useState(false);
  const [content, setContent] = useState<ArtifactContent | null>(null);
  const [removedBlock, setRemovedBlock] = useState<RemovedAccountBlock | null>(null);
  const [inspectedVersion, setInspectedVersion] = useState<ArtifactVersion | null>(null);
  const [style, setStyle] = useState<StyleProfile | null>(null);
  const [expectedVersion, setExpectedVersion] = useState(
    artifact.currentVersion,
  );
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [note, setNote] = useState("");
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api<{
        artifact: CloudArtifact;
        versions: ArtifactVersion[];
        pagination?: { nextOffset: number | null };
      }>(`/api/cloud/workspaces/${workspaceId}/artifacts/${artifact.id}`);
      const latest = [...result.versions].sort(
        (a, b) => b.number - a.number,
      )[0];
      setVersions(result.versions);
      setRemovedBlock(null);
      setInspectedVersion(null);
      setNextOffset(result.pagination?.nextOffset ?? null);
      setAssetIds(latest?.assetIds || []);
      setExpectedVersion(result.artifact.currentVersion);
      setContent(
        latest?.content || {
          schemaVersion: 1,
          title: artifact.title,
          kind: artifact.kind,
          sections: [
            { id: crypto.randomUUID(), title: "Main content", blocks: [] },
          ],
        },
      );
      const defaultStyle = baseStyles[0];
      setStyle(
        latest?.style || {
          id: defaultStyle.id,
          name: defaultStyle.name,
          version: 1,
          typography: { headingFont: "Source Serif 4", bodyFont: "Inter" },
          colors: {
            accent: defaultStyle.color,
            ink: "#16181D",
            canvas: "#F8F7F4",
          },
          description: defaultStyle.description,
          referenceAssetIds: [],
        },
      );
      setDirty(false);
      setConflict(false);
      setSavePaused(false);
      try {
        const original = localStorage.getItem(recoveryKey);
        if (original) {
          const saved = RecoveryDraftSchema.safeParse(JSON.parse(original));
          if (saved.success) setRecovery(saved.data);
          else
            notify(
              "A recovery draft could not be read. It has been preserved on this device.",
            );
        }
      } catch {
        notify(
          "Recovery storage could not be read. Your saved cloud content remains available.",
        );
      }
      return true;
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Content could not load.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, [
    artifact.id,
    artifact.title,
    artifact.kind,
    workspaceId,
    notify,
    recoveryKey,
  ]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);
  useEffect(() => {
    function guard(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => {
    if (!dirty || !content || !style) return;
    try {
      localStorage.setItem(
        recoveryKey,
        JSON.stringify({
          schemaVersion: 1,
          basedOnVersion: expectedVersion,
          content,
          style,
          assetIds,
          note,
        }),
      );
    } catch {
      queueMicrotask(() =>
        notify(
          "This device could not preserve the recovery draft. Download your draft before leaving this page.",
        ),
      );
    }
  }, [
    dirty,
    content,
    style,
    expectedVersion,
    assetIds,
    note,
    recoveryKey,
    notify,
  ]);
  function blockAction(sectionId: string, blockId: string, action: "up" | "down" | "remove") {
    if (!content || role === "reviewer" || uncertainSave || conflict || recovery) return;
    try {
      let next: ArtifactContent;
      if (action === "remove") { const result = removeAccountBlock(content, sectionId, blockId); next = result.content; setRemovedBlock(result.removed); }
      else next = moveAccountBlock(content, sectionId, blockId, action === "up" ? -1 : 1);
      editRevision.current++; setContent(next); setDirty(true);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not change this block."); }
  }
  function undoRemoval() {
    if (!content || !removedBlock || role === "reviewer" || uncertainSave || conflict || recovery) return;
    try { const next = restoreAccountBlock(content, removedBlock); editRevision.current++; setContent(next); setDirty(true); setRemovedBlock(null); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not restore this block."); }
  }
  function editBlock(sectionId: string, blockId: string, text: string) {
    if (!content || role === "reviewer" || uncertainSave || content.sections.find(section => section.id === sectionId)?.blocks.find(block => block.id === blockId)?.locked) return;
    editRevision.current++;
    setContent({
      ...content,
      sections: content.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              blocks: s.blocks.map((b) =>
                b.id === blockId ? { ...b, text } : b,
              ),
            }
          : s,
      ),
    });
    setDirty(true);
  }
  function add(type: "heading" | "paragraph" | "quote") {
    if (!content || role === "reviewer" || uncertainSave || conflict || recovery) return;
    editRevision.current++;
    const sections = [...content.sections];
    if (!sections.length)
      sections.push({
        id: crypto.randomUUID(),
        title: "Main content",
        blocks: [],
      });
    sections[0] = {
      ...sections[0],
      blocks: [
        ...sections[0].blocks,
        {
          id: crypto.randomUUID(),
          type,
          text: "",
          assetId: null,
          locked: false,
          sourceIds: [],
        },
      ],
    };
    setContent({ ...content, sections });
    setDirty(true);
  }
  async function save() {
    if (!content || !style || busy || saveBusy.current || role === "reviewer")
      return;
    saveBusy.current = true;
    const attempt = uncertainSave && pendingSave.current ? pendingSave.current : {
      revision: editRevision.current,
      payload: { expectedVersion, content, style, assetIds, changeSummary: note || "Saved account content" },
    };
    pendingSave.current = attempt;
    const savingRevision = attempt.revision;
    setSavePaused(false);
    setBusy(true);
    try {
      const result = await api<{
        version: ArtifactVersion;
        artifact: CloudArtifact;
        mutation: { replayed: boolean };
      }>(
        `/api/cloud/workspaces/${workspaceId}/artifacts/${artifact.id}/versions`,
        attempt.payload,
      );
      pendingSave.current = null;
      setExpectedVersion(result.artifact.currentVersion);
      setVersions((v) => [...v.filter(version => version.id !== result.version.id), result.version]);
      const settlement = settleAccountSave(savingRevision, editRevision.current, result.mutation.replayed);
      const hasNewerEdits = settlement.newerEdits;
      setDirty(hasNewerEdits);
      setRecovery(null);
      setConflict(false);
      setUncertainSave(false);
      if (settlement.clearRecovery) {
        try { localStorage.removeItem(recoveryKey); } catch { /* A retained draft is safer than treating a confirmed save as failed. */ }
        setNote("");
      }
      if (result.mutation.replayed) {
        if (settlement.pauseForReview) {
          setConflict(true);
          notify("The earlier save is confirmed. Your newer edits are preserved; review them against the latest saved version before continuing.");
          return;
        }
        const current = await load();
        if (!current) {
          setConflict(true);
          notify(
            "The original save was confirmed, but the latest cloud content could not be loaded. Review it before editing.",
          );
        } else
          notify(
            "The original save was confirmed and the latest cloud content has been loaded.",
          );
      } else notify("Content version saved to the cloud.");
    } catch (error) {
      setSavePaused(true);
      if (error instanceof CloudError && error.uncertain) {
        setUncertainSave(true);
        notify(error.message);
      } else if (
        error instanceof CloudError &&
        error.status === 409 &&
        error.code !== "REQUEST_PENDING"
      ) {
        setConflict(true);
        notify(
          "Another version was saved first. Your draft is preserved on this screen. Download it before loading the latest content.",
        );
      } else
        notify(
          error instanceof Error
            ? error.message
            : "Save failed; your draft is preserved on this screen.",
        );
    } finally {
      saveBusy.current = false;
      setBusy(false);
    }
  }
  const saveAfterPause = useEffectEvent(() => { void save(); });
  useEffect(() => {
    if (!canAutosave({ dirty, busy, conflict, uncertain: uncertainSave, paused: savePaused, recovery: !!recovery, reviewer: role === "reviewer", ready: !!content && !!style })) return;
    const timer = window.setTimeout(() => saveAfterPause(), 1500);
    return () => window.clearTimeout(timer);
  }, [dirty, busy, conflict, uncertainSave, savePaused, recovery, role, content, style, note, assetIds]);
  function restoreVersion(version: ArtifactVersion) {
    if (!content || dirty || busy || saveBusy.current || savePaused || uncertainSave || conflict || recovery || role === "reviewer") return;
    try {
      const restored = prepareVersionRestore(content, version, artifact.id, expectedVersion);
      editRevision.current++;
      setContent(restored.content);
      setStyle(restored.style);
      setAssetIds(restored.assetIds);
      setNote(restored.changeSummary);
      setRemovedBlock(null);
      setInspectedVersion(null);
      setDirty(true);
      notify(`Version ${version.number} restored into your editor. Saving it as a new version…`);
    } catch (error) { notify(error instanceof Error ? error.message : "This version could not be restored."); }
  }
  async function moreVersions() {
    if (nextOffset === null || busy) return;
    setBusy(true);
    try {
      const result = await api<{
        versions: ArtifactVersion[];
        pagination: { nextOffset: number | null };
      }>(
        `/api/cloud/workspaces/${workspaceId}/artifacts/${artifact.id}?offset=${nextOffset}`,
      );
      setVersions((existing) => {
        const entries = new Map(
          [...existing, ...result.versions].map((v) => [v.id, v]),
        );
        return [...entries.values()];
      });
      setNextOffset(result.pagination.nextOffset);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Earlier versions could not load.",
      );
    } finally {
      setBusy(false);
    }
  }
  function backup() {
    const data = JSON.stringify(
      { content, style, basedOnVersion: expectedVersion },
      null,
      2,
    );
    const url = URL.createObjectURL(
      new Blob([data], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "makeborne-cloud-draft.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="cloud-editor">
      <div className="editor-heading">
        <button
          className="icon-button"
          aria-label="Back to projects"
          onClick={() => {
            if (
              !dirty ||
              window.confirm(
                "Leave this unsaved cloud draft? Download it first if you need to preserve changes.",
              )
            )
              back();
          }}
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2>{artifact.title}</h2>
          <p>
            Saved to your account · Version {expectedVersion} ·{" "}
            {savePaused || conflict || uncertainSave ? "Saving paused — review required" : busy && dirty ? "Saving…" : dirty ? "Waiting to save…" : "Saved"}
          </p>
        </div>
        <button
          className="button primary"
          disabled={busy || !content || conflict || role === "reviewer"}
          onClick={save}
        >
          <Save size={16} />
          {!content ? "Loading…" : busy ? "Saving…" : savePaused ? "Retry save" : "Save now"}
        </button>
      </div>
      {uncertainSave && (
        <div className="cloud-conflict" role="alert">
          <h3>The last save is not confirmed.</h3>
          <p>
            Your recovery draft is retained on this device. Retry the unchanged
            request to reconcile its saved result, or download this draft before
            loading the latest version.
          </p>
          <button className="button secondary" disabled={busy} onClick={save}>
            Retry the same save
          </button>
          <button className="button secondary" onClick={backup}>
            Download draft
          </button>
        </div>
      )}
      {recovery && (
        <div className="cloud-conflict">
          <PendingCloudWrites accountId={accountId} refresh={async () => { setConflict(true); notify("The pending request is confirmed. Download any recovery draft before loading the latest version."); }} />
          <h3>An unsaved draft is available.</h3>
          <p>
            Saved on this device from cloud version {recovery.basedOnVersion}.
            It has not replaced the latest cloud content.
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              onClick={() => {
                setContent(recovery.content);
                editRevision.current++;
                setStyle(recovery.style);
                setAssetIds(recovery.assetIds);
                setExpectedVersion(recovery.basedOnVersion);
                setNote(recovery.note);
                setDirty(true);
                setRecovery(null);
                setConflict(false);
              }}
            >
              Restore recovery draft
            </button>
            <button
              className="button secondary"
              onClick={() => {
                if (
                  window.confirm(
                    "Discard the recovery draft on this device? Saved cloud versions are unaffected.",
                  )
                ) {
                  localStorage.removeItem(recoveryKey);
                  setRecovery(null);
                }
              }}
            >
              Discard recovery draft
            </button>
          </div>
        </div>
      )}
      {conflict && (
        <div className="cloud-conflict" role="alert">
          <h3>Your draft needs a review.</h3>
          <p>
            The cloud has a newer version. This draft will not overwrite it.
          </p>
          <div className="button-row">
            <button className="button secondary" onClick={backup}>
              Download your draft
            </button>
            <button
              className="button secondary"
              onClick={() => {
                if (
                  window.confirm(
                    "Load the newest cloud content and replace this on-screen draft?",
                  )
                )
                  void load();
              }}
            >
              Load latest cloud version
            </button>
          </div>
        </div>
      )}
      {!content ? (
        <p>Loading content…</p>
      ) : (
        <div className="cloud-edit-grid account-visual-editor">
          <div className="account-compose">
          <div>
            {removedBlock && <div className="account-block-undo"><span role="status">Block removed.</span><button type="button" className="button secondary small" disabled={role === "reviewer" || uncertainSave || conflict || !!recovery} onClick={undoRemoval}><Undo2 size={14} /> Undo removal</button></div>}
            {content.sections.map((s) => (
              <section key={s.id}>
                <span className="eyebrow">{s.title}</span>
                {s.blocks.map((b, index) => (
                  <div className="account-content-block" key={b.id}>
                    <div className="account-block-tools"><label htmlFor={`account-block-${b.id}`}>{b.type}{b.locked ? " · locked" : ""}</label>
                      {role !== "reviewer" && <div>
                        <button type="button" aria-label={`Move ${b.type} block ${index + 1} up`} title="Move up" disabled={b.locked || index === 0 || s.blocks[index - 1]?.locked || uncertainSave || conflict || !!recovery} onClick={() => blockAction(s.id, b.id, "up")}><ArrowUp size={14} /></button>
                        <button type="button" aria-label={`Move ${b.type} block ${index + 1} down`} title="Move down" disabled={b.locked || index === s.blocks.length - 1 || s.blocks[index + 1]?.locked || uncertainSave || conflict || !!recovery} onClick={() => blockAction(s.id, b.id, "down")}><ArrowDown size={14} /></button>
                        <button type="button" aria-label={`Remove ${b.type} block ${index + 1}`} title="Remove block" disabled={b.locked || uncertainSave || conflict || !!recovery} onClick={() => blockAction(s.id, b.id, "remove")}><Trash2 size={14} /></button>
                      </div>}
                    </div>
                    <textarea id={`account-block-${b.id}`}
                      value={b.text}
                      disabled={
                        role === "reviewer" || b.locked || uncertainSave
                      }
                      rows={b.type === "heading" ? 2 : 5}
                      maxLength={50000}
                      onChange={(e) => editBlock(s.id, b.id, e.target.value)}
                    />
                  </div>
                ))}
              </section>
            ))}
            {role !== "reviewer" && !uncertainSave && !conflict && !recovery && (
              <div className="button-row">
                {(["heading", "paragraph", "quote"] as const).map((t) => (
                  <button
                    key={t}
                    className="button secondary small"
                    onClick={() => add(t)}
                  >
                    <Plus size={14} />
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
          {style && <AccountPreview content={content} style={style} dirty={dirty} />}
          </div>
          <aside>
            {style && <AccountStyleEditor style={style} kind={content.kind} disabled={role === "reviewer" || uncertainSave || conflict || !!recovery || busy} onChange={next => {
              if (role === "reviewer" || uncertainSave || conflict || recovery || busy) return;
              editRevision.current++; setStyle(next); setDirty(true);
            }} />}
            <span className="eyebrow">AUTOMATIC SAVING</span>
            <p>
              Edits save after you pause typing. Each save creates a version.
              A recovery draft stays on this device. Saving pauses if another
              person has updated the project or a request cannot be confirmed.
            </p>
            <label>
              Change note
              <input
                value={note}
                maxLength={2000}
                disabled={role === "reviewer" || uncertainSave}
                onChange={(e) => { editRevision.current++; setNote(e.target.value); setDirty(true); }}
                placeholder="What changed?"
              />
            </label>
            <button className="button secondary" onClick={backup}>
              <FileText size={16} /> Download draft
            </button>
            {style && <AccountExport documentId={artifact.id} content={content} style={style} dirty={dirty} disabled={conflict || uncertainSave || !!recovery} />}
            <h3>Version history</h3>
            {versions.length === 0 ? (
              <p>No saved versions yet.</p>
            ) : (
              [...versions]
                .sort((a, b) => b.number - a.number)
                .map((v) => (
                  <div className="cloud-version" key={v.id}>
                    <strong>Version {v.number}</strong>
                    <p>{v.changeSummary}</p>
                    <small>{new Date(v.createdAt).toLocaleString()}</small>
                    <button type="button" className="button secondary small" aria-expanded={inspectedVersion?.id === v.id} onClick={() => setInspectedVersion(inspectedVersion?.id === v.id ? null : v)}> {inspectedVersion?.id === v.id ? "Close preview" : `Preview version ${v.number}`}</button>
                  </div>
                ))
            )}
            {inspectedVersion && <section className="account-version-review" aria-label={`Saved version ${inspectedVersion.number}`}>
              <h3>Version {inspectedVersion.number}</h3>
              <p className="small-note">This is a saved snapshot. Restoring creates a new version and keeps your history.</p>
              <AccountPreview key={inspectedVersion.id} content={inspectedVersion.content} style={inspectedVersion.style} dirty={false} />
              {role !== "reviewer" && inspectedVersion.number < expectedVersion && <>
                <button type="button" className="button secondary" disabled={dirty || busy || savePaused || uncertainSave || conflict || !!recovery} onClick={() => restoreVersion(inspectedVersion)}>Restore as new version</button>
                {(dirty || busy || savePaused || uncertainSave || conflict || !!recovery) && <p className="small-note">Finish saving or resolve your current draft before restoring.</p>}
              </>}
            </section>}
            {nextOffset !== null && (
              <button
                className="button secondary small"
                disabled={busy}
                onClick={moreVersions}
              >
                Load earlier versions
              </button>
            )}
            <p className="small-note">
              Artwork upload, automatic generation, and publication are separate
              capabilities and are not performed by this editor.
            </p>
          </aside>
        </div>
      )}
    </section>
  );
}
export function CloudClientDetails({
  client,
  workspaceId,
  canEdit,
  close,
  saved,
  notify,
  onSaving,
}: {
  onSaving?: (value: boolean) => void;
  client: CloudClient;
  workspaceId: string;
  canEdit: boolean;
  close: () => void;
  saved: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [name, setName] = useState(client.name);
  const [company, setCompany] = useState(client.company);
  const [email, setEmail] = useState(client.email);
  const [website, setWebsite] = useState(client.website);
  const [notes, setNotes] = useState(client.notes);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit || busy) return;
    setBusy(true); onSaving?.(true);
    try {
      await api(
        `/api/cloud/workspaces/${workspaceId}/clients/${client.id}`,
        {
          name,
          company,
          email,
          website,
          notes,
          expectedUpdatedAt: client.updatedAt,
        },
        "PATCH",
      );
      await saved();
    } catch (error) {
      if (error instanceof CloudError && error.status === 409)
        setConflict(true);
      notify(
        error instanceof Error
          ? error.message
          : "Client details could not save.",
      );
    } finally {
      setBusy(false); onSaving?.(false);
    }
  }
  return (
    <section className="import-review">
      <span className="eyebrow">CONTACT DETAILS</span>
      <h2>{client.name}</h2>
      {conflict && (
        <p role="alert">
          A newer client record exists. Your edits remain below; copy them
          before closing and reloading this workspace.
        </p>
      )}
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Name
            <input
              required
              disabled={!canEdit || busy}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Company
            <input
              disabled={!canEdit || busy}
              value={company}
              maxLength={160}
              onChange={(e) => setCompany(e.target.value)}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              disabled={!canEdit || busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Website
            <input
              type="url"
              disabled={!canEdit || busy}
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>
        </div>
        <label>
          Internal notes
          <textarea
            disabled={!canEdit || busy}
            rows={4}
            maxLength={10000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="button-row">
          {canEdit && (
            <button
              className="button primary"
              disabled={busy || conflict || !name.trim()}
            >
              Save client details
            </button>
          )}
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob(
                  [
                    JSON.stringify(
                      {
                        clientId: client.id,
                        workspaceId,
                        name,
                        company,
                        email,
                        website,
                        notes,
                        expectedUpdatedAt: client.updatedAt,
                      },
                      null,
                      2,
                    ),
                  ],
                  { type: "application/json" },
                ),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "makeborne-client-draft.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download client draft
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            Close
          </button>
        </div>
      </form>
    </section>
  );
}

"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Clock3,
  FolderOpen,
  Globe,
  Pencil,
  Plus,
  Presentation,
  Search,
  Users,
} from "lucide-react";
import type { Client, Project } from "./studio-model";
import "@/app/client-workspace.css";

export type ClientWorkspaceProps = {
  clients: Client[];
  projects: Project[];
  selectedClientId: string | null;
  onSelectClient: (id: string | null) => void;
  onEditClient: (client: Client) => void;
  onAddClient: () => void;
  onOpenProject: (id: string) => void;
  onCreateProject: (clientId: string) => void;
};
const kinds = {
  website: "Website",
  book: "Book",
  presentation: "Presentation",
};
const icons = { website: Globe, book: BookOpen, presentation: Presentation };
const statuses: Record<Project["status"], string> = {
  draft: "Draft",
  in_progress: "In progress",
  review: "In review",
  approved: "Approved internally",
  published: "Recorded as published",
  archived: "Archived",
};
function date(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
function safeWebsite(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export default function ClientWorkspace({
  clients,
  projects,
  selectedClientId,
  onSelectClient,
  onEditClient,
  onAddClient,
  onOpenProject,
  onCreateProject,
}: ClientWorkspaceProps) {
  const [clientSearch, setClientSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAllTasks, setShowAllTasks] = useState(false);
  const clientIds = new Set(clients.map((client) => client.id));
  const projectsByClient = new Map<string, Project[]>();
  for (const project of projects) {
    if (!project.clientId) continue;
    const group = projectsByClient.get(project.clientId) ?? [];
    group.push(project);
    projectsByClient.set(project.clientId, group);
  }
  function selectClient(id: string | null) {
    setProjectSearch(""); setKindFilter("all"); setStatusFilter("all");
    setShowAllTasks(false);
    onSelectClient(id);
  }
  const selected = clients.find((client) => client.id === selectedClientId);
  const linkedProjects = projects.filter((project) =>
    selected
      ? project.clientId === selected.id
      : !!project.clientId && clientIds.has(project.clientId),
  );
  const visibleClients = clients.filter((client) =>
    [
      client.name,
      client.company,
      client.email,
      ...(projectsByClient.get(client.id) ?? [])
        .map((project) => project.title),
    ]
      .join(" ")
      .toLowerCase()
      .includes(clientSearch.trim().toLowerCase()),
  );
  const visibleProjects = linkedProjects
    .filter(
      (project) =>
        project.title
          .toLowerCase()
          .includes(projectSearch.trim().toLowerCase()) &&
        (kindFilter === "all" || project.kind === kindFilter) &&
        (statusFilter === "all" || project.status === statusFilter),
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const activity = linkedProjects
    .reduce<{ at: string; text: string; project: Project }[]>(
      (recent, project) =>
        [
          ...recent,
          ...project.activity.slice(-50).map((item) => ({ ...item, project })),
        ]
          .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
          .slice(0, 50),
      [],
    )
    .slice(0, 12);
  const website = selected?.website ? safeWebsite(selected.website) : null;
  const openTasks = linkedProjects.filter(project => project.status !== "archived")
    .flatMap(project => (project.tasks ?? []).filter(task => !task.completedAt).map(task => ({ task, project })))
    .sort((a, b) => (a.task.dueDate ?? "9999").localeCompare(b.task.dueDate ?? "9999") || a.task.createdAt.localeCompare(b.task.createdAt));
  const visibleTasks = showAllTasks ? openTasks : openTasks.slice(0, 8);
  const today = new Date();
  const localDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const clientNames = new Map(clients.map(client => [client.id, client.name]));
  return (
    <div className="cw-workspace">
      {selected && (
        <button
          type="button"
          className="cw-back"
          onClick={() => selectClient(null)}
        >
          <ArrowLeft size={16} /> All clients
        </button>
      )}
      <header className="cw-header">
        <div>
          <span className="cw-eyebrow">CLIENT WORKSPACE</span>
          <h1>
            {selected ? selected.name : "Good work. Clear relationships."}
          </h1>
          <p>
            {selected
              ? "Every project and saved version in one place."
              : "Keep each client and everything you make for them connected."}
          </p>
        </div>
        <button
          type="button"
          className="cw-primary"
          onClick={() =>
            selected ? onCreateProject(selected.id) : onAddClient()
          }
        >
          <Plus size={17} />
          {selected ? "New project" : "Add client"}
        </button>
      </header>
      <div className="cw-stats" aria-label="Client project counts">
        {[
          [
            selected ? "Projects" : "Clients",
            selected ? linkedProjects.length : clients.length,
          ],
          [
            "Websites",
            linkedProjects.filter((project) => project.kind === "website")
              .length,
          ],
          [
            "In progress",
            linkedProjects.filter((project) => project.status === "in_progress")
              .length,
          ],
          [
            "In review",
            linkedProjects.filter((project) => project.status === "review")
              .length,
          ],
        ].map(([label, count]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{count}</strong>
          </div>
        ))}
      </div>
      {selected ? (
        <section className="cw-profile" aria-label="Client details">
          <div className="cw-profile-identity">
            <span className="cw-avatar">{initials(selected.name)}</span>
            <div>
              <h2>{selected.company || selected.name}</h2>
              <p>Client since {date(selected.createdAt)}</p>
            </div>
            <button
              type="button"
              className="cw-secondary"
              onClick={() => onEditClient(selected)}
            >
              <Pencil size={15} />
              Edit details
            </button>
          </div>
          <dl className="cw-details">
            <div>
              <dt>Email</dt>
              <dd>
                {selected.email ? (
                  <a href={`mailto:${selected.email}`}>{selected.email}</a>
                ) : (
                  "Not added"
                )}
              </dd>
            </div>
            <div>
              <dt>Website</dt>
              <dd>
                {website ? (
                  <a href={website} target="_blank" rel="noopener noreferrer">
                    {selected.website}
                    <ArrowUpRight size={13} />
                  </a>
                ) : (
                  selected.website || "Not added"
                )}
              </dd>
            </div>
          </dl>
          {selected.notes && (
            <div className="cw-notes">
              <span>Client notes</span>
              <p>{selected.notes}</p>
            </div>
          )}
        </section>
      ) : (
        <section
          className="cw-client-section"
          aria-labelledby="cw-clients-title"
        >
          <div className="cw-section-heading">
            <h2 id="cw-clients-title">
              Your clients <span>{clients.length}</span>
            </h2>
            <label className="cw-search">
              <Search size={16} />
              <input
                aria-label="Search clients and their projects"
                placeholder="Search clients or their projects"
                value={clientSearch}
                onChange={(event) => setClientSearch(event.target.value)}
              />
            </label>
          </div>
          {clients.length === 0 ? (
            <div className="cw-empty">
              <Users size={27} />
              <h3>A home for your client work.</h3>
              <p>
                Add a client, then connect their websites, books, and
                presentations as you create them.
              </p>
              <button
                type="button"
                className="cw-secondary"
                onClick={onAddClient}
              >
                <Plus size={16} />
                Add your first client
              </button>
            </div>
          ) : visibleClients.length === 0 ? (
            <div className="cw-empty">
              <Search size={24} />
              <h3>No matching clients.</h3>
              <p>Try a name, company, email, or project title.</p>
              <button
                type="button"
                className="cw-secondary"
                onClick={() => setClientSearch("")}
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="cw-client-grid">
              {visibleClients.map((client) => {
                const work = projects.filter(
                  (project) => project.clientId === client.id,
                );
                const latest = [...work].sort(
                  (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
                )[0];
                return (
                  <button
                    type="button"
                    className="cw-client-card"
                    key={client.id}
                    onClick={() => selectClient(client.id)}
                  >
                    <div className="cw-card-top">
                      <span className="cw-avatar">{initials(client.name)}</span>
                      <ArrowUpRight size={18} />
                    </div>
                    <h3>{client.name}</h3>
                    <p>
                      {client.company ||
                        client.email ||
                        "Client details ready to add"}
                    </p>
                    <div className="cw-card-counts">
                      <span>
                        {work.length}{" "}
                        {work.length === 1 ? "project" : "projects"}
                      </span>
                      <span>
                        {
                          work.filter((project) => project.kind === "website")
                            .length
                        }{" "}
                        websites
                      </span>
                    </div>
                    <small>
                      {latest
                        ? `Latest update ${date(latest.updatedAt)}`
                        : "No projects yet"}
                    </small>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}
      {selected && (
        <section
          className="cw-project-section"
          aria-labelledby="cw-project-title"
        >
          <div className="cw-section-heading">
            <h2 id="cw-project-title">
              Client projects <span>{linkedProjects.length}</span>
            </h2>
            <label className="cw-search">
              <Search size={16} />
              <input
                aria-label="Search client projects"
                placeholder="Find a project"
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
              />
            </label>
          </div>
          <div className="cw-project-filters">
            <label>
              Format
              <select
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value)}
              >
                <option value="all">All formats</option>
                {Object.entries(kinds).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">All statuses</option>
                {Object.entries(statuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Statuses describe your local workflow. They do not publish or
              share a project.
            </p>
          </div>
          {linkedProjects.length === 0 ? (
            <div className="cw-empty">
              <FolderOpen size={27} />
              <h3>Their next project starts here.</h3>
              <p>
                Create a website, book, or presentation linked to{" "}
                {selected.name}.
              </p>
              <button
                type="button"
                className="cw-secondary"
                onClick={() => onCreateProject(selected.id)}
              >
                <Plus size={16} />
                Create a client project
              </button>
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="cw-empty">
              <h3>No projects match these filters.</h3>
              <button
                type="button"
                className="cw-secondary"
                onClick={() => {
                  setKindFilter("all");
                  setStatusFilter("all");
                  setProjectSearch("");
                }}
              >
                Reset filters
              </button>
            </div>
          ) : (
            <div className="cw-table-wrap">
              <table className="cw-project-table">
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th scope="col">Status</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Saved versions</th>
                    <th scope="col">
                      <span className="cw-sr">Open project</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProjects.map((project) => {
                    const Icon = icons[project.kind];
                    return (
                      <tr key={project.id}>
                        <td>
                          <button
                            type="button"
                            className="cw-project-name"
                            onClick={() => onOpenProject(project.id)}
                          >
                            <span className="cw-project-icon">
                              <Icon size={18} />
                            </span>
                            <span>
                              <strong>{project.title}</strong>
                              <small>{kinds[project.kind]}</small>
                              <small>{(project.tasks ?? []).filter(task => !task.completedAt).length} open tasks</small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <span
                            className={`cw-status cw-status-${project.status}`}
                          >
                            {statuses[project.status]}
                          </span>
                        </td>
                        <td>
                          <time dateTime={project.updatedAt}>
                            {date(project.updatedAt)}
                          </time>
                        </td>
                        <td>{project.versions.length} saved</td>
                        <td>
                          <button
                            type="button"
                            className="cw-open"
                            aria-label={`Open ${project.title}`}
                            onClick={() => onOpenProject(project.id)}
                          >
                            <ArrowUpRight size={17} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {linkedProjects.length > 0 && <section className="cw-next-section" aria-labelledby="cw-next-title">
        <div className="cw-section-heading">
          <h2 id="cw-next-title">Next up</h2>
          <span className="cw-section-note">{openTasks.length} open · active client projects</span>
        </div>
        {openTasks.length === 0 ? <div className="cw-activity-empty"><Clock3 size={20} /><p>No open tasks. Add next steps in a project’s History & review.</p></div> : <ul className="cw-next-list">
          {visibleTasks.map(({ task, project }) => <li key={`${project.id}-${task.id}`}>
            <button type="button" onClick={() => onOpenProject(project.id)} aria-label={`Open ${project.title} for task: ${task.title}`}>
              <span className="cw-next-copy"><strong>{task.title}</strong><small>{!selected && project.clientId ? `${clientNames.get(project.clientId)} · ` : ""}{project.title}</small></span>
              <span className={task.dueDate && task.dueDate < localDay ? "cw-due overdue" : "cw-due"}>{task.dueDate ? <><span>{task.dueDate < localDay ? "Overdue" : task.dueDate === localDay ? "Today" : "Due"}</span><time dateTime={task.dueDate}>{date(`${task.dueDate}T12:00:00`)}</time></> : "No due date"}</span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </li>)}
        </ul>}
        {openTasks.length > 8 && <button className="cw-back" type="button" onClick={() => setShowAllTasks(value => !value)}>{showAllTasks ? "Show fewer tasks" : `Show all ${openTasks.length} tasks`}</button>}
      </section>}
      <section
        className="cw-activity-section"
        aria-labelledby="cw-activity-title"
      >
        <div className="cw-section-heading">
          <h2 id="cw-activity-title">Recent activity</h2>
          <span className="cw-section-note">Saved project history</span>
        </div>
        {activity.length === 0 ? (
          <div className="cw-activity-empty">
            <Clock3 size={20} />
            <p>Project activity will appear here as you work.</p>
          </div>
        ) : (
          <ol className="cw-activity-list">
            {activity.map((item, index) => (
              <li key={`${item.project.id}-${item.at}-${index}`}>
                <span className="cw-activity-dot" />
                <div>
                  <p>{item.text}</p>
                  <button
                    type="button"
                    onClick={() => onOpenProject(item.project.id)}
                  >
                    {item.project.title}
                    <ArrowUpRight size={13} />
                  </button>
                </div>
                <time dateTime={item.at}>{date(item.at)}</time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

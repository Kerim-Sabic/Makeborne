export type StudioTab = "projects" | "clients" | "styles" | "settings";
export type StudioRoute = { tab: StudioTab; projectId: string | null; clientId: string | null };
const tabs: StudioTab[] = ["projects", "clients", "styles", "settings"];
export function studioTab(value: string | null): StudioTab {
  return tabs.includes(value as StudioTab) ? value as StudioTab : "projects";
}
export function readStudioRoute(search: string, workspace: {
  projects: readonly { id: string }[]; clients: readonly { id: string }[];
}): StudioRoute & { notice?: string } {
  const query = new URLSearchParams(search);
  const tab = studioTab(query.get("tab"));
  const project = tab === "projects" ? query.get("project") : null;
  const client = tab === "clients" ? query.get("client") : null;
  const projectId = project && workspace.projects.some(item => item.id === project) ? project : null;
  const clientId = client && workspace.clients.some(item => item.id === client) ? client : null;
  return { tab, projectId, clientId,
    ...((project && !projectId) || (client && !clientId) ? {
      notice: "This item is not in this browser’s workspace. Local project links work only where the matching workspace is saved.",
    } : {}),
  };
}
export function studioHref(route: StudioRoute): string {
  const query = new URLSearchParams({ tab: route.tab });
  if (route.tab === "projects" && route.projectId) query.set("project", route.projectId);
  if (route.tab === "clients" && route.clientId) query.set("client", route.clientId);
  return `/studio?${query.toString()}`;
}

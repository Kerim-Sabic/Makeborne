export type StudioTab = "projects" | "clients" | "styles" | "settings";
export type AccountProjectRoute = { workspaceId: string; artifactId: string | null };
export type AccountClientRoute = { workspaceId: string; clientId: string | null };
export type StudioRoute = { tab: StudioTab; projectId: string | null; clientId: string | null; account?: AccountProjectRoute | null; accountClient?: AccountClientRoute | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tabs: StudioTab[] = ["projects", "clients", "styles", "settings"];
export function studioTab(value: string | null): StudioTab {
  return tabs.includes(value as StudioTab) ? value as StudioTab : "projects";
}
export function readStudioRoute(search: string, workspace: {
  projects: readonly { id: string }[]; clients: readonly { id: string }[];
}): StudioRoute & { notice?: string } {
  const query = new URLSearchParams(search);
  const tab = studioTab(query.get("tab"));
  const requestedWorkspace = tab === "projects" ? query.get("workspace") : null;
  const requestedArtifact = tab === "projects" ? query.get("artifact") : null;
  const account = requestedWorkspace && uuid.test(requestedWorkspace) && (!requestedArtifact || uuid.test(requestedArtifact))
    ? { workspaceId: requestedWorkspace, artifactId: requestedArtifact } : null;
  const invalidAccount = !!(requestedWorkspace || requestedArtifact) && !account;
  const project = tab === "projects" && !account ? query.get("project") : null;
  const clientWorkspace = tab === "clients" ? query.get("workspace") : null;
  const accountClientId = tab === "clients" ? query.get("accountClient") : null;
  const accountClient = clientWorkspace && uuid.test(clientWorkspace) && (!accountClientId || uuid.test(accountClientId))
    ? { workspaceId: clientWorkspace, clientId: accountClientId } : null;
  const invalidClient = !!(clientWorkspace || accountClientId) && !accountClient;
  const client = tab === "clients" && !accountClient && !invalidClient ? query.get("client") : null;
  const projectId = project && workspace.projects.some(item => item.id === project) ? project : null;
  const clientId = client && workspace.clients.some(item => item.id === client) ? client : null;
  return { tab, projectId, clientId, ...(account ? { account } : {}), ...(accountClient ? { accountClient } : {}),
    ...(invalidClient ? { notice: "This account client link is incomplete or invalid. Open the client from Clients." } : {}),
    ...(invalidAccount ? { notice: "This account project link is incomplete or invalid. Open the project from your saved projects." } : {}),
    ...((project && !projectId) || (client && !clientId) ? {
      notice: "This item is not in this browser’s workspace. Local project links work only where the matching workspace is saved.",
    } : {}),
  };
}
export function studioHref(route: StudioRoute): string {
  const query = new URLSearchParams({ tab: route.tab });
  if (route.tab === "projects" && route.account) {
    if (!uuid.test(route.account.workspaceId) || (route.account.artifactId && !uuid.test(route.account.artifactId))) throw new Error("Invalid account project route.");
    query.set("workspace", route.account.workspaceId);
    if (route.account.artifactId) query.set("artifact", route.account.artifactId);
  } else if (route.tab === "projects" && route.projectId) query.set("project", route.projectId);
  if (route.tab === "clients" && route.accountClient) {
    if (!uuid.test(route.accountClient.workspaceId) || (route.accountClient.clientId && !uuid.test(route.accountClient.clientId))) throw new Error("Invalid account client route.");
    query.set("workspace", route.accountClient.workspaceId);
    if (route.accountClient.clientId) query.set("accountClient", route.accountClient.clientId);
  } else if (route.tab === "clients" && route.clientId) query.set("client", route.clientId);
  return `/studio?${query.toString()}`;
}

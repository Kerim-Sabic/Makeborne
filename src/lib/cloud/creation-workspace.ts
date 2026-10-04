import type { CloudWorkspace } from "./contracts";

/** A client handoff must never silently fall back to a different workspace. */
export function creationWorkspace(workspaces: CloudWorkspace[], requestedId?: string | null): CloudWorkspace | null {
  if (requestedId) {
    const requested = workspaces.find(item => item.id === requestedId);
    if (!requested) throw new Error("This client workspace is no longer available to your account. Close this form and check your access.");
    if (requested.role === "reviewer") throw new Error("You have read-only access to this client workspace. Ask its owner for editing access.");
    return requested;
  }
  const editable = workspaces.find(item => item.role === "owner") ?? workspaces.find(item => item.role === "editor") ?? null;
  if (!editable && workspaces.length) throw new Error("Your account has read-only access. Ask the workspace owner for editing access before creating a project.");
  return editable;
}

import type { Project } from "../components/studio-model";

/** Preserve the outgoing content before replacing it with a historical snapshot. */
export function restoreContentVersion(project: Project, versionId: string, safetyId: string, at: string): Project {
  const index = project.versions.findIndex(version => version.id === versionId);
  if (index < 0) throw new Error("This saved version could not be found.");
  if (project.versions.length >= 100)
    throw new Error("This project has 100 versions. Download a workspace backup before continuing; restoration needs room for a safety copy.");
  if (project.activity.length >= 2000)
    throw new Error("This project has reached its activity limit. Download a workspace backup before continuing.");
  return {
    ...project,
    blocks: structuredClone(project.versions[index].blocks),
    versions: [...project.versions, {
      id: safetyId, at, blocks: structuredClone(project.blocks),
      note: `Safety copy before restoring version ${index + 1}`,
    }],
    activity: [...project.activity, { at, text: `Restored content from version ${index + 1}; saved the previous content as a safety copy.` }],
    status: project.status === "approved" ? "in_progress" : project.status,
    updatedAt: at,
  };
}

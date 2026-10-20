/**
 * Personal checkpoints on saved versions (audit M11, the "bookmarks" P2 item).
 * A checkpoint is a private label for finding a version again: it is bound to
 * the immutable version id, kept in this browser for this account until
 * sign-out, and never changes, approves, checks or publishes the version.
 * Pure helpers; the component owns storage access. Client-safe.
 */

export const CHECKPOINT_LIMITS = { name: 80, note: 280, perProject: 50 } as const;
const STORE_VERSION = 1;

export type Checkpoint = { versionId: string; versionNumber: number; name: string; note: string; createdAt: string; updatedAt: string };
export type CheckpointScope = { accountId: string; workspaceId: string; artifactId: string };
type Store = { v: typeof STORE_VERSION; checkpoints: Checkpoint[] };

export const checkpointKey = (scope: CheckpointScope) => `makeborne.version-checkpoints.v1.${scope.accountId}.${scope.workspaceId}.${scope.artifactId}`;

/** Removes control and bidirectional-override characters and collapses whitespace; keeps every other script, emoji included. */
export function cleanLabel(value: string, max: number, multiline = false): string {
  const stripped = [...value].filter(char => { const code = char.codePointAt(0)!; return multiline && char === "\n" ? true : code >= 0x20 && !(code >= 0x7f && code <= 0x9f) && code !== 0x2028 && code !== 0x2029 && !(code >= 0x202a && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069); }).join("");
  const tidy = multiline ? stripped.split("\n").map(line => line.replace(/\s+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim() : stripped.replace(/\s+/g, " ").trim();
  return [...tidy].slice(0, max).join("");
}

export function parseCheckpoints(raw: string | null): Checkpoint[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as Partial<Store>;
    if (!value || value.v !== STORE_VERSION || !Array.isArray(value.checkpoints)) return [];
    const seen = new Set<string>();
    return value.checkpoints.filter((item): item is Checkpoint => !!item && typeof item.versionId === "string" && item.versionId.length > 0 && item.versionId.length <= 64
      && Number.isInteger(item.versionNumber) && item.versionNumber > 0 && typeof item.name === "string" && typeof item.note === "string"
      && typeof item.createdAt === "string" && typeof item.updatedAt === "string")
      .filter(item => !seen.has(item.versionId) && (seen.add(item.versionId), true))
      .map(item => ({ ...item, name: cleanLabel(item.name, CHECKPOINT_LIMITS.name) || `Version ${item.versionNumber}`, note: cleanLabel(item.note, CHECKPOINT_LIMITS.note, true) }))
      .slice(0, CHECKPOINT_LIMITS.perProject);
  } catch { return []; }
}

export const serializeCheckpoints = (checkpoints: Checkpoint[]) => JSON.stringify({ v: STORE_VERSION, checkpoints } satisfies Store);

export type CheckpointEdit = { ok: true; checkpoints: Checkpoint[] } | { ok: false; message: string };

/** Adds or renames the checkpoint for one version. One checkpoint per version; repeated saves update it in place. */
export function saveCheckpoint(list: Checkpoint[], version: { id: string; number: number }, name: string, note: string, now = new Date().toISOString()): CheckpointEdit {
  const cleanName = cleanLabel(name, CHECKPOINT_LIMITS.name), cleanNote = cleanLabel(note, CHECKPOINT_LIMITS.note, true);
  if (!cleanName) return { ok: false, message: "Give the checkpoint a name." };
  const existing = list.find(item => item.versionId === version.id);
  if (!existing && list.length >= CHECKPOINT_LIMITS.perProject) return { ok: false, message: `You can keep up to ${CHECKPOINT_LIMITS.perProject} checkpoints per project. Remove one first.` };
  const next: Checkpoint = existing ? { ...existing, name: cleanName, note: cleanNote, updatedAt: now } : { versionId: version.id, versionNumber: version.number, name: cleanName, note: cleanNote, createdAt: now, updatedAt: now };
  return { ok: true, checkpoints: existing ? list.map(item => item.versionId === version.id ? next : item) : [...list, next] };
}

/** Removes only the label. The version, its content and anything published from it are untouched. */
export const removeCheckpoint = (list: Checkpoint[], versionId: string) => list.filter(item => item.versionId !== versionId);

export type CheckpointPlace = { checkpoint: Checkpoint; state: "loaded" | "not-loaded" | "missing" };
/**
 * Where each checkpoint's version is in the loaded history. A version that is
 * older than the loaded page is "not loaded" (load earlier versions), never
 * reported as gone; a number now held by a different version id is "missing"
 * and is not silently retargeted.
 */
export function placeCheckpoints(list: Checkpoint[], loaded: { id: string; number: number }[], moreToLoad: boolean): CheckpointPlace[] {
  const ids = new Set(loaded.map(version => version.id));
  const byNumber = new Map(loaded.map(version => [version.number, version.id]));
  const oldest = loaded.length ? Math.min(...loaded.map(version => version.number)) : Infinity;
  return [...list].sort((a, b) => b.versionNumber - a.versionNumber).map(checkpoint => ({
    checkpoint,
    state: ids.has(checkpoint.versionId) ? "loaded" : moreToLoad && checkpoint.versionNumber < oldest && !byNumber.has(checkpoint.versionNumber) ? "not-loaded" : "missing",
  }));
}

import { fileBlocks, type ProjectFiles } from "./files";

/**
 * The cached site snapshot. A website run's first request starts with the tools, the system prompt and one snapshot of
 * the site, each ending at a 5-minute cache marker; everything that changes per request follows it (the project details,
 * the files changed since the snapshot, the images, the request). A run that starts while an earlier run's cache lives
 * reads that prefix (on Claude Opus 5.5 at a twenty-fifth of the write price) instead of writing it again; a repair attempt
 * in the same run does too.
 *
 * Which version is the snapshot (the anchor) follows from the saved versions alone, so every run recomputes exactly the
 * anchor the run before it sent: versions are grouped in fixed blocks of SNAPSHOT_BLOCK (v1–v6, v7–v12, ...); in a block
 * the first version with files is the anchor, and it stays the anchor while the files changed since are at most
 * SNAPSHOT_CHANGE_SHARE of the site, otherwise that version becomes the anchor. A cache that has expired only costs the
 * changed files written once more; spending is reserved from the cache usage the provider reports
 * (../ai/anthropic-call.ts), never from this layout.
 */
export const SNAPSHOT_BLOCK = 6;
/** Keeping the snapshot stays cheaper than writing a new one until the changes are about 96% of the site (a cache read costs
 * 1/25 of a write); the limit is lower so the request never carries more than three quarters of the site twice. At 50%, two
 * edits that touch the main stylesheet (often half a site) already forced a new snapshot (8 sessions, 23 Oct). */
export const SNAPSHOT_CHANGE_SHARE = 0.75;

export type SnapshotVersion = { number: number; files: ReadonlyMap<string, string> };

const size = (files: ReadonlyMap<string, string>) => [...files.values()].reduce((total, content) => total + content.length, 0);
/** Characters the changes block carries for `files` against `anchor`: changed and added files in full, deleted paths. */
function changedSize(anchor: ReadonlyMap<string, string>, files: ReadonlyMap<string, string>) {
  let total = 0;
  for (const [path, content] of files) if (anchor.get(path) !== content) total += content.length;
  for (const path of anchor.keys()) if (!files.has(path)) total += path.length;
  return total;
}
const fits = (anchor: SnapshotVersion, files: ReadonlyMap<string, string>) => changedSize(anchor.files, files) <= SNAPSHOT_CHANGE_SHARE * size(files);

/** The snapshot for a run that starts from version `current` (null: no files to snapshot). `versions` are the saved
 * versions at hand; when one in the current block is missing, the current version is its own snapshot. */
export function snapshotAnchor(versions: readonly SnapshotVersion[], current: number): SnapshotVersion | null {
  const byNumber = new Map(versions.map(version => [version.number, version]));
  const own = byNumber.get(current);
  if (!own?.files.size) return null;
  let anchor: SnapshotVersion | null = null;
  for (let number = current - ((current - 1) % SNAPSHOT_BLOCK); number <= current; number++) {
    const version = byNumber.get(number);
    if (!version) return own;
    if (!version.files.size) anchor = null;
    else if (!anchor || !fits(anchor, version.files)) anchor = version;
  }
  return anchor;
}

/** The cacheable block: byte-identical whenever the same version is the snapshot. */
export function snapshotText(anchor: SnapshotVersion) {
  return `<current_files snapshot="v${anchor.number}">\n${fileBlocks(anchor.files)}\n</current_files>`;
}

/** The request's own part about files: what changed since the snapshot (current content in full, replacing the
 * snapshot's copy; deleted paths), then the project's images. */
export function filesSince(anchor: SnapshotVersion, files: ProjectFiles) {
  const changed = new Map([...files.files].filter(([path, content]) => anchor.files.get(path) !== content));
  const deleted = [...anchor.files.keys()].filter(path => !files.files.has(path)).sort();
  const images = `Existing images: ${[...files.assets.values()].map(asset => `/${asset.path.slice(7)}`).join(", ") || "none"}`;
  if (!changed.size && !deleted.length) return `The files in the snapshot above are current.\n${images}`;
  return [`<changes_since_snapshot>`,
    `The project changed after the snapshot above (v${anchor.number}). ${changed.size ? "These files are current: their content below replaces the snapshot's copy." : ""}${deleted.length ? ` Deleted since: ${deleted.join(", ")}.` : ""}`.trim(),
    ...(changed.size ? [fileBlocks(changed)] : []), `</changes_since_snapshot>`, images].join("\n");
}

/** A saved version's files, for snapshotAnchor. */
export function snapshotVersion(version: { number: number; content: { websiteSource?: { files: Array<{ path: string; content: string }> } } }): SnapshotVersion {
  return { number: version.number, files: new Map((version.content.websiteSource?.files ?? []).map(file => [file.path, file.content])) };
}

/** Exact identity: middle edits, Unicode, renamed files and removals all matter.
 * Sorted paths make a reordered but identical file map keep the same revision.
 * Do not replace contents with length/tail summaries or a collision-prone hash.
 */
export function previewFileRevision(files: Readonly<Record<string, string>>) {
  return JSON.stringify(Object.keys(files).sort().map(path => [path, files[path]]));
}

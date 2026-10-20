/**
 * Which version a pre-publish check describes (audit M07: separate saved,
 * checked and public versions). A result is tied to the exact content it read;
 * any later edit or save makes it out of date instead of silently standing in
 * for the new content. Client-safe.
 */

/** Exact identity of what a check read: the full source (assets are listed by hash, not bytes) plus check-specific settings. */
export function checkedFingerprint(source: unknown, settings: unknown = null): string {
  return JSON.stringify([source, settings]);
}

export type CheckedScope = { fingerprint: string; version: number; dirty: boolean };

export function checkedLabel(scope: Pick<CheckedScope, "version" | "dirty">): string {
  if (scope.version < 1) return "Checked your unsaved draft";
  return scope.dirty ? `Checked version ${scope.version} with unsaved changes` : `Checked saved version ${scope.version}`;
}

export function checkIsCurrent(scope: CheckedScope | null, fingerprint: string, version: number, dirty: boolean): boolean {
  return !!scope && scope.fingerprint === fingerprint && scope.version === version && scope.dirty === dirty;
}

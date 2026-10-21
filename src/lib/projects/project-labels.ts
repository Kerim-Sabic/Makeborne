/**
 * Library card metadata. Each label names what its date measures, so a card
 * never presents one kind of activity as another.
 *
 * Account projects: the listing's only date is `artifacts.updated_at`. It moves
 * only when a version is saved (`makeborne_save_artifact_version` advances
 * `current_version` and copies the saved title); chat messages, plans,
 * previews, checks and publishing never write the artifact row, which an
 * offline check guards. So it is the saved-source time, labelled as such. Last
 * chat activity, a rendered preview's time and the published version are not
 * part of this listing, so a card does not claim them.
 */
export type SavedSourceMeta = { label: string; at: string };

export function savedSourceMeta(artifact: { currentVersion: number; createdAt: string; updatedAt: string }, format: (iso: string) => string): SavedSourceMeta {
  if (artifact.currentVersion < 1) return { label: `New draft · created ${format(artifact.createdAt)}`, at: artifact.createdAt };
  return { label: `Version ${artifact.currentVersion} · saved ${format(artifact.updatedAt)}`, at: artifact.updatedAt };
}

/** Short day and month in the viewer's locale (with the year when it is not this year); an unreadable date says so instead of "Invalid Date". */
export function shortDate(iso: string): string {
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? "date unknown" : value.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(value.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

/**
 * Library card dates: today and yesterday keep the time of day, so several
 * projects saved on the same day can still be told apart; older dates are the
 * short day and month. The viewer's own clock and locale decide "today".
 */
export function libraryDate(iso: string, now: Date = new Date()): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "date unknown";
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(value)) / 86_400_000);
  const time = () => value.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `today, ${time()}`;
  if (days === 1) return `yesterday, ${time()}`;
  return value.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(value.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

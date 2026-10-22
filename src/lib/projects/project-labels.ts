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

/**
 * How long ago, in words, for the line under a grid card's title: "just now",
 * "5 minutes ago", "3 hours ago", "yesterday", "4 days ago", then the day
 * itself ("on Oct 3") once it is a week or more old. A time ahead of this clock
 * by more than a few minutes is named by its day rather than called "just now".
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "at an unknown time";
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const onDay = () => `on ${value.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(value.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) })}`;
  const seconds = (now.getTime() - value.getTime()) / 1000;
  if (seconds < -300) return onDay();
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.max(1, Math.round((day(now) - day(value)) / 86_400_000));
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return onDay();
}

/**
 * The grid card's short time line. Like `savedSourceMeta`, it names what the
 * date measures: the saved-source time ("Saved 5 minutes ago"), or, with no
 * saved version yet, when the project was created. The full label (version and
 * time of day) stays in the line's tooltip and the list view.
 */
export function savedAgo(artifact: { currentVersion: number; createdAt: string; updatedAt: string }, now: Date = new Date()): SavedSourceMeta {
  if (artifact.currentVersion < 1) return { label: `Created ${relativeTime(artifact.createdAt, now)}`, at: artifact.createdAt };
  return { label: `Saved ${relativeTime(artifact.updatedAt, now)}`, at: artifact.updatedAt };
}

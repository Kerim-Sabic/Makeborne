import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Review link view tracking. Stored per tab session: times, bounded seconds,
 * a coarse device class and seconds per slide/page/section. Never an IP
 * address, user agent string, cookie, name or email. */

export const VIEW_DEVICES = ["phone", "tablet", "desktop"] as const;
export type ViewDevice = (typeof VIEW_DEVICES)[number];
export const VIEW_REF = /^[A-Za-z0-9:_.-]{1,100}$/;
/** Matches the database: at most 20 slices and 60 seconds per heartbeat. */
export const MAX_SLICES = 20;
export const MAX_BEAT_SECONDS = 60;
export const BEAT_INTERVAL_MS = 15_000;
export const MAX_BEAT_BYTES = 4_000;

export const ViewSliceSchema = z.object({
  ref: z.string().regex(VIEW_REF),
  label: z.string().max(160).default(""),
  seconds: z.number().int().min(0).max(MAX_BEAT_SECONDS),
}).strict();
export type ViewSlice = z.infer<typeof ViewSliceSchema>;

export const ViewBeatSchema = z.object({
  session: z.string().uuid(),
  device: z.enum(VIEW_DEVICES),
  open: z.boolean(),
  slices: z.array(ViewSliceSchema).max(MAX_SLICES),
}).strict();
export type ViewBeat = z.infer<typeof ViewBeatSchema>;

/** Coarse class from the screen's short side and pointer type; only the class is sent. */
export function deviceClass(shortSide: number, coarsePointer: boolean): ViewDevice {
  if (shortSide > 0 && shortSide < 600) return "phone";
  if (coarsePointer && shortSide < 1100) return "tablet";
  return "desktop";
}

/** Accumulates visible time per location between heartbeats. Pure: the caller passes the clock. */
export class ViewClock {
  private entries = new Map<string, { label: string; ms: number; reported: boolean }>();
  private current: { ref: string; label: string } | null = null;
  private since: number | null;

  constructor(now: number, visible: boolean) { this.since = visible ? now : null; }

  private tick(now: number) {
    if (this.since !== null && this.current) {
      const entry = this.entries.get(this.current.ref);
      if (entry) entry.ms += Math.max(0, now - this.since);
    }
    if (this.since !== null) this.since = now;
  }

  setLocation(ref: string, label: string, now: number) {
    if (!VIEW_REF.test(ref)) return;
    this.tick(now);
    const clean = label.replace(/\s+/g, " ").trim().slice(0, 160);
    this.current = { ref, label: clean };
    const entry = this.entries.get(ref);
    if (entry) entry.label = clean;
    else this.entries.set(ref, { label: clean, ms: 0, reported: false });
  }

  setVisible(visible: boolean, now: number) {
    this.tick(now);
    this.since = visible ? now : null;
  }

  /** Slices since the last call: new locations (even at 0 s) and any time spent.
   * At most 20 slices and 60 seconds in total, most time first. */
  take(now: number): ViewSlice[] {
    this.tick(now);
    const out: ViewSlice[] = [];
    for (const [ref, entry] of this.entries) {
      const seconds = Math.min(MAX_BEAT_SECONDS, Math.round(entry.ms / 1000));
      if (seconds > 0 || !entry.reported) out.push({ ref, label: entry.label, seconds });
    }
    out.sort((a, b) => b.seconds - a.seconds);
    let budget = MAX_BEAT_SECONDS;
    const slices = out.slice(0, MAX_SLICES).map(slice => {
      const seconds = Math.min(slice.seconds, budget);
      budget -= seconds;
      return { ...slice, seconds };
    });
    this.entries = new Map();
    if (this.current) this.entries.set(this.current.ref, { label: this.current.label, ms: 0, reported: true });
    return slices;
  }
}

// ---------------------------------------------------------------------------
// Owner summaries.
// ---------------------------------------------------------------------------
export type ViewRow = {
  link_id: string; started_at: string; last_seen_at: string; active_seconds: number; opens: number;
  device: string; pages: unknown;
};
export type PageTime = { ref: string; label: string; seconds: number; share: number };
export type ViewSummary = {
  opens: number;
  sessions: number;
  totalSeconds: number;
  lastOpenedAt: string | null;
  devices: Record<ViewDevice, number>;
  /** Most time first; at most 50. */
  pages: PageTime[];
  /** Latest sessions, newest first; at most 5. */
  recent: { at: string; seconds: number; device: ViewDevice }[];
};
/** "setup": the table isn't there yet. "error": it exists but couldn't be read right now. */
export type ReviewViews = { available: false; reason: "setup" | "error" } | { available: true; byLink: Record<string, ViewSummary> };

const clamp = (value: unknown, max: number) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(0, number)) : 0;
};
const deviceOf = (value: string): ViewDevice => (VIEW_DEVICES as readonly string[]).includes(value) ? value as ViewDevice : "desktop";

/** Natural order for refs: slide:2 before slide:10. */
function refOrder(a: string, b: string) {
  const [ta, na] = a.split(":"), [tb, nb] = b.split(":");
  if (ta !== tb) return ta < tb ? -1 : 1;
  const x = Number(na), y = Number(nb);
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Default label when a viewer didn't send one. */
export function viewRefLabel(ref: string, label = "") {
  const clean = label.trim();
  if (clean) return clean;
  const [type, value] = ref.split(":");
  const number = Number(value);
  if (type === "slide" && Number.isFinite(number)) return `Slide ${number + 1}`;
  if (type === "page" && value === undefined) return "Website";
  if (type === "page" && Number.isFinite(number)) return number === 0 ? "Cover" : `Page ${number}`;
  if (type === "chapter" && Number.isFinite(number)) return `Chapter ${number + 1}`;
  if (type === "section" && Number.isFinite(number)) return `Section ${number + 1}`;
  return "Page";
}

/** Rows of one link → totals, device mix, time per slide/page. Bounded and defensive. */
export function summariseViews(rows: ViewRow[]): ViewSummary {
  const devices: Record<ViewDevice, number> = { phone: 0, tablet: 0, desktop: 0 };
  const pages = new Map<string, { label: string; seconds: number; at: number }>();
  let opens = 0, totalSeconds = 0, last = 0;
  for (const row of rows) {
    const seconds = clamp(row.active_seconds, 14_400);
    opens += clamp(row.opens, 1000) || 1;
    totalSeconds += seconds;
    devices[deviceOf(row.device)]++;
    const seen = Date.parse(row.last_seen_at);
    if (Number.isFinite(seen) && seen > last) last = seen;
    if (row.pages && typeof row.pages === "object" && !Array.isArray(row.pages)) {
      for (const [ref, value] of Object.entries(row.pages as Record<string, unknown>).slice(0, 200)) {
        if (!VIEW_REF.test(ref) || !value || typeof value !== "object") continue;
        const entry = value as { s?: unknown; l?: unknown };
        const label = typeof entry.l === "string" ? entry.l.slice(0, 80) : "";
        const page = pages.get(ref) ?? { label: "", seconds: 0, at: 0 };
        page.seconds += clamp(entry.s, 14_400);
        // The label from the most recent session wins (slides can be renamed).
        if (label && (Number.isFinite(seen) ? seen : 0) >= page.at) { page.label = label; page.at = Number.isFinite(seen) ? seen : 0; }
        pages.set(ref, page);
      }
    }
  }
  const pageTotal = [...pages.values()].reduce((sum, page) => sum + page.seconds, 0);
  const list = [...pages.entries()]
    .map(([ref, page]) => ({ ref, label: viewRefLabel(ref, page.label), seconds: page.seconds, share: pageTotal ? Math.round(page.seconds / pageTotal * 1000) / 10 : 0 }))
    .sort((a, b) => b.seconds - a.seconds || refOrder(a.ref, b.ref))
    .slice(0, 50);
  const recent = [...rows]
    .filter(row => Number.isFinite(Date.parse(row.last_seen_at)))
    .sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))
    .slice(0, 5)
    .map(row => ({ at: new Date(row.last_seen_at).toISOString(), seconds: clamp(row.active_seconds, 14_400), device: deviceOf(row.device) }));
  return { opens, sessions: rows.length, totalSeconds, lastOpenedAt: last ? new Date(last).toISOString() : null, devices, pages: list, recent };
}

/** Slide/page list in reading order, for the per-slide bar list. */
export function pagesInOrder(pages: PageTime[]) {
  return [...pages].sort((a, b) => refOrder(a.ref, b.ref));
}

/** "Most time: Slide 6 · Pricing", or null when nothing held attention. */
export function mostTime(summary: Pick<ViewSummary, "pages">) {
  const top = summary.pages[0];
  return top && top.seconds > 0 ? top : null;
}

/** Plain, short durations: "45 sec", "4 min", "1 h 5 min". */
export function formatDuration(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  if (value < 60) return `${value} sec`;
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** "just now", "5 min ago", "2h ago", "yesterday", "3 days ago", then a date. */
export function relativeTime(value: string | null, now = Date.now()) {
  if (!value) return "never";
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "never";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString("en", { month: "short", day: "numeric", ...(days > 300 ? { year: "numeric" } : {}) });
}

/** "2 on desktop, 1 on a phone". */
export function deviceMix(devices: Record<ViewDevice, number>) {
  const words: Record<ViewDevice, [string, string]> = { desktop: ["on desktop", "on desktop"], phone: ["on a phone", "on phones"], tablet: ["on a tablet", "on tablets"] };
  return (["desktop", "phone", "tablet"] as const).filter(device => devices[device] > 0).map(device => `${devices[device]} ${words[device][devices[device] === 1 ? 0 : 1]}`).join(", ");
}

export const VIEW_COLUMNS = "link_id,started_at,last_seen_at,active_seconds,opens,device,pages";
const missingTable = (code?: string) => code === "42P01" || code === "PGRST205";

/** Members read through RLS. Views are secondary: a missing migration or a read
 * failure is reported in the result and never fails the review panel. */
export async function loadReviewViews(client: SupabaseClient, workspaceId: string, linkIds: string[]): Promise<ReviewViews> {
  if (!linkIds.length) return { available: true, byLink: {} };
  const { data, error } = await client.from("client_review_views").select(VIEW_COLUMNS)
    .eq("workspace_id", workspaceId).in("link_id", linkIds).order("last_seen_at", { ascending: false }).limit(3_000);
  if (error) return { available: false, reason: missingTable(error.code) ? "setup" : "error" };
  const grouped = new Map<string, ViewRow[]>();
  for (const row of (data ?? []) as unknown as ViewRow[]) {
    const list = grouped.get(row.link_id) ?? [];
    list.push(row);
    grouped.set(row.link_id, list);
  }
  return { available: true, byLink: Object.fromEntries([...grouped].map(([id, rows]) => [id, summariseViews(rows)])) };
}

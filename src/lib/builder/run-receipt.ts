/**
 * The receipt shown after a builder request: what was charged, what changed,
 * which checks ran, how long it took. Built only from what the server reported
 * on the stream (each step's terminal event carries its settled `charged`
 * credits) and from checks the client itself ran, so it never claims more than
 * is known. Pure and client-safe.
 */
export type RunMeter = {
  started: number;
  /** Steps (build, continuation, review) that ended or were refused. */
  steps: number;
  charged: number;
  /** False once any step ended without a settled charge (connection lost, recovery pending). */
  chargeKnown: boolean;
  files: Set<string>;
  items: Set<string>;
  saved: boolean;
  version: number | null;
  /** Whether the last step that saved passed the builder's finish check. */
  finished: boolean | null;
  /** The last saving step's build check: passed, could not run (unverified), or not reported (older servers). */
  build: "passed" | "unverified" | null;
  reviews: number;
  failed: boolean;
  /** The free final render check after automatic review rounds. */
  render: { ok: boolean } | null;
  /** Names of the source files sent with the request (the "Will be read" set); empty when none were sent. */
  sources: string[];
  /** The advisor brief this request came from ("Mira’s brief · revision 2"), when it carried one. */
  brief?: string;
  /** Which brief the first build used ("original": the client's own words). `improved`: the client asked for the free
   * brief improvement first; `credits` is that improvement's charge from its durable action (0 today), or null while
   * it is still being confirmed. It stays on the build's receipt whichever brief was then used. */
  enhanced?: EnhancedReceipt;
  /** The concept the first build chose, and its runners-up (names). */
  concept?: { chosen: string; runnersUp: string[] };
  /** Generated images: the model the router chose, its quality, size, reason and measured cost. */
  images: ReceiptImage[];
};

export type EnhancedReceipt = { mode: "enhanced" | "edited" | "analysis" | "original"; credits: number | null; improved?: boolean };

export type ReceiptImage = { path: string; model: string | null; quality: string | null; size: string | null; reason: string | null; costMicrousd: number | null };

export type RunReceipt = {
  charged: number | null;
  unlimited: boolean;
  saved: boolean;
  version: number | null;
  durationMs: number;
  files: string[];
  items: string[];
  /** Source files that were sent with this request. */
  sources: string[];
  /** The advisor brief recorded with this request, when there was one. */
  brief?: string;
  enhanced?: EnhancedReceipt;
  concept?: { chosen: string; runnersUp: string[] };
  checks: { ok: boolean; label: string }[];
  images: ReceiptImage[];
  /** This request saved nothing and the server settled it at zero credits. */
  notCharged: boolean;
};

export function newRunMeter(now = Date.now()): RunMeter {
  return { started: now, steps: 0, charged: 0, chargeKnown: true, files: new Set(), items: new Set(), saved: false, version: null, finished: null, build: null, reviews: 0, failed: false, render: null, sources: [], images: [] };
}

type StreamEvent = { type?: unknown; path?: unknown; label?: unknown; chosen?: unknown; runnersUp?: unknown; charged?: unknown; changed?: unknown; finished?: unknown; build?: unknown; version?: unknown;
  model?: unknown; quality?: unknown; size?: unknown; reason?: unknown; costMicrousd?: unknown };
const text = (value: unknown) => typeof value === "string" && value ? value.slice(0, 300) : null;
const credits = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Records one server-sent builder event. */
export function meterEvent(meter: RunMeter, event: StreamEvent) {
  switch (event.type) {
    case "file": case "delete":
      if (typeof event.path === "string") meter.files.add(event.path);
      break;
    case "image":
      if (typeof event.path === "string") meter.images.push({ path: event.path, model: text(event.model), quality: text(event.quality), size: text(event.size), reason: text(event.reason),
        costMicrousd: typeof event.costMicrousd === "number" && Number.isSafeInteger(event.costMicrousd) && event.costMicrousd >= 0 ? event.costMicrousd : null });
      break;
    case "item":
      if (typeof event.label === "string") meter.items.add(event.label);
      break;
    case "concept":
      if (typeof event.chosen === "string" && event.chosen.trim()) meter.concept = { chosen: event.chosen.slice(0, 48),
        runnersUp: Array.isArray(event.runnersUp) ? event.runnersUp.filter((name): name is string => typeof name === "string").slice(0, 2).map(name => name.slice(0, 48)) : [] };
      break;
    case "done": {
      meter.steps++;
      const charged = credits(event.charged);
      if (charged === null) meter.chargeKnown = false; else meter.charged += charged;
      if (event.changed !== false) {
        meter.saved = true;
        const version = Number(event.version);
        if (Number.isSafeInteger(version) && version > 0) meter.version = version;
        meter.finished = event.finished !== false;
        meter.build = event.build === "passed" || event.build === "unverified" ? event.build : null;
      }
      break;
    }
    case "error": {
      meter.steps++;
      meter.failed = true;
      const charged = credits(event.charged);
      if (charged === null) meter.chargeKnown = false; else meter.charged += charged;
      break;
    }
  }
}

/** The server refused the step before it ran (no stream): nothing was charged for it. */
export function meterRefused(meter: RunMeter) { meter.steps++; meter.failed = true; }
/** The stream ended without a terminal event: the charge must be checked on the server. */
export function meterLost(meter: RunMeter) { meter.steps++; meter.failed = true; meter.chargeKnown = false; }

export function runReceipt(meter: RunMeter, options: { website: boolean; unlimited: boolean; now?: number }): RunReceipt | null {
  if (!meter.steps) return null;
  const checks: RunReceipt["checks"] = [];
  if (options.website && meter.saved && meter.finished !== null) checks.push(meter.finished
    ? { ok: true, label: "Project check passed: required files, imports, fonts and icons" }
    : { ok: false, label: "Stopped before the final project check. Progress so far was saved" });
  if (options.website && meter.saved && meter.build) checks.push(meter.build === "passed"
    ? { ok: true, label: "Build check passed: the website compiles" }
    : { ok: false, label: "Build check could not run, so this version is saved but not verified to build. Check the preview before publishing" });
  if (meter.reviews) checks.push({ ok: true, label: `Design review: ${meter.reviews} round${meter.reviews === 1 ? "" : "s"} on desktop and mobile` });
  if (meter.render) checks.push(meter.render.ok
    ? { ok: true, label: "Final render: no runtime errors, broken images or sideways scrolling" }
    : { ok: false, label: "Final render needs attention (details above)" });
  const charged = meter.chargeKnown ? meter.charged : null;
  return {
    charged, unlimited: options.unlimited, saved: meter.saved, version: meter.version,
    durationMs: Math.max(0, (options.now ?? Date.now()) - meter.started),
    files: [...meter.files].sort(), items: [...meter.items], sources: [...meter.sources], ...(meter.brief ? { brief: meter.brief } : {}), ...(meter.enhanced ? { enhanced: { ...meter.enhanced } } : {}), ...(meter.concept ? { concept: { chosen: meter.concept.chosen, runnersUp: [...meter.concept.runnersUp] } } : {}), checks, images: meter.images.map(image => ({ ...image })),
    notCharged: !options.unlimited && charged === 0 && !meter.saved && meter.failed,
  };
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

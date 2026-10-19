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
  reviews: number;
  failed: boolean;
  /** The free final render check after automatic review rounds. */
  render: { ok: boolean } | null;
};

export type RunReceipt = {
  charged: number | null;
  unlimited: boolean;
  saved: boolean;
  version: number | null;
  durationMs: number;
  files: string[];
  items: string[];
  checks: { ok: boolean; label: string }[];
  /** This request saved nothing and the server settled it at zero credits. */
  notCharged: boolean;
};

export function newRunMeter(now = Date.now()): RunMeter {
  return { started: now, steps: 0, charged: 0, chargeKnown: true, files: new Set(), items: new Set(), saved: false, version: null, finished: null, reviews: 0, failed: false, render: null };
}

type StreamEvent = { type?: unknown; path?: unknown; label?: unknown; charged?: unknown; changed?: unknown; finished?: unknown; version?: unknown };
const credits = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Records one server-sent builder event. */
export function meterEvent(meter: RunMeter, event: StreamEvent) {
  switch (event.type) {
    case "file": case "delete":
      if (typeof event.path === "string") meter.files.add(event.path);
      break;
    case "item":
      if (typeof event.label === "string") meter.items.add(event.label);
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
  if (meter.reviews) checks.push({ ok: true, label: `Design review: ${meter.reviews} round${meter.reviews === 1 ? "" : "s"} on desktop and mobile` });
  if (meter.render) checks.push(meter.render.ok
    ? { ok: true, label: "Final render: no runtime errors, broken images or sideways scrolling" }
    : { ok: false, label: "Final render needs attention (details above)" });
  const charged = meter.chargeKnown ? meter.charged : null;
  return {
    charged, unlimited: options.unlimited, saved: meter.saved, version: meter.version,
    durationMs: Math.max(0, (options.now ?? Date.now()) - meter.started),
    files: [...meter.files].sort(), items: [...meter.items], checks,
    notCharged: !options.unlimited && charged === 0 && !meter.saved && meter.failed,
  };
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

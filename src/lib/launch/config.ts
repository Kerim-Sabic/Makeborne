import "server-only";
import { countdownEnabled, countdownOverride, launchDateText, launchPhase, parseLaunchAt, type LaunchPhase } from "./countdown";

/** Cookie set by `/?preview=site`: the owner and Codex see the normal home page before launch. */
export const PREVIEW_COOKIE = "makeborne_launch_preview";

/**
 * Launch countdown settings, read on the server at request time.
 * - NEXT_PUBLIC_MAKEBORNE_LAUNCH_AT: ISO UTC instant (default 2026-10-28T18:00:00Z).
 * - MAKEBORNE_LAUNCH_COUNTDOWN: exactly "on" shows it; unset defaults to on in this branch; anything else hides it.
 * Informational only: sales still follow WHOP_CREATION_ENABLED and the database plan gate.
 */
export function launchConfig() {
  const launchAt = parseLaunchAt(process.env.NEXT_PUBLIC_MAKEBORNE_LAUNCH_AT);
  return {
    enabled: countdownEnabled(process.env.MAKEBORNE_LAUNCH_COUNTDOWN),
    launchAt,
    // `?countdown=at:<iso>` forces a launch moment for testing, never on production.
    testOverrides: process.env.VERCEL_ENV !== "production" && process.env.VERCEL_TARGET_ENV !== "production",
  };
}

/** Everything a page needs to render the countdown identically on the server and in the browser. */
export function launchState(override?: string | string[]) {
  const config = launchConfig();
  const forced = config.testOverrides ? countdownOverride(override) : null;
  const launchAt = forced ?? config.launchAt;
  const serverNow = Date.now();
  const text = launchDateText(launchAt);
  const phase: LaunchPhase = launchPhase(serverNow, launchAt);
  return { enabled: config.enabled, testOverrides: config.testOverrides, forced: forced !== null, launchAt, launchIso: new Date(launchAt).toISOString(), serverNow, phase, text };
}

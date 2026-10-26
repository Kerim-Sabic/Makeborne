"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { announcement, countdownOverride, launchPhase, LIVE_WINDOW_MS, liveCopy, remaining, remainingLabel, shortRemaining, type LaunchPhase } from "@/lib/launch/countdown";
import { useClientValue, useLaunchClock } from "./use-launch-clock";
import "./launch-banner.css";

const DISMISS_KEY = "makeborne.launch-banner.dismissed";
/** Marketing pages that carry the banner. App, account, client review and portal pages never do. */
const PUBLIC_PAGES = /^\/(billing(\/terms)?|help(\/.*)?|privacy|terms|dpa|imprint|withdraw)\/?$/;
const PREVIEW_COOKIE = /(?:^|;\s*)makeborne_launch_preview=site(?:;|$)/;

// Runs before the first paint on hard loads. It hides the banner when it was dismissed this session, and keeps its
// space but hides its text when the server's phase is stale (a page prerendered before launch), until React has the clock.
const hideScript = (liveWindow: number) => `try{var b=document.getElementById("mb-launch-banner");if(b){var l=+b.getAttribute("data-launch-at"),n=Date.now(),p=n<l?"before":n<l+${liveWindow}?"live":"after";`
  + `if(sessionStorage.getItem(${JSON.stringify(DISMISS_KEY)})===b.getAttribute("data-phase"))b.setAttribute("data-dismissed","");if(p!==b.getAttribute("data-phase"))b.setAttribute("data-stale","")}}catch(e){}`;

/**
 * The slim launch banner. Before launch it counts down on public pages (and on the home page only when the
 * owner's preview shows the normal home page). For 48 hours after launch it says "We're live", with a plans link
 * only while the server says plans are on sale. It never opens or closes sales itself.
 */
export default function LaunchBanner({ launchAt: serverLaunchAt, serverPhase, dateShort, timeText, testOverrides }: {
  launchAt: number;
  serverPhase: LaunchPhase;
  dateShort: string;
  timeText: string;
  testOverrides: boolean;
}) {
  const pathname = usePathname();
  // Browser-only inputs, read after hydration: this session's dismissal, the owner's home preview and a test launch moment.
  const stored = useClientValue(readDismissed, null);
  const [dismissedNow, setDismissedNow] = useState<LaunchPhase | null>(null);
  const homePreview = useClientValue(readHomePreview, false);
  const forced = useClientValue(() => testOverrides ? countdownOverride(new URLSearchParams(window.location.search).get("countdown")) : null, null);
  const launchAt = forced ?? serverLaunchAt;
  const { now, salesOpen } = useLaunchClock({ launchAt, unit: corrected => !reduceMotion() && launchAt - corrected > 0 && launchAt - corrected <= 3_600_000 ? 1000 : 60000, watchSales: true, trustClient: forced !== null });
  const dismissed = dismissedNow ?? stored;

  // Until the browser's clock is read, render exactly what the server rendered.
  const phase = now === null ? serverPhase : launchPhase(now, launchAt);
  const onHome = pathname === "/";
  const visible = phase !== "after" && (onHome ? phase === "live" || homePreview : PUBLIC_PAGES.test(pathname ?? ""));
  if (!visible || dismissed === phase) return null;

  const dismiss = () => { setDismissedNow(phase); try { sessionStorage.setItem(DISMISS_KEY, phase); } catch { /* session only */ } };
  const left = remaining(now ?? launchAt, launchAt);
  const live = liveCopy(salesOpen);
  return <>
    <aside id="mb-launch-banner" className="mb-launch-banner" data-phase={phase} data-launch-at={launchAt} data-ready={now === null ? undefined : ""} aria-label="Makeborne launch" suppressHydrationWarning
      onKeyDown={event => { if (event.key === "Escape") dismiss(); }}>
      <p className="mb-launch-text">
        {phase === "before" ? <>
          <span className="mb-launch-spark" aria-hidden="true" />
          <span className="mb-launch-wide">Makeborne launches </span><span>{dateShort}, {timeText}</span>
          <span className="mb-launch-sep" aria-hidden="true">·</span>
          <span className="mb-launch-left" role="timer" aria-label={now === null ? "Time until launch" : remainingLabel(left)}>
            {now !== null && <span key={shortRemaining(left)} className="mb-launch-roll" aria-hidden="true">{shortRemaining(left)}</span>}
          </span>
        </> : <>
          <span className="mb-launch-spark is-live" aria-hidden="true" />
          <strong>{live.headline}</strong>
          {live.cta ? <><span className="mb-launch-sep" aria-hidden="true">·</span><Link href="/billing#plans" className="mb-launch-cta">{live.cta}<span aria-hidden="true"> →</span></Link></>
            : live.note ? <><span className="mb-launch-sep" aria-hidden="true">·</span><span className="mb-launch-note">{live.note}</span></> : null}
        </>}
      </p>
      <button type="button" className="mb-launch-close" aria-label="Dismiss launch announcement" onClick={dismiss}>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
      </button>
      <span className="mb-launch-sr" aria-live="polite">{now === null ? "" : phase === "before" ? announcement(left) : "Makeborne is live."}</span>
    </aside>
    <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: hideScript(LIVE_WINDOW_MS) }} />
  </>;
}

function readDismissed(): LaunchPhase | null {
  try { return sessionStorage.getItem(DISMISS_KEY) as LaunchPhase | null; } catch { return null; }
}
function readHomePreview() {
  const preview = new URLSearchParams(window.location.search).get("preview");
  return preview === "site" || (preview !== "off" && PREVIEW_COOKIE.test(document.cookie));
}
function reduceMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

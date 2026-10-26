"use client";
import Link from "next/link";
import { type ComponentType, useEffect, useRef, useState } from "react";
import BrandMark from "@/components/brand-mark";
import FlipClock from "./flip-clock";
import { useClientValue, useLaunchClock } from "./use-launch-clock";
import { announcement, localLaunchText, remaining, remainingLabel } from "@/lib/launch/countdown";
import { burstConfetti } from "./confetti";
import "./launch-screen.css";

type HomeProps = { initialEmail: string | null; accountsEnabled: boolean; trialCredits?: number | null };
type Stage = "count" | "zero" | "live" | "opening" | "done";
const loadHome = () => import("@/components/creation-home").then(module => module.default as ComponentType<HomeProps>);

/** How long each reveal step holds, in milliseconds (reduced motion: a short hold, then one cross-fade). */
const TIMING = { full: { zero: 650, live: 1700, opening: 1500 }, reduced: { zero: 0, live: 1200, opening: 650 } };

/**
 * The full-page launch screen on `/` before launch. At zero it reveals the real home page in place, with no reload:
 * the digits give way to "We're live", then the screen splits open over the home page underneath.
 * The home page's code loads only near zero (or at the reveal), never during the countdown itself.
 */
export default function LaunchScreen({ launchAt, serverNow, text, tagline, home, testMode = false }: {
  launchAt: number;
  /** A forced launch moment (non-production test override): the browser's own clock is trusted as it is. */
  testMode?: boolean;
  serverNow: number;
  text: { date: string; time: string; short: string };
  tagline: string;
  home: HomeProps;
}) {
  const { now, reduced } = useLaunchClock({ launchAt, initialNow: serverNow, unit: corrected => window.matchMedia("(prefers-reduced-motion: reduce)").matches && launchAt - corrected > 60_000 ? 60000 : 1000, trustClient: testMode });
  const left = remaining(now ?? serverNow, launchAt);
  const [stageState, setStage] = useState<Stage>("count");
  const [Home, setHome] = useState<ComponentType<HomeProps> | null>(null);
  // Client-only values after hydration: the visitor's own zone, and permission to animate.
  const local = useClientValue(() => localLaunchText(launchAt, visitorZone()), null);
  const hydrated = useClientValue(() => true, false);
  const confetti = useRef<HTMLCanvasElement>(null);
  const stopConfetti = useRef<(() => void) | null>(null);
  const loading = useRef<Promise<void> | null>(null);
  const timing = reduced ? TIMING.reduced : TIMING.full;

  const live = left.totalSeconds <= 0;
  // Fetch the home page's code shortly before zero so the reveal never waits on the network.
  const preload = live || left.totalSeconds <= 120;
  useEffect(() => {
    if (!preload || loading.current) return;
    loading.current = loadHome().then(component => setHome(() => component)).catch(() => { loading.current = null; });
  }, [preload]);

  // Reaching zero starts the reveal; every later step is timed below.
  const stage: Stage = stageState === "count" && live ? "zero" : stageState;
  const homeRef = useRef(Home);
  useEffect(() => { homeRef.current = Home; }, [Home]);
  useEffect(() => {
    if (stage === "count" || stage === "done") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (stage === "zero") timer = setTimeout(() => setStage("live"), timing.zero);
    else if (stage === "opening") timer = setTimeout(() => setStage("done"), timing.opening);
    else {
      // The burst outlives this step: it keeps falling while the screen opens, and stops on unmount.
      if (!reduced && confetti.current && !stopConfetti.current) stopConfetti.current = burstConfetti(confetti.current);
      let attempts = 0;
      const next = () => {
        if (homeRef.current) { setStage("opening"); return; }
        // The code could not load (offline, or a newer deployment): by now the server serves the home page itself.
        if (!loading.current && ++attempts > 3) { window.location.reload(); return; }
        if (!loading.current) loading.current = loadHome().then(component => setHome(() => component)).catch(() => { loading.current = null; });
        timer = setTimeout(next, 400);
      };
      timer = setTimeout(next, timing.live);
    }
    return () => clearTimeout(timer);
  }, [stage, reduced, timing]);
  useEffect(() => () => stopConfetti.current?.(), []);

  // While the screen is over the page, the page underneath doesn't scroll; afterwards keyboard focus starts at the top.
  useEffect(() => {
    if (stage !== "live" && stage !== "opening") return;
    const root = document.documentElement, previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest(".mbl")) document.activeElement.blur();
    };
  }, [stage]);

  const underneath = Home && stage !== "count" && stage !== "zero";
  return <>
    {underneath && <div className="mbl-underneath" inert={stage !== "done"}><Home {...home} /></div>}
    {stage !== "done" && <div className="mbl" data-stage={stage} data-animate={hydrated && !reduced ? "on" : "off"} data-launch-screen="">
      <div className="mbl-panel mbl-panel-top" aria-hidden="true"><div className="mbl-aura" /><div className="mbl-grain" /></div>
      <div className="mbl-panel mbl-panel-bottom" aria-hidden="true"><div className="mbl-aura" /><div className="mbl-grain" /></div>
      <span className="mbl-seam" aria-hidden="true" />
      <div className="mbl-sweep" aria-hidden="true" />
      <div className="mbl-content">
        <header className="mbl-header">
          <Link href="/" className="mbl-wordmark" aria-label="Makeborne home"><BrandMark size={28} tone="light" /><span>Makeborne</span></Link>
          <Link href="/login" className="mbl-signin">Sign in</Link>
        </header>
        <main className="mbl-main">
          <p className="mbl-eyebrow"><span className="mbl-dot" aria-hidden="true" />{stage === "count" || stage === "zero" ? "Launch countdown" : "Launch day"}</p>
          <div className="mbl-stack">
            <div className="mbl-clock" role="timer" aria-label={remainingLabel(left)}>
              <FlipClock left={left} animate={hydrated && !reduced} showSeconds={!reduced} />
            </div>
            <p className="mbl-live-title" aria-hidden={stage === "count"}><span>We&rsquo;re live</span></p>
          </div>
          <h1 className="mbl-date"><span className="mbl-date-lead">Makeborne launches </span><time dateTime={new Date(launchAt).toISOString()}>{text.date}<span className="mbl-date-sep"> · </span>{text.time}</time></h1>
          <p className="mbl-local">{local ?? " "}</p>
          <p className="mbl-tagline">{tagline}</p>
          <p className="mbl-sr" aria-live="polite">{hydrated ? announcement(left) : ""}</p>
        </main>
        <footer className="mbl-foot">
          <a className="mbl-follow" href="https://www.instagram.com/makeborne" target="_blank" rel="noopener noreferrer">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none" /></svg>
            Follow @makeborne
          </a>
          <nav className="mbl-foot-links" aria-label="Footer"><Link href="/billing">Pricing</Link><Link href="/help">Help</Link><Link href="/privacy">Privacy</Link></nav>
        </footer>
      </div>
      <canvas ref={confetti} className="mbl-confetti" aria-hidden="true" />
    </div>}
  </>;
}

function visitorZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
}

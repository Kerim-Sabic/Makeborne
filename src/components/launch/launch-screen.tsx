"use client";
import Link from "next/link";
import { type ComponentType, type CSSProperties, useEffect, useRef, useState } from "react";
import BrandMark from "@/components/brand-mark";
import RollClock from "./roll-clock";
import WaitlistForm from "./waitlist-form";
import { useClientValue, useLaunchClock } from "./use-launch-clock";
import { announcement, localLaunchText, remaining, remainingLabel } from "@/lib/launch/countdown";
import "./launch-screen.css";

type HomeProps = { initialEmail: string | null; accountsEnabled: boolean; trialCredits?: number | null };
type Stage = "count" | "zero" | "live" | "opening" | "done";
const loadHome = () => import("@/components/creation-home").then(module => module.default as ComponentType<HomeProps>);

/** How long each reveal step holds, in milliseconds. The split itself is 1.4 s (reduced motion: one short cross-fade). */
const TIMING = { full: { zero: 450, live: 1900, opening: 1500 }, reduced: { zero: 0, live: 1200, opening: 650 } };
const stagger = (index: number) => ({ "--i": index }) as CSSProperties;

/**
 * The full-page launch screen on `/` before launch. At zero it reveals the real home page in place, with no reload:
 * the figures roll away to "We're live.", then the screen splits and lifts off the home page underneath.
 * The home page's code loads only near zero (or at the reveal), never during the countdown itself.
 */
export default function LaunchScreen({ launchAt, serverNow, text, tagline, home, testMode = false, theme = "dark" }: {
  launchAt: number;
  serverNow: number;
  text: { date: string; time: string; short: string };
  tagline: string;
  home: HomeProps;
  /** A forced launch moment (non-production test override): the browser's own clock is trusted as it is. */
  testMode?: boolean;
  /** Dark is the launch look; `?theme=light` shows the light variant. */
  theme?: "dark" | "light";
}) {
  const { now, reduced } = useLaunchClock({ launchAt, initialNow: serverNow, unit: corrected => window.matchMedia("(prefers-reduced-motion: reduce)").matches && launchAt - corrected > 60_000 ? 60000 : 1000, trustClient: testMode });
  const left = remaining(now ?? serverNow, launchAt);
  const [stageState, setStage] = useState<Stage>("count");
  const [Home, setHome] = useState<ComponentType<HomeProps> | null>(null);
  // Client-only values after hydration: the visitor's own zone, and permission to animate.
  const local = useClientValue(() => localLaunchText(launchAt, visitorZone()), null);
  const hydrated = useClientValue(() => true, false);
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
  const counting = stage === "count" || stage === "zero";
  return <>
    {underneath && <div className="mbl-underneath" data-stage={stage} inert={stage !== "done"}><Home {...home} /></div>}
    {stage !== "done" && <div className="mbl" data-theme={theme} data-stage={stage} data-animate={hydrated && !reduced ? "on" : "off"} data-launch-screen="">
      <div className="mbl-panel mbl-panel-top" aria-hidden="true"><div className="mbl-tone" /></div>
      <div className="mbl-panel mbl-panel-bottom" aria-hidden="true"><div className="mbl-tone" /></div>
      <span className="mbl-seam" aria-hidden="true" />
      <div className="mbl-content">
        <header className="mbl-header mbl-in" style={stagger(0)}>
          <Link href="/" className="mbl-wordmark" aria-label="Makeborne home"><BrandMark size={24} tone={theme === "light" ? "ink" : "light"} /><span>Makeborne</span></Link>
          <p className="mbl-meta"><span>Public launch</span><span className="mbl-meta-rule" aria-hidden="true" /><time dateTime={new Date(launchAt).toISOString()}>{text.short} · {text.time}</time></p>
        </header>
        <main className="mbl-main">
          <p className="mbl-eyebrow mbl-in" style={stagger(1)}><span className="mbl-dot" aria-hidden="true" />{counting ? "Countdown to launch" : "Now open"}</p>
          <div className="mbl-stage">
            <div className="mbl-clock" role="timer" aria-label={remainingLabel(left)}>
              <RollClock left={left} animate={hydrated && !reduced} showSeconds={!reduced} />
            </div>
            <p className="mbl-live-word" aria-hidden={counting}><span>We&rsquo;re live</span><span className="mbl-accent">.</span></p>
          </div>
          <div className="mbl-details">
            <h1 className="mbl-date mbl-in" style={stagger(7)}><span className="mbl-date-lead">Makeborne launches </span><time dateTime={new Date(launchAt).toISOString()}>{text.date}<span className="mbl-date-sep"> · </span>{text.time}</time></h1>
            <p className="mbl-local mbl-in" style={stagger(8)}>{local ?? " "}</p>
            <p className="mbl-tagline mbl-in" style={stagger(9)}>{tagline}</p>
            <div className="mbl-in" style={stagger(10)}><WaitlistForm /></div>
          </div>
          <p className="mbl-sr" aria-live="polite">{hydrated ? announcement(left) : ""}</p>
        </main>
        <footer className="mbl-foot mbl-in" style={stagger(11)}>
          <span>© 2026 Makeborne</span>
          <a className="mbl-follow" href="https://www.instagram.com/makeborne" target="_blank" rel="noopener noreferrer">
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none" /></svg>
            Follow @makeborne<span aria-hidden="true"> ↗</span>
          </a>
        </footer>
      </div>
    </div>}
  </>;
}

function visitorZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
}

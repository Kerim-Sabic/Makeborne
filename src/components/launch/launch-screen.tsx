"use client";
import Link from "next/link";
import { type ComponentType, type CSSProperties, useEffect, useRef, useState, useSyncExternalStore } from "react";
import BrandMark from "@/components/brand-mark";
import RollClock, { FinalSeconds } from "./roll-clock";
import LaunchBackdrop from "./launch-backdrop";
import { launchFont } from "./launch-font";
import SoundToggle, { useLaunchSound } from "./sound-toggle";
import WaitlistForm from "./waitlist-form";
import { useClientValue, useLaunchClock } from "./use-launch-clock";
import { announcement, localLaunchText, remaining, remainingLabel } from "@/lib/launch/countdown";
import "./launch-screen.css";

type HomeProps = { initialEmail: string | null; accountsEnabled: boolean; trialCredits?: number | null };
type Stage = "count" | "zero" | "live" | "opening" | "done";
const loadHome = () => import("@/components/creation-home").then(module => module.default as ComponentType<HomeProps>);

/** How long each reveal step holds, in milliseconds. The iris itself is about 1 s (reduced motion: one short cross-fade). */
const TIMING = { full: { zero: 450, live: 1900, opening: 1450 }, reduced: { zero: 0, live: 1200, opening: 650 } };
const stagger = (index: number) => ({ "--i": index }) as CSSProperties;

/**
 * The full-page launch screen on `/` before launch. At zero it reveals the real home page in place, with no reload:
 * the figures roll away to "We're live.", then the accent full stop opens as an iris onto the live home page
 * underneath (a hard-edged circle, about 1 s), and the dawn-coloured light of the countdown meets the home page's own.
 * The home page's code loads only near zero (or at the reveal), never during the countdown itself.
 */
export default function LaunchScreen({ launchAt, serverNow, text, tagline, home, testMode = false, theme = "dark", waitlistCount = null }: {
  launchAt: number;
  serverNow: number;
  text: { date: string; time: string; short: string };
  tagline: string;
  home: HomeProps;
  /** A forced launch moment (non-production test override): the browser's own clock is trusted as it is. */
  testMode?: boolean;
  /** Dark is the launch look; `?theme=light` shows the light variant. */
  theme?: "dark" | "light";
  /** The real waitlist size, rounded down to tens; null hides the line (unknown, or fewer than 50). */
  waitlistCount?: number | null;
}) {
  const { now, reduced } = useLaunchClock({ launchAt, initialNow: serverNow, unit: corrected => window.matchMedia("(prefers-reduced-motion: reduce)").matches && launchAt - corrected > 60_000 ? 60000 : 1000, trustClient: testMode });
  const left = remaining(now ?? serverNow, launchAt);
  const [stageState, setStage] = useState<Stage>("count");
  const [Home, setHome] = useState<ComponentType<HomeProps> | null>(null);
  // Client-only values after hydration: the visitor's own zone, and permission to animate.
  const local = useClientValue(() => localLaunchText(launchAt, visitorZone()), null);
  const hydrated = useClientValue(() => true, false);
  // Everything that moves stops while the tab is hidden.
  const hidden = useSyncExternalStore(subscribeVisibility, () => document.hidden, () => false);
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
  const animate = hydrated && !reduced;
  // The final minute: the seconds take the stage and breathe once a second, through zero until "We're live." takes over.
  // Reduced motion keeps the calm minute-by-minute clock instead.
  const final = animate && stage !== "done" && left.totalSeconds <= 60;
  // Optional sound (off by default, started only by the visitor): a soft tick each second and a swell at the reveal.
  const sound = useLaunchSound({ seconds: left.totalSeconds, stage, soft: reduced, hidden });
  // The iris opens from the accent full stop of "We're live.", wherever it sits on this screen.
  const accent = useRef<HTMLSpanElement>(null);
  const [iris, setIris] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (stage !== "live" || iris) return;
    const timer = setTimeout(() => {
      const box = accent.current?.getBoundingClientRect();
      setIris(box ? { x: box.left + box.width / 2, y: box.top + box.height * 0.78 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }, 1600);
    return () => clearTimeout(timer);
  }, [stage, iris]);
  return <>
    {underneath && <div className="mbl-underneath" data-stage={stage} inert={stage !== "done"}
      style={iris ? { "--rx": `${Math.round(iris.x)}px`, "--ry": `${Math.round(iris.y)}px` } as CSSProperties : undefined}><Home {...home} /></div>}
    {stage !== "done" && <div className={`mbl ${launchFont.variable}`} data-theme={theme} data-stage={stage} data-animate={animate ? "on" : "off"} data-final={final ? "" : undefined} data-paused={hidden ? "" : undefined} data-launch-screen="">
      <LaunchBackdrop animate={animate && !hidden} active={counting && !hidden} />
      <div className="mbl-content">
        <header className="mbl-header mbl-in" style={stagger(0)}>
          <Link href="/" className="mbl-wordmark" aria-label="Makeborne home"><BrandMark size={24} tone={theme === "light" ? "ink" : "light"} /><span>Makeborne</span></Link>
          <div className="mbl-header-actions">
          <SoundToggle sound={sound} />
          <a className="mbl-follow" href="https://www.instagram.com/makeborne" target="_blank" rel="noopener noreferrer">
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none" /></svg>
            <span className="mbl-follow-text">Follow @makeborne</span>
          </a>
          </div>
        </header>
        <main className="mbl-main">
          <p className="mbl-eyebrow mbl-in" style={stagger(1)}><span className="mbl-dot" aria-hidden="true" />{final && counting ? "The final minute" : counting ? "Launching soon" : "Now open"}</p>
          <div className="mbl-stage">
            <div className="mbl-clock" role="timer" aria-label={remainingLabel(left)}>
              <RollClock left={left} animate={animate} showSeconds={!reduced} />
            </div>
            {final && <FinalSeconds left={left} animate={animate} />}
            <p className="mbl-live-word" aria-hidden={counting}><span>We&rsquo;re live</span><span ref={accent} className="mbl-accent">.</span></p>
          </div>
          <div className="mbl-details">
            <h1 className="mbl-date mbl-in" style={stagger(7)}>{counting
              ? <><span className="mbl-date-lead">Makeborne launches </span><time dateTime={new Date(launchAt).toISOString()}>{text.date}<span className="mbl-date-sep"> · </span>{text.time}</time></>
              : <><span className="mbl-date-lead">Makeborne is live </span><time dateTime={new Date(launchAt).toISOString()}>since {text.time}</time></>}</h1>
            <p className="mbl-local mbl-in" style={stagger(8)}>{local ?? " "}</p>
            <p className="mbl-tagline mbl-in" style={stagger(9)}>{tagline}</p>
            <div className="mbl-waitlist-slot mbl-in" style={stagger(10)}><WaitlistForm count={waitlistCount} /></div>
          </div>
          <p className="mbl-sr" aria-live="polite">{hydrated ? announcement(left) : ""}</p>
        </main>
        <footer className="mbl-foot mbl-in" style={stagger(11)}>
          <span>© 2026 Makeborne</span>
          <Link href="/privacy" prefetch={false} className="mbl-foot-link">Privacy</Link>
        </footer>
      </div>
    </div>}
  </>;
}

function visitorZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
}

function subscribeVisibility(change: () => void) {
  document.addEventListener("visibilitychange", change);
  return () => document.removeEventListener("visibilitychange", change);
}

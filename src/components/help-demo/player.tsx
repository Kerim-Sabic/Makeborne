"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { captionsOf, type DemoState, type DemoStep } from "./engine";
import { DEMO_SCRIPTS, type DemoId } from "./scripts";
import { SCENES } from "./scenes";
import "./demo.css";

const WIDTH = 880, HEIGHT = 540;
type Cursor = { x: number; y: number; down: boolean; ms: number };

/**
 * Plays one pre-written demo: a cursor that moves, clicks and types across a
 * replica of the app. Starts when scrolled into view, loops, and pauses when
 * hidden. With reduced motion it waits for Play and jumps instead of gliding.
 */
export default function DemoPlayer({ id, autoPlay = true, compact = false }: { id: DemoId; autoPlay?: boolean; compact?: boolean }) {
  const script = DEMO_SCRIPTS[id], Scene = SCENES[id];
  // Stable across renders: the play loop and the autoplay effect depend on it.
  const captions = useMemo(() => captionsOf(script), [script]);
  const [state, setState] = useState<DemoState>(script.initial);
  const [cursor, setCursor] = useState<Cursor>({ x: WIDTH * 0.62, y: HEIGHT * 0.78, down: false, ms: 0 });
  const [ripples, setRipples] = useState<{ key: number; x: number; y: number }[]>([]);
  const [caption, setCaption] = useState(0);
  const [ghost, setGhost] = useState<{ title: string; sub?: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [scale, setScale] = useState(0);
  const frame = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null);
  const token = useRef(0), stepAt = useRef(0), userPaused = useRef(false), visible = useRef(false), reduced = useRef(false);
  const cursorAt = useRef(cursor);

  // Fit the fixed-size canvas to the available width.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / WIDTH)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const sleep = useCallback((ms: number, run: number) => new Promise<boolean>(resolve => setTimeout(() => resolve(token.current === run), reduced.current ? Math.min(ms, 350) : ms)), []);
  const point = useCallback((target: string) => {
    const root = stage.current, element = root?.querySelector<HTMLElement>(target.startsWith("@") ? target.slice(1) : `[data-demo="${target}"]`);
    if (!root || !element) {
      if (process.env.NODE_ENV !== "production") console.warn(`Demo ${id}: no target "${target}"`);
      return cursorAt.current;
    }
    const base = root.getBoundingClientRect(), box = element.getBoundingClientRect(), ratio = base.width / WIDTH || 1;
    const left = (box.left - base.left) / ratio, top = (box.top - base.top) / ratio, width = box.width / ratio, height = box.height / ratio;
    const aimLeft = element.dataset.demoAim === "left";
    return { x: aimLeft ? left + Math.min(56, width / 3) : left + width / 2, y: top + height / 2 };
  }, [id]);
  const moveTo = useCallback(async (target: string, ms: number, run: number) => {
    const next = point(target), distance = Math.hypot(next.x - cursorAt.current.x, next.y - cursorAt.current.y);
    const duration = reduced.current ? 0 : Math.round(Math.min(ms, 380 + distance * 0.9));
    cursorAt.current = { ...cursorAt.current, ...next, ms: duration };
    setCursor(cursorAt.current);
    return sleep(duration + 120, run);
  }, [point, sleep]);
  const press = useCallback(async (run: number, target: string) => {
    // The control under the cursor presses in with it, like a real click.
    const element = stage.current?.querySelector<HTMLElement>(target.startsWith("@") ? target.slice(1) : `[data-demo="${target}"]`);
    element?.classList.add("hd-pressed");
    cursorAt.current = { ...cursorAt.current, down: true, ms: 0 }; setCursor(cursorAt.current);
    setRipples(list => [...list.slice(-3), { key: Date.now() + Math.random(), x: cursorAt.current.x, y: cursorAt.current.y }]);
    const alive = await sleep(160, run);
    element?.classList.remove("hd-pressed");
    cursorAt.current = { ...cursorAt.current, down: false }; setCursor(cursorAt.current);
    return alive;
  }, [sleep]);

  const runStep = useCallback(async (step: DemoStep, run: number) => {
    if (step.do === "wait") { if (step.patch) setState(current => ({ ...current, ...step.patch })); return sleep(step.ms, run); }
    if (step.do === "move") return moveTo(step.target, step.ms ?? 900, run);
    if (step.do === "click") {
      if (!await moveTo(step.target, step.ms ?? 900, run) || !await press(run, step.target)) return false;
      if (step.patch) setState(current => ({ ...current, ...step.patch }));
      return sleep(520, run);
    }
    if (step.do === "type") {
      if (!await moveTo(step.target, step.ms ?? 900, run) || !await press(run, step.target)) return false;
      setState(current => ({ ...current, focus: step.target }));
      if (reduced.current) { setState(current => ({ ...current, [step.field]: step.text })); return sleep(300, run); }
      for (let index = 1; index <= step.text.length; index++) {
        setState(current => ({ ...current, [step.field]: step.text.slice(0, index) }));
        // A steady, human rhythm: a little longer after spaces and punctuation.
        if (!await sleep(/[\s,.]/.test(step.text[index - 1]) ? 70 : 34, run)) return false;
      }
      return sleep(420, run);
    }
    // Drag: press on the source, glide to the destination, release.
    if (!await moveTo(step.target, 800, run)) return false;
    cursorAt.current = { ...cursorAt.current, down: true }; setCursor(cursorAt.current);
    setState(current => ({ ...current, dragging: step.target })); setGhost(step.ghost);
    if (!await sleep(220, run) || !await moveTo(step.to, step.ms ?? 1100, run)) return false;
    cursorAt.current = { ...cursorAt.current, down: false }; setCursor(cursorAt.current);
    setGhost(null); setState(current => ({ ...current, dragging: "", ...step.patch }));
    return sleep(520, run);
  }, [moveTo, press, sleep]);

  const play = useCallback(async () => {
    const run = ++token.current;
    setPlaying(true);
    for (;;) {
      while (stepAt.current < script.steps.length) {
        const step = script.steps[stepAt.current];
        if (step.caption) setCaption(captions.indexOf(step.caption));
        if (!await runStep(step, run)) return;
        stepAt.current++;
      }
      // Hold the finished result, then start over from the beginning.
      if (!await sleep(2800, run)) return;
      stepAt.current = 0;
      setState(script.initial); setCaption(0);
      cursorAt.current = { x: WIDTH * 0.62, y: HEIGHT * 0.78, down: false, ms: 0 }; setCursor(cursorAt.current);
      if (!await sleep(500, run)) return;
    }
  }, [captions, runStep, script, sleep]);
  const pause = useCallback(() => { token.current++; setPlaying(false); }, []);

  // Play while visible (unless the viewer paused or prefers reduced motion).
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const element = frame.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
      if (entry.isIntersecting && autoPlay && !userPaused.current && !reduced.current) void play();
      else if (!entry.isIntersecting) pause();
    }, { threshold: 0.35 });
    observer.observe(element);
    const hidden = () => { if (document.hidden) pause(); else if (visible.current && autoPlay && !userPaused.current && !reduced.current) void play(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", hidden); pause(); };
  }, [autoPlay, pause, play]);

  function toggle() {
    if (playing) { userPaused.current = true; pause(); }
    else { userPaused.current = false; void play(); }
  }
  function restart() {
    userPaused.current = false; token.current++;
    stepAt.current = 0; setState(script.initial); setCaption(0); setGhost(null);
    cursorAt.current = { x: WIDTH * 0.62, y: HEIGHT * 0.78, down: false, ms: 0 }; setCursor(cursorAt.current);
    window.setTimeout(() => void play(), 60);
  }

  return <figure className={`hd${compact ? " is-compact" : ""}`} aria-label={`Demo: ${script.title}`}>
    <div className="hd-frame" ref={frame} style={{ height: scale ? (HEIGHT + 34) * scale : undefined }}>
      <div className="hd-window" style={{ transform: `scale(${scale || 1})`, opacity: scale ? 1 : 0 }} aria-hidden="true">
        <div className="hd-chrome"><span /><span /><span /><div className="hd-address">{script.address}</div></div>
        <div className="hd-stage" ref={stage} inert>
          <Scene s={state} />
          {ghost && <div className="dm-card is-lifted hd-ghost" style={{ transform: `translate(${cursor.x - 70}px, ${cursor.y - 20}px) rotate(-2deg)`, transitionDuration: `${cursor.ms}ms` }}><b>{ghost.title}</b>{ghost.sub && <small>{ghost.sub}</small>}</div>}
          {ripples.map(ripple => <span key={ripple.key} className="hd-ripple" style={{ left: ripple.x, top: ripple.y }} onAnimationEnd={() => setRipples(list => list.filter(item => item.key !== ripple.key))} />)}
          {/* The wrapper moves; only the arrow inside shrinks on a click, so a press never shifts the position. */}
          <div className="hd-cursor" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)`, transitionDuration: `${cursor.ms}ms` }}>
            <svg className={cursor.down ? "is-down" : undefined} width="22" height="26" viewBox="0 0 22 26">
              <path d="M2 1.5v19.2l5.1-4.6 3.4 7.6 3.3-1.5-3.3-7.4 6.9-.3z" fill="#fff" stroke="#17141f" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>
    </div>
    <figcaption className="hd-bar">
      <button type="button" className="hd-play" onClick={toggle} aria-label={playing ? "Pause demo" : "Play demo"}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
      <div className="hd-caption" aria-live="off"><span>{caption + 1}/{captions.length}</span><p>{captions[caption]}</p></div>
      <div className="hd-steps" aria-hidden="true">{captions.map((text, index) => <i key={text} className={index < caption ? "is-done" : index === caption ? "is-now" : ""} />)}</div>
      <button type="button" className="hd-restart" onClick={restart} aria-label="Restart demo"><RotateCcw size={14} /></button>
    </figcaption>
    <ol className="hd-transcript">{captions.map(text => <li key={text}>{text}</li>)}</ol>
  </figure>;
}

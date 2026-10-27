"use client";
/* eslint-disable @next/next/no-img-element -- pre-optimised decorative WebP, loaded only once the spotlight is first used; next/image would add a loader and srcset this layer doesn't want. */
import { useEffect, useRef, useState } from "react";
import { conceptSrc, preloadConcept, shuffledConcepts, type Concept } from "./concepts";

/**
 * The launch screen's background. By default it is clean: near-black, a slow dawn light and film grain, and nothing
 * ever appears on its own. Underneath is a hidden gallery, revealed only by the visitor:
 * - with a mouse, a soft spotlight follows the cursor and uncovers an image, which changes every few seconds of movement;
 * - on touch, press and hold the background, then drag: the spotlight follows the finger. A quick swipe still scrolls
 *   and taps on the form and links behave normally.
 * The imagery is unlabelled and decorative. Images load only when the spotlight is first used, one ahead at most.
 * The motion is transform and opacity in one rAF loop that sleeps when idle; nothing runs in a hidden tab, during the
 * reveal or with reduced motion.
 */
const SWITCH_MS = 3500;
const HOLD_MS = 260;
const HOLD_SLOP = 10;

export default function LaunchBackdrop({ animate, active }: {
  /** Motion allowed (hydrated, no reduced motion, tab visible). */
  animate: boolean;
  /** The countdown is showing (not revealing). */
  active: boolean;
}) {
  const [order, setOrder] = useState<Concept[] | null>(null);
  const [spot, setSpot] = useState<{ a: string | null; b: string | null; front: "a" | "b"; on: boolean; touch: boolean }>({ a: null, b: null, front: "a", on: false, touch: false });
  const spotRef = useRef<HTMLDivElement>(null), innerRef = useRef<HTMLDivElement>(null);

  // A fresh order for this visit, decided in the browser after hydration.
  useEffect(() => { const timer = setTimeout(() => setOrder(shuffledConcepts()), 0); return () => clearTimeout(timer); }, []);

  useEffect(() => {
    if (!animate || !active || !order) return;
    let index = 0, frame = 0, last = 0, moved = 0, lastMove = 0, loading = false, ready = false, front: "a" | "b" = "a";
    let touching = false, holdTimer: ReturnType<typeof setTimeout> | undefined, start = { x: 0, y: 0 };
    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 }, current = { ...target };
    const src = (offset: number) => conceptSrc(order[(index + offset) % order.length], "art");
    const radius = () => (spotRef.current?.offsetWidth ?? 600) / 2;
    const place = () => {
      const r = radius();
      spotRef.current?.style.setProperty("transform", `translate3d(${(current.x - r).toFixed(1)}px, ${(current.y - r).toFixed(1)}px, 0)`);
      innerRef.current?.style.setProperty("transform", `translate3d(${(r - current.x).toFixed(1)}px, ${(r - current.y).toFixed(1)}px, 0)`);
    };
    const warm = () => {
      if (ready || loading) return;
      loading = true;
      void preloadConcept(src(0)).then(() => { ready = true; setSpot(state => ({ ...state, a: src(0) })); void preloadConcept(src(1)); });
    };
    const step = (time: number) => {
      frame = 0;
      if (document.hidden) return;
      const delta = last ? Math.min(64, time - last) : 16; last = time;
      const ease = touching ? 0.35 : 0.16;
      current.x += (target.x - current.x) * ease; current.y += (target.y - current.y) * ease;
      place();
      const visible = touching || time - lastMove < 900;
      if (visible && ready) {
        moved += delta;
        if (moved > SWITCH_MS) {
          moved = 0; index++;
          front = front === "a" ? "b" : "a";
          const next = src(0);
          setSpot(state => ({ ...state, [front]: next, front }));
          void preloadConcept(src(1));
        }
      }
      setSpot(state => state.on === visible && state.touch === touching ? state : { ...state, on: visible, touch: touching });
      if (visible || Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > 0.5) frame = requestAnimationFrame(step);
      else last = 0;
    };
    const wake = () => { if (!frame) frame = requestAnimationFrame(step); };
    const mouse = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      target.x = event.clientX; target.y = event.clientY; lastMove = performance.now();
      if (!ready && !loading) { current.x = target.x; current.y = target.y; }
      warm(); wake();
    };
    // Touch: only a deliberate press-and-hold on the background turns into a reveal; then dragging moves it and the
    // page doesn't scroll for that one gesture. Anything quicker is an ordinary tap or scroll.
    const interactive = (node: EventTarget | null) => !(node instanceof Element) || !node.closest(".mbl") || Boolean(node.closest("a,button,input,label,form"));
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || interactive(event.target)) return;
      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY };
      warm();
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        touching = true;
        target.x = current.x = start.x; target.y = current.y = start.y; lastMove = performance.now();
        wake();
      }, HOLD_MS);
    };
    const touchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      if (!touching) {
        if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > HOLD_SLOP) clearTimeout(holdTimer);
        return;
      }
      event.preventDefault();
      target.x = touch.clientX; target.y = touch.clientY; lastMove = performance.now();
      wake();
    };
    const touchEnd = () => { clearTimeout(holdTimer); if (touching) { touching = false; lastMove = 0; wake(); } };
    window.addEventListener("pointermove", mouse, { passive: true });
    window.addEventListener("touchstart", touchStart, { passive: true });
    window.addEventListener("touchmove", touchMove, { passive: false });
    window.addEventListener("touchend", touchEnd, { passive: true });
    window.addEventListener("touchcancel", touchEnd, { passive: true });
    return () => {
      clearTimeout(holdTimer); cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", mouse);
      window.removeEventListener("touchstart", touchStart);
      window.removeEventListener("touchmove", touchMove);
      window.removeEventListener("touchend", touchEnd);
      window.removeEventListener("touchcancel", touchEnd);
      setSpot(state => ({ ...state, on: false, touch: false }));
    };
  }, [animate, active, order]);

  return <div className="mbl-backdrop" aria-hidden="true">
    <div className="mbl-glow"><span /><span /><span /></div>
    <div ref={spotRef} className="mbl-spot" data-on={spot.on && (spot.a || spot.b) ? "" : undefined} data-touch={spot.touch ? "" : undefined}>
      <div ref={innerRef} className="mbl-spot-inner">
        {spot.a && <img src={spot.a} alt="" decoding="async" data-front={spot.front === "a" ? "" : undefined} />}
        {spot.b && <img src={spot.b} alt="" decoding="async" data-front={spot.front === "b" ? "" : undefined} />}
      </div>
    </div>
    <div className="mbl-grain" />
  </div>;
}

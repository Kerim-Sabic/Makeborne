"use client";
import { useState } from "react";
import { digits, type Remaining } from "@/lib/launch/countdown";

/**
 * One split-flap digit. The static halves never move; two flaps fold over them (transform only, GPU composited)
 * and are re-keyed on every change so the CSS animation restarts. Fixed card size, so no layout shift.
 */
function FlipDigit({ value, animate }: { value: string; animate: boolean }) {
  // Remember the previous value during render (React's "adjusting state when a prop changes" pattern).
  const [state, setState] = useState({ current: value, previous: value, turn: 0 });
  if (state.current !== value) setState({ current: value, previous: state.current, turn: state.turn + 1 });
  const { current, previous, turn } = state;
  const flipping = animate && turn > 0;
  return <span className="mbl-card">
    <span className="mbl-half mbl-top"><span>{current}</span></span>
    <span className="mbl-half mbl-bottom"><span>{flipping ? previous : current}</span></span>
    {flipping && <>
      <span key={`top-${turn}`} className="mbl-half mbl-top mbl-flap-top"><span>{previous}</span></span>
      <span key={`bottom-${turn}`} className="mbl-half mbl-bottom mbl-flap-bottom"><span>{current}</span></span>
    </>}
  </span>;
}

const UNITS = [
  { key: "days", label: "Days" },
  { key: "hours", label: "Hours" },
  { key: "minutes", label: "Minutes" },
  { key: "seconds", label: "Seconds" },
] as const;

/** Days, hours, minutes and seconds. The parent labels the whole timer; the cards themselves are hidden from screen readers. */
export default function FlipClock({ left, animate, showSeconds = true }: { left: Remaining; animate: boolean; showSeconds?: boolean }) {
  return <span className="mbl-clock-units" aria-hidden="true">
    {UNITS.filter(unit => showSeconds || unit.key !== "seconds").map(unit => <span key={unit.key} className="mbl-unit" data-unit={unit.key}>
      <span className="mbl-cards">{digits(left[unit.key]).map((digit, index, all) => <FlipDigit key={all.length - index} value={digit} animate={animate} />)}</span>
      <span className="mbl-unit-label">{unit.label}</span>
    </span>)}
  </span>;
}

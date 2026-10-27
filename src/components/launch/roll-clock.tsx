"use client";
import { type CSSProperties, Fragment, useState } from "react";
import { digits, type Remaining } from "@/lib/launch/countdown";

/**
 * One rolling numeral. The new figure drops in from above on a damped spring (with a brief motion blur and a weight
 * settle) while the old one falls away. Fixed-width slots keep the figures tabular in every engine, so a change never
 * moves a neighbour. `order` counts from the right, so a carry ripples leftwards (…59 → …00).
 */
function RollDigit({ value, order, animate }: { value: string; order: number; animate: boolean }) {
  // Remember the previous figure during render (React's "adjusting state when a prop changes" pattern).
  const [state, setState] = useState({ current: value, previous: value, turn: 0 });
  if (state.current !== value) setState({ current: value, previous: state.current, turn: state.turn + 1 });
  const rolling = animate && state.turn > 0;
  return <span className="mbl-digit" style={{ "--order": order } as CSSProperties}>
    <span key={`in-${state.turn}`} className={rolling ? "mbl-digit-in" : undefined}>{state.current}</span>
    {rolling && <span key={`out-${state.turn}`} className="mbl-digit-out">{state.previous}</span>}
  </span>;
}

const UNITS = [
  { key: "days", label: "Days" },
  { key: "hours", label: "Hours" },
  { key: "minutes", label: "Minutes" },
  { key: "seconds", label: "Seconds" },
] as const;

/** Days, hours, minutes and seconds in one row. The parent labels the timer; the figures are hidden from screen readers. */
export default function RollClock({ left, animate, showSeconds = true }: { left: Remaining; animate: boolean; showSeconds?: boolean }) {
  const units = UNITS.filter(unit => showSeconds || unit.key !== "seconds");
  let order = units.reduce((total, unit) => total + digits(left[unit.key]).length, 0);
  return <span className="mbl-clock-units" aria-hidden="true">
    {units.map((unit, index) => <Fragment key={unit.key}>
      {index > 0 && <span className="mbl-sep mbl-in" style={{ "--i": 3 + index } as CSSProperties}><span /><span /></span>}
      <span className="mbl-unit mbl-in" data-unit={unit.key} style={{ "--i": 3 + index } as CSSProperties}>
        <span className="mbl-figures">{digits(left[unit.key]).map((digit, position, all) => {
          order--;
          return <RollDigit key={all.length - position} value={digit} order={order} animate={animate} />;
        })}</span>
        <span className="mbl-unit-label">{unit.label}</span>
      </span>
    </Fragment>)}
    {/* The current minute drains along one hairline under the whole row: a transform eased linearly between ticks. */}
    {showSeconds && <span className="mbl-progress"><span style={{ transform: `scaleX(${(left.seconds / 60).toFixed(4)})` }} /></span>}
  </span>;
}

/** The final minute: the seconds alone, much larger, breathing once a second. Absolutely placed, so nothing reflows. */
export function FinalSeconds({ left, animate }: { left: Remaining; animate: boolean }) {
  const figures = digits(Math.min(left.totalSeconds, 60));
  return <span className="mbl-final" aria-hidden="true">
    <span className="mbl-final-figures">
      {animate && <span key={left.totalSeconds} className="mbl-final-pulse" />}
      {figures.map((digit, position) => <RollDigit key={figures.length - position} value={digit} order={figures.length - 1 - position} animate={animate} />)}
    </span>
    <span className="mbl-unit-label">Seconds to launch</span>
  </span>;
}

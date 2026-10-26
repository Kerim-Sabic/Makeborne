"use client";
import { type CSSProperties, useState } from "react";
import { digits, type Remaining } from "@/lib/launch/countdown";

/**
 * One rolling numeral. The new figure drops in from above on a damped spring while the old one falls away; both are
 * transform/opacity animations, so they stay on the compositor. The slot is one em tall and the figures are tabular,
 * so nothing around it ever moves. `order` counts from the right, so a carry ripples leftwards (…59 → …00).
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

/** Days, hours, minutes and seconds as four ruled columns. The parent labels the timer; the figures are hidden from screen readers. */
export default function RollClock({ left, animate, showSeconds = true }: { left: Remaining; animate: boolean; showSeconds?: boolean }) {
  const units = UNITS.filter(unit => showSeconds || unit.key !== "seconds");
  let order = units.reduce((total, unit) => total + digits(left[unit.key]).length, 0);
  return <span className="mbl-clock-units" aria-hidden="true" data-units={units.length}>
    {units.map((unit, index) => <span key={unit.key} className="mbl-unit mbl-in" data-unit={unit.key} style={{ "--i": 3 + index } as CSSProperties}>
      <span className="mbl-unit-label"><span className="mbl-unit-index">{String(index + 1).padStart(2, "0")}</span>{unit.label}</span>
      <span className="mbl-figures">{digits(left[unit.key]).map((digit, position, all) => {
        order--;
        return <RollDigit key={all.length - position} value={digit} order={order} animate={animate} />;
      })}</span>
    </span>)}
  </span>;
}

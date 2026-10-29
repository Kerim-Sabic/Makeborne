"use client";
import { launchPhase, remaining, remainingLabel, shortRemaining } from "@/lib/launch/countdown";
import { useLaunchClock } from "./use-launch-clock";
import "./launch-banner.css";

/**
 * "Plans open in 1d 4h 12m" near the plans. Rendered only while the server says plans are not on sale yet;
 * after launch time it says "Opening any moment" until the server's sales state changes. Never claims checkout is live.
 */
export default function PlansOpenLine({ launchAt, serverNow, dateText }: { launchAt: number; serverNow: number; dateText: { date: string; time: string } }) {
  const { now, salesOpen } = useLaunchClock({ launchAt, initialNow: serverNow, unit: corrected => launchAt - corrected <= 3_600_000 ? 1000 : 60000, watchSales: true });
  const current = now ?? serverNow;
  const phase = launchPhase(current, launchAt);
  // The server said plans were closed at render time; once the client hears they are open, the plan buttons speak for themselves.
  if (salesOpen === true || phase === "after") return null;
  const left = remaining(current, launchAt);
  return <div className="mb-plans-line">
    <span className="mb-launch-spark" aria-hidden="true" />
    {phase === "before" ? <>
      <span>Plans open in <span className="mb-plans-time" role="timer" aria-label={remainingLabel(left)}><span aria-hidden="true">{shortRemaining(left)}</span></span></span>
      <span className="mb-plans-when">{dateText.date}, {dateText.time}</span>
    </> : <span>Launch time has passed. Plans are opening any moment.</span>}
  </div>;
}

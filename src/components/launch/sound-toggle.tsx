"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SOUND_KEY, soundOff, soundOn, soundPause, soundStop, soundSwell, soundTick } from "./launch-sound";

type Sound = { on: boolean; toggle: () => void };

function readStored() {
  try { return localStorage.getItem(SOUND_KEY) === "on"; } catch { return false; }
}
const noop = () => () => undefined;

/**
 * Sound state for the launch screen. Off by default; the choice is remembered on this device. Audio only ever starts
 * from the visitor's own click or key press (a remembered "on" waits for the first one), pauses in a hidden tab, ticks
 * once per clock tick (softer with reduced motion), swells at the reveal and stops once the home page is showing.
 */
export function useLaunchSound({ seconds, stage, soft, hidden }: { seconds: number; stage: string; soft: boolean; hidden: boolean }): Sound {
  const stored = useSyncExternalStore(noop, readStored, () => false);
  const [choice, setChoice] = useState<boolean | null>(null);
  const on = choice ?? stored;
  const running = useRef(false);

  const toggle = () => {
    const next = !on;
    setChoice(next);
    try { localStorage.setItem(SOUND_KEY, next ? "on" : "off"); } catch { /* remembered for this visit only */ }
    if (next) void soundOn().then(started => { running.current = started; });
    else { soundOff(); running.current = false; }
  };

  // A remembered "on" starts with the visitor's first gesture, as browsers require.
  useEffect(() => {
    if (!on || running.current) return;
    const start = () => { void soundOn().then(started => { running.current = started; }); };
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => { window.removeEventListener("pointerdown", start); window.removeEventListener("keydown", start); };
  }, [on]);

  useEffect(() => { if (on && running.current && stage === "count") soundTick(soft); }, [seconds, on, soft, stage]);
  useEffect(() => { if (on && running.current && stage === "live") soundSwell(); }, [stage, on]);
  useEffect(() => { if (stage === "done") soundStop(); }, [stage]);
  useEffect(() => { if (running.current) soundPause(hidden); }, [hidden]);
  useEffect(() => () => soundStop(), []);
  return { on, toggle };
}

/** A small speaker toggle labelled "Sound" (the label hides on the smallest phones; the name stays for screen readers). */
export default function SoundToggle({ sound }: { sound: Sound }) {
  return <button type="button" className="mbl-sound" aria-pressed={sound.on} onClick={sound.toggle} title={sound.on ? "Sound on" : "Sound off"}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
      {sound.on
        ? <><path d="M15.5 9a4.2 4.2 0 0 1 0 6" /><path d="M18.2 6.5a8 8 0 0 1 0 11" /></>
        : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
    </svg>
    <span className="mbl-sound-text">Sound</span>
  </button>;
}

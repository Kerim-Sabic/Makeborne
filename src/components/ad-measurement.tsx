"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { AD_CHOICE_EVENT, AD_CHOICE_KEY, AD_HOSTS, adChoiceRecord, adPageAllowed, adSignalsAllowed, clearWhopStorage, fenceHistory, readAdChoice, startWhopPixel, type AdChoice } from "@/lib/telemetry/ad-measurement";
import styles from "./ad-measurement.module.css";

const subscribe = (notify: () => void) => {
  window.addEventListener(AD_CHOICE_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => { window.removeEventListener(AD_CHOICE_EVENT, notify); window.removeEventListener("storage", notify); };
};
/** The stored record; "blocked" when the browser refuses storage (no choice can be kept, so nothing is asked or loaded). */
const choiceSnapshot = () => { try { return window.localStorage.getItem(AD_CHOICE_KEY) ?? ""; } catch { return "blocked"; } };
const serverSnapshot = () => null;
const never = () => () => {};
const signalsSnapshot = () => adSignalsAllowed(navigator);

/** Saves the visitor's choice for this browser and updates every banner and settings panel on the page. */
export function saveAdChoice(choice: AdChoice) {
  try { window.localStorage.setItem(AD_CHOICE_KEY, adChoiceRecord(choice)); } catch { return; }
  if (choice === "denied") {
    clearWhopStorage(window);
    // A running pixel keeps its listeners until the page unloads.
    if (document.getElementById("whop-pixel")) { window.location.reload(); return; }
  }
  window.dispatchEvent(new Event(AD_CHOICE_EVENT));
}

export function useAdChoice() {
  const raw = useSyncExternalStore(subscribe, choiceSnapshot, serverSnapshot);
  const signals = useSyncExternalStore(never, signalsSnapshot, () => false);
  return { ready: raw !== null, blocked: raw === "blocked", signals, choice: raw === null || raw === "blocked" ? null : readAdChoice(raw) };
}

/**
 * Opt-in Whop Pixel on public pages (privacy policy §6). Nothing loads and nothing is asked on any other page, for
 * browsers sending Do Not Track or Global Privacy Control, or until the visitor allows it. `testHost` is local checks only.
 */
export default function AdMeasurement({ testHost }: { testHost?: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { ready, blocked, signals, choice } = useAdChoice();
  const hosts = testHost ? [...AD_HOSTS, testHost] : AD_HOSTS;
  const page = ready && !blocked && signals && adPageAllowed(new URL(`${pathname}${search ? `?${search}` : ""}`, window.location.origin), hosts);

  useEffect(() => {
    if (!page || choice !== "granted") return;
    const allowed = (url: URL) => adPageAllowed(url, testHost ? [...AD_HOSTS, testHost] : AD_HOSTS);
    // The live address too: the pixel reads the whole URL, fragment included.
    if (!allowed(new URL(window.location.href))) return;
    fenceHistory(window, allowed);
    startWhopPixel(document);
  }, [page, choice, testHost]);

  if (!page || choice !== null) return null;
  return <aside className={styles.banner} aria-label="Ad measurement">
    <p><strong>May we measure our ads?</strong> If you allow it, the Whop Pixel records your visits to our public pages and sets a cookie that lasts up to two years. It never sees the studio, your projects or private links. <Link href="/privacy#ad-measurement">How it works</Link></p>
    <div className={styles.actions}>
      <button type="button" onClick={() => saveAdChoice("denied")}>Don&rsquo;t allow</button>
      <button type="button" onClick={() => saveAdChoice("granted")}>Allow</button>
    </div>
  </aside>;
}

/** On the privacy page: see and change this browser's choice at any time. */
export function AdMeasurementSettings() {
  const { ready, blocked, signals, choice } = useAdChoice();
  if (!ready) return null;
  const status = !signals ? "Your browser sends Do Not Track or Global Privacy Control, so ad measurement stays off and we do not ask."
    : blocked ? "Your browser blocks site storage, so ad measurement stays off."
    : choice === "granted" ? "Ad measurement is allowed in this browser."
    : choice === "denied" ? "Ad measurement is off in this browser."
    : "You have not chosen yet, so ad measurement is off.";
  return <div className={styles.settings}>
    <p role="status">{status}</p>
    {signals && !blocked && <div className={styles.actions}>
      {choice !== "denied" && <button type="button" onClick={() => saveAdChoice("denied")}>{choice === "granted" ? "Stop ad measurement" : "Don’t allow"}</button>}
      {choice !== "granted" && <button type="button" onClick={() => saveAdChoice("granted")}>Allow ad measurement</button>}
    </div>}
  </div>;
}

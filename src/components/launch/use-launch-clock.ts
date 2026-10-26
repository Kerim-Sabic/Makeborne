"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { clockOffset, dateHeaderTime, launchPhase, nextTickDelay, PAGE_SKEW_TOLERANCE_MS } from "@/lib/launch/countdown";

type Status = { offset: number | null; salesOpen: boolean | null };
let shared: { at: number; value: Promise<Status> } | null = null;

/** One small anonymous request shared by every countdown on the page: server time (for big skew) and the sales state. */
export function fetchLaunchStatus(force = false): Promise<Status> {
  const at = Date.now();
  if (!force && shared && Math.abs(at - shared.at) < 30_000) return shared.value;
  const sentAt = Date.now();
  const value = fetch("/api/launch-status", { cache: "no-store", credentials: "omit" }).then(async response => {
    const receivedAt = Date.now();
    const body = await response.json().catch(() => null) as { now?: unknown; salesOpen?: unknown } | null;
    const serverNow = typeof body?.now === "number" ? body.now : dateHeaderTime(response.headers.get("date"));
    return {
      offset: response.ok && Number.isFinite(serverNow) ? clockOffset({ sentAt, receivedAt, serverNow }) : null,
      salesOpen: response.ok && typeof body?.salesOpen === "boolean" ? body.salesOpen : null,
    };
  }).catch((): Status => ({ offset: null, salesOpen: null }));
  shared = { at, value };
  return value;
}

const never = () => () => undefined;
/** A browser-only value: `server` during server rendering and hydration, then `read()` (re-read on every render). */
export function useClientValue<T extends string | number | boolean | null>(read: () => T, server: T): T {
  return useSyncExternalStore(never, read, () => server);
}

const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(change: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}
/** False on the server and during hydration, then the visitor's real preference. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false);
}

/**
 * The corrected clock. It always recomputes from the absolute launch instant (never decrements), so a sleeping tab
 * or a throttled timer is right again on the next tick, and wakes immediately when the tab becomes visible.
 * `initialNow` (the server's time at render) makes the first browser render identical to the server's HTML.
 */
export function useLaunchClock({ launchAt, initialNow = null, unit, watchSales = false, trustClient = false }: {
  launchAt: number;
  initialNow?: number | null;
  /** Tick interval for a given corrected time: every second, or every minute. */
  unit: (now: number) => 1000 | 60000;
  /** Poll the sales state once a minute while live and plans are not yet on sale. */
  watchSales?: boolean;
  /** Test mode (a forced launch moment outside production): keep the browser's own, possibly mocked, clock. */
  trustClient?: boolean;
}) {
  const [now, setNow] = useState<number | null>(initialNow);
  const [salesOpen, setSalesOpen] = useState<boolean | null>(null);
  const offset = useRef(0);
  const unitRef = useRef(unit);
  const tickRef = useRef<() => void>(() => undefined);
  useEffect(() => { unitRef.current = unit; });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    // The page's own server time is a few seconds old by now; it only corrects a clock that is wildly off.
    if (initialNow !== null && !trustClient) {
      const estimate = initialNow - Date.now();
      offset.current = Math.abs(estimate) > PAGE_SKEW_TOLERANCE_MS ? estimate : 0;
    }
    const tick = () => {
      if (cancelled) return;
      clearTimeout(timer);
      const corrected = Date.now() + offset.current;
      setNow(corrected);
      timer = setTimeout(tick, nextTickDelay(corrected, unitRef.current(corrected), corrected < launchAt ? launchAt : undefined));
    };
    tickRef.current = tick;
    tick();
    const wake = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    void fetchLaunchStatus().then(status => {
      if (cancelled) return;
      if (status.offset !== null && !trustClient) offset.current = status.offset;
      setSalesOpen(status.salesOpen);
      tick();
    });
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener("visibilitychange", wake); window.removeEventListener("pageshow", wake); };
  }, [launchAt, initialNow, trustClient]);

  // A unit change (for example reduced motion switching on) reschedules right away.
  const reduced = useReducedMotion();
  useEffect(() => { tickRef.current(); }, [reduced]);

  const phase = now === null ? null : launchPhase(now, launchAt);
  useEffect(() => {
    if (!watchSales || phase !== "live" || salesOpen === true) return;
    const timer = setInterval(() => { void fetchLaunchStatus(true).then(status => { if (status.salesOpen !== null) setSalesOpen(status.salesOpen); }); }, 60_000);
    // Crossing zero while the page is open: ask once straight away (shared with the mount request when recent).
    void fetchLaunchStatus().then(status => { if (status.salesOpen !== null) setSalesOpen(status.salesOpen); });
    return () => clearInterval(timer);
  }, [watchSales, phase, salesOpen]);

  return { now, phase, salesOpen, reduced };
}

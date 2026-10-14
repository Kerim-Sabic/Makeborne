"use client";
import { useEffect, useRef } from "react";
import { BEAT_INTERVAL_MS, ViewClock, deviceClass } from "@/lib/client-review/views";

export type ViewLocation = { ref: string; label: string };
const SESSION_KEY = "makeborne.review-view.v1";

/** One random id per browser tab and link, kept in sessionStorage (never a
 * cookie, never sent automatically). A reload in the same tab is a new "open"
 * of the same visit; a new tab is a new visit. */
function sessionId(token: string) {
  const fresh = () => {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const key = `${SESSION_KEY}:${token.slice(0, 12)}`;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(stored)) return stored;
    const id = fresh();
    sessionStorage.setItem(key, id);
    return id;
  } catch { return fresh(); }
}

/** Tells the person who shared this link how long the review was open and
 * where. Heartbeats every 15 s while the tab is visible, plus a final beat when
 * the tab is hidden or closed. Failures are ignored: the review never depends on it. */
export default function ClientReviewBeacon({ token, where }: { token: string; where: ViewLocation | null }) {
  const clock = useRef<ViewClock | null>(null);
  const latest = useRef(where);
  useEffect(() => {
    latest.current = where;
    if (where) clock.current?.setLocation(where.ref, where.label, Date.now());
  }, [where]);
  useEffect(() => {
    const url = `/api/review/${token}/view`;
    const session = sessionId(token);
    const shortSide = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
    const device = deviceClass(shortSide, window.matchMedia?.("(pointer: coarse)").matches ?? false);
    const timer = new ViewClock(Date.now(), document.visibilityState === "visible");
    if (latest.current) timer.setLocation(latest.current.ref, latest.current.label, Date.now());
    clock.current = timer;
    let opened = false;
    const send = (closing: boolean) => {
      const slices = timer.take(Date.now());
      if (opened && !slices.length) return;
      const body = JSON.stringify({ session, device, open: !opened, slices });
      opened = true;
      try {
        if (closing && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url, body)) return;
        void fetch(url, { method: "POST", body, keepalive: true, cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "text/plain;charset=UTF-8" } }).catch(() => {});
      } catch { /* tracking is best effort */ }
    };
    send(false);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") send(false); }, BEAT_INTERVAL_MS);
    const visibility = () => {
      const visible = document.visibilityState === "visible";
      if (!visible) send(true);
      timer.setVisible(visible, Date.now());
    };
    const hide = () => send(true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      send(true);
      if (clock.current === timer) clock.current = null;
    };
  }, [token]);
  return null;
}

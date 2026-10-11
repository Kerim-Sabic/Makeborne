"use client";

import { useEffect, useRef, useState } from "react";

export type CreditBalanceData = { balance: number; reserved: number; available: number; unlimited: boolean };
type State = { status: "loading" } | { status: "ready"; data: CreditBalanceData } | { status: "signed-out" } | { status: "error" };

/** Dispatch after work that changes credits so every mounted balance refreshes. */
export const CREDITS_CHANGED_EVENT = "makeborne:credits-changed";

const number = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function parse(value: unknown): CreditBalanceData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const whole = (item: unknown) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
  if (!whole(data.balance) || !whole(data.reserved) || !whole(data.available) || typeof data.unlimited !== "boolean") return null;
  return { balance: data.balance as number, reserved: data.reserved as number, available: data.available as number, unlimited: data.unlimited };
}

/**
 * The signed-in account's available credits ("N credits" or "Unlimited").
 * `variant="hero"` renders the large billing figure; `inline` suits headers.
 */
export default function CreditBalance({ variant = "inline", className, onLoad }: { variant?: "inline" | "hero"; className?: string; onLoad?: (data: CreditBalanceData) => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const onLoadRef = useRef(onLoad);
  useEffect(() => { onLoadRef.current = onLoad; }, [onLoad]);

  useEffect(() => {
    const refresh = () => setVersion(value => value + 1);
    window.addEventListener(CREDITS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CREDITS_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/credits", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async response => {
        if (response.status === 401) return setState({ status: "signed-out" });
        const data = response.ok ? parse(await response.json()) : null;
        if (!data) return setState({ status: "error" });
        setState({ status: "ready", data });
        onLoadRef.current?.(data);
      })
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error" }); });
    return () => controller.abort();
  }, [version]);

  const label = state.status === "ready"
    ? state.data.unlimited ? "Unlimited credits" : `${number.format(state.data.available)} credits available`
    : state.status === "loading" ? "Loading credits" : state.status === "signed-out" ? "Sign in to see credits" : "Credits unavailable";
  const figure = state.status === "ready" ? state.data.unlimited ? "Unlimited" : number.format(state.data.available) : state.status === "loading" ? "…" : "—";

  if (variant === "hero")
    return <div className={className ?? "billing-balance-number"} aria-label={label} aria-live="polite">{figure}<span>credits</span></div>;
  return <span className={className ?? "credit-balance"} aria-label={label} aria-live="polite" title={label}>
    {state.status === "ready" && !state.data.unlimited ? `${figure} credits` : state.status === "signed-out" ? "Sign in" : figure}
  </span>;
}

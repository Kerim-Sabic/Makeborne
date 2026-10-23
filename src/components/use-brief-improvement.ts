"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesignAnswers } from "@/lib/builder/brief-questions";
import { enhanceView, type EnhanceView } from "@/lib/builder/enhance-action";

/** What the brief card shows. "offer": nothing has started; the client chooses to build or to improve the brief first. */
export type EnhancingState = { status: "offer" } | { status: "loading"; key: string } | Exclude<EnhanceView, { status: "absent" }>;
export type Improvement = { text: string; design: DesignAnswers; original: string; key: string | null; state: EnhancingState };
type Stored = { key: string; text: string; design: DesignAnswers; original: string; at: number };

const STORED_FOR_MS = 24 * 60 * 60_000;
/** Re-reads of a running or unknown action: never a re-run. Then the client may check again by hand. */
const FOLLOW_DELAYS = [400, 800, 1500, 2500, 4000, 6000, 8000];
function browserStorage() { try { return window.localStorage; } catch { return null; } }
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The optional "Improve my brief first" step of a first website build, as one durable action per
 * Idempotency-Key (see /api/build/enhance). It starts only on the client's explicit choice. A lost reply,
 * a timeout or a reload re-reads the same action (the key is kept on this device for this account and
 * project), so the result and its receipt are recovered and the reading is never run twice. A key the
 * server never received is closed with a recorded Stop, so a late arrival cannot start it.
 */
export function useBriefImprovement({ accountId, workspaceId, artifactId, attachments, enabled }: {
  accountId: string; workspaceId: string; artifactId: string; attachments: number; enabled: boolean;
}) {
  const scope = `makeborne.brief-improvement.${accountId}.${workspaceId}.${artifactId}`;
  const [item, setItem] = useState<Improvement | null>(null);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const headers = useCallback((key?: string) => ({ "Content-Type": "application/json", "X-Makeborne-Account": accountId, ...(key ? { "Idempotency-Key": key } : {}) }), [accountId]);

  const save = useCallback((value: Stored | null) => {
    const storage = browserStorage();
    try { if (value) storage?.setItem(scope, JSON.stringify(value)); else storage?.removeItem(scope); } catch { /* storage refused: recovery then lasts until reload */ }
  }, [scope]);
  const show = useCallback((token: number, key: string, state: EnhancingState) => {
    if (generation.current !== token) return;
    setItem(current => current && current.key === key ? { ...current, state } : current);
  }, []);

  /** One status call. Transport failures and unreadable replies are "unknown", never "failed". */
  const ask = useCallback(async (key: string, method: "GET" | "PATCH" | "DELETE"): Promise<EnhanceView> => {
    const query = { workspaceId, artifactId, key };
    try {
      const response = method === "GET"
        ? await fetch(`/api/build/enhance?${new URLSearchParams(query)}`, { cache: "no-store", headers: headers(), signal: AbortSignal.timeout(15_000) })
        : await fetch("/api/build/enhance", { method, cache: "no-store", headers: headers(), body: JSON.stringify(query), signal: AbortSignal.timeout(15_000) });
      return enhanceView(key, response.status, await response.json().catch(() => null));
    } catch { return enhanceView(key, null, null); }
  }, [artifactId, headers, workspaceId]);

  /** Follows an action to a settled view: re-reads a running/unknown one, retries the release of a recorded one,
   * and closes one the server never received with a recorded Stop. */
  const follow = useCallback(async (token: number, key: string, start: EnhanceView): Promise<EnhanceView> => {
    let view = start;
    for (const delay of [0, ...FOLLOW_DELAYS]) {
      if (generation.current !== token) return view;
      if (view.status === "absent") view = await ask(key, "DELETE");
      if (view.status !== "checking") break;
      show(token, key, view);
      await wait(delay);
      if (generation.current !== token) return view;
      view = await ask(key, view.reason === "billing" ? "PATCH" : "GET");
    }
    const settled: EnhanceView = view.status === "absent"
      ? { status: "failed", key, message: "Your request to improve the brief never arrived, so nothing was started or charged.", charged: 0 } : view;
    show(token, key, settled as EnhancingState);
    return settled;
  }, [ask, show]);

  /** Shows the choice; nothing is sent. */
  const offer = useCallback((text: string, design: DesignAnswers, original: string) => {
    generation.current++; request.current?.abort(); request.current = null;
    setItem({ text, design, original, key: null, state: { status: "offer" } });
  }, []);

  /** The client chose "Improve my brief first": one action, one key, kept on this device until the card closes. */
  const improve = useCallback(async () => {
    if (!item || item.state.status !== "offer") return;
    const token = ++generation.current, key = crypto.randomUUID(), { text, design, original } = item;
    save({ key, text, design, original, at: Date.now() });
    setItem({ text, design, original, key, state: { status: "loading", key } });
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 58_000);
    let view: EnhanceView;
    try {
      const response = await fetch("/api/build/enhance", { method: "POST", cache: "no-store", signal: controller.signal, headers: headers(key),
        body: JSON.stringify({ workspaceId, artifactId, brief: text.slice(0, 8000), original: original.slice(0, 8000), ...(Object.keys(design).length ? { design } : {}), attachments: Math.min(attachments, 20) }) });
      view = enhanceView(key, response.status, await response.json().catch(() => null));
    } catch { view = enhanceView(key, null, null); }
    finally { clearTimeout(timer); if (request.current === controller) request.current = null; }
    // A refusal before any action existed leaves nothing to recover.
    if (view.status === "failed" && view.key === null) save(null);
    await follow(token, key, view);
  }, [artifactId, attachments, follow, headers, item, save, workspaceId]);

  /** Re-reads the current action now (the client's "Check again"). */
  const check = useCallback(async () => {
    if (!item?.key) return;
    const token = ++generation.current;
    await follow(token, item.key, { status: "checking", key: item.key, reason: item.state.status === "checking" ? item.state.reason : "unknown", message: "Checking your brief's improvement…" });
  }, [follow, item]);

  /** Durable Stop of the current action (before arrival, during work, or a no-op after completion), followed to its settled view. */
  const stop = useCallback(async (): Promise<EnhanceView | null> => {
    if (!item?.key) return null;
    const token = ++generation.current, key = item.key;
    request.current?.abort(); request.current = null;
    show(token, key, { status: "checking", key, reason: "running", message: "Stopping the improvement of your brief…" });
    return follow(token, key, await ask(key, "DELETE"));
  }, [ask, follow, item, show]);

  /** Closes the card (the client started a build or cancelled). The action's receipt stays with the caller. */
  const close = useCallback(() => {
    generation.current++; request.current?.abort(); request.current = null;
    setItem(null); save(null);
  }, [save]);

  /** Puts a card back after a start was refused before it began. */
  const restore = useCallback((previous: Improvement) => {
    generation.current++; setItem(previous);
    if (previous.key) save({ key: previous.key, text: previous.text, design: previous.design, original: previous.original, at: Date.now() });
  }, [save]);

  // After a reload: an improvement this device started is read back by its key, never sent again.
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || restored.current === scope) return;
    restored.current = scope;
    let stored: Stored | null = null;
    try {
      const raw = browserStorage()?.getItem(scope);
      const value = raw ? JSON.parse(raw) as Stored : null;
      stored = value && typeof value.key === "string" && typeof value.text === "string" && typeof value.original === "string" && value.design && typeof value.design === "object"
        && Date.now() - Number(value.at) < STORED_FOR_MS ? value : null;
      if (raw && !stored) browserStorage()?.removeItem(scope);
    } catch { stored = null; }
    if (!stored) return;
    const token = ++generation.current, found = stored;
    const message = "Checking the brief improvement you asked for before the page reloaded…";
    queueMicrotask(() => {
      setItem({ text: found.text, design: found.design, original: found.original, key: found.key, state: { status: "checking", key: found.key, reason: "unknown", message } });
      void follow(token, found.key, { status: "checking", key: found.key, reason: "unknown", message });
    });
  }, [enabled, follow, scope]);
  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);

  return { item, offer, improve, check, stop, close, restore };
}

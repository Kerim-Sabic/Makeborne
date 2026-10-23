"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMessageSchema, ChatPageSchema, mergeChat, type ChatMessage } from "@/lib/builder/chat-history";
type Turn = ChatMessage & { state: "streaming" | "done" | "error" };
type Session = { key: string; loaded: boolean; live: boolean; synced: Set<string>; pending: ChatMessage[]; messages: ChatMessage[]; controller: AbortController };
type View = { key: string; messages: ChatMessage[]; next: string | null; ready: boolean; error: string | null; saving: boolean };
function storage() { try { return window.localStorage; } catch { return null; } }
export function useChatHistory(accountId: string, workspaceId: string, artifactId: string, turns: Turn[]) {
  const key = `${accountId}.${workspaceId}.${artifactId}`;
  const cache = `makeborne.chat.v1.${key}`;
  const path = `/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/chat`;
  const session = useMemo<Session>(() => ({ key, loaded: false, live: true, synced: new Set(), pending: [], messages: [], controller: new AbortController() }), [key]);
  const [view, setView] = useState<View | null>(null);
  const [retry, setRetry] = useState(0);
  const pageBusy = useRef(false);
  const request = useCallback(async (suffix = "", messages?: ChatMessage[]) => {
    const response = await fetch(path + suffix, { method: messages ? "POST" : "GET", cache: "no-store", credentials: "same-origin",
      headers: { "X-Makeborne-Account": accountId, ...(messages ? { "Content-Type": "application/json" } : {}) },
      body: messages ? JSON.stringify({ messages }) : undefined, signal: session.controller.signal });
    if (!response.ok) throw new Error("Chat history could not sync. Your current conversation is still here.");
    return response.json();
  }, [accountId, path, session]);
  const refresh = useCallback(async () => {
    const controller = session.controller;
    try {
      const page = ChatPageSchema.parse(await request());
      if (!session.live || controller.signal.aborted) return;
      page.messages.forEach(item => session.synced.add(item.id));
      session.messages = session.loaded ? mergeChat(session.messages, page.messages) : mergeChat(page.messages, session.messages);
      session.loaded = true;
      setView(current => ({ key, messages: session.messages, next: current?.key === key && current.messages.length > 50 ? current.next : page.next, ready: true, error: null, saving: false }));
    } catch {
      if (session.live && !controller.signal.aborted) setView(current => ({ key, messages: current?.key === key ? current.messages : [], next: null, ready: false, error: "Chat history is unavailable. Retry to sync your conversation.", saving: false }));
    }
  }, [key, request, session]);
  useEffect(() => {
    session.live = true;
    session.controller = new AbortController();
    try {
      const raw = storage()?.getItem(cache);
      const parsed: unknown = raw && raw.length <= 500000 ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) session.pending = parsed.flatMap(item => { const result = ChatMessageSchema.safeParse(item); return result.success ? [result.data] : []; }).slice(-50);
    } catch { /* No local cache is required to use account history. */ }
    queueMicrotask(() => { if (session.live) void refresh(); });
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => { session.live = false; session.controller.abort(); window.removeEventListener("focus", focus); };
  }, [cache, refresh, session]);
  const settled = JSON.stringify(turns.filter(turn => turn.state !== "streaming" && turn.text.trim()).map(({ id, role, text }) => ({ id, role, text: text.slice(0, 8000) })));
  useEffect(() => {
    if (!session.live) return;
    const current = JSON.parse(settled) as ChatMessage[];
    session.pending = mergeChat(session.pending, current).filter(item => !session.synced.has(item.id));
    const pending = [...session.pending];
    if (!pending.length) return;
    try { storage()?.setItem(cache, JSON.stringify(pending.slice(-50))); } catch { /* Cloud sync still works. */ }
    if (view?.key !== key || !view.ready) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setView(value => value?.key === key ? { ...value, saving: true } : value);
        try {
          for (let i = 0; i < pending.length && session.live && !cancelled; i += 10) {
            const batch = pending.slice(i, i + 10);
            const result = await request("", batch);
            if (!Array.isArray(result.saved) || batch.some(item => !result.saved.includes(item.id))) throw new Error("Unconfirmed history save");
            batch.forEach(item => session.synced.add(item.id));
            session.pending = session.pending.filter(item => !session.synced.has(item.id));
            try { storage()?.setItem(cache, JSON.stringify(session.pending.slice(-50))); } catch { /* Optional retry cache. */ }
          }
          if (session.live && !cancelled) await refresh();
        } catch {
          if (session.live && !cancelled) setView(value => value?.key === key ? { ...value, error: "Chat history could not sync. Retry to save it to your account.", saving: false } : value);
        }
      })();
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [cache, key, refresh, request, retry, session, settled, view?.key, view?.ready]);
  const older = async () => {
    if (view?.key !== key || !view.next || pageBusy.current) return;
    pageBusy.current = true;
    try {
      const page = ChatPageSchema.parse(await request(`?before=${view.next}`));
      if (!session.live) return;
      page.messages.forEach(item => session.synced.add(item.id));
      session.messages = mergeChat(page.messages, session.messages);
      setView(current => current?.key === key ? { ...current, messages: session.messages, next: page.next, error: null } : current);
    } catch { if (session.live) setView(current => current?.key === key ? { ...current, error: "Older messages could not load. Try again." } : current); }
    finally { pageBusy.current = false; }
  };
  return { messages: view?.key === key ? view.messages.filter(item => !turns.some(turn => turn.id === item.id)) : [],
    next: view?.key === key ? view.next : null, error: view?.key === key ? view.error : null,
    synced: view?.key === key && view.messages.every(item => session.synced.has(item.id)),
    ready: view?.key === key && view.ready, saving: view?.key === key && view.saving, older,
    retry: () => { if (!view?.ready) void refresh(); setRetry(value => value + 1); } };
}

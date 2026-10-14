"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, Check, Copy, Gem, RotateCcw, Sparkles, Square, SquarePen } from "lucide-react";
import BrandMark from "@/components/brand-mark";
import ChatMarkdown from "@/components/chat-markdown";
import { readExpertStream } from "@/components/expert-stream";
import { createClient } from "@/lib/supabase/client";
import { CHAT_MODES, EXPERT_CHAT_LIMITS, EXPERT_IDS, EXPERT_PERSONAS, type ChatMode, type ExpertId, type ExpertPersona } from "@/lib/expert-personas";
import "@/app/expert-chat.css";

type Message = { role: "user" | "assistant"; content: string; mode?: ChatMode; credits?: number; truncated?: boolean };
type Conversations = Record<ExpertId, Message[]>;
const empty = (): Conversations => Object.fromEntries(EXPERT_IDS.map(id => [id, []])) as unknown as Conversations;

/** Portrait when one exists, otherwise the expert's initial. */
function Avatar({ person, size, large = false }: { person: ExpertPersona; size: number; large?: boolean }) {
  return <span className={`advisor-avatar advisor-avatar-${person.id}${large ? " advisor-avatar-large" : ""}${person.portrait ? "" : " is-initial"}`} aria-hidden="true">
    {person.portrait ? <Image key={person.id} src={`/advisors/${person.id}-transparent.png`} alt="" width={size} height={size} priority={large} /> : person.name.slice(0, 1)}
  </span>;
}
const STORE = "makeborne.advisor-chats.v2";
const MODE_STORE = "makeborne.advisor-mode";

/** Conversations stay in this browser, separately for each signed-in account. */
function load(account: string): Conversations {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(`${STORE}:${account}`) ?? "null");
    const result = empty();
    if (raw && typeof raw === "object") for (const { id } of EXPERT_PERSONAS) {
      const list = (raw as Record<string, unknown>)[id];
      if (Array.isArray(list)) result[id] = list.filter((item): item is Message => !!item && typeof item === "object" && (item.role === "user" || item.role === "assistant") && typeof item.content === "string").slice(-60);
    }
    return result;
  } catch { return empty(); }
}

/** The most recent turns that fit the server's limits. */
function history(messages: Message[]) {
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  let total = 0;
  for (const message of [...messages].reverse()) {
    if (turns.length >= EXPERT_CHAT_LIMITS.historyMessages || total + message.content.length > EXPERT_CHAT_LIMITS.historyCharacters) break;
    turns.unshift({ role: message.role, content: message.content.slice(0, EXPERT_CHAT_LIMITS.messageCharacters * 3) });
    total += message.content.length;
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

export default function ExpertChat() {
  const [selected, setSelected] = useState<ExpertId>("mira");
  const [account, setAccount] = useState<string | null>(null);
  // Until the session is read, nothing is shown as signed out.
  const [ready, setReady] = useState(false);
  const signedOut = ready && !account;
  const [conversations, setConversations] = useState<Conversations>(empty);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ChatMode>("standard");
  const [streaming, setStreaming] = useState<{ expert: ExpertId; text: string; status: string } | null>(null);
  const [error, setError] = useState<{ expert: ExpertId; message: string; retry: boolean } | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const expert = EXPERT_PERSONAS.find(item => item.id === selected)!;
  const messages = conversations[selected];
  const busy = streaming !== null;

  useEffect(() => {
    let active = true;
    void createClient().auth.getSession().then(({ data }) => {
      if (!active) return;
      const id = data.session?.user.id ?? null;
      setAccount(id); setReady(true);
      if (id) setConversations(load(id));
      try { if (localStorage.getItem(MODE_STORE) === "genius") setMode("genius"); } catch { /* storage unavailable */ }
    }).catch(() => { if (active) setReady(true); });
    return () => { active = false; abort.current?.abort(); };
  }, []);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(168, Math.max(24, input.scrollHeight))}px`;
  }, [draft, selected]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, streaming?.text, selected]);

  function save(next: Conversations) {
    setConversations(next);
    if (account) try { localStorage.setItem(`${STORE}:${account}`, JSON.stringify(next)); } catch { /* storage full or blocked */ }
  }
  function chooseMode(next: ChatMode) {
    setMode(next);
    try { localStorage.setItem(MODE_STORE, next); } catch { /* storage unavailable */ }
  }

  async function send(text: string, base: Conversations = conversations) {
    const content = text.trim();
    if (!content || busy) return;
    if (content.length > EXPERT_CHAT_LIMITS.messageCharacters) { setError({ expert: selected, message: "Messages are limited to 6,000 characters.", retry: false }); return; }
    const who = selected, askedMode = mode;
    const thread = [...base[who], { role: "user" as const, content }];
    const withQuestion = { ...base, [who]: thread };
    save(withQuestion); setDraft(""); setError(null);
    setStreaming({ expert: who, text: "", status: askedMode === "genius" ? "Thinking deeply…" : "Thinking…" });
    const controller = new AbortController();
    abort.current = controller;
    const result = await readExpertStream("/api/chat", { expert: who, mode: askedMode, messages: history(thread) }, {
      signal: controller.signal,
      onText: text => setStreaming({ expert: who, text, status: "" }),
      onStatus: status => setStreaming(current => current && { ...current, status }),
    });
    abort.current = null;
    setStreaming(null);
    if (result.text.trim() && (result.charged !== null || controller.signal.aborted)) {
      save({ ...withQuestion, [who]: [...thread, { role: "assistant", content: result.text, mode: askedMode, credits: result.charged ?? undefined, truncated: result.truncated || result.charged === null }] });
      return;
    }
    // No answer: take the question back out of the thread and put it in the box so it can be sent again.
    save({ ...withQuestion, [who]: thread.slice(0, -1) }); setDraft(content);
    if (result.error) setError({ expert: who, message: result.error.message, retry: result.error.retry });
  }

  function startOver() {
    if (busy) return;
    save({ ...conversations, [selected]: [] }); setError(null); inputRef.current?.focus();
  }
  async function copy(index: number, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(index); setTimeout(() => setCopied(current => current === index ? null : current), 1600); } catch { /* clipboard blocked */ }
  }

  const live = streaming?.expert === selected ? streaming : null;
  const shownError = error?.expert === selected ? error : null;
  return (
    <div className="advisor-page">
      <aside className="advisor-sidebar" aria-label="Advisors">
        <Link href="/" className="advisor-brand"><BrandMark size={25} /><span>Makeborne</span></Link>
        <Link href="/studio" className="advisor-back"><ArrowLeft size={15} />Back to studio</Link>
        <div className="advisor-sidebar-label">Your advisors</div>
        <div className="advisor-picker" role="group" aria-label="Choose an advisor">
          {EXPERT_PERSONAS.map(person => (
            <button key={person.id} type="button" className={`advisor-person ${selected === person.id ? "is-selected" : ""}`} aria-pressed={selected === person.id}
              onClick={() => { setSelected(person.id); setError(null); }} title={`${person.name} advises on: ${person.covers.join(", ")}`}>
              <Avatar person={person} size={44} />
              <span><strong>{person.name}</strong><small>{person.specialty}</small></span>
              {streaming?.expert === person.id && <span className="advisor-typing-dot" aria-label="Answering" />}
            </button>
          ))}
        </div>
        <div className="advisor-sidebar-note"><Sparkles size={16} /><p>Each advisor sticks to their own field, so every answer comes from the right expert.</p></div>
      </aside>

      <main className="advisor-main">
        <header className="advisor-top">
          <div><strong>{expert.name}</strong><span>{expert.specialty}</span></div>
          <div className="advisor-top-actions">
            <div className="advisor-mode" role="radiogroup" aria-label="Answer depth">
              {(Object.keys(CHAT_MODES) as ChatMode[]).map(item => (
                <button key={item} type="button" role="radio" aria-checked={mode === item} disabled={busy} onClick={() => chooseMode(item)} title={CHAT_MODES[item].summary}>
                  {item === "genius" && <Gem size={13} aria-hidden="true" />}{CHAT_MODES[item].label}
                </button>
              ))}
            </div>
            {messages.length > 0 && <button type="button" className="advisor-new" disabled={busy} onClick={startOver}><SquarePen size={14} />New chat</button>}
          </div>
        </header>
        <div className={`advisor-conversation${messages.length || live ? " has-messages" : ""}`}>
          {!messages.length && !live ? (
            <section className="advisor-welcome" aria-labelledby="advisor-title">
              <Avatar person={expert} size={88} large />
              <p className="advisor-eyebrow">Think it through with {expert.name}</p>
              <h1 id="advisor-title">{expert.introduction}</h1>
              <p className="advisor-description">{expert.description} {expert.name} advises on {expert.covers.slice(0, -1).join(", ").toLowerCase()} and {expert.covers.at(-1)!.toLowerCase()}.</p>
              <div className="advisor-starters" aria-label="Suggested questions">{expert.starters.map(starter => <button key={starter} type="button" disabled={busy || signedOut} onClick={() => void send(starter)}>{starter}</button>)}</div>
            </section>
          ) : (
            <section className="advisor-thread" aria-label={`Conversation with ${expert.name}`} aria-live="polite">
              {messages.map((message, index) => message.role === "user"
                ? <div key={index} className="advisor-message is-user"><p>{message.content}</p></div>
                : <div key={index} className="advisor-message is-expert">
                    <Avatar person={expert} size={30} />
                    <div className="advisor-reply"><ChatMarkdown text={message.content} />
                      <div className="advisor-reply-meta">
                        {message.mode === "genius" && <span className="advisor-genius-tag"><Gem size={11} />Genius</span>}
                        {message.credits !== undefined && <span>{message.credits === 0 ? "No credits used" : `${message.credits} credit${message.credits === 1 ? "" : "s"}`}</span>}
                        {message.truncated && <span>Stopped early</span>}
                        <button type="button" onClick={() => void copy(index, message.content)} aria-label="Copy answer">{copied === index ? <Check size={13} /> : <Copy size={13} />}</button>
                      </div>
                    </div>
                  </div>)}
              {live && <div className="advisor-message is-expert">
                <Avatar person={expert} size={30} />
                <div className="advisor-reply">{live.text ? <ChatMarkdown text={live.text} /> : <p className="advisor-thinking"><span />{live.status || "Thinking…"}</p>}</div>
              </div>}
              <div ref={endRef} />
            </section>
          )}

          <section className="advisor-compose-area" aria-label="Message">
            {shownError && <div className="advisor-error" role="alert"><p>{shownError.message}</p>{shownError.retry && <button type="button" onClick={() => void send(draft)}><RotateCcw size={13} />Try again</button>}</div>}
            {signedOut && <p className="advisor-draft-note">Sign in to ask your advisors.</p>}
            <form className="advisor-composer" onSubmit={event => { event.preventDefault(); void send(draft); }}>
              <label className="advisor-sr-only" htmlFor="advisor-message">Message {expert.name}</label>
              <textarea rows={1} ref={inputRef} id="advisor-message" value={draft} disabled={signedOut} maxLength={EXPERT_CHAT_LIMITS.messageCharacters}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }}
                placeholder={`Ask ${expert.name} about ${expert.specialty.toLowerCase()}…`} />
              {busy && streaming?.expert === selected
                ? <button type="button" className="advisor-send is-stop" onClick={() => abort.current?.abort()} aria-label="Stop answer"><Square size={14} /></button>
                : <button type="submit" className="advisor-send" disabled={!draft.trim() || busy || signedOut} aria-label={`Send to ${expert.name}`}><ArrowUp size={18} /></button>}
            </form>
            <p className="advisor-draft-note">{mode === "genius" ? <><Gem size={11} /> Genius: {CHAT_MODES.genius.summary}</> : CHAT_MODES.standard.summary} Advice only; {expert.name} answers questions about {expert.specialty.toLowerCase()}.</p>
          </section>
        </div>
      </main>
    </div>
  );
}

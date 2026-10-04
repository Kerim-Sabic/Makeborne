"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, Check, Copy, Sparkles } from "lucide-react";
import BrandMark from "@/components/brand-mark";
import { EXPERT_CHAT_POLICY, EXPERT_PERSONAS, type ExpertId } from "@/lib/expert-personas";
import "@/app/expert-chat.css";

const DRAFT_KEY = "makeborne.advisor-drafts.v1";
type Drafts = Record<ExpertId, string>;
const emptyDrafts: Drafts = { mira: "", atlas: "", ellis: "" };

export default function ExpertChat() {
  const [selected, setSelected] = useState<ExpertId>("mira");
  const [drafts, setDrafts] = useState<Drafts>(emptyDrafts);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const expert = EXPERT_PERSONAS.find((item) => item.id === selected)!;
  const draft = drafts[selected];

  useEffect(() => {
    let active = true;
    // Hydrate tab-scoped drafts after mount; keep the server and initial client render identical.
    queueMicrotask(() => {
      if (!active) return;
    try {
      const raw: unknown = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");
      if (raw && typeof raw === "object") {
        const restored = { ...emptyDrafts };
        for (const { id } of EXPERT_PERSONAS) {
          const value = (raw as Record<string, unknown>)[id];
          if (typeof value === "string") restored[id] = value.slice(0, EXPERT_CHAT_POLICY.maxDraftCharacters);
        }
        setDrafts(restored);
      }
    } catch { setNotice("Draft storage is unavailable. Keep a copy before leaving this page."); }
    setReady(true);
    });
    return () => { active = false; };
  }, []);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(144, Math.max(24, input.scrollHeight))}px`;
  }, [draft, selected, ready]);

  function updateDraft(value: string) {
    const next = { ...drafts, [selected]: value.slice(0, EXPERT_CHAT_POLICY.maxDraftCharacters) };
    setDrafts(next);
    setCopied(false);
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next)); }
    catch { setNotice("Your draft is here, but could not be saved in this tab. Copy it before leaving."); }
  }

  async function copyDraft() {
    try { await navigator.clipboard.writeText(draft); setCopied(true); setNotice("Draft copied."); }
    catch { inputRef.current?.focus(); inputRef.current?.select(); setNotice("Copy is unavailable. Your draft is selected so you can copy it manually."); }
  }

  return (
    <div className="advisor-page">
      <aside className="advisor-sidebar" aria-label="Advisors">
        <Link href="/" className="advisor-brand"><BrandMark size={25} /><span>makeborne</span></Link>
        <Link href="/studio" className="advisor-back"><ArrowLeft size={15} />Back to studio</Link>
        <div className="advisor-sidebar-label">Your advisors<span>Preview</span></div>
        <div className="advisor-picker" role="group" aria-label="Choose an advisor">
          {EXPERT_PERSONAS.map((person) => (
            <button key={person.id} type="button" className={`advisor-person ${selected === person.id ? "is-selected" : ""}`} aria-pressed={selected === person.id} onClick={() => { setSelected(person.id); setCopied(false); setNotice(""); }}>
              <span className={`advisor-avatar advisor-avatar-${person.id}`} aria-hidden="true"><Image src={`/advisors/${person.id}-transparent.png`} alt="" width={44} height={44} /></span>
              <span><strong>{person.name}</strong><small>{person.specialty}</small></span>
            </button>
          ))}
        </div>
        <div className="advisor-sidebar-note"><Sparkles size={16} /><p>A little perspective for your next big idea.</p></div>
      </aside>

      <main className="advisor-main">
        <header className="advisor-top"><div><strong>{expert.name}</strong><span>{expert.specialty}</span></div><span className="advisor-preview-badge">Chat preview</span></header>
        <div className="advisor-conversation">
          <section className="advisor-welcome" aria-labelledby="advisor-title">
            <span className={`advisor-avatar advisor-avatar-large advisor-avatar-${expert.id}`} aria-hidden="true"><Image key={expert.id} src={`/advisors/${expert.id}-transparent.png`} alt="" width={88} height={88} priority /></span>
            <p className="advisor-eyebrow">Think it through with {expert.name}</p>
            <h1 id="advisor-title">{expert.introduction}</h1>
            <p className="advisor-description">{expert.description} Start with a question, a rough idea, or the decision in front of you.</p>
          </section>

          <section className="advisor-compose-area" aria-label="Conversation draft">
            <div className="advisor-availability"><span className="advisor-status-dot" /><p><strong>Live chat is not connected yet.</strong> Your question stays in this tab until replies are enabled.</p></div>
            <form className="advisor-composer" onSubmit={(event) => event.preventDefault()}>
              <label className="advisor-sr-only" htmlFor="advisor-message">Message {expert.name}</label>
              <textarea rows={1} ref={inputRef} id="advisor-message" value={draft} disabled={!ready} maxLength={EXPERT_CHAT_POLICY.maxDraftCharacters} onChange={(event) => updateDraft(event.target.value)} placeholder={`What would you like to work through with ${expert.name}?`} aria-describedby="advisor-draft-note" />
              <button type="submit" className="advisor-send" disabled aria-label="Send unavailable — live chat is not connected" title="Live chat is not connected"><ArrowUp size={18} /></button>
              {draft.length > 0 && <div className="advisor-composer-actions"><span>{draft.length.toLocaleString()} / 12,000</span><div><button type="button" className="advisor-copy" disabled={!draft} onClick={() => { updateDraft(""); setNotice("Draft cleared."); inputRef.current?.focus(); }}>Clear</button><button type="button" className="advisor-copy" disabled={!draft.trim()} onClick={copyDraft}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy draft"}</button></div></div>}
            </form>
            <p id="advisor-draft-note" className="advisor-draft-note">Drafts stay in this browser tab. Nothing is sent to an AI service.</p>
            <p className="advisor-feedback" role="status">{notice}</p>
          </section>
        </div>
      </main>
    </div>
  );
}

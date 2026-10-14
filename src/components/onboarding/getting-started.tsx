"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Check, ChevronDown, Globe2, MessageCircle, Sparkles, X } from "lucide-react";
import BrandMark from "@/components/brand-mark";
import Modal from "../mail/modal";
import { mailApi } from "../mail/mail-api";
import { ONBOARDING_REFRESH_EVENT, requestClientsAction } from "./signals";
import { checklist, type Progress } from "./checklist";
import "./onboarding.css";

type Saved = { welcomed: boolean; hidden: boolean; celebrated: boolean };
const storeKey = (account: string) => `makeborne.onboarding.v1:${account}`;
const CHAT_STORE = "makeborne.advisor-chats.v2";

function readSaved(account: string): Saved {
  try { return { welcomed: false, hidden: false, celebrated: false, ...JSON.parse(localStorage.getItem(storeKey(account)) ?? "{}") }; }
  catch { return { welcomed: false, hidden: false, celebrated: false }; }
}
/** Has this account asked an advisor anything (conversations are kept in this browser)? */
function advisorUsed(account: string) {
  try {
    const raw = JSON.parse(localStorage.getItem(`${CHAT_STORE}:${account}`) ?? "null") as Record<string, unknown> | null;
    return !!raw && Object.values(raw).some(list => Array.isArray(list) && list.length > 0);
  } catch { return false; }
}

/**
 * First-run experience: a one-time welcome for a brand-new account, then a
 * small "Getting started" checklist that ticks itself off from real account
 * data. Dismissible; never shown to people who already use the studio.
 */
export default function GettingStarted({ accountId, workspaceId, tab, hidden, onCreate, onNavigate }: {
  accountId: string; workspaceId: string; tab: string; hidden: boolean;
  onCreate: (kind: "website" | "book" | "presentation") => void; onNavigate: (tab: "projects" | "clients") => void;
}) {
  const [saved, setSaved] = useState<Saved>(() => readSaved(accountId));
  const [progress, setProgress] = useState<Progress | null>(null);
  const [advisor, setAdvisor] = useState(false);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const save = useCallback((change: Partial<Saved>) => setSaved(current => {
    const next = { ...current, ...change };
    try { localStorage.setItem(storeKey(accountId), JSON.stringify(next)); } catch { /* storage unavailable: shown again next time */ }
    return next;
  }), [accountId]);

  const load = useCallback(async () => {
    try {
      const result = await mailApi<{ progress: Progress }>(accountId, `/api/cloud/workspaces/${workspaceId}/onboarding`);
      setProgress(result.progress); setAdvisor(advisorUsed(accountId));
    } catch { /* the checklist is optional: stay hidden until it can load */ }
  }, [accountId, workspaceId]);
  // Load after mount and on every tab change; refresh when the window regains focus or the app reports progress.
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, tab]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("focus", refresh); window.addEventListener(ONBOARDING_REFRESH_EVENT, refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener(ONBOARDING_REFRESH_EVENT, refresh); };
  }, [load]);

  const go = useMemo(() => ({
    create: (kind: "website" | "book" | "presentation") => { setOpen(false); save({ welcomed: true }); onCreate(kind); },
    leads: () => { setOpen(false); save({ welcomed: true }); requestClientsAction("find-leads"); onNavigate("clients"); },
    email: () => { setOpen(false); requestClientsAction("email"); onNavigate("clients"); },
    clients: () => { setOpen(false); onNavigate("clients"); },
    projects: () => { setOpen(false); onNavigate("projects"); },
    chat: () => router.push("/chat"),
  }), [onCreate, onNavigate, router, save]);

  if (!progress) return null;
  const steps = checklist(progress, advisor, go);
  const done = steps.filter(step => step.done).length;
  const fresh = (progress.artifacts ?? 0) === 0 && (progress.clients ?? 0) === 0;
  const complete = done === steps.length;
  const welcome = fresh && !saved.welcomed && !hidden;

  return <>
    {welcome && <Modal label="Welcome to Makeborne" onClose={() => save({ welcomed: true })}>
      <div className="gs-welcome">
        <button type="button" className="gs-x" aria-label="Close" onClick={() => save({ welcomed: true })}><X size={18} /></button>
        <BrandMark size={34} />
        <h2>Welcome to Makeborne</h2>
        <p>Create work for your business or your clients, and win new ones. Where would you like to start?</p>
        <div className="gs-paths">
          <button type="button" onClick={() => go.create("website")}><span className="gs-path-icon is-site"><Globe2 size={20} /></span><strong>Make my first website</strong><small>Describe your business and watch it build, live.</small><ArrowRight size={16} /></button>
          <button type="button" onClick={go.leads}><span className="gs-path-icon is-leads"><Sparkles size={20} /></span><strong>Find my first 10 leads</strong><small>Local businesses or creators, ranked for what you sell.</small><ArrowRight size={16} /></button>
          <button type="button" onClick={() => go.create("book")}><span className="gs-path-icon is-book"><BookOpen size={20} /></span><strong>Write a book or deck</strong><small>A print-ready e-book or a presentation from your notes.</small><ArrowRight size={16} /></button>
        </div>
        <button type="button" className="gs-skip" onClick={() => save({ welcomed: true })}>I’ll look around first</button>
      </div>
    </Modal>}

    {!hidden && !saved.hidden && !(complete && saved.celebrated) && <div className={`gs${open ? " is-open" : ""}`}>
      {open && <section className="gs-panel" aria-labelledby="gs-title">
        <header>
          <div><h2 id="gs-title">{complete ? "You’re all set" : "Getting started"}</h2><p>{complete ? "Every first step is done. Nice work." : `${done} of ${steps.length} done · each takes a minute or two`}</p></div>
          <button type="button" className="gs-x" aria-label="Collapse getting started" onClick={() => setOpen(false)}><ChevronDown size={18} /></button>
        </header>
        <div className="gs-bar" aria-hidden="true"><span style={{ width: `${Math.round(done / steps.length * 100)}%` }} /></div>
        <ol>{steps.map(step => <li key={step.id} className={step.done ? "is-done" : ""}>
          <span className="gs-check" aria-hidden="true">{step.done ? <Check size={13} /> : null}</span>
          <div><strong>{step.title}</strong><small>{step.hint} <Link href={`/help/${step.guide}`} target="_blank">How it works</Link></small></div>
          {!step.done && <button type="button" onClick={step.run}>{step.action}</button>}
          <span className="sr-only">{step.done ? "Done" : "Not done yet"}</span>
        </li>)}</ol>
        <footer>
          {complete ? <button type="button" className="gs-link" onClick={() => { save({ celebrated: true }); setOpen(false); }}>Close for good</button>
            : <button type="button" className="gs-link" onClick={() => { save({ hidden: true }); setOpen(false); }}>Hide this checklist</button>}
          <Link className="gs-link" href="/help" target="_blank"><MessageCircle size={13} />Help center</Link>
        </footer>
      </section>}
      <button type="button" className="gs-pill" aria-expanded={open} aria-label={`Getting started, ${done} of ${steps.length} done`} onClick={() => setOpen(!open)}>
        <svg className="gs-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" className="is-fill" style={{ strokeDasharray: `${done / steps.length * 94.2} 94.2` }} /></svg>
        <span><strong>{complete ? "All set" : "Getting started"}</strong><small>{done}/{steps.length} done</small></span>
      </button>
    </div>}
  </>;
}

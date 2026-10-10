"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { type CSSProperties, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, BookOpen, Check, Globe2, Menu, Presentation, X } from "lucide-react";
import ComposerControls from "./composer-controls";
import GenerationPermissions, {useGenerationConsent} from "./generation-permissions";
import StudioAccount from "./studio-account";
import { DEFAULT_EFFORT, type EffortLevel } from "@/lib/routing/effort";
import BrandMark from "./brand-mark";
import TemplateGallery from "./template-gallery";
import type { Style } from "./studio-model";
import { templateDirections } from "@/lib/template-directions";
import { AUTOMATIC_STYLE } from "@/lib/automatic-style";
import { useCreationAccount } from "./use-creation-account";
import { attachmentOwner, saveCreationDraft } from "@/lib/attachments";
import { AttachFilesButton, AttachmentList, useFileAttachments, useFileDrop } from "./file-attachments";
import "@/app/home.css";

type Kind = "website" | "book" | "presentation";
const formats = [
  { id: "website" as const, label: "Website", icon: Globe2 },
  { id: "book" as const, label: "Book", icon: BookOpen },
  { id: "presentation" as const, label: "Presentation", icon: Presentation },
];
const ideas: Record<Kind, { label: string; text: string }[]> = {
  website: [
    { label: "A website for my client", text: "A refined website for an independent architecture studio. Warm neutrals, generous spacing and a project-led portfolio. Help me plan the pages and content I need." },
    { label: "My personal portfolio", text: "A distinctive portfolio for my creative work. Confident, minimal and easy to explore, with my story, selected work and contact details." },
    { label: "A product landing page", text: "A sharp landing page for my new product. Help me define the audience, real benefits, page structure and a clear next step." },
  ],
  book: [
    { label: "Turn my knowledge into a book", text: "Help me structure a practical book from my own knowledge and examples. I want a clear chapter outline, beautiful editorial typography and a consistent illustration direction." },
    { label: "A beautiful field guide", text: "Plan an illustrated field guide with short chapters, useful exercises and plenty of breathing room. Identify the source material and real examples I should supply." },
    { label: "A guide for my audience", text: "Plan a useful guide for my audience, focused on a specific problem, practical steps and examples drawn from my supplied material." },
  ],
  presentation: [
    { label: "A pitch that stands out", text: "Plan a confident pitch with a strong narrative, concise slides and a consistent visual direction. Use my supplied facts and flag anything that needs evidence." },
    { label: "Turn my text into slides", text: "Turn my supplied text into a presentation outline while preserving my meaning. Ask about the audience, outcome and presentation length before designing slides." },
    { label: "A client proposal", text: "Structure a client proposal with context, scope, approach, timeline and next steps. Leave pricing and claims for me to confirm." },
  ],
};

export default function CreationHome({ initialEmail, accountsEnabled }: { initialEmail: string | null; accountsEnabled: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("website");
  const [mode, setMode] = useState<"create" | "plan">("create");
  const [effort, setEffort] = useState<EffortLevel>(DEFAULT_EFFORT);
  const [brief, setBrief] = useState("");
  const [selectedStyles, setSelectedStyles] = useState<Partial<Record<Kind, Style>>>({});
  const selectedStyle = selectedStyles[kind];
  const selectedConcept = templateDirections.find(direction => direction.style.id === selectedStyle?.id);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const account = useCreationAccount(undefined,{includeClients:false});
  const permissions=useGenerationConsent(account.accountId);
  const accessReady=permissions.ready;
  const immediateWebsite=kind==="website"&&mode==="create"&&permissions.enabled;
  const owner = account.ready ? attachmentOwner(account.accountId) : null;
  const attachments = useFileAttachments(owner, "home");
  const drop = useFileDrop(attachments.add, !attachments.ready || attachments.busy || busy);
  const starting = useRef(false);
  async function start() {
    if (starting.current || attachments.busy) return;
    if (!owner || !attachments.ready) { setError(account.error || attachments.error || "Checking your account and file storage. Try again in a moment."); return; }
    if (!brief.trim()) { promptRef.current?.focus(); return; }
    if (!accessReady) { setError("Checking creation availability. Your brief is preserved."); return; }
    if (immediateWebsite && !permissions.consent) { setError("Confirm processing and source permissions beside your prompt before creating."); return; }
    if (brief.trim().length > 20000) { setError("Keep your brief under 20,000 characters."); return; }
    starting.current = true; setBusy(true);
    try {
      const requestId = crypto.randomUUID();
      const nonce = crypto.randomUUID();
      const generationConsent=immediateWebsite?permissions.consent??undefined:undefined;
      const draft = { kind, brief: brief.trim(), styleId: selectedStyle?.id ?? AUTOMATIC_STYLE.id, style: selectedStyle, mode, effort, requestId, attachmentOwner: owner, generationConsent };
      await saveCreationDraft(owner, requestId, nonce, draft);
      sessionStorage.setItem("makeborne.creation-draft.v1", JSON.stringify(draft));
      router.push(`/studio?create=${kind}&from=home&draft=${requestId}&claim=${nonce}`);
    } catch { setError("Your browser could not save this brief and its files. Keep a copy and try again."); starting.current = false; setBusy(false); }
  }
  function chooseStyle(selectedKind: Kind, styleId: string, style: Style) {
    if (starting.current || style.id !== styleId) return;
    setKind(selectedKind);
    setSelectedStyles(previous => ({ ...previous, [selectedKind]: style }));
    setError("");
    requestAnimationFrame(() => {
      promptRef.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      promptRef.current?.focus({ preventScroll: true });
    });
  }
  function addIdea(text: string) {
    const combined = [brief.trim(), text].filter(Boolean).join("\n\n");
    if (combined.length > 20000) { setError("There isn't room for this suggestion. Your existing brief is preserved."); return; }
    setBrief(combined); setError(""); promptRef.current?.focus();
  }
  return (
    <main className="mk-home">
      <header className="mk-nav">
        <Link href="/" className="mk-wordmark" aria-label="Makeborne home"><BrandMark size={30} /><span>Makeborne</span></Link>
        <nav className="mk-nav-middle" aria-label="Main navigation"><Link href="/studio">Studio</Link><a href="#templates">Templates</a><Link href="/chat">Expert chat</Link><Link href="/studio?tab=clients">For client work <ArrowUpRight size={13} /></Link></nav>
        <div className="mk-nav-actions"><StudioAccount variant="home" initialEmail={initialEmail} enabled={accountsEnabled} /><Link className="mk-nav-cta" href="/studio">Open studio <ArrowUpRight size={14} /></Link><button className="mk-menu-toggle" aria-label={menu ? "Close navigation" : "Open navigation"} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={20} /> : <Menu size={20} />}</button></div>
        {menu && <nav className="mk-mobile-menu" aria-label="Mobile navigation"><Link href="/studio">Studio</Link><a href="#templates" onClick={() => setMenu(false)}>Templates</a><Link href="/chat">Expert chat</Link><Link href="/studio?tab=clients">Client work</Link><StudioAccount variant="home-mobile" initialEmail={initialEmail} enabled={accountsEnabled} /></nav>}
      </header>
      <section className="mk-hero" aria-labelledby="creation-heading">
        <div className="mk-atmosphere" aria-hidden="true"><span /><span /><span /></div>
        <div className="mk-hero-content">
          <h1 id="creation-heading">What will you<br className="mk-mobile-break" /> make next?</h1>
          <p className="mk-hero-subtitle">Beautiful websites. Books worth opening. Slides that stay with you.</p>
          <div className="mk-format-switch" style={{ "--format-index": formats.findIndex(item => item.id === kind) } as CSSProperties} role="group" aria-label="What would you like to create?"><span className="mk-format-indicator" aria-hidden="true" />{formats.map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={kind === id} className={kind === id ? "is-active" : ""} onClick={() => { setKind(id); setError(""); }}><Icon size={16} strokeWidth={1.7} />{label}</button>)}</div>
          <form className={`mk-composer${drop.dragging ? " is-file-dragging" : ""}`} {...drop.handlers} onSubmit={event => { event.preventDefault(); void start(); }}>
            {drop.dragging && <p className="attachment-drop-hint">Drop files to attach</p>}
            <AttachmentList files={attachments.files} onRemove={id => void attachments.remove(id)} disabled={attachments.busy || busy} />
            {selectedStyle && <div className="mk-selected-style" role="status">
              {selectedConcept && <Image src={`/gallery/${selectedConcept.id}.png`} alt="" width={32} height={32} />}
              <span><small>Style</small>{selectedStyle.name}</span>
              <button type="button" disabled={busy} aria-label={`Remove ${selectedStyle.name} style`} onClick={() => setSelectedStyles(previous => ({ ...previous, [kind]: undefined }))}><X size={14} /></button>
            </div>}
            <label className="mk-sr-only" htmlFor="creation-brief">Describe your project</label>
            <textarea ref={promptRef} id="creation-brief" maxLength={20000} value={brief} onChange={event => { setBrief(event.target.value); setError(""); }} placeholder={kind === "website" ? "A beautiful website for my business, with…" : kind === "book" ? "An illustrated book about something I know well…" : "A presentation that tells the story of…"} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); start(); } }} />
            <div className="mk-composer-bottom">
              <AttachFilesButton onFiles={attachments.add} disabled={!attachments.ready || busy} busy={attachments.busy} />
              <ComposerControls mode={mode} onMode={setMode} effort={effort} onEffort={setEffort} />
              <button className="mk-send" type="submit" disabled={busy || attachments.busy || !brief.trim() || !accessReady || immediateWebsite&&!permissions.consent} aria-label={mode === "plan" ? "Plan this project" : "Create this project"}><span>{busy ? "Opening…" : mode === "plan" ? "Plan" : "Create"}</span><ArrowUp size={17} strokeWidth={2} /></button>
            </div>
          </form>
          {immediateWebsite&&<GenerationPermissions value={permissions} disabled={busy}/>}
          {attachments.error && <p className="attachment-error" role="alert">{attachments.error}</p>}
          {error && <p className="mk-error" role="alert">{error}</p>}
          <div className="mk-idea-chips" aria-label="Ideas to get started">{ideas[kind].map(idea => <button key={idea.label} onClick={() => addIdea(idea.text)}>{idea.label}<ArrowUpRight size={13} /></button>)}</div>
          <p className="mk-availability">{immediateWebsite ? "Your website starts building as soon as your project opens." : "Sign in to start building. New accounts include free trial credits."}</p>
        </div>
        <div className="mk-hero-foot"><span>ONE IDEA, EVERY POSSIBILITY.</span><span>DESIGNED TO BE YOURS <span className="mk-tiny-star">✳</span></span></div>
      </section>
      <section className="mk-discovery" id="templates" aria-label="Style directions"><TemplateGallery key={kind} initialFilter={kind} selectedStyleId={selectedStyle?.id} onChoose={chooseStyle} /></section>
      <section className="mk-client-band" aria-labelledby="client-work-heading">
        <div className="mk-client-copy">
          <span className="mk-overline">FOR YOUR CLIENT WORK</span>
          <h2 id="client-work-heading">One place for<br /> every client.</h2>
          <p>Keep their projects, your conversations, and the next step together. Pick up exactly where you left off.</p>
          <Link className="mk-client-cta" href="/studio?tab=clients">Open client workspace <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </div>
        <div className="mk-client-workflow" aria-label="Your client workflow">
          <div className="mk-client-workflow-heading"><span className="mk-client-workflow-mark" aria-hidden="true"><BrandMark size={22} /></span><span>From first hello to final handoff.</span></div>
          <ol>
            <li><span className="mk-workflow-step" aria-hidden="true">01</span><div><h3>Know the client</h3><p>Contact details, outreach, and the brief.</p></div></li>
            <li><span className="mk-workflow-step" aria-hidden="true">02</span><div><h3>Keep the work connected</h3><p>Every project and its saved versions.</p></div></li>
            <li><span className="mk-workflow-step" aria-hidden="true"><Check size={15} strokeWidth={1.8} /></span><div><h3>Know what comes next</h3><p>Notes and follow-ups, ready when you are.</p></div></li>
          </ol>
        </div>
      </section>
      <footer className="mk-footer">
        <div className="mk-footer-main">
          <div className="mk-footer-brand"><Link href="/" className="mk-wordmark" aria-label="Makeborne home"><BrandMark size={25} /><span>Makeborne</span></Link><p>Make something worth sharing.</p></div>
          <nav aria-label="Footer navigation"><Link href="/studio">Studio</Link><Link href="/chat">Expert chat</Link><a href="#templates">Styles</a><Link href="/billing">Plans &amp; credits</Link><Link href="/help">Getting started</Link><Link href="/privacy">Privacy</Link></nav>
        </div>
        <div className="mk-footer-bottom"><span>© 2026 Makeborne</span><a href="#creation-heading">Back to top <ArrowUp size={13} aria-hidden="true" /></a></div>
      </footer>
    </main>
  );
}

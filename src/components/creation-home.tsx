"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, BookOpen, Check, FileText, Globe2, Layers3, Menu, Plus, Presentation, X } from "lucide-react";
import BrandMark from "./brand-mark";
import TemplateGallery from "./template-gallery";
import type { Style } from "./studio-model";
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

export default function CreationHome() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("website");
  const [brief, setBrief] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  function start(selectedKind: Kind = kind, text = brief, styleId = "editorial", style?: Style) {
    if (busy) return;
    if (!text.trim()) { promptRef.current?.focus(); return; }
    if (text.trim().length > 20000) { setError("Keep your brief and style instructions under 20,000 characters."); return; }
    try {
      sessionStorage.setItem("makeborne.creation-draft.v1", JSON.stringify({ kind: selectedKind, brief: text.trim(), styleId, style }));
      setBusy(true);
      router.push(`/studio?create=${selectedKind}&from=home`);
    } catch { setError("Your browser could not keep this brief. Copy your text before opening the studio."); }
  }
  function addIdea(text: string) {
    const combined = [brief.trim(), text].filter(Boolean).join("\n\n");
    if (combined.length > 20000) { setError("There isn't room for this suggestion. Your existing brief is preserved."); return; }
    setBrief(combined); setError(""); promptRef.current?.focus();
  }
  async function importText(file?: File) {
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name) || file.size > 100_000) { setError("Choose a text or Markdown file under 100 KB."); return; }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const combined = [brief.trim(), text.trim()].filter(Boolean).join("\n\n");
      if (combined.length > 20000) { setError("Keep your brief and source text under 20,000 characters."); return; }
      setBrief(combined); setFileName(file.name); setError(""); promptRef.current?.focus();
    } catch { setError("This file could not be read as UTF-8 text. Try a plain text file."); }
  }
  return (
    <main className="mk-home">
      <header className="mk-nav">
        <Link href="/" className="mk-wordmark" aria-label="Makeborne home"><BrandMark size={30} /><span>Makeborne</span></Link>
        <nav className="mk-nav-middle" aria-label="Main navigation"><Link href="/studio">Studio</Link><a href="#templates">Templates</a><Link href="/studio?tab=clients">For client work <ArrowUpRight size={13} /></Link></nav>
        <div className="mk-nav-actions"><Link className="mk-login" href="/login">Log in</Link><Link className="mk-nav-cta" href="/studio">Open studio <ArrowUpRight size={14} /></Link><button className="mk-menu-toggle" aria-label={menu ? "Close navigation" : "Open navigation"} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={20} /> : <Menu size={20} />}</button></div>
        {menu && <nav className="mk-mobile-menu" aria-label="Mobile navigation"><Link href="/studio">Studio</Link><a href="#templates" onClick={() => setMenu(false)}>Templates</a><Link href="/studio?tab=clients">Client work</Link><Link href="/login">Log in</Link></nav>}
      </header>
      <section className="mk-hero" aria-labelledby="creation-heading">
        <div className="mk-atmosphere" aria-hidden="true"><span /><span /><span /></div>
        <div className="mk-hero-content">
          <a className="mk-announcement" href="#templates"><span>MADE FOR YOUR NEXT IDEA</span><ArrowUpRight size={13} /></a>
          <h1 id="creation-heading">What will you<br className="mk-mobile-break" /> make next?</h1>
          <p className="mk-hero-subtitle">Beautiful websites. Books worth opening. Slides that stay with you.</p>
          <div className="mk-format-switch" role="group" aria-label="What would you like to create?">{formats.map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={kind === id} className={kind === id ? "is-active" : ""} onClick={() => { setKind(id); setError(""); }}><Icon size={16} strokeWidth={1.7} />{label}</button>)}</div>
          <form className="mk-composer" onSubmit={event => { event.preventDefault(); start(); }}>
            <label className="mk-sr-only" htmlFor="creation-brief">Describe your project</label>
            <textarea ref={promptRef} id="creation-brief" maxLength={20000} value={brief} onChange={event => { setBrief(event.target.value); setError(""); }} placeholder={kind === "website" ? "A beautiful website for my business, with…" : kind === "book" ? "An illustrated book about something I know well…" : "A presentation that tells the story of…"} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); start(); } }} />
            <div className="mk-composer-bottom"><button className="mk-attach" type="button" onClick={() => uploadRef.current?.click()} aria-label="Add a text or Markdown file"><Plus size={19} /><span>Add your text</span></button><input ref={uploadRef} type="file" hidden accept=".txt,.md,text/plain,text/markdown" onChange={event => { void importText(event.target.files?.[0]); event.target.value = ""; }} /><div className="mk-composer-right"><span className="mk-compose-hint">Start with an idea</span><button className="mk-send" type="submit" disabled={busy || !brief.trim()} aria-label="Plan this project"><ArrowUp size={21} strokeWidth={2} /></button></div></div>
          </form>
          {fileName && <div className="mk-file-note"><FileText size={13} />{fileName}<span>Text added to your brief</span></div>}
          {error && <p className="mk-error" role="alert">{error}</p>}
          <div className="mk-idea-chips" aria-label="Ideas to get started">{ideas[kind].map(idea => <button key={idea.label} onClick={() => addIdea(idea.text)}><Plus size={13} />{idea.label}</button>)}</div>
          <p className="mk-availability">Explore the editor now. Live AI generation is coming next.</p>
        </div>
        <div className="mk-hero-foot"><span>ONE IDEA, EVERY POSSIBILITY.</span><span>DESIGNED TO BE YOURS <span className="mk-tiny-star">✳</span></span></div>
      </section>
      <section className="mk-discovery" id="templates" aria-label="Style directions"><TemplateGallery onChoose={(selectedKind, text, styleId, style) => start(selectedKind, [brief.trim(), text].filter(Boolean).join("\n\n"), styleId, style)} /></section>
      <section className="mk-client-band"><div className="mk-client-icon"><Layers3 size={24} strokeWidth={1.4} /></div><div><span className="mk-overline">BUILT FOR THE WORK AFTER THE IDEA</span><h2>Your clients. Your projects.<br />All in one place.</h2><p>Keep every website, revision and next step connected to the right client.</p><Link href="/studio?tab=clients">Explore your client workspace <ArrowUpRight size={16} /></Link></div><div className="mk-client-preview" aria-label="Illustrative client workflow"><div className="mk-client-preview-head"><span>CLIENT WORKSPACE</span><span>Illustration</span></div><div className="mk-client-preview-row"><span className="mk-client-avatar">A</span><div><strong>A client’s next chapter</strong><span>Website · Brand guide · Presentation</span></div><span className="mk-preview-dot" /></div><div className="mk-client-progress"><span><Check size={12} /> Brief</span><i /><span><Check size={12} /> Direction</span><i /><span>Review</span></div></div></section>
      <footer className="mk-footer"><Link href="/" className="mk-wordmark"><BrandMark size={23} /><span>Makeborne</span></Link><span>A place for things worth making.</span><span>© 2026 Makeborne</span></footer>
    </main>
  );
}

"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Clock3, Crosshair, Link2Off, MessageSquare, Monitor, RotateCcw, Smartphone, X } from "lucide-react";
import BrandMark from "./brand-mark";
import AccountPreview, { PreviewBlock, previewPalette } from "./account-preview";
import AccountBookPreview from "./account-book-preview";
import ClientDocumentReview from "./client-document-review";
import AccountSlidePreview from "./account-slide-preview";
import { ArtifactContentSchema, StyleProfileSchema, type ArtifactContent, type StyleProfile } from "@/lib/domain";
import { previewBlocks, previewSlides } from "@/lib/cloud/preview-content";
import { anchorLabel } from "@/lib/client-review/feedback";
import type { ActiveReview, ReviewAnchor, ReviewComment, ReviewDecision, ReviewPayload } from "@/lib/client-review/contracts";
import "@/app/account-preview.css";

type Identity = { name: string; email: string };
type Pin = { x: number; y: number; ref: string; label: string };
const IDENTITY_KEY = "makeborne.review-identity.v1";
const dateLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const timeLabel = (value: string) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function readIdentity(): Identity {
  try {
    const value = JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? "null");
    if (value && typeof value.name === "string" && typeof value.email === "string") return { name: value.name.slice(0, 80), email: value.email.slice(0, 254) };
  } catch { /* storage unavailable */ }
  return { name: "", email: "" };
}
function saveIdentity(identity: Identity) {
  try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity)); } catch { /* optional convenience */ }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message ?? "That didn’t go through. Please try again.");
  return result as T;
}

export default function ClientReviewPage({ token, review }: { token: string; review: ReviewPayload | null }) {
  if (!review || review.status !== "active") return <ReviewUnavailable review={review} />;
  return <ActiveReviewPage token={token} initial={review} />;
}

function ReviewUnavailable({ review }: { review: ReviewPayload | null }) {
  const copy = review?.status === "expired" ? ["This review link has expired", "Ask the person who shared it for a fresh link. Your earlier comments are safe with them."]
    : review?.status === "revoked" ? ["This review link was turned off", "The person who shared it has closed this link. Ask them for a new one if you still need access."]
    : review?.status === "preparing" ? [`${review.title} isn’t ready yet`, "The review copy is still being prepared. Try again in a few minutes."]
    : ["This review link isn’t available", "Check that you copied the whole link, or ask the person who shared it for a new one."];
  return <main className="cr-unavailable">
    <div className="cr-unavailable-card">
      <span className="cr-unavailable-icon">{review?.status === "preparing" ? <Clock3 size={22} /> : <Link2Off size={22} />}</span>
      <h1>{copy[0]}</h1>
      <p>{copy[1]}</p>
      <span className="cr-shared"><BrandMark size={16} /> Shared with Makeborne</span>
    </div>
  </main>;
}

function ActiveReviewPage({ token, initial }: { token: string; initial: ActiveReview }) {
  const [comments, setComments] = useState<ReviewComment[]>(initial.comments);
  const [decision, setDecision] = useState<ReviewDecision | null>(initial.decision);
  const [identity, setIdentity] = useState<Identity>({ name: "", email: "" });
  const [editingIdentity, setEditingIdentity] = useState(false);
  // Identity fields stay visible until a comment or decision is saved with them.
  const [identityReady, setIdentityReady] = useState(false);
  const [body, setBody] = useState("");
  const [pin, setPin] = useState<Pin | null>(null);
  const [pinning, setPinning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [documentReady, setDocumentReady] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<"approved" | "changes_requested" | null>(null);
  const [note, setNote] = useState("");
  const [location, setLocation] = useState(initial.kind === "presentation" ? "slide:0" : initial.kind === "book" ? "page:0" : "page");
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { queueMicrotask(() => { const stored = readIdentity(); setIdentity(stored); setIdentityReady(!!stored.name.trim()); }); }, []);
  const parsed = useMemo(() => {
    if (initial.mode !== "content") return null;
    const content = ArtifactContentSchema.safeParse(initial.content);
    const style = StyleProfileSchema.safeParse({ referenceAssetIds: [], description: "", name: "Style", version: 1, id: "review", typography: { headingFont: "Source Serif 4", bodyFont: "Inter" }, colors: {}, ...(initial.style && typeof initial.style === "object" ? initial.style : {}) });
    return content.success ? { content: content.data, style: style.success ? style.data : null } : null;
  }, [initial]);
  const requiresDocument = !!parsed?.content.document;
  const approvalReady = !requiresDocument || documentReady;
  const discussion = comments.filter(comment => comment.kind === "comment");
  const numbered = new Map(discussion.filter(comment => comment.anchor.kind === "point").map((comment, index) => [comment.id, index + 1]));
  const pins = discussion.filter(comment => comment.version === initial.version).flatMap(comment => comment.anchor.kind === "point" ? [{ id: comment.id, number: numbered.get(comment.id)!, anchor: comment.anchor, resolved: comment.resolved }] : []);
  const needsIdentity = !identityReady || editingIdentity || !identity.name.trim();

  const pick = useCallback((next: Pin) => { setPin(next); setPinning(false); setTimeout(() => composer.current?.focus(), 0); }, []);
  function anchor(): ReviewAnchor {
    return pin ? { kind: "point", ref: pin.ref, label: pin.label.slice(0, 160), x: Math.round(pin.x * 10000) / 10000, y: Math.round(pin.y * 10000) / 10000 } : { kind: "general" };
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(""); setNotice("");
    if (!identity.name.trim()) { setEditingIdentity(true); setError("Add your name so the team knows who left this comment."); return; }
    if (!body.trim()) { setError("Write a comment first."); return; }
    setBusy(true);
    try {
      const result = await post<{ comment: ReviewComment }>(`/api/review/${token}/comments`, { version: initial.version, name: identity.name, email: identity.email, body, anchor: anchor() });
      saveIdentity(identity); setEditingIdentity(false); setIdentityReady(true);
      setComments(current => [...current, result.comment]); setBody(""); setPin(null); setActive(result.comment.id);
      setNotice("Comment added. Thank you!");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your comment didn’t go through."); }
    finally { setBusy(false); }
  }
  async function decide(value: "approved" | "changes_requested") {
    if (busy || (value === "approved" && !approvalReady)) return;
    if (!identity.name.trim()) { setEditingIdentity(true); setError("Add your name before sending your decision."); return; }
    setBusy(true); setError("");
    try {
      const result = await post<{ decision: ReviewDecision; comment: ReviewComment }>(`/api/review/${token}/decision`, { version: initial.version, name: identity.name, email: identity.email, decision: value, note });
      saveIdentity(identity); setEditingIdentity(false); setIdentityReady(true);
      setDecision(result.decision); setComments(current => [...current, result.comment]); setDeciding(null); setNote("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your decision didn’t go through."); }
    finally { setBusy(false); }
  }
  function focusComment(comment: ReviewComment) {
    setActive(comment.id);
    if (comment.anchor.kind === "general") return;
    if (initial.kind !== "website" || initial.mode === "content") setLocation(comment.anchor.ref);
  }

  const greeting = initial.recipientName.trim() ? `Hi ${initial.recipientName.trim().split(/\s+/)[0]},` : "Hello,";
  const kindLabel = initial.kind === "website" ? "website" : initial.kind === "book" ? "book" : "presentation";
  return <div className="cr-page">
    <header className="cr-top">
      <div className="cr-top-title">
        <span className="cr-shared"><BrandMark size={16} /> Shared for review</span>
        <h1>{initial.title}</h1>
        <p><span className="cr-chip">Version {initial.version}</span><span>{initial.pinned ? "This exact version" : "Always the latest version"}</span><span aria-hidden="true">·</span><span>Link open until {dateLabel(initial.expiresAt)}</span></p>
      </div>
      <div className="cr-top-actions">
        {decision ? <DecisionBadge decision={decision} /> : null}
        <button type="button" className="button secondary" disabled={busy} aria-pressed={deciding === "changes_requested"} onClick={() => { setDeciding(deciding === "changes_requested" ? null : "changes_requested"); setNote(""); }}><RotateCcw size={15} /> Request changes</button>
        <button type="button" className="button primary cr-approve" disabled={busy || !approvalReady} aria-pressed={deciding === "approved"} onClick={() => { setDeciding(deciding === "approved" ? null : "approved"); setNote(""); }}><Check size={15} /> Approve</button>
      </div>
    </header>
    {deciding && <section className="cr-decision-panel" aria-label={deciding === "approved" ? "Approve this version" : "Request changes"}>
      <div>
        <h2>{deciding === "approved" ? `Approve version ${initial.version}?` : "What should change?"}</h2>
        <p>{deciding === "approved" ? "This tells the team the work is ready to deliver. You can add a final note." : "Summarise what you’d like changed. Pinned comments on the page are included too."}</p>
      </div>
      {needsIdentity && <IdentityFields identity={identity} onChange={setIdentity} />}
      <label className="cr-field">{deciding === "approved" ? "Note (optional)" : "Summary (optional)"}<textarea rows={3} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder={deciding === "approved" ? "Looks great — ready to go." : "The hero feels too dark, and pricing needs the new tiers."} /></label>
      <div className="cr-decision-actions">
        <button type="button" className="button secondary small" onClick={() => setDeciding(null)} disabled={busy}>Cancel</button>
        <button type="button" className={`button small ${deciding === "approved" ? "primary cr-approve" : "dark"}`} disabled={busy || (deciding === "approved" && !approvalReady)} onClick={() => void decide(deciding)}>{busy ? "Sending…" : deciding === "approved" ? "Approve version " + initial.version : "Send change request"}</button>
      </div>
    </section>}
    <div className="cr-layout">
      <main className="cr-stage" aria-label={`${initial.title} ${kindLabel}`}>
        {pinning && <div className="cr-pin-hint" role="status"><Crosshair size={14} /> Click anywhere on the {kindLabel} to pin your comment. <button type="button" onClick={() => setPinning(false)}>Cancel</button></div>}
        {initial.mode === "html" && initial.html ? <WebsiteFrame html={initial.html} title={initial.title} pinning={pinning} pins={pins} draft={pin} active={active} onPick={pick} onPin={id => setActive(id)} />
          : parsed?.content.document ? <ClientDocumentReview key={`${token}:${initial.version}`} document={parsed.content.document} token={token} version={initial.version} onReady={setDocumentReady}
            render={(html, onLoaded) => <WebsiteFrame html={html} title={initial.title} documentKind={parsed.content.document!.kind} onReady={onLoaded} pinning={pinning} pins={pins} draft={pin} active={active} onPick={pick} onPin={id => setActive(id)} />} />
          : parsed ? <ContentReview content={parsed.content} style={parsed.style} location={location} onLocation={setLocation} pinning={pinning} pins={pins} draft={pin} active={active} onPick={pick} onPin={id => setActive(id)} />
          : <p className="cr-empty" role="alert">This version can’t be displayed. Ask the team for a new link.</p>}
      </main>
      <aside className="cr-sidebar" aria-label="Feedback">
        <div className="cr-intro">
          <p className="cr-greeting">{greeting}</p>
          <p>{initial.message.trim() || `Here is the ${kindLabel} for your review. Leave comments anywhere on the page, then approve it or request changes.`}</p>
        </div>
        <form className="cr-composer" onSubmit={send}>
          <h2><MessageSquare size={15} /> Add a comment</h2>
          {needsIdentity ? <IdentityFields identity={identity} onChange={setIdentity} /> : <p className="cr-as">Commenting as <strong>{identity.name}</strong> <button type="button" onClick={() => setEditingIdentity(true)}>Change</button></p>}
          <div className="cr-anchor-row">
            {pin ? <span className="cr-anchor-chip"><Crosshair size={13} /> {pin.label || "Pinned spot"}<button type="button" aria-label="Remove pin" onClick={() => setPin(null)}><X size={12} /></button></span>
              : <span className="cr-anchor-chip is-general">General comment</span>}
            <button type="button" className="cr-pin-button" aria-pressed={pinning} onClick={() => setPinning(value => !value)}><Crosshair size={14} /> {pinning ? "Click the page…" : pin ? "Move pin" : "Pin to a spot"}</button>
          </div>
          <label className="cr-sr" htmlFor="cr-comment">Comment</label>
          <textarea id="cr-comment" ref={composer} rows={4} maxLength={2000} value={body} onChange={event => setBody(event.target.value)} placeholder={pin ? "What should change here?" : "Share your thoughts on the whole piece…"} />
          <div className="cr-composer-foot"><small>{body.length}/2000</small><button type="submit" className="button primary small" disabled={busy || !body.trim()}>{busy ? "Posting…" : "Post comment"}</button></div>
          {error && <p className="cr-error" role="alert">{error}</p>}
          {notice && <p className="cr-notice" role="status">{notice}</p>}
        </form>
        <section className="cr-thread" aria-label="Comments">
          <h2>Comments <span>{discussion.length}</span></h2>
          {!comments.length && <p className="cr-empty">No comments yet. Pin one to a spot or leave a general note.</p>}
          <ol>{comments.map(comment => <li key={comment.id} className={`cr-comment cr-comment-${comment.kind}${active === comment.id ? " is-active" : ""}${comment.resolved ? " is-resolved" : ""}`}>
            <button type="button" className="cr-comment-focus" onClick={() => focusComment(comment)} aria-label={`Show comment from ${comment.authorName}`}>
              <span className="cr-comment-head">
                {numbered.has(comment.id) ? <span className="cr-pin-number">{numbered.get(comment.id)}</span> : comment.kind === "comment" ? <span className="cr-pin-number is-general"><MessageSquare size={11} /></span> : <span className={`cr-pin-number is-${comment.kind}`}>{comment.kind === "approved" ? <Check size={11} /> : <RotateCcw size={11} />}</span>}
                <strong>{comment.authorName}</strong>
                <time dateTime={comment.createdAt}>{timeLabel(comment.createdAt)}</time>
              </span>
              {comment.kind !== "comment" && <span className="cr-comment-decision">{comment.kind === "approved" ? `Approved version ${comment.version}` : `Requested changes on version ${comment.version}`}</span>}
              {comment.kind === "comment" && <span className="cr-comment-where">{anchorLabel(comment.anchor, initial.kind)}{comment.version !== initial.version ? ` · version ${comment.version}` : ""}{comment.resolved ? " · Resolved" : ""}</span>}
              {comment.body && <span className="cr-comment-body">{comment.body}</span>}
            </button>
          </li>)}</ol>
        </section>
        <p className="cr-privacy">Your name, comments and decision are shared only with the team that sent this link. Your email is optional and never shown here.</p>
      </aside>
    </div>
  </div>;
}

function DecisionBadge({ decision }: { decision: ReviewDecision }) {
  return <span className={`cr-decision-badge is-${decision.value}`} role="status">
    {decision.value === "approved" ? <Check size={14} /> : <RotateCcw size={14} />}
    {decision.value === "approved" ? "Approved" : "Changes requested"} by {decision.name} · {dateLabel(decision.at)}
  </span>;
}

function IdentityFields({ identity, onChange }: { identity: Identity; onChange: (value: Identity) => void }) {
  return <div className="cr-identity">
    <label className="cr-field">Your name<input value={identity.name} maxLength={80} autoComplete="name" required onChange={event => onChange({ ...identity, name: event.target.value })} placeholder="Jane Doe" /></label>
    <label className="cr-field"><span>Email <small>(optional)</small></span><input type="email" value={identity.email} maxLength={254} autoComplete="email" onChange={event => onChange({ ...identity, email: event.target.value })} placeholder="jane@company.com" /></label>
  </div>;
}

type PinView = { id: string; number: number; anchor: Extract<ReviewAnchor, { kind: "point" }>; resolved: boolean };
type Surface = { pinning: boolean; pins: PinView[]; draft: Pin | null; active: string | null; onPick: (pin: Pin) => void; onPin: (id: string) => void };

/** Overlay that turns a click into a relative position, and draws numbered pins. */
function PinLayer({ refId, label, pinning, pins, draft, active, onPick, onPin, children }: Surface & { refId: string; label: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const visible = pins.filter(pin => pin.anchor.ref === refId);
  return <div className="cr-pin-layer" ref={box}>
    {children}
    {pinning && <button type="button" className="cr-pin-capture" aria-label={`Pin a comment on ${label}`} onClick={event => {
      const rect = box.current!.getBoundingClientRect();
      onPick({ x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)), ref: refId, label });
    }} />}
    {visible.map(pin => <button type="button" key={pin.id} className={`cr-pin${active === pin.id ? " is-active" : ""}${pin.resolved ? " is-resolved" : ""}`} style={{ left: `${pin.anchor.x * 100}%`, top: `${pin.anchor.y * 100}%` }} aria-label={`Comment ${pin.number}`} onClick={() => onPin(pin.id)}>{pin.number}</button>)}
    {draft?.ref === refId && <span className="cr-pin is-draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }} aria-hidden="true">+</span>}
  </div>;
}

function ContentReview({ content, style, location, onLocation, ...surface }: Surface & { content: ArtifactContent; style: StyleProfile | null; location: string; onLocation: (value: string) => void }) {
  const theme = style ?? StyleProfileSchema.parse({ id: "review", name: "Style", version: 1, typography: { headingFont: "Source Serif 4", bodyFont: "Inter" }, colors: {}, description: "" });
  if (content.kind === "presentation") {
    const slides = previewSlides(content);
    const index = Math.min(Math.max(0, Number(location.split(":")[1]) || 0), Math.max(0, slides.length - 1));
    if (!slides.length) return <p className="cr-empty">This presentation has no slides yet.</p>;
    const slide = slides[index];
    return <div className="cr-slides">
      <div className="ap-stage presentation cr-slide-stage" style={previewPalette(theme)}>
        <PinLayer {...surface} refId={`slide:${index}`} label={`Slide ${index + 1}${slide.title ? ` · ${slide.title.slice(0, 80)}` : ""}`}>
          <AccountSlidePreview slide={slide} index={index} total={slides.length} renderImage={block => <PreviewBlock block={block} />} />
        </PinLayer>
      </div>
      <nav className="cr-slide-nav" aria-label="Slides">
        <button type="button" disabled={index === 0} aria-label="Previous slide" onClick={() => onLocation(`slide:${index - 1}`)}><ChevronLeft size={16} /></button>
        <span aria-live="polite">Slide {index + 1} of {slides.length}</span>
        <button type="button" disabled={index >= slides.length - 1} aria-label="Next slide" onClick={() => onLocation(`slide:${index + 1}`)}><ChevronRight size={16} /></button>
      </nav>
      <div className="cr-thumbs" aria-label="All slides">{slides.map((item, slideIndex) => <button type="button" key={item.id + slideIndex} aria-current={slideIndex === index} onClick={() => onLocation(`slide:${slideIndex}`)}><span>{slideIndex + 1}</span>{item.title || "Untitled"}{surface.pins.some(pin => pin.anchor.ref === `slide:${slideIndex}`) && <i aria-label="Has comments" />}</button>)}</div>
    </div>;
  }
  if (content.kind === "book") {
    const page = Number(location.split(":")[1]) || 0;
    return <div className="ap-stage book cr-book-stage" style={previewPalette(theme)}>
      <PinLayer {...surface} refId={`page:${page}`} label={page === 0 ? "Cover" : `Page ${page}`}>
        <AccountBookPreview title={content.title} blocks={previewBlocks(content)} renderBlock={block => <PreviewBlock block={block} />} onPageChange={next => onLocation(`page:${next}`)} />
      </PinLayer>
    </div>;
  }
  return <PinLayer {...surface} refId="page" label="Website"><AccountPreview content={content} style={theme} dirty={false} /></PinLayer>;
}

/** The published-snapshot style website: sanitized, script-free HTML in a
 * sandbox without allow-scripts. Same-origin lets this page (not the site)
 * measure clicks and draw pins; the document itself can never run code. */
function WebsiteFrame({ html, title, documentKind, onReady, pinning, pins, draft, active, onPick, onPin }: Surface & { html: string; title: string; documentKind?: "deck" | "book"; onReady?: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [mobile, setMobile] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const state = useRef({ pinning, onPick, onPin, documentKind, onReady });
  useEffect(() => { state.current = { pinning, onPick, onPin, documentKind, onReady }; }, [pinning, onPick, onPin, documentKind, onReady]);
  const attached = useRef<Document | null>(null);
  const attach = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.documentElement || attached.current === doc) return;
    attached.current = doc;
    const style = doc.createElement("style");
    style.setAttribute("data-mb-review", "");
    style.textContent = `[data-mb-pin]{position:absolute;z-index:2147483646;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50% 50% 50% 4px;display:grid;place-items:center;background:#3358d4;color:#fff;font:600 12px/1 Arial,sans-serif;box-shadow:0 0 0 3px #fff,0 6px 18px #1a1f3a55;cursor:pointer;border:0;padding:0}[data-mb-pin].is-active{background:#16181d;transform:scale(1.15)}[data-mb-pin].is-resolved{background:#8b8f9c}[data-mb-pin].is-draft{background:#f76f53}html.mb-pinning,html.mb-pinning *{cursor:crosshair!important}`;
    doc.head?.appendChild(style);
    doc.addEventListener("click", event => {
      const target = event.target as Element | null;
      const pinElement = target?.closest?.("[data-mb-pin]");
      if (pinElement) { event.preventDefault(); const id = pinElement.getAttribute("data-mb-pin"); if (id && id !== "draft") state.current.onPin(id); return; }
      if (state.current.pinning) {
        event.preventDefault(); event.stopPropagation();
        const root = doc.documentElement;
        const width = Math.max(root.scrollWidth, 1), height = Math.max(root.scrollHeight, 1);
        const sections = [...doc.querySelectorAll("header, section, footer, main > div, [id]")].filter(element => element.parentElement?.closest("section, header, footer") == null);
        const section = target?.closest?.("section, header, footer") ?? target?.closest?.("[id]") ?? null;
        const index = section ? Math.max(0, sections.indexOf(section)) : -1;
        const heading = (section?.querySelector("h1, h2, h3") as HTMLElement | null)?.innerText?.replace(/\s+/g, " ").trim().slice(0, 70);
        const name = section?.tagName === "HEADER" ? "Header" : section?.tagName === "FOOTER" ? "Footer" : heading ? `“${heading}”` : section?.id ? section.id.replace(/[-_]/g, " ") : "";
        state.current.onPick({ x: event.pageX / width, y: event.pageY / height, ref: index >= 0 ? `section:${index}` : "page", label: state.current.documentKind ? section?.getAttribute("aria-label") || name || "Document" : name ? `Section ${name}` : "Website" });
        return;
      }
      const link = target?.closest?.("a");
      if (link) {
        event.preventDefault();
        const href = link.getAttribute("href") ?? "";
        const id = href.includes("#") ? decodeURIComponent(href.slice(href.indexOf("#") + 1)) : "";
        if (id) doc.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, true);
    doc.addEventListener("submit", event => event.preventDefault(), true);
    setLoaded(value => value + 1);
    void doc.fonts.ready.then(() => { if (frame.current?.contentDocument === doc) state.current.onReady?.(); });
  }, []);
  // A server-rendered srcdoc frame can finish loading before hydration, so
  // its load event is missed: attach as soon as the document is complete.
  useEffect(() => {
    let timer = 0;
    const check = () => {
      const doc = frame.current?.contentDocument;
      if (doc?.readyState === "complete" && doc.documentElement && doc.URL === "about:srcdoc") attach();
      else timer = window.setTimeout(check, 100);
    };
    check();
    return () => window.clearTimeout(timer);
  }, [attach, mobile]);
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.documentElement || !loaded) return;
    doc.documentElement.classList.toggle("mb-pinning", pinning);
    doc.querySelectorAll("[data-mb-pin]").forEach(element => element.remove());
    const root = doc.documentElement;
    const place = (id: string, label: string, x: number, y: number, className: string) => {
      const element = doc.createElement("button");
      element.setAttribute("data-mb-pin", id); element.setAttribute("type", "button"); element.setAttribute("aria-label", id === "draft" ? "New comment position" : `Comment ${label}`);
      element.className = className; element.textContent = label;
      element.style.left = `${x * root.scrollWidth}px`; element.style.top = `${y * root.scrollHeight}px`;
      root.appendChild(element);
    };
    pins.forEach(pin => place(pin.id, String(pin.number), pin.anchor.x, pin.anchor.y, `${active === pin.id ? "is-active" : ""}${pin.resolved ? " is-resolved" : ""}`));
    if (draft) place("draft", "+", draft.x, draft.y, "is-draft");
    if (active) {
      const pin = pins.find(item => item.id === active);
      if (pin) doc.defaultView?.scrollTo({ top: Math.max(0, pin.anchor.y * root.scrollHeight - 160), behavior: "smooth" });
    }
  }, [pins, draft, active, pinning, loaded, mobile]);
  return <section className="cr-website">
    <div className="cr-website-bar">
      <span className="cr-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="cr-website-title">{title}</span>
      {!documentKind && <div className="cr-devices" role="group" aria-label="Preview width">
        <button type="button" aria-label="Desktop width" aria-pressed={!mobile} onClick={() => setMobile(false)}><Monitor size={15} /></button>
        <button type="button" aria-label="Mobile width" aria-pressed={mobile} onClick={() => setMobile(true)}><Smartphone size={15} /></button>
      </div>}
    </div>
    <div className={`cr-website-viewport${mobile ? " is-mobile" : ""}`}>
      <iframe ref={frame} key={mobile ? "mobile" : "desktop"} title={`${title} ${documentKind === "deck" ? "presentation" : documentKind === "book" ? "book" : "website"} preview`} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={html} onLoad={attach} />
    </div>
  </section>;
}

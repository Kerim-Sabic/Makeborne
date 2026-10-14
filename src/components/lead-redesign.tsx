"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Globe, Loader2, RefreshCw, Wand2, X } from "lucide-react";
import { BRAND_COLOR_ROLES, brandFont, type BrandKitInput } from "@/lib/brand/kit";
import type { AuditFinding } from "@/lib/leads/redesign";
import { brandRequest } from "./brand-kit-api";
import "@/app/lead-redesign.css";

type Reading = {
  name: string; url: string; title: string; brief: string; audit: AuditFinding[];
  pagesRead: { label: string; url: string }[];
  facts: { phones: string[]; emails: string[]; address: string; hours: number; words: number };
  brand: { kit: BrandKitInput; notes: string[] } | null; hasBrandKit: boolean;
};
const LEVEL = { high: "Big problem", medium: "Problem", low: "Worth fixing" } as const;
const host = (url: string) => { try { return new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ""); } catch { return url; } };

/**
 * "Redesign their website": reads the client's current site (no AI, no credits),
 * shows what holds it back and their brand, then hands a ready brief to the
 * normal project setup. Building the redesign uses credits as usual.
 */
export default function LeadRedesign({ accountId, workspaceId, client, onClose, onCreate }: {
  accountId: string; workspaceId: string; client: { id: string; name: string; website: string };
  onClose: () => void; onCreate: (brief: string, title: string) => void;
}) {
  const [url, setUrl] = useState(client.website);
  const [reading, setReading] = useState<Reading | null>(null);
  const [busy, setBusy] = useState<"" | "read" | "create">("read");
  const [error, setError] = useState("");
  const [saveKit, setSaveKit] = useState(true);
  const [brief, setBrief] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const path = `/api/cloud/workspaces/${workspaceId}/clients/${client.id}`;

  const read = useCallback(async (address: string) => {
    setBusy("read"); setError("");
    try {
      const value = await brandRequest<Reading>(accountId, `${path}/redesign`, { method: "POST", body: JSON.stringify({ url: address.trim() }) });
      setReading(value); setBrief(value.brief);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Their website couldn't be read."); }
    finally { setBusy(""); }
  }, [accountId, path]);
  // Read once on open; later reads happen from the address form.
  const started = useRef(false);
  useEffect(() => { if (started.current) return; started.current = true; void read(client.website); }, [client.website, read]);

  const close = useCallback(() => { if (busy !== "create") onClose(); }, [busy, onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, [close]);

  async function create() {
    if (!reading || !brief.trim()) return;
    setBusy("create"); setError("");
    try {
      if (reading.brand && !reading.hasBrandKit && saveKit)
        await brandRequest(accountId, `/api/cloud/workspaces/${workspaceId}/brand-kits`, { method: "PUT", body: JSON.stringify({ clientId: client.id, kit: { ...reading.brand.kit, name: reading.brand.kit.name || reading.name } }) });
      onCreate(brief.trim(), reading.title);
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "Their brand kit couldn't be saved."} Untick “Save their brand” to continue without it.`);
      setBusy("");
    }
  }

  const kit = reading?.brand?.kit;
  const problems = reading?.audit.filter(item => item.id !== "platform") ?? [];
  const platform = reading?.audit.find(item => item.id === "platform");

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="modal lr" role="dialog" aria-modal="true" aria-labelledby="lr-title" tabIndex={-1} ref={dialog}>
      <button type="button" className="icon-button modal-close" aria-label="Close" onClick={close}><X size={20} /></button>
      <span className="eyebrow">REDESIGN</span>
      <h2 id="lr-title">Redesign {client.name}&apos;s website</h2>
      <p className="lr-intro">We read their current site, keep their real details, fix what holds it back and build a new version you can show them. Reading is free; building uses credits as usual.</p>

      {busy === "read" && <div className="lr-reading" role="status"><Loader2 size={18} className="lr-spin" /><div><strong>Reading {host(url)}…</strong><span>Home page, services, about and contact. This can take up to 30 seconds.</span></div></div>}

      {error && <div className="lr-error" role="alert"><AlertTriangle size={15} /> <span>{error}</span></div>}
      {!reading && busy !== "read" && <form className="lr-address" onSubmit={event => { event.preventDefault(); void read(url); }}>
        <label htmlFor="lr-url">Their website</label>
        <div><input id="lr-url" type="text" inputMode="url" value={url} maxLength={500} onChange={event => setUrl(event.target.value)} placeholder="www.example.com" />
          <button type="submit" className="button" disabled={!url.trim()}><RefreshCw size={15} /> Try again</button></div>
      </form>}

      {reading && <>
        <section className="lr-section" aria-labelledby="lr-read">
          <h3 id="lr-read"><Globe size={15} /> What we read</h3>
          <ul className="lr-pages">{reading.pagesRead.map(page => <li key={page.url}><a href={page.url} target="_blank" rel="noreferrer noopener">{page.label}</a></li>)}</ul>
          <p className="lr-muted">{[reading.facts.phones.length ? "phone" : "", reading.facts.emails.length ? "email" : "", reading.facts.address ? "address" : "", reading.facts.hours ? "opening hours" : ""].filter(Boolean).join(", ").replace(/^./, letter => letter.toUpperCase()) || "No contact details"} found{reading.facts.words ? `, about ${Math.round(reading.facts.words / 10) * 10} words of their own copy` : ""}. The redesign keeps these facts and invents nothing.</p>
        </section>

        <section className="lr-section" aria-labelledby="lr-audit">
          <h3 id="lr-audit">What&apos;s holding their site back</h3>
          {problems.length ? <ul className="lr-audit">{problems.map(item => <li key={item.id} data-level={item.level}><span className="lr-level">{LEVEL[item.level]}</span><strong>{item.title}</strong><span>{item.detail}</span></li>)}</ul>
            : <p className="lr-muted">No obvious technical problems. The redesign focuses on a stronger look, clearer offer and easier booking.</p>}
          {platform && <p className="lr-muted">{platform.detail}</p>}
          <p className="lr-muted">You can mention these in your email: choose the “I redesigned your website” angle when writing to them.</p>
        </section>

        <section className="lr-section" aria-labelledby="lr-brand">
          <h3 id="lr-brand">Their brand</h3>
          {reading.hasBrandKit ? <p className="lr-muted"><Check size={14} /> The redesign uses their saved brand kit.</p>
            : kit ? <>
              <div className="lr-brand">
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URL logo read from their site */}
                {kit.logo ? <img src={kit.logo} alt={`${kit.name} logo`} /> : <span className="lr-muted">No logo found</span>}
                <span className="lr-swatches" aria-label="Their colours">{BRAND_COLOR_ROLES.map(role => kit.colors[role] && <span key={role} title={kit.colors[role]!} style={{ background: kit.colors[role]! }} />)}</span>
                <span className="lr-muted">{[brandFont(kit.fonts?.heading)?.family, brandFont(kit.fonts?.body)?.family].filter(Boolean).join(" / ")}</span>
              </div>
              <label className="lr-check"><input type="checkbox" checked={saveKit} onChange={event => setSaveKit(event.target.checked)} /> Save their brand as {client.name}&apos;s brand kit, so the redesign and future work use it. You can edit it on their Details tab.</label>
            </> : <p className="lr-muted">Their colours and logo couldn&apos;t be read. The builder will choose a fitting direction.</p>}
        </section>

        <details className="lr-brief">
          <summary><ChevronDown size={15} /> Review the brief the builder gets</summary>
          <textarea value={brief} onChange={event => setBrief(event.target.value)} rows={12} maxLength={7500} aria-label="Redesign brief" />
          <p className="lr-muted">{brief.length.toLocaleString()} / 7,500 characters. Text from their site is marked as material, so the builder never follows instructions hidden in it.</p>
        </details>
      </>}

      <footer className="lr-actions">
        <button type="button" className="button" onClick={close} disabled={busy === "create"}>Cancel</button>
        <button type="button" className="button primary" onClick={() => void create()} disabled={!reading || !brief.trim() || Boolean(busy)}>
          {busy === "create" ? <><Loader2 size={15} className="lr-spin" /> Preparing…</> : <><Wand2 size={15} /> Create the redesign</>}</button>
      </footer>
    </div>
  </div>;
}

"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Globe, ImagePlus, Loader2, Palette, Plus, Trash2, X } from "lucide-react";
import { BRAND_COLOR_ROLES, BRAND_FONTS, BrandKitSchema, brandFont, brandWarnings, COLOR_ROLE_LABELS, contrast, emptyBrandKit, resolvedColors, type BrandColorRole, type BrandKit, type BrandKitInput } from "@/lib/brand/kit";
import { brandRequest, type BrandKitList, type SavedBrandKit } from "./brand-kit-api";
import { FONT_SUBSETS, UNICODE_RANGES, type FontSubset } from "@/lib/builder/fonts";
import { focusReturnTarget } from "@/lib/focus-return";
import "@/app/brand-kits.css";

const OWN = "own";
const keyOf = (clientId: string | null) => clientId ?? OWN;
const FONT_GROUPS: [string, string][] = [["serif", "Serif"], ["sans", "Sans serif"], ["display", "Display"], ["mono", "Monospace"]];
/** Same-origin copies of a catalogue face: latin, and latin-ext for names such as Šibenik or Łódź. */
const fontSrc = (id: string, subset: FontSubset) => `/builder-runtime/fonts/${id}-${subset === "latin" ? "" : `${subset}-`}normal.woff2`;

/**
 * Brand kits for the workspace's own brand and for each client. With
 * `clientId`, shows only that client's kit (on the client page).
 */
export default function BrandKits({ accountId, workspaceId, clientId, clientName }: { accountId: string; workspaceId: string; clientId?: string; clientName?: string }) {
  const [state, setState] = useState<BrandKitList | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ clientId: string | null; title: string; kit: BrandKitInput; saved: boolean } | null>(null);
  const [newClient, setNewClient] = useState("");
  const path = `/api/cloud/workspaces/${workspaceId}/brand-kits`;

  useEffect(() => {
    let active = true;
    brandRequest<BrandKitList>(accountId, path).then(value => { if (active) setState(value); }, cause => { if (active) setError(cause instanceof Error ? cause.message : "Brand kits couldn't load."); });
    return () => { active = false; };
  }, [accountId, path]);

  const byKey = useMemo(() => new Map((state?.kits ?? []).map(entry => [keyOf(entry.clientId), entry])), [state]);
  const clientsWithout = (state?.clients ?? []).filter(client => !byKey.has(client.id));
  const open = (target: string | null, title: string, defaultName: string) => {
    const saved = byKey.get(keyOf(target));
    setEditing({ clientId: target, title, kit: saved ? saved.kit : emptyBrandKit(defaultName), saved: Boolean(saved) });
  };
  const onSaved = (entry: SavedBrandKit | null, target: string | null) => setState(current => {
    if (!current) return current;
    const others = current.kits.filter(item => keyOf(item.clientId) !== keyOf(target));
    const name = target ? current.clients.find(client => client.id === target)?.name ?? clientName ?? "Client" : null;
    return { ...current, kits: entry ? [{ ...entry, clientName: name }, ...others] : others };
  });

  if (error) return <section className="bk"><p className="bk-error" role="alert">{error}</p></section>;
  if (!state) return <section className="bk" aria-busy="true"><p className="bk-muted"><Loader2 size={14} className="bk-spin" /> Loading brand kits…</p></section>;
  if (!state.available) return <section className="bk"><Heading single={Boolean(clientId)} /><p className="bk-muted">Brand kits are being set up. Your projects keep using their creative direction until then.</p></section>;

  const cards: ReactNode[] = [];
  if (clientId) {
    const saved = byKey.get(clientId);
    cards.push(<KitCard key={clientId} label={clientName ?? "This client"} entry={saved} canEdit={state.canEdit} onOpen={() => open(clientId, `${clientName ?? "Client"} brand kit`, clientName ?? "")} />);
  } else {
    cards.push(<KitCard key={OWN} label="Your brand" hint="Projects without a client and your outreach emails" entry={byKey.get(OWN)} canEdit={state.canEdit} onOpen={() => open(null, "Your brand kit", "")} />);
    for (const entry of state.kits.filter(item => item.clientId))
      cards.push(<KitCard key={entry.clientId!} label={entry.clientName ?? "Client"} entry={entry} canEdit={state.canEdit} onOpen={() => open(entry.clientId, `${entry.clientName ?? "Client"} brand kit`, entry.clientName ?? "")} />);
  }

  return <section className="bk">
    <Heading single={Boolean(clientId)} />
    <div className="bk-grid">{cards}</div>
    {!clientId && state.canEdit && clientsWithout.length > 0 && <form className="bk-add" onSubmit={event => {
      event.preventDefault();
      const client = state.clients.find(item => item.id === newClient);
      if (client) { open(client.id, `${client.name} brand kit`, client.name); setNewClient(""); }
    }}>
      <label htmlFor="bk-new-client">Add a kit for a client</label>
      <select id="bk-new-client" value={newClient} onChange={event => setNewClient(event.target.value)}>
        <option value="">Choose a client…</option>
        {clientsWithout.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
      </select>
      <button type="submit" className="button" disabled={!newClient}><Plus size={15} /> Add kit</button>
    </form>}
    {editing && <KitEditor accountId={accountId} path={path} target={editing.clientId} title={editing.title} initial={editing.kit} saved={editing.saved}
      onClose={() => setEditing(null)} onSaved={entry => { onSaved(entry, editing.clientId); setEditing(null); }} />}
  </section>;
}

function Heading({ single }: { single: boolean }) {
  return <div className="bk-heading">
    <h2><Palette size={18} /> {single ? "Brand kit" : "Brand kits"}</h2>
    <p>{single ? "This client's logo, colours, fonts and voice. Every website, deck and book you make for them uses it." : "Your logo, colours, fonts and voice, applied automatically to every website, deck, book and outreach email."}</p>
  </div>;
}

function Logo({ kit, size = 44 }: { kit: Pick<BrandKitInput, "logo" | "name" | "colors">; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- stored data: URL logo
  if (kit.logo) return <img className="bk-logo" src={kit.logo} alt={`${kit.name || "Brand"} logo`} style={{ maxHeight: size }} />;
  const initials = (kit.name || "?").split(/\s+/).map(word => word[0]).join("").slice(0, 2).toUpperCase();
  const primary = /^#[0-9a-f]{6}$/i.test(kit.colors.primary) ? kit.colors.primary : "#1f6f5b";
  return <span className="bk-initials" style={{ width: size, height: size, background: primary, color: contrast(primary, "#ffffff") >= 3 ? "#fff" : "#16181d" }} aria-hidden="true">{initials}</span>;
}

function KitCard({ label, hint, entry, canEdit, onOpen }: { label: string; hint?: string; entry?: SavedBrandKit; canEdit: boolean; onOpen: () => void }) {
  if (!entry) return <button type="button" className="bk-card bk-card-empty" onClick={onOpen} disabled={!canEdit}>
    <span className="bk-card-label">{label}</span>
    {hint && <span className="bk-muted">{hint}</span>}
    <span className="bk-cta"><Plus size={15} /> Set up brand kit</span>
  </button>;
  const kit = entry.kit, heading = brandFont(kit.fonts.heading), body = brandFont(kit.fonts.body);
  return <button type="button" className="bk-card" onClick={onOpen} aria-label={`${canEdit ? "Edit" : "View"} ${label} brand kit`}>
    <span className="bk-card-top"><Logo kit={kit} /><span className="bk-card-label">{label}</span></span>
    {hint && <span className="bk-muted">{hint}</span>}
    <span className="bk-swatches" aria-hidden="true">{BRAND_COLOR_ROLES.map(role => kit.colors[role] && <span key={role} style={{ background: kit.colors[role]! }} />)}</span>
    <span className="bk-muted">{[heading?.family, body?.family].filter(Boolean).join(" / ") || "Fonts chosen per project"}</span>
  </button>;
}

const listText = (values: string[]) => values.join(", ");
const listValue = (text: string) => text.split(/[,\n]/).map(value => value.trim()).filter(Boolean).slice(0, 15);

/** Reads a logo file: SVGs go to the server as-is (it rasterises safe ones); images are scaled to 512 px PNG first. */
async function readLogo(file: File): Promise<string> {
  if (file.size > 2_000_000) throw new Error("Use a logo file under 2 MB.");
  if (file.type === "image/svg+xml") return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("That logo couldn't be read."));
    reader.readAsDataURL(file);
  });
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("Upload a PNG, JPG, WebP or SVG logo.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/png");
}

function KitEditor({ accountId, path, target, title, initial, saved, onClose, onSaved }: {
  accountId: string; path: string; target: string | null; title: string; initial: BrandKitInput; saved: boolean;
  onClose: () => void; onSaved: (entry: SavedBrandKit | null) => void;
}) {
  const [kit, setKit] = useState<BrandKitInput>(initial);
  const [use, setUse] = useState(listText(initial.wordsToUse ?? []));
  const [avoid, setAvoid] = useState(listText(initial.wordsToAvoid ?? []));
  const [website, setWebsite] = useState(initial.sourceUrl ?? "");
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "import" | "save" | "delete" | "logo">("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  useEffect(() => {
    const previous = focusReturnTarget();
    dialog.current?.querySelector<HTMLElement>("input, button")?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, [close]);

  const candidate = { ...kit, wordsToUse: listValue(use), wordsToAvoid: listValue(avoid) };
  // The logo is checked by the server (it re-encodes uploads), so validate everything else here.
  const parsed = BrandKitSchema.safeParse({ ...candidate, logo: null });
  const preview: BrandKit | null = parsed.success ? parsed.data : null;
  const warnings = preview ? brandWarnings(preview) : [];
  const colors = preview ? resolvedColors(preview) : null;
  const heading = brandFont(kit.fonts?.heading), body = brandFont(kit.fonts?.body);
  const fontCss = [heading, body].filter((font, index, all) => font && all.findIndex(other => other?.id === font.id) === index)
    .flatMap(font => FONT_SUBSETS.map(subset => `@font-face{font-family:"bk-${font!.id}";src:url(${fontSrc(font!.id, subset)}) format("woff2");font-display:swap;font-weight:100 900;unicode-range:${UNICODE_RANGES[subset]}}`)).join("");

  const setColor = (role: BrandColorRole, value: string | null) => setKit(current => ({ ...current, colors: { ...current.colors, [role]: value } }));

  async function importSite() {
    if (!website.trim()) return;
    setBusy("import"); setError(""); setNotes([]);
    try {
      const result = await brandRequest<{ kit: BrandKitInput; notes: string[] }>(accountId, `${path}/import`, { method: "POST", body: JSON.stringify({ url: website.trim() }) });
      // Keep anything the owner already wrote about their voice.
      setKit(current => ({ ...result.kit, tone: current.tone || result.kit.tone, name: target ? current.name || result.kit.name : result.kit.name || current.name }));
      if (!use.trim()) setUse(listText(result.kit.wordsToUse ?? []));
      setNotes(result.notes);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That website couldn't be read."); }
    finally { setBusy(""); }
  }

  async function save() {
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the highlighted fields."); return; }
    setBusy("save"); setError("");
    try {
      const result = await brandRequest<{ kit: SavedBrandKit }>(accountId, path, { method: "PUT", body: JSON.stringify({ clientId: target, kit: candidate }) });
      onSaved(result.kit);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The brand kit couldn't be saved."); setBusy(""); }
  }

  async function remove() {
    setBusy("delete"); setError("");
    try { await brandRequest(accountId, path, { method: "DELETE", body: JSON.stringify({ clientId: target }) }); onSaved(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The brand kit couldn't be removed."); setBusy(""); }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="modal bk-modal" role="dialog" aria-modal="true" aria-labelledby="bk-title" ref={dialog}>
      <button type="button" className="icon-button modal-close" aria-label="Close" onClick={close}><X size={20} /></button>
      {fontCss && <style>{fontCss}</style>}
      <h2 id="bk-title">{title}</h2>

      <form className="bk-import" onSubmit={event => { event.preventDefault(); void importSite(); }}>
        <label htmlFor="bk-website"><Globe size={14} /> Start from a website</label>
        <div className="bk-row">
          <input id="bk-website" type="text" inputMode="url" placeholder="www.example.com" value={website} maxLength={500} onChange={event => setWebsite(event.target.value)} />
          <button type="submit" className="button" disabled={!website.trim() || Boolean(busy)}>{busy === "import" ? <><Loader2 size={15} className="bk-spin" /> Reading…</> : "Import"}</button>
        </div>
        <p className="bk-muted">We read the site&apos;s colours, fonts and logo. Nothing is saved until you press Save.</p>
        {notes.length > 0 && <ul className="bk-notes">{notes.map(note => <li key={note}>{note}</li>)}</ul>}
      </form>

      {colors && preview && <div className="bk-preview" style={{ background: colors.background, color: colors.text }} aria-label="Preview">
        <div className="bk-preview-bar"><Logo kit={{ ...kit, name: kit.name }} size={30} /><span style={{ fontFamily: heading ? `"bk-${heading.id}", serif` : undefined }}>{kit.name || "Your brand"}</span></div>
        <p className="bk-preview-title" style={{ fontFamily: heading ? `"bk-${heading.id}", serif` : undefined }}>{kit.tagline || "A headline in your brand"}</p>
        <p className="bk-preview-body" style={{ fontFamily: body ? `"bk-${body.id}", sans-serif` : undefined }}>Body text looks like this, in your text colour on your background.</p>
        <span className="bk-preview-button" style={{ background: colors.primary, color: contrast(colors.primary, "#ffffff") >= 4.5 ? "#fff" : "#16181d" }}>Book a table</span>
        {colors.accent && <span className="bk-preview-accent" style={{ background: colors.accent }} />}
      </div>}

      <div className="bk-fields">
        <label className="bk-field"><span>Brand name</span><input value={kit.name} maxLength={80} onChange={event => setKit({ ...kit, name: event.target.value })} placeholder="Saffron Table" /></label>
        <label className="bk-field"><span>Tagline <em>optional</em></span><input value={kit.tagline ?? ""} maxLength={140} onChange={event => setKit({ ...kit, tagline: event.target.value })} placeholder="Supper for the street" /></label>

        <div className="bk-field">
          <span>Logo</span>
          <div className="bk-logo-row">
            {kit.logo ? <Logo kit={kit} size={48} /> : <span className="bk-muted">No logo yet. Sites use the name as a wordmark.</span>}
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" hidden onChange={async event => {
              const file = event.target.files?.[0]; event.target.value = "";
              if (!file) return;
              setBusy("logo"); setError("");
              try { const logo = await readLogo(file); setKit(current => ({ ...current, logo })); }
              catch (cause) { setError(cause instanceof Error ? cause.message : "That logo couldn't be read."); }
              finally { setBusy(""); }
            }} />
            <button type="button" className="button" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}><ImagePlus size={15} /> {kit.logo ? "Replace" : "Upload logo"}</button>
            {kit.logo && <button type="button" className="button" onClick={() => setKit({ ...kit, logo: null })}>Remove</button>}
          </div>
        </div>

        <fieldset className="bk-colors">
          <legend>Colours</legend>
          {BRAND_COLOR_ROLES.map(role => {
            const value = kit.colors[role] ?? null, valid = typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
            return <div key={role} className="bk-color">
              <input type="color" aria-label={`${COLOR_ROLE_LABELS[role]} picker`} value={valid ? value!.toLowerCase() : "#ffffff"} data-empty={!value ? "true" : undefined} onChange={event => setColor(role, event.target.value)} />
              <label><span>{COLOR_ROLE_LABELS[role]}{role !== "primary" && <em> optional</em>}</span>
                <input value={value ?? ""} placeholder={role === "primary" ? "#1f6f5b" : "Not set"} maxLength={7} aria-invalid={Boolean(value) && !valid}
                  onChange={event => setColor(role, event.target.value.trim() ? event.target.value.trim() : role === "primary" ? "" : null)} />
              </label>
              {role !== "primary" && value && <button type="button" className="bk-clear" aria-label={`Clear ${COLOR_ROLE_LABELS[role].toLowerCase()}`} onClick={() => setColor(role, null)}><X size={13} /></button>}
            </div>;
          })}
        </fieldset>

        <div className="bk-two">
          {(["heading", "body"] as const).map(role => <label key={role} className="bk-field"><span>{role === "heading" ? "Heading font" : "Body font"}</span>
            <select value={kit.fonts?.[role] ?? ""} onChange={event => setKit({ ...kit, fonts: { heading: kit.fonts?.heading ?? null, body: kit.fonts?.body ?? null, [role]: event.target.value || null } })}>
              <option value="">Choose per project</option>
              {FONT_GROUPS.map(([category, label]) => <optgroup key={category} label={label}>
                {BRAND_FONTS.filter(font => font.category === category).map(font => <option key={font.id} value={font.id}>{font.family}</option>)}
              </optgroup>)}
            </select>
            {brandFont(kit.fonts?.[role]) && <em className="bk-muted">{brandFont(kit.fonts?.[role])!.voice}</em>}
          </label>)}
        </div>

        <fieldset className="bk-usage">
          <legend>How should designs use this kit?</legend>
          <label><input type="radio" name="bk-usage" checked={(kit.usage ?? "exact") === "exact"} onChange={() => setKit({ ...kit, usage: "exact" })} />
            <span><strong>Exactly</strong> Official brand: these colours and fonts, nothing else.</span></label>
          <label><input type="radio" name="bk-usage" checked={kit.usage === "guide"} onChange={() => setKit({ ...kit, usage: "guide" })} />
            <span><strong>As a starting point</strong> Keep the logo and main colour recognisable; the designer refines the rest. Best for dated brands.</span></label>
        </fieldset>

        <label className="bk-field"><span>Tone of voice <em>optional</em></span>
          <textarea rows={2} maxLength={400} value={kit.tone ?? ""} onChange={event => setKit({ ...kit, tone: event.target.value })} placeholder="Warm and plain-spoken. Short sentences, no jargon, a little dry humour." /></label>
        <div className="bk-two">
          <label className="bk-field"><span>Words we use <em>comma-separated</em></span><input value={use} onChange={event => setUse(event.target.value)} placeholder="seasonal, wood-fired, neighbourhood" /></label>
          <label className="bk-field"><span>Words we never use</span><input value={avoid} onChange={event => setAvoid(event.target.value)} placeholder="cheap, world-class, synergy" /></label>
        </div>
      </div>

      {warnings.length > 0 && <ul className="bk-warnings">{warnings.map(warning => <li key={warning}><AlertTriangle size={14} /> {warning}</li>)}</ul>}
      {error && <p className="bk-error" role="alert">{error}</p>}

      <footer className="bk-actions">
        {saved && (confirmDelete
          ? <span className="bk-confirm"><button type="button" className="button bk-danger" onClick={() => void remove()} disabled={Boolean(busy)}>Delete kit</button><button type="button" className="button" onClick={() => setConfirmDelete(false)}>Keep</button></span>
          : <button type="button" className="button bk-quiet" onClick={() => setConfirmDelete(true)} disabled={Boolean(busy)}><Trash2 size={15} /> Delete</button>)}
        <span className="bk-spacer" />
        <button type="button" className="button" onClick={close} disabled={Boolean(busy)}>Cancel</button>
        <button type="button" className="button primary" onClick={() => void save()} disabled={Boolean(busy)}>{busy === "save" ? <><Loader2 size={15} className="bk-spin" /> Saving…</> : "Save brand kit"}</button>
      </footer>
    </div>
  </div>;
}

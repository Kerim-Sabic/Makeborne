"use client";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, Clock, LoaderCircle, Plus, Send, Trash2, Undo2 } from "lucide-react";
import { canonical, checkCollection, describeChange, newItemId, parseManifest, serialiseContent, type Collection, type Manifest } from "@/lib/portal/content-model";
import type { PortalChange, PortalSite } from "@/lib/portal/contracts";
import PortalShell from "./portal-shell";
import { FieldInput, type Images, type Uploader } from "./portal-fields";
import { PortalError, portalAccount, portalRequest, portalUpload } from "./portal-api";

type Values = Record<string, unknown>;
const SAVE_DELAY_MS = 1500;

/** Edit one site's content collections; changes autosave as a draft and are sent to the agency for review. */
export default function PortalSiteEditor({ artifactId }: { artifactId: string }) {
  const [site, setSite] = useState<PortalSite | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState("");
  const path = `/api/portal/sites/${artifactId}`;

  const load = useCallback(() => portalRequest<PortalSite>(path).then(setSite, cause => {
    if (cause instanceof PortalError && cause.status === 401) { window.location.replace(`/portal/login?next=${encodeURIComponent(`/portal/sites/${artifactId}`)}`); return; }
    setError(cause instanceof Error ? cause.message : "This website couldn't load.");
  }), [artifactId, path]);
  useEffect(() => { void load(); void portalRequest<{ email: string }>("/api/portal").then(home => setEmail(home.email), () => undefined); void portalAccount(); }, [load]);

  if (error) return <PortalShell back={{ href: "/portal", label: "Your websites" }}><div className="portal-card"><p className="portal-error" role="alert">{error}</p></div></PortalShell>;
  if (!site) return <PortalShell><p className="portal-muted" aria-busy="true"><LoaderCircle size={16} className="portal-spin" /> Opening your website…</p></PortalShell>;
  return <PortalShell brand={site.agency} email={email} back={{ href: "/portal", label: "Your websites" }}>
    <Editor key={`${site.baseVersion}:${site.change?.id ?? "none"}:${site.change?.status ?? ""}`} site={site} path={path} reload={load} />
  </PortalShell>;
}

function Editor({ site, path, reload }: { site: PortalSite; path: string; reload: () => Promise<void> }) {
  const parsed = useMemo(() => parseManifest(site.manifest), [site.manifest]);
  const manifest: Manifest | null = parsed.ok ? parsed.manifest : null;
  // Photos the client uploads join the picker immediately (they reach the website only on approval).
  const [images, setImages] = useState<Images>(site.images);
  const upload: Uploader = async file => {
    const image = await portalUpload(site.site.artifactId, file);
    setImages(list => list.some(item => item.path === image.path) ? list : [...list, image]);
    return image;
  };
  const assets = useMemo(() => new Set(images.map(image => image.path)), [images]);
  // Tabs follow the order the site declares its collections in.
  const editable = useMemo(() => {
    if (!manifest) return [];
    const order = Object.keys(manifest.collections);
    return site.collections.filter(entry => manifest.collections[entry.key]).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }, [manifest, site.collections]);
  const original = useMemo(() => Object.fromEntries(editable.map(entry => [entry.key, safeParse(entry.text)])) as Values, [editable]);
  const open = site.change && (site.change.status === "draft" || site.change.status === "pending") ? site.change : null;
  // A withdrawn change keeps its edits as the starting point, so the client can carry on where they left off.
  const resume = open ?? (site.change?.status === "withdrawn" ? site.change : null);
  const [values, setValues] = useState<Values>(() => Object.fromEntries(editable.map(entry => [entry.key, resume?.files[entry.path] !== undefined ? safeParse(resume.files[entry.path]) : original[entry.key]])));
  const [tab, setTab] = useState(editable[0]?.key ?? "");
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; text?: string }>({ state: open ? "saved" : "idle" });
  const [changeId, setChangeId] = useState(open?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const pending = open?.status === "pending";
  const agency = site.agency.name;

  const checks = useMemo(() => Object.fromEntries(editable.map(entry => [entry.key, checkCollection(manifest!.collections[entry.key], serialiseContent(values[entry.key]), { assets, routes: site.routes })])), [editable, manifest, values, assets, site.routes]);
  // Compare normalised values, independent of key order, so a resumed draft only counts real edits.
  const normal = (key: string, value: unknown) => { const result = checkCollection(manifest!.collections[key], serialiseContent(value), { assets, routes: site.routes }); return canonical(result.ok ? result.value : value); };
  const changed = editable.filter(entry => normal(entry.key, values[entry.key]) !== normal(entry.key, original[entry.key]));
  const summary = changed.map(entry => describeChange(manifest!.collections[entry.key], original[entry.key], values[entry.key])).filter(Boolean) as string[];

  const persist = useCallback(async () => {
    const files: Record<string, string> = {};
    for (const entry of changed) { const result = checks[entry.key]; if (!result.ok) { setSave({ state: "error", text: `${manifest!.collections[entry.key].label}: ${result.message}` }); return null; } files[entry.path] = result.text; }
    if (!Object.keys(files).length) { setSave({ state: "idle" }); return changeId; }
    setSave({ state: "saving" });
    try {
      const result = await portalRequest<{ change: PortalChange }>(`${path}/draft`, { method: "PUT", body: { baseVersion: site.baseVersion, files, summary: summary.join("; ") }, key: crypto.randomUUID() });
      setChangeId(result.change.id); setSave({ state: "saved" });
      return result.change.id;
    } catch (cause) { setSave({ state: "error", text: cause instanceof Error ? cause.message : "Your changes couldn't be saved." }); return null; }
  }, [changed, checks, changeId, manifest, path, site.baseVersion, summary]);

  // Autosave a draft shortly after the last edit.
  const saveAfterPause = useEffectEvent(() => { void persist(); });
  const edited = useRef(false);
  useEffect(() => {
    if (!edited.current || pending) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(saveAfterPause, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer.current);
  }, [values, pending]);

  const setValue = (key: string, value: unknown) => { edited.current = true; setValues(current => ({ ...current, [key]: value })); };

  async function act(action: "submit" | "withdraw") {
    setBusy(true); setNotice("");
    try {
      window.clearTimeout(timer.current);
      const id = action === "submit" ? await persist() : changeId;
      if (!id) { setBusy(false); return; }
      await portalRequest(`${path}/changes`, { method: "POST", body: { action, changeId: id }, key: crypto.randomUUID() });
      await reload();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "That didn't work. Try again."); setBusy(false); }
  }

  if (!manifest || !editable.length) return <div className="portal-card"><h1>{site.site.title}</h1><p>{agency} hasn&apos;t set up editable content on this website yet. Ask them to turn it on.</p></div>;
  const current = editable.find(entry => entry.key === tab) ?? editable[0];
  const collection = manifest.collections[current.key];
  const last = site.change && !resume ? site.change : null;

  return <div className="pe">
    <div className="pe-head">
      <div>
        <h1>{site.site.title}</h1>
        {site.site.liveUrl && <a className="portal-muted" href={site.site.liveUrl} target="_blank" rel="noreferrer noopener">View the live website <ArrowUpRight size={13} /></a>}
      </div>
      <SaveState save={save} pending={pending} />
    </div>

    {pending && <div className="pe-banner is-pending" role="status"><Clock size={16} /><div><strong>Waiting for {agency} to review your changes.</strong> {open?.summary && <span>{open.summary}.</span>} They&apos;ll go live once approved.</div>
      <button type="button" className="portal-link" disabled={busy} onClick={() => void act("withdraw")}><Undo2 size={14} /> Withdraw to keep editing</button></div>}
    {last?.status === "approved" && <div className="pe-banner is-approved" role="status"><Check size={16} /><div><strong>{agency} approved your last changes.</strong> {last.decisionNote}</div></div>}
    {last?.status === "rejected" && <div className="pe-banner is-rejected" role="status"><div><strong>{agency} didn&apos;t approve your last changes.</strong> {last.decisionNote || "They may contact you about it."}</div></div>}

    <nav className="pe-tabs" aria-label="Content to edit">{editable.map(entry => {
      const check = checks[entry.key], dirty = changed.includes(entry);
      return <button key={entry.key} type="button" aria-pressed={entry.key === current.key} onClick={() => setTab(entry.key)}>
        {manifest.collections[entry.key].label}{!check.ok ? <span className="pe-dot is-error" title="Needs a fix" /> : dirty ? <span className="pe-dot" title="Changed" /> : null}
      </button>;
    })}</nav>

    <section className="portal-card pe-panel" aria-label={collection.label}>
      {collection.help && <p className="portal-muted">{collection.help}</p>}
      <fieldset disabled={pending || busy}>
        {collection.kind === "single"
          ? <ItemForm prefix={current.key} collection={collection} value={(values[current.key] as Values | null) ?? {}} images={images} onUpload={upload} manifest={manifest} onChange={value => setValue(current.key, value)} />
          : <ListEditor prefix={current.key} collection={collection} value={(values[current.key] as { items: Values[] } | null) ?? { items: [] }} images={images} onUpload={upload} manifest={manifest} onChange={value => setValue(current.key, value)} />}
      </fieldset>
      {!checks[current.key].ok && <p className="portal-error" role="alert">{(checks[current.key] as { message: string }).message}</p>}
    </section>

    {!pending && <div className="pe-actions">
      <p className="portal-muted">{changed.length ? summary.join(" · ") : "No changes yet."}</p>
      {changed.length > 0 && <button type="button" className="portal-link" disabled={busy} onClick={() => { edited.current = true; setValues(original); }}><Undo2 size={14} /> Discard changes</button>}
      <button type="button" className="portal-button" disabled={busy || !changed.length || editable.some(entry => !checks[entry.key].ok)} onClick={() => void act("submit")}>
        {busy ? <LoaderCircle size={16} className="portal-spin" /> : <Send size={16} />} Send changes to {agency}</button>
    </div>}
    {notice && <p className="portal-error" role="alert">{notice}</p>}
  </div>;
}

function SaveState({ save, pending }: { save: { state: string; text?: string }; pending: boolean }) {
  if (pending) return null;
  if (save.state === "saving") return <span className="pe-save" role="status"><LoaderCircle size={14} className="portal-spin" /> Saving draft…</span>;
  if (save.state === "saved") return <span className="pe-save" role="status"><Check size={14} /> Draft saved</span>;
  if (save.state === "error") return <span className="pe-save is-error" role="alert">{save.text}</span>;
  return null;
}

const safeParse = (text: string) => { try { return JSON.parse(text); } catch { return null; } };

function ItemForm({ prefix, collection, value, images, onUpload, manifest, onChange }: { prefix: string; collection: Collection; value: Values; images: Images; onUpload: Uploader; manifest: Manifest; onChange: (value: Values) => void }) {
  return <div className="pe-form">{Object.entries(collection.fields).map(([name, field]) =>
    <FieldInput key={name} id={`${prefix}-${name}`} name={name} field={field} value={value[name] ?? null} images={images} onUpload={onUpload} currency={manifest.currency} locale={manifest.locale}
      onChange={next => onChange({ ...value, [name]: next })} />)}</div>;
}

function ListEditor({ prefix, collection, value, images, onUpload, manifest, onChange }: { prefix: string; collection: Collection; value: { items: Values[] }; images: Images; onUpload: Uploader; manifest: Manifest; onChange: (value: { items: Values[] }) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const items = value.items ?? [], max = collection.maxItems ?? 200, noun = collection.itemLabel ?? "item";
  const titleOf = (item: Values) => {
    const key = collection.titleField ?? Object.keys(collection.fields).find(name => collection.fields[name].type === "text");
    const text = key ? item[key] : null;
    return typeof text === "string" && text.trim() ? text : `Untitled ${noun.toLowerCase()}`;
  };
  const set = (items: Values[]) => onChange({ ...value, items });
  const add = () => {
    const item: Values = { id: newItemId() };
    for (const [name, field] of Object.entries(collection.fields)) item[name] = field.type === "boolean" ? field.default ?? true : null;
    set([...items, item]); setOpenId(item.id as string);
  };
  return <div className="pe-list">
    {!items.length && <p className="portal-muted">Nothing here yet.</p>}
    <ol>{items.map((item, index) => {
      const id = item.id as string, expanded = openId === id;
      return <li key={id} className={expanded ? "is-open" : ""}>
        <div className="pe-item-head">
          <button type="button" className="pe-item-title" aria-expanded={expanded} onClick={() => setOpenId(expanded ? null : id)}><ChevronDown size={15} /> {titleOf(item)}{item.available === false && <span className="portal-chip">Hidden</span>}</button>
          <span className="pe-item-tools">
            <button type="button" className="pf-icon" aria-label="Move up" disabled={index === 0} onClick={() => set(items.map((entry, at) => at === index - 1 ? item : at === index ? items[index - 1] : entry))}><ArrowUp size={14} /></button>
            <button type="button" className="pf-icon" aria-label="Move down" disabled={index === items.length - 1} onClick={() => set(items.map((entry, at) => at === index + 1 ? item : at === index ? items[index + 1] : entry))}><ArrowDown size={14} /></button>
            {confirm === id
              ? <><button type="button" className="pe-danger" onClick={() => { set(items.filter(entry => entry.id !== id)); setConfirm(null); }}>Remove</button><button type="button" className="portal-link" onClick={() => setConfirm(null)}>Keep</button></>
              : <button type="button" className="pf-icon" aria-label={`Remove ${titleOf(item)}`} onClick={() => setConfirm(id)}><Trash2 size={14} /></button>}
          </span>
        </div>
        {expanded && <ItemForm prefix={`${prefix}-${id}`} collection={collection} value={item} images={images} onUpload={onUpload} manifest={manifest} onChange={next => set(items.map(entry => entry.id === id ? { ...next, id } : entry))} />}
      </li>;
    })}</ol>
    <button type="button" className="portal-link" disabled={items.length >= max} onClick={add}><Plus size={15} /> Add {noun.toLowerCase()}</button>
    {items.length >= max && <span className="portal-muted"> (up to {max})</span>}
  </div>;
}

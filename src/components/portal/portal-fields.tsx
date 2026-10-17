"use client";
import { useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { emptyHours, type Field, type Hours, type RichText } from "@/lib/portal/content-model";

export type Images = { path: string; previewUrl: string; removable?: boolean }[];
/** The client's own photos: upload a new one, or delete one that isn't on the website. */
export type PhotoActions = { upload: (file: File) => Promise<Images[number]>; remove: (image: Images[number]) => Promise<void> };
const DAYS: [keyof Omit<Hours, "exceptions">, string][] = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];

const words = (key: string) => key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, letter => letter.toUpperCase());
export const fieldLabel = (key: string, field: Field) => field.label ?? words(key);

/** One form control for a content field. Values follow the content model (null = empty). */
export function FieldInput({ id, name, field, value, onChange, images, photos, currency, locale }: {
  id: string; name: string; field: Field; value: unknown; onChange: (value: unknown) => void; images: Images; photos?: PhotoActions; currency?: string; locale?: string;
}) {
  const label = fieldLabel(name, field), text = typeof value === "string" ? value : "";
  const head = <label htmlFor={id}>{label}{field.required ? "" : <em> optional</em>}</label>;
  const help = field.help ? <p className="portal-help">{field.help}</p> : null;
  switch (field.type) {
    case "text": return <div className="pf-field">{head}{field.multiline
      ? <textarea id={id} rows={Math.min(8, Math.max(3, Math.ceil(text.length / 60)))} maxLength={field.max ?? 2000} value={text} onChange={event => onChange(event.target.value)} />
      : <input id={id} maxLength={field.max ?? 200} value={text} onChange={event => onChange(event.target.value)} />}{help}</div>;
    case "price": {
      const symbol = (() => { try { return new Intl.NumberFormat(locale ?? "en-GB", { style: "currency", currency: currency ?? "GBP" }).formatToParts(0).find(part => part.type === "currency")?.value ?? ""; } catch { return ""; } })();
      return <div className="pf-field">{head}<div className="pf-prefix"><span aria-hidden="true">{symbol}</span>
        <input id={id} inputMode="decimal" value={text} placeholder="12.50" onChange={event => onChange(event.target.value.replace(",", ".").replace(/[^\d.]/g, "") || null)}
          onBlur={() => { if (/^\d+(\.\d)?$/.test(text)) onChange(Number(text).toFixed(2)); }} /></div>{help}</div>;
    }
    case "number": return <div className="pf-field">{head}<input id={id} type="number" value={typeof value === "number" ? value : ""} min={field.min} max={field.max} onChange={event => onChange(event.target.value === "" ? null : Number(event.target.value))} />{help}</div>;
    case "date": return <div className="pf-field">{head}<input id={id} type="date" value={text} onChange={event => onChange(event.target.value || null)} />{help}</div>;
    case "time": return <div className="pf-field">{head}<input id={id} type="time" value={text} onChange={event => onChange(event.target.value || null)} />{help}</div>;
    case "boolean": return <div className="pf-field pf-toggle"><label htmlFor={id}><input id={id} type="checkbox" checked={value === undefined || value === null ? field.default ?? false : Boolean(value)} onChange={event => onChange(event.target.checked)} /> {label}</label>{help}</div>;
    case "select": return <div className="pf-field">{head}<select id={id} value={text} onChange={event => onChange(event.target.value || null)}>
      {!field.required && <option value="">None</option>}
      {field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>{help}</div>;
    case "url": return <div className="pf-field">{head}<input id={id} type="url" inputMode="url" value={text} placeholder="https://…" onChange={event => onChange(event.target.value || null)} />{help}</div>;
    case "email": return <div className="pf-field">{head}<input id={id} type="email" value={text} onChange={event => onChange(event.target.value || null)} />{help}</div>;
    case "phone": return <div className="pf-field">{head}<input id={id} type="tel" value={text} onChange={event => onChange(event.target.value || null)} />{help}</div>;
    case "hours": return <div className="pf-field">{<span className="pf-label">{label}</span>}<HoursEditor id={id} value={(value as Hours | null) ?? emptyHours()} onChange={onChange} />{help}</div>;
    case "richtext": return <div className="pf-field"><span className="pf-label">{label}</span><RichTextEditor id={id} value={(value as RichText | null) ?? []} onChange={onChange} />{help}</div>;
    case "image": return <div className="pf-field"><span className="pf-label">{label}</span><ImagePicker id={id} value={value as { src: string; alt: string } | null} images={images} onChange={onChange} photos={photos} />{help}</div>;
  }
}

function HoursEditor({ id, value, onChange }: { id: string; value: Hours; onChange: (value: Hours) => void }) {
  return <div className="pf-hours" role="group" aria-label="Opening hours">
    {DAYS.map(([day, name]) => {
      const spans = value[day] ?? [], open = spans.length > 0, first = spans[0] ?? { open: "09:00", close: "17:00" };
      const set = (next: Hours[typeof day]) => onChange({ ...value, [day]: next });
      return <div key={day} className="pf-day">
        <label className="pf-day-name"><input type="checkbox" checked={open} onChange={event => set(event.target.checked ? [first] : [])} aria-label={`Open on ${name}`} /> {name}</label>
        {open ? <span className="pf-span">
          <input id={`${id}-${day}-open`} type="time" aria-label={`${name} opens`} value={first.open} onChange={event => set([{ ...first, open: event.target.value }, ...spans.slice(1)])} />
          <span aria-hidden="true">–</span>
          <input type="time" aria-label={`${name} closes`} value={first.close} onChange={event => set([{ ...first, close: event.target.value }, ...spans.slice(1)])} />
          {spans.length > 1 && <span className="portal-muted">+{spans.length - 1} more</span>}
        </span> : <span className="portal-muted">Closed</span>}
      </div>;
    })}
  </div>;
}

function RichTextEditor({ id, value, onChange }: { id: string; value: RichText; onChange: (value: RichText) => void }) {
  const update = (index: number, block: RichText[number]) => onChange(value.map((item, at) => at === index ? block : item));
  return <div className="pf-rich" id={id}>
    {value.map((block, index) => <div key={index} className="pf-block">
      <select aria-label="Block type" value={block.type} onChange={event => {
        const type = event.target.value as RichText[number]["type"], text = block.type === "list" ? block.items.join("\n") : block.text;
        update(index, type === "list" ? { type, items: text.split("\n").filter(Boolean) } : { type, text });
      }}>
        <option value="paragraph">Paragraph</option><option value="heading">Heading</option><option value="quote">Quote</option><option value="list">Bullet list</option>
      </select>
      <textarea aria-label={block.type === "list" ? "List items, one per line" : "Text"} rows={block.type === "heading" ? 1 : 3} value={block.type === "list" ? block.items.join("\n") : block.text}
        onChange={event => update(index, block.type === "list" ? { type: "list", items: event.target.value.split("\n") } : { ...block, text: event.target.value })} />
      <button type="button" className="pf-icon" aria-label="Remove block" onClick={() => onChange(value.filter((_, at) => at !== index))}><X size={14} /></button>
    </div>)}
    <button type="button" className="portal-link" onClick={() => onChange([...value, { type: "paragraph", text: "" }])}><Plus size={14} /> Add paragraph</button>
  </div>;
}

function ImagePicker({ id, value, images, onChange, photos }: { id: string; value: { src: string; alt: string } | null; images: Images; onChange: (value: { src: string; alt: string } | null) => void; photos?: PhotoActions }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  async function upload(file: File) {
    if (!photos) return;
    setBusy(true); setError("");
    try { const image = await photos.upload(file); onChange({ src: image.path, alt: value?.alt ?? "" }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The photo couldn't be uploaded."); }
    finally { setBusy(false); }
  }
  async function remove(image: Images[number]) {
    if (!photos) return;
    setBusy(true); setError("");
    try { await photos.remove(image); setConfirming(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The photo couldn't be deleted."); setConfirming(null); }
    finally { setBusy(false); }
  }
  return <div className="pf-images" id={id}>
    {images.length > 0 ? <div role="radiogroup" aria-label="Choose a photo">
      {images.map(image => <div key={image.path} className="pf-photo">
        <button type="button" role="radio" aria-checked={value?.src === image.path} title={image.path.split("/").pop()}
          onClick={() => onChange({ src: image.path, alt: value?.alt ?? "" })}>
          {/* eslint-disable-next-line @next/next/no-img-element -- portal-served thumbnail */}
          <img src={image.previewUrl} alt="" loading="lazy" />
        </button>
        {/* Only the client's own photos that aren't on the website, and not the one chosen here. */}
        {photos && image.removable && value?.src !== image.path && (confirming === image.path
          ? <div className="pf-photo-confirm" role="group" aria-label="Delete this photo?">
            <button type="button" className="pf-photo-yes" disabled={busy} onClick={() => void remove(image)}>{busy ? <LoaderCircle size={13} className="portal-spin" /> : <Trash2 size={13} />} Delete</button>
            <button type="button" className="pf-photo-no" disabled={busy} onClick={() => setConfirming(null)}>Keep</button>
          </div>
          : <button type="button" className="pf-photo-delete" aria-label="Delete this photo" title="Delete this photo" onClick={() => setConfirming(image.path)}><X size={13} /></button>)}
      </div>)}
    </div> : <p className="portal-muted">No photos yet{photos ? ". Upload one below." : ". Ask your agency to add some."}</p>}
    {photos && <div className="pf-upload">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif" hidden
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
      <button type="button" className="portal-link" disabled={busy} onClick={() => input.current?.click()}>{busy ? <LoaderCircle size={14} className="portal-spin" /> : <ImagePlus size={14} />} {busy ? "Uploading…" : "Upload a photo"}</button>
      <span className="portal-muted">JPG, PNG or iPhone photos up to 8 MB. Your agency sees it when you send your changes.</span>
    </div>}
    {error && <p className="portal-error" role="alert">{error}</p>}
    {value && <div className="pf-image-meta">
      <input aria-label="Describe the photo for people who can't see it" placeholder="Describe the photo (for screen readers and Google)" maxLength={300} value={value.alt} onChange={event => onChange({ ...value, alt: event.target.value })} />
      <button type="button" className="portal-link" onClick={() => onChange(null)}><Trash2 size={14} /> No photo</button>
    </div>}
  </div>;
}

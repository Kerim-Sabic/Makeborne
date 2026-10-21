"use client";
import { useEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, ChevronsUp, MessageSquarePlus, MousePointerClick, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import type { ElementDescription, ElementLoc, StyleField, VisualEdit } from "@/lib/builder/visual-edit";
import "@/app/visual-editor.css";

/** What the preview reported about the clicked element. */
export type PickedElement = {
  loc: ElementLoc; index: number; count: number; tag: string; text: string; hasParent: boolean;
  style: Partial<Record<StyleField, string>>;
};
export type ProjectImage = { path: string; url?: string };

const WEIGHTS = [["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["800", "Extra bold"]] as const;

/** rgb()/rgba() from getComputedStyle → #rrggbb for colour inputs. */
function toHex(value: string | undefined): { hex: string; clear: boolean } {
  if (!value) return { hex: "#000000", clear: true };
  if (/^#[0-9a-f]{6}$/i.test(value)) return { hex: value.toLowerCase(), clear: false };
  if (/^#[0-9a-f]{3}$/i.test(value)) return { hex: `#${[...value.slice(1)].map(c => c + c).join("")}`.toLowerCase(), clear: false };
  const match = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:\s*[,/]\s*([\d.]+%?))?/i.exec(value);
  if (!match) return { hex: "#000000", clear: true };
  const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
  return { hex: `#${match.slice(1, 4).map(part => Math.min(255, Number(part)).toString(16).padStart(2, "0")).join("")}`, clear: alpha === 0 };
}
const px = (value: string | undefined) => { const number = parseFloat(value ?? ""); return Number.isFinite(number) ? String(Math.round(number * 10) / 10) : ""; };

export type Swatch = { label: string; value: string };
/** The picked element an "Ask the builder" request refers to, so the request can be bound to it. */
export type AskTarget = { path: string; line: number; label: string };

export default function VisualEditorPanel({ picked, description, images, swatches = [], note, canUndo, onEdit, onParent, onClose, onUndo, onAsk }: {
  picked: PickedElement | null; description: ElementDescription | null; images: ProjectImage[]; swatches?: Swatch[]; note: string; canUndo: boolean;
  onEdit: (edit: VisualEdit) => void; onParent: () => void; onClose: () => void; onUndo: () => void; onAsk?: (text: string, target?: AskTarget) => void;
}) {
  return <aside className="ve" aria-label="Edit selected element">
    <header className="ve-top">
      <span className="ve-title"><MousePointerClick size={14} />Click to edit</span>
      {canUndo && <button type="button" className="ve-icon" onClick={onUndo} aria-label="Undo last edit" title="Undo last edit"><Undo2 size={15} /></button>}
      <button type="button" className="ve-icon" onClick={onClose} aria-label="Stop editing" title="Stop editing"><X size={15} /></button>
    </header>
    {note && <p className="ve-note" role="alert">{note}</p>}
    {!picked || !description
      ? <div className="ve-empty"><p>Click any text, image, link or section in the preview to change it.</p><p className="ve-muted">Edits save automatically as a new version and don&apos;t use credits.</p></div>
      : <Inspector key={`${picked.loc.path}@${picked.loc.offset}:${picked.index}:${"value" in description.text ? description.text.value : "parts" in description.text ? description.text.parts.join("|") : ""}`}
        picked={picked} description={description} images={images} swatches={swatches} onEdit={onEdit} onParent={onParent} onAsk={onAsk} />}
  </aside>;
}

function Inspector({ picked, description, images, swatches, onEdit, onParent, onAsk }: {
  picked: PickedElement; description: ElementDescription; images: ProjectImage[]; swatches: Swatch[];
  onEdit: (edit: VisualEdit) => void; onParent: () => void; onAsk?: (text: string, target?: AskTarget) => void;
}) {
  const loc = picked.loc;
  const text = "value" in description.text ? description.text : null;
  const [draft, setDraft] = useState(text?.value ?? "");
  const [href, setHref] = useState(description.href && "value" in description.href ? description.href.value ?? "" : "");
  const [alt, setAlt] = useState(description.alt && "value" in description.alt ? description.alt.value ?? "" : "");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const snippet = picked.text.length > 60 ? `${picked.text.slice(0, 60)}…` : picked.text;
  const style = (field: StyleField, value: string) => onEdit({ kind: "style", loc, style: { [field]: value } });

  return <div className="ve-body">
    <section className="ve-element">
      <div className="ve-element-row"><code className="ve-tag">&lt;{description.tag}&gt;</code>{snippet && <span className="ve-snippet">{snippet}</span>}</div>
      <p className="ve-muted">{loc.path} · line {description.line}</p>
      {picked.count > 1 && <p className="ve-shared">This element repeats {picked.count} times on the page. Changes apply to every copy.</p>}
      {picked.hasParent && <button type="button" className="ve-link" onClick={onParent}><ChevronsUp size={13} />Select the surrounding element</button>}
    </section>

    <section className="ve-section" aria-label="Text">
      <h4>Text</h4>
      {text ? <form onSubmit={event => { event.preventDefault(); onEdit({ kind: "text", loc, value: draft, rendered: picked.text }); }}>
        <textarea id="ve-text" aria-label="Element text" rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 34)))} value={draft} maxLength={2000}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        {text.shared && <p className="ve-muted">Stored in {text.path}, line {text.line}.</p>}
        <button type="submit" className="ve-apply" disabled={!draft.trim() || draft === text.value}>Apply text</button>
      </form> : "parts" in description.text ? description.text.parts.map((part, index, parts) =>
        <TextPart key={`${index}:${part}`} index={index} total={parts.length} value={part} onApply={value => onEdit({ kind: "text", loc, value, part: index })} />)
      : <p className="ve-muted">{"reason" in description.text ? description.text.reason : ""}</p>}
      {"parts" in description.text && <p className="ve-muted">Styled words, like the ones in italics, are separate. Click them in the preview to edit them.</p>}
    </section>

    {description.href && <section className="ve-section" aria-label="Link">
      <h4>Link</h4>
      {description.href.editable ? <form className="ve-inline" onSubmit={event => { event.preventDefault(); onEdit({ kind: "attribute", loc, name: "href", value: href }); }}>
        <input id="ve-href" aria-label="Link address" value={href} placeholder="/contact, #menu or https://…" maxLength={500} onChange={event => setHref(event.target.value)} />
        <button type="submit" className="ve-apply" disabled={!href.trim()}>Apply</button>
      </form> : <p className="ve-muted">{description.href.reason}</p>}
    </section>}

    {description.src && <section className="ve-section" aria-label="Image">
      <h4>Image</h4>
      {description.src.editable && images.length > 0 ? <div className="ve-images" role="group" aria-label="Project images">
        {images.map(image => {
          const current = "value" in description.src! && description.src.value === image.path;
          return <button key={image.path} type="button" aria-pressed={current} title={image.path} onClick={() => { if (!current) onEdit({ kind: "attribute", loc, name: "src", value: image.path }); }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- in-memory data: URL thumbnail of a project asset */}
            {image.url ? <img src={image.url} alt="" /> : <span>{image.path.split("/").pop()}</span>}
          </button>;
        })}
      </div> : <p className="ve-muted">{"reason" in description.src ? description.src.reason : "This project has no other images yet. Ask the builder to add some."}</p>}
      {description.alt?.editable && <form className="ve-inline" onSubmit={event => { event.preventDefault(); onEdit({ kind: "attribute", loc, name: "alt", value: alt }); }}>
        <input id="ve-alt" aria-label="Image description for screen readers" value={alt} placeholder="Describe the image" maxLength={300} onChange={event => setAlt(event.target.value)} />
        <button type="submit" className="ve-apply">Apply</button>
      </form>}
    </section>}

    <section className="ve-section" aria-label="Style">
      <h4>Style</h4>
      {description.styleReason ? <p className="ve-muted">{description.styleReason}</p> : <div className="ve-style">
        <ColorField id="ve-color" label="Text colour" inline={description.style.color} computed={picked.style.color} swatches={swatches} onChange={value => style("color", value)} />
        <ColorField id="ve-background" label="Background" inline={description.style.backgroundColor} computed={picked.style.backgroundColor} swatches={swatches} onChange={value => style("backgroundColor", value)} />
        <NumberField id="ve-size" label="Text size" unit="px" inline={description.style.fontSize} computed={picked.style.fontSize} min={8} max={200} onChange={value => style("fontSize", value)} />
        <div className="ve-field">
          <label htmlFor="ve-weight">Weight</label>
          <div className="ve-control">
            <select id="ve-weight" value={WEIGHTS.find(([value]) => value === (description.style.fontWeight ?? picked.style.fontWeight))?.[0] ?? ""} onChange={event => style("fontWeight", event.target.value)}>
              {!WEIGHTS.some(([value]) => value === (description.style.fontWeight ?? picked.style.fontWeight)) && <option value="">{picked.style.fontWeight ?? "Default"}</option>}
              {WEIGHTS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
            <Reset shown={Boolean(description.style.fontWeight)} label="weight" onReset={() => style("fontWeight", "")} />
          </div>
        </div>
        <div className="ve-field">
          <span id="ve-align-label">Alignment</span>
          <div className="ve-control">
            <div className="ve-segment" role="group" aria-labelledby="ve-align-label">
              {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([value, Icon]) =>
                <button key={value} type="button" aria-label={`Align ${value}`} aria-pressed={(description.style.textAlign ?? picked.style.textAlign) === value || (value === "left" && (description.style.textAlign ?? picked.style.textAlign) === "start")}
                  onClick={() => style("textAlign", value)}><Icon size={14} /></button>)}
            </div>
            <Reset shown={Boolean(description.style.textAlign)} label="alignment" onReset={() => style("textAlign", "")} />
          </div>
        </div>
        <TextField id="ve-padding" label="Inner spacing" hint="e.g. 24px or 16px 32px" inline={description.style.padding} computed={picked.style.padding} onChange={value => style("padding", value)} />
        <TextField id="ve-margin" label="Outer spacing" hint="e.g. 0 auto or 48px 0" inline={description.style.margin} computed={picked.style.margin} onChange={value => style("margin", value)} />
        <NumberField id="ve-radius" label="Corners" unit="px" inline={description.style.borderRadius} computed={picked.style.borderRadius} min={0} max={400} onChange={value => style("borderRadius", value)} />
      </div>}
    </section>

    <footer className="ve-actions">
      {onAsk && <button type="button" className="ve-secondary" onClick={() => onAsk(`Change the <${description.tag}>${snippet ? ` "${snippet}"` : ""} in ${loc.path} (line ${description.line}): `, { path: loc.path, line: description.line, label: `the <${description.tag}>` })}>
        <MessageSquarePlus size={14} />Ask the builder</button>}
      {description.removable && (confirmRemove
        ? <span className="ve-confirm" role="group" aria-label="Confirm removal"><button type="button" className="ve-danger" onClick={() => onEdit({ kind: "remove", loc })}>Remove{picked.count > 1 ? ` all ${picked.count}` : ""}</button><button type="button" className="ve-secondary" onClick={() => setConfirmRemove(false)}>Keep</button></span>
        : <button type="button" className="ve-secondary" onClick={() => setConfirmRemove(true)}><Trash2 size={14} />Remove</button>)}
    </footer>
  </div>;
}

function TextPart({ index, total, value, onApply }: { index: number; total: number; value: string; onApply: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const id = `ve-text-${index}`;
  return <form onSubmit={event => { event.preventDefault(); onApply(draft); }}>
    {total > 1 && <label className="ve-muted" htmlFor={id}>Part {index + 1} of {total}</label>}
    <textarea id={id} aria-label={total > 1 ? `Text part ${index + 1} of ${total}` : "Element text"} rows={Math.min(5, Math.max(2, Math.ceil(draft.length / 34)))} value={draft} maxLength={2000}
      onChange={event => setDraft(event.target.value)}
      onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
    <button type="submit" className="ve-apply" disabled={!draft.trim() || draft === value}>Apply text</button>
  </form>;
}

function Reset({ shown, label, onReset }: { shown: boolean; label: string; onReset: () => void }) {
  return shown ? <button type="button" className="ve-icon" onClick={onReset} aria-label={`Reset ${label}`} title={`Reset ${label}`}><RotateCcw size={13} /></button> : null;
}

function ColorField({ id, label, inline, computed, swatches, onChange }: { id: string; label: string; inline?: string; computed?: string; swatches: Swatch[]; onChange: (value: string) => void }) {
  const current = toHex(inline ?? computed);
  const [value, setValue] = useState(current.hex);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <div className="ve-field">
    <label htmlFor={id}>{label}</label>
    <div className="ve-control">
      <input id={id} type="color" value={value} data-empty={current.clear && !inline ? "true" : undefined} onChange={event => {
        const next = event.target.value; setValue(next);
        window.clearTimeout(timer.current); timer.current = window.setTimeout(() => onChange(next), 300);
      }} />
      <code className="ve-value">{current.clear && !inline ? "None" : value}</code>
      <Reset shown={Boolean(inline)} label={label.toLowerCase()} onReset={() => onChange("")} />
    </div>
    {swatches.length > 0 && <div className="ve-swatches" role="group" aria-label={`Brand colours for ${label.toLowerCase()}`}>
      {swatches.map(swatch => <button key={swatch.label} type="button" title={`${swatch.label} ${swatch.value}`} aria-label={`Use ${swatch.label} (${swatch.value})`}
        aria-pressed={value === swatch.value} style={{ background: swatch.value }}
        onClick={() => { window.clearTimeout(timer.current); setValue(swatch.value); onChange(swatch.value); }} />)}
    </div>}
  </div>;
}

function NumberField({ id, label, unit, inline, computed, min, max, onChange }: { id: string; label: string; unit: string; inline?: string; computed?: string; min: number; max: number; onChange: (value: string) => void }) {
  const initial = px(inline ?? computed);
  const [value, setValue] = useState(initial);
  const commit = () => { if (value !== initial && value.trim() && Number(value) >= min && Number(value) <= max) onChange(`${Number(value)}${unit}`); };
  return <div className="ve-field">
    <label htmlFor={id}>{label}</label>
    <div className="ve-control">
      <input id={id} type="number" inputMode="decimal" min={min} max={max} step={1} value={value} onChange={event => setValue(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} />
      <span className="ve-unit">{unit}</span>
      <Reset shown={Boolean(inline)} label={label.toLowerCase()} onReset={() => onChange("")} />
    </div>
  </div>;
}

function TextField({ id, label, hint, inline, computed, onChange }: { id: string; label: string; hint: string; inline?: string; computed?: string; onChange: (value: string) => void }) {
  const initial = inline ?? computed ?? "";
  const [value, setValue] = useState(initial);
  const commit = () => { if (value.trim() && value.trim() !== initial) onChange(value.trim()); };
  return <div className="ve-field">
    <label htmlFor={id}>{label}</label>
    <div className="ve-control">
      <input id={id} value={value} placeholder={hint} maxLength={60} onChange={event => setValue(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} />
      <Reset shown={Boolean(inline)} label={label.toLowerCase()} onReset={() => onChange("")} />
    </div>
  </div>;
}

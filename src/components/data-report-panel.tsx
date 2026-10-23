"use client";
import { useEffect, useMemo, useState } from "react";
import { Table2 } from "lucide-react";
import { uploadSourceReference } from "@/lib/ingest/client";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import "@/app/data-report.css";

/**
 * "Report from data": choose a stored spreadsheet → choose the task → check the
 * computed figures (with their cells, unreadable values and warnings, and the
 * column reading you can correct) → generate → open the new version. Offered
 * only when the server says data reports are on. The figures are always
 * recomputed by the server; nothing here supplies a number. No provider or
 * model names appear here.
 */
type Role = { role: string; label: string; required: boolean; multiple: boolean; kinds: string[] };
type Template = { id: string; label: string; description: string; roles: Role[] };
type Source = { assetId: string; sha256: string; name: string; bytes: number; format: string };
type Info = { available: boolean; canGenerate: boolean; currentVersion: number; templates: Template[]; sources: Source[]; writtenSummary: { plain: boolean; ai: boolean } };
type Column = { letter: string; header: string; kind: string; kindSource: string; currency?: string; unit?: string; dateFormat?: string; decimal?: string; values: number; missing: number; formulas: number; suggestions: { kind: string; message: string; value?: string }[] };
type Preview = {
  template: string; title: string; digest: string; period: { from: string; to: string } | null; sheet: string; sheets: string[]; headerRow: number; rows: number;
  columns: Column[]; roles: Record<string, string | string[]>;
  facts: { id: string; label: string; display: string; refs: string; n: number; missing?: { count: number; refs: string }; denominator?: { value: string; label: string }; method: string; rounding?: string }[];
  issues: { ref: string; column: string; reason: string }[]; issueCount: number; warnings: string[];
};
type Generated = { replayed: boolean; version: { number: number }; files: { format: string; bytes: number; url: string }[] };
type ColumnSpec = { column: string; kind?: string; dateFormat?: string; decimal?: string; currency?: string };

const KINDS = [["text", "Text"], ["number", "Number"], ["money", "Money"], ["percent", "Percentage"], ["date", "Date"]] as const;
const DATE_ORDERS = [["", "Unambiguous only"], ["DD/MM/YYYY", "Day/month/year"], ["MM/DD/YYYY", "Month/day/year"]] as const;
const DECIMALS = [["", "Unambiguous only"], [".", "Point (1,234.56)"], [",", "Comma (1.234,56)"]] as const;
const FILES: Record<string, string> = { pdf: "PDF", pptx: "PowerPoint (editable charts)", facts: "Figures and cells (JSON)" };

const availability = new Map<string, Promise<Info | null>>();
function load(path: string, accountId: string) {
  if (!availability.has(path)) availability.set(path, fetch(path, { cache: "no-store", headers: { "X-Makeborne-Account": accountId } }).then(response => response.ok ? response.json() as Promise<Info> : null).catch(() => null));
  return availability.get(path)!;
}
async function call<T>(path: string, accountId: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", cache: "no-store", headers: { "X-Makeborne-Account": accountId, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || "This request could not complete. Nothing was changed.");
  return data as T;
}

export default function DataReportAction({ accountId, workspaceId, artifactId, expectedVersion, disabled, onGenerated }: {
  accountId: string; workspaceId: string; artifactId: string; expectedVersion: number; disabled?: boolean; onGenerated: () => void;
}) {
  const base = `/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/data-reports`;
  const [info, setInfo] = useState<Info | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { let live = true; void load(base, accountId).then(value => { if (live) setInfo(value); }); return () => { live = false; }; }, [accountId, base]);
  if (!info?.available || !info.canGenerate || !info.templates.length) return null;
  return <>
    <button type="button" className="button secondary small" disabled={disabled} onClick={() => setOpen(true)} aria-expanded={open}><Table2 size={14} /> Report from data</button>
    {open && <DataReportPanel {...{ accountId, workspaceId, artifactId, expectedVersion, base }} initial={info} onClose={() => setOpen(false)} onGenerated={() => { availability.delete(base); onGenerated(); }} />}
  </>;
}

function DataReportPanel({ accountId, workspaceId, artifactId, expectedVersion, base, initial, onClose, onGenerated }: {
  accountId: string; workspaceId: string; artifactId: string; expectedVersion: number; base: string; initial: Info; onClose: () => void; onGenerated: () => void;
}) {
  const [sources, setSources] = useState<Source[]>(initial.sources);
  const [source, setSource] = useState<string>(initial.sources[0]?.assetId ?? "");
  const [template, setTemplate] = useState<string>(initial.templates[0].id);
  const [sheet, setSheet] = useState<string | undefined>(undefined);
  const [headerRow, setHeaderRow] = useState(1);
  const [specs, setSpecs] = useState<Record<string, ColumnSpec>>({});
  const [roles, setRoles] = useState<Record<string, string | string[]>>({});
  const [separate, setSeparate] = useState(false);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [result, setResult] = useState<Generated | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const chosen = sources.find(item => item.assetId === source);
  const info = initial.templates.find(item => item.id === template)!;

  const request = useMemo(() => chosen ? ({
    source: { assetId: chosen.assetId, sha256: chosen.sha256 }, template,
    dataset: { ...(sheet ? { sheet } : {}), headerRow, columns: Object.values(specs).filter(spec => spec.kind || spec.dateFormat || spec.decimal || spec.currency) },
    roles, options: { mixedCurrency: separate ? "separate" : "refuse" },
  }) : null, [chosen, template, sheet, headerRow, specs, roles, separate]);
  // Any change means the figures must be checked again before generating (and a new request key).
  const changed = () => { setPreview(null); setActionKey(null); setResult(null); };

  async function check(next = request) {
    if (!next) return;
    setBusy(true); setMessage(null);
    try {
      const data = await call<{ preview: Preview }>(base, accountId, { action: "preview", ...next });
      setPreview(data.preview); setRoles(data.preview.roles); setActionKey(crypto.randomUUID());
    } catch (error) { setPreview(null); setMessage(error instanceof Error ? error.message : "The figures could not be computed."); }
    finally { setBusy(false); }
  }
  async function generate() {
    if (!request || !preview || !actionKey) return;
    setBusy(true); setMessage(null);
    try {
      // The same key on a retry returns the version already saved instead of saving another.
      const data = await call<Generated>(base, accountId, { action: "generate", ...request, expectedVersion, actionKey, expectedFactsDigest: preview.digest, mode, narrative: "plain" });
      setResult(data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The report could not be saved. Nothing was changed."); }
    finally { setBusy(false); }
  }
  async function upload(file: File) {
    setBusy(true); setMessage(null);
    try {
      const mediaType = /\.csv$/i.test(file.name) ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const stored = await uploadSourceReference({ id: crypto.randomUUID(), name: file.name, type: mediaType, size: file.size, owner: `account:${accountId}`, blob: file, previewType: null }, mediaType,
        { workspaceId, artifactId, accountHeader: { "X-Makeborne-Account": accountId } },
        async (objectPath, blob, contentType) => { const { error } = await createBrowserSupabase().storage.from("project-assets").upload(objectPath, blob, { contentType, upsert: false, cacheControl: "0" }); return { error: error ? { message: error.message } : null }; });
      const entry = { assetId: stored.reference.assetId, sha256: stored.reference.sha256, name: file.name, bytes: stored.reference.bytes, format: mediaType === "text/csv" ? "csv" : "xlsx" };
      setSources(current => [entry, ...current.filter(item => item.assetId !== entry.assetId)]); setSource(entry.assetId); changed();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The file could not be stored."); }
    finally { setBusy(false); }
  }
  const spec = (letter: string, patch: Partial<ColumnSpec>) => { setSpecs(current => ({ ...current, [letter]: { ...current[letter], column: letter, ...patch } })); changed(); };
  const roleValue = (role: Role) => roles[role.role];

  return <section className="data-report-panel" aria-label="Report from data">
    <header><h4>Report from data</h4><button type="button" className="button secondary small" onClick={onClose} disabled={busy}>Close</button></header>
    {!result && <div className="data-report-form">
      <label>Spreadsheet<select value={source} disabled={busy} onChange={event => { setSource(event.target.value); setSheet(undefined); setSpecs({}); setRoles({}); changed(); }}>
        {!sources.length && <option value="">No spreadsheets in this project yet</option>}
        {sources.map(item => <option key={item.assetId} value={item.assetId}>{item.name}</option>)}
      </select></label>
      <label className="small-note">Add a spreadsheet (.xlsx or .csv)<input type="file" accept=".xlsx,.csv" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /></label>
      <label>Report<select value={template} disabled={busy} onChange={event => { setTemplate(event.target.value); setRoles({}); changed(); }}>
        {initial.templates.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <p className="small-note">{info.description} Every figure is computed from the file; formulas are not recalculated, and different currencies are never added together.</p>
      {preview && <div className="data-report-settings">
        {preview.sheets.length > 1 && <label>Sheet<select value={sheet ?? preview.sheet} disabled={busy} onChange={event => { setSheet(event.target.value); setSpecs({}); setRoles({}); changed(); }}>{preview.sheets.map(name => <option key={name}>{name}</option>)}</select></label>}
        <label>Heading row<input type="number" min={1} max={50} value={headerRow} disabled={busy} onChange={event => { setHeaderRow(Math.max(1, Math.min(50, Number(event.target.value) || 1))); changed(); }} /></label>
        <table className="data-report-columns"><thead><tr><th>Column</th><th>Read as</th><th>Format</th><th>Values</th></tr></thead><tbody>
          {preview.columns.map(column => <tr key={column.letter}>
            <td>{column.letter} · {column.header}{column.suggestions.map(item => <p key={item.kind} className="small-note">{item.message}</p>)}</td>
            <td><select value={specs[column.letter]?.kind ?? column.kind} disabled={busy} onChange={event => spec(column.letter, { kind: event.target.value })}>{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
            <td>{column.kind === "date" ? <select value={specs[column.letter]?.dateFormat ?? column.dateFormat ?? ""} disabled={busy} onChange={event => spec(column.letter, { dateFormat: event.target.value || undefined })}>{DATE_ORDERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              : column.kind === "text" ? null : <select value={specs[column.letter]?.decimal ?? column.decimal ?? ""} disabled={busy} onChange={event => spec(column.letter, { decimal: event.target.value || undefined })}>{DECIMALS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
              {column.kind === "money" && <span className="small-note"> {column.currency ?? "no currency"}</span>}</td>
            <td>{column.values} read{column.missing ? `, ${column.missing} missing` : ""}{column.formulas ? `, ${column.formulas} saved formula results` : ""}</td>
          </tr>)}
        </tbody></table>
        <fieldset><legend>Columns for this report</legend>
          {info.roles.map(role => <label key={role.role}>{role.label}{role.required ? "" : " (optional)"}
            {role.multiple ? <select multiple value={(roleValue(role) as string[] | undefined) ?? []} disabled={busy} onChange={event => { setRoles(current => ({ ...current, [role.role]: [...event.target.selectedOptions].map(option => option.value) })); changed(); }}>
              {preview.columns.map(column => <option key={column.letter} value={column.letter}>{column.letter} · {column.header}</option>)}</select>
              : <select value={(roleValue(role) as string | undefined) ?? ""} disabled={busy} onChange={event => { setRoles(current => { const next = { ...current }; if (event.target.value) next[role.role] = event.target.value; else delete next[role.role]; return next; }); changed(); }}>
                <option value="">{role.required ? "Choose a column" : "None"}</option>{preview.columns.map(column => <option key={column.letter} value={column.letter}>{column.letter} · {column.header}</option>)}</select>}
          </label>)}
        </fieldset>
        <label className="data-report-check"><input type="checkbox" checked={separate} disabled={busy} onChange={event => { setSeparate(event.target.checked); changed(); }} />Report each currency separately when amounts are in more than one currency</label>
      </div>}
      <button type="button" className="button small" disabled={busy || !chosen} onClick={() => void check()}>{busy && !preview ? "Computing…" : preview ? "Check the figures again" : "Check the figures"}</button>
    </div>}
    {preview && !result && <div className="data-report-preview">
      <h5>{preview.title}</h5>
      <p className="small-note">{preview.rows} rows from “{preview.sheet}”{preview.period ? `, ${preview.period.from} to ${preview.period.to}` : ""}. Check these figures; the report will use exactly these.</p>
      <div className="data-report-scroll"><table><thead><tr><th>Figure</th><th>Value</th><th>From cells</th></tr></thead><tbody>
        {preview.facts.slice(0, 120).map(fact => <tr key={fact.id}><td title={`${fact.method}${fact.rounding ? ` (${fact.rounding})` : ""}`}>{fact.label}</td><td>{fact.display}</td>
          <td>{fact.refs}{fact.missing ? ` · ${fact.missing.count} missing: ${fact.missing.refs}` : ""}{fact.denominator ? ` · base ${fact.denominator.value} ${fact.denominator.label}` : ""}</td></tr>)}
      </tbody></table></div>
      {preview.facts.length > 120 && <p className="small-note">{preview.facts.length - 120} more figures are in the saved figures file.</p>}
      {preview.issueCount > 0 && <details><summary>{preview.issueCount} value{preview.issueCount === 1 ? "" : "s"} could not be used</summary><ul>{preview.issues.slice(0, 60).map(issue => <li key={issue.ref}>{issue.ref}: {issue.reason}</li>)}</ul></details>}
      {preview.warnings.length > 0 && <ul className="data-report-warnings">{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      <fieldset><legend>Written summary</legend>
        <label className="data-report-check"><input type="radio" checked readOnly />Written from the figures above</label>
        <label className="data-report-check"><input type="radio" disabled />AI-written (not available yet)</label>
      </fieldset>
      <fieldset><legend>Where it goes</legend>
        <label className="data-report-check"><input type="radio" checked={mode === "replace"} disabled={busy} onChange={() => { setMode("replace"); setResult(null); }} />Replace the current content (earlier versions stay in history)</label>
        <label className="data-report-check"><input type="radio" checked={mode === "append"} disabled={busy} onChange={() => { setMode("append"); setResult(null); }} />Add to the end</label>
      </fieldset>
      <button type="button" className="button small" disabled={busy} onClick={() => void generate()}>{busy ? "Saving the report…" : "Generate report"}</button>
    </div>}
    {result && <div className="data-report-result" role="status">
      <p>{result.replayed ? "This report was already saved" : "Saved"} as version {result.version.number}. The figures, chart data and files are stored with it.</p>
      <ul>{result.files.map(file => <li key={file.format}><a href={file.url}>{FILES[file.format] ?? file.format}</a></li>)}</ul>
      <button type="button" className="button small" onClick={onGenerated}>Open the new version</button>
    </div>}
    {message && <p role="status" className="small-note">{message}</p>}
  </section>;
}

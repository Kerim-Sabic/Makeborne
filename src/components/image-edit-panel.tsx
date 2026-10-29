"use client";
import { useEffect, useState } from "react";
import { Wand2 } from "lucide-react";
import AccountArtwork from "./account-artwork";
import "@/app/image-edit.css";

/**
 * "Edit image": select an image -> describe the change -> see the maximum
 * credits -> generate ONE version -> compare before/after -> accept or
 * discard. Offered only when the server says editing is on. Nothing is
 * regenerated automatically; every new try is an explicit click. No provider
 * or model names appear here.
 */
type Use = { kind: string; label: string } & Record<string, unknown>;
type Candidate = { original: { assetId: string; sha256: string }; candidate: { assetId: string; width: number; height: number }; summary?: string; reviewRequired: boolean; reviewReasons: string[] };
type EditView = { state: "candidate" | "deterministic" | "failed" | "uncertain" | "stopped"; message: string; charged: number; candidate?: Candidate };

const OPERATIONS = [
  ["background_replace", "Replace the background"], ["object_remove", "Remove an object"], ["object_replace", "Replace an object"],
  ["extend", "Extend the picture"], ["relight_restyle", "Adjust lighting or style"], ["variant", "Make a related variant"], ["cutout", "Cut out the subject"],
] as const;
const SHAPES = [["1024x1024", "Square"], ["1536x1024", "Landscape"], ["1024x1536", "Portrait"]] as const;
const QUALITIES = [["low", "Draft"], ["medium", "Standard"], ["high", "Detailed"]] as const;

let availability: Promise<boolean> | null = null;
function editingAvailable(path: string) {
  availability ??= fetch(path, { cache: "no-store" }).then(response => response.ok ? response.json() : { available: false }).then(body => body?.available === true).catch(() => false);
  return availability;
}

async function call<T>(path: string, accountId: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store", headers: { "X-Makeborne-Account": accountId, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || "This request could not complete. Your original image is unchanged.");
  return data as T;
}

export default function ImageEditAction({ accountId, workspaceId, artifactId, assetId, defaultUse, expectedVersion, disabled, onAccepted }: {
  accountId: string; workspaceId: string; artifactId: string; assetId: string; defaultUse?: Record<string, unknown>; expectedVersion: number; disabled?: boolean; onAccepted: () => void;
}) {
  const base = `/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/image-edits`;
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { let live = true; void editingAvailable(base).then(value => { if (live) setAvailable(value); }); return () => { live = false; }; }, [base]);
  if (!available) return null;
  return <>
    <button type="button" className="button secondary small" disabled={disabled} onClick={() => setOpen(true)} aria-expanded={open}><Wand2 size={14} /> Edit image</button>
    {open && <ImageEditPanel {...{ accountId, workspaceId, artifactId, assetId, defaultUse, expectedVersion, base }} onClose={() => setOpen(false)} onAccepted={() => { setOpen(false); onAccepted(); }} />}
  </>;
}

function ImageEditPanel({ accountId, workspaceId, artifactId, assetId, defaultUse, expectedVersion, base, onClose, onAccepted }: {
  accountId: string; workspaceId: string; artifactId: string; assetId: string; defaultUse?: Record<string, unknown>; expectedVersion: number; base: string; onClose: () => void; onAccepted: () => void;
}) {
  const [operation, setOperation] = useState<string>("background_replace");
  const [instruction, setInstruction] = useState("");
  const [size, setSize] = useState<string>("1024x1024");
  const [quality, setQuality] = useState<string>("medium");
  const [asset, setAsset] = useState<{ id: string; sha256: string } | null>(null);
  const [uses, setUses] = useState<Use[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [estimate, setEstimate] = useState<{ credits: number; label: string } | null>(null);
  const [keys, setKeys] = useState<{ actionKey: string; stepKey: string } | null>(null);
  const [result, setResult] = useState<EditView | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const defaultKey = JSON.stringify(defaultUse ?? null);
  useEffect(() => {
    let live = true;
    const wanted = JSON.parse(defaultKey) as Record<string, unknown> | null;
    void call<{ asset: { id: string; sha256: string }; uses: Use[] }>(`${base}/uses?assetId=${assetId}`, accountId).then(data => {
      if (!live) return;
      setAsset(data.asset); setUses(data.uses);
      const preferred = data.uses.find(use => wanted && Object.entries(wanted).every(([key, value]) => use[key] === value)) ?? data.uses[0];
      if (preferred) setChosen(new Set([JSON.stringify(strip(preferred))]));
    }).catch(error => { if (live) setMessage(error instanceof Error ? error.message : "This image could not be loaded."); });
    return () => { live = false; };
  }, [accountId, assetId, base, defaultKey]);

  const background = operation === "cutout" ? "transparent" : "opaque";
  const request = (extra: Record<string, unknown>) => ({ artifactId, asset, operation, instruction: instruction.trim(), settings: { size, quality, background }, expectedRevision: expectedVersion, ...extra });
  // Any change to the request needs a fresh estimate and a fresh action.
  const changed = () => { setEstimate(null); setKeys(null); setResult(null); setReviewed(false); };

  async function showEstimate() {
    if (!asset || instruction.trim().length < 3) return;
    setBusy(true); setMessage(null);
    try {
      const data = await call<{ estimate: { credits: number; label: string } }>(`${base}/estimate`, accountId, request({ actionKey: crypto.randomUUID(), stepKey: crypto.randomUUID(), ceilingCredits: 60 }));
      setEstimate(data.estimate); setKeys({ actionKey: crypto.randomUUID(), stepKey: crypto.randomUUID() });
    } catch (error) { setMessage(error instanceof Error ? error.message : "The estimate is unavailable."); }
    finally { setBusy(false); }
  }
  async function generate() {
    if (!estimate || !keys) return;
    setBusy(true); setMessage(null);
    try {
      // The same keys on a retry replay the recorded result instead of making another edit.
      const data = await call<{ edit: EditView }>(base, accountId, request({ ...keys, ceilingCredits: estimate.credits }));
      setResult(data.edit);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The edit could not be made. Your original is unchanged."); }
    finally { setBusy(false); }
  }
  async function accept() {
    const candidate = result?.candidate;
    if (!candidate || !chosen.size) return;
    setBusy(true); setMessage(null);
    try {
      await call(`${base}/accept`, accountId, { artifactId, acceptKey: crypto.randomUUID(), originalAssetId: candidate.original.assetId, candidateAssetId: candidate.candidate.assetId,
        expectedVersion, references: [...chosen].map(item => JSON.parse(item)), reviewed });
      onAccepted();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The edited image could not be used. Nothing changed."); }
    finally { setBusy(false); }
  }
  function discard() { setResult(null); setKeys(null); setEstimate(null); setMessage("Discarded. Nothing changed; your original image is still used everywhere."); }

  const candidate = result?.candidate;
  return <section className="image-edit-panel" aria-label="Edit image">
    <header><h4>Edit image</h4><button type="button" className="button secondary small" onClick={onClose} disabled={busy}>Close</button></header>
    {!candidate && <div className="image-edit-form">
      <label>What kind of change<select value={operation} onChange={event => { setOperation(event.target.value); changed(); }} disabled={busy}>{OPERATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Describe the change<textarea rows={3} maxLength={2000} value={instruction} onChange={event => { setInstruction(event.target.value); changed(); }} disabled={busy} placeholder="For example: replace the grey wall with a sunlit garden; keep the person and the product label as they are." /></label>
      <div className="image-edit-row">
        <label>Shape<select value={size} onChange={event => { setSize(event.target.value); changed(); }} disabled={busy}>{SHAPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Detail<select value={quality} onChange={event => { setQuality(event.target.value); changed(); }} disabled={busy}>{QUALITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <p className="small-note">Masks and protected areas guide the edit; they are not a pixel-exact guarantee. For logos or labels, place the original artwork with an exact composite instead.</p>
      {!estimate ? <button type="button" className="button small" disabled={busy || !asset || instruction.trim().length < 3} onClick={() => void showEstimate()}>See credit estimate</button>
        : <div className="image-edit-estimate"><p><strong>Up to {estimate.credits} credits.</strong> {estimate.label}</p>
          <button type="button" className="button small" disabled={busy} onClick={() => void generate()}>{busy ? "Making one version…" : "Generate one version"}</button></div>}
    </div>}
    {candidate && <div className="image-edit-compare">
      <div className="image-edit-pair">
        <AccountArtwork scope={{ accountId, workspaceId, artifactId }} assetId={candidate.original.assetId} caption="Before (original, unchanged)" />
        <AccountArtwork scope={{ accountId, workspaceId, artifactId }} assetId={candidate.candidate.assetId} caption="After (edited version)" />
      </div>
      {candidate.summary && <p className="small-note">{candidate.summary}</p>}
      {candidate.reviewReasons.length > 0 && <ul className="image-edit-review">{candidate.reviewReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      <fieldset><legend>Use the edited version in</legend>
        {uses.map(use => { const key = JSON.stringify(strip(use)); return <label key={key} className="image-edit-use"><input type="checkbox" checked={chosen.has(key)} disabled={busy}
          onChange={event => setChosen(current => { const next = new Set(current); if (event.target.checked) next.add(key); else next.delete(key); return next; })} />{use.label}</label>; })}
        <p className="small-note">Places you leave unticked keep the original.</p>
      </fieldset>
      {candidate.reviewRequired && <label className="image-edit-use"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={busy} />I checked the labels, logos and text in the edited version.</label>}
      <div className="button-row">
        <button type="button" className="button small" disabled={busy || !chosen.size || (candidate.reviewRequired && !reviewed)} onClick={() => void accept()}>Accept</button>
        <button type="button" className="button secondary small" disabled={busy} onClick={discard}>Discard</button>
      </div>
      {result && <p className="small-note">Charged: {result.charged} credit{result.charged === 1 ? "" : "s"}.</p>}
    </div>}
    {result && !candidate && <p role="status" className="small-note">{result.message}</p>}
    {message && <p role="status" className="small-note">{message}</p>}
  </section>;
}

function strip(use: Use) { const { label, ...reference } = use; void label; return reference; }

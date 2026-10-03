"use client";

import { useState, type FormEvent } from "react";
import { WebsiteRecordSchema, websiteHref, type WebsiteRecord } from "@/lib/website-record";

export default function WebsiteRecordPanel({ value, save }: {
  value?: WebsiteRecord;
  save: (record: WebsiteRecord) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = WebsiteRecordSchema.safeParse({
      previewUrl: data.get("previewUrl"), liveUrl: data.get("liveUrl"),
      hosting: data.get("hosting"), notes: data.get("notes"), updatedAt: new Date().toISOString(),
    });
    if (!result.success) { setMessage(result.error.issues[0].message); return; }
    if (!save(result.data)) { setMessage("These details could not be saved. Keep this form open and check the workspace message."); return; }
    setEditing(false); setMessage("Website details saved on this device.");
  }
  return <section className="website-record" aria-labelledby="website-record-title">
    <div className="website-record-heading"><div><h3 id="website-record-title">Website delivery</h3><p>Keep the preview, live address, and hosting details with the project.</p></div>{!editing && <button className="button secondary small" onClick={() => { setEditing(true); setMessage(""); }}>Edit website details</button>}</div>
    <p className="muted">Links are recorded by you. Adding one does not publish the site or verify its availability.</p>
    {editing ? <form onSubmit={submit}>
      <div className="form-grid"><label>Preview link<input type="url" name="previewUrl" maxLength={2000} defaultValue={value?.previewUrl ?? ""} placeholder="https://preview.example.com" /></label><label>Live website link<input type="url" name="liveUrl" maxLength={2000} defaultValue={value?.liveUrl ?? ""} placeholder="https://example.com" /></label></div>
      <label>Hosting provider or account reference<input name="hosting" maxLength={200} defaultValue={value?.hosting ?? ""} placeholder="e.g. Client’s Vercel account" /></label>
      <label>Delivery notes<textarea name="notes" maxLength={5000} defaultValue={value?.notes ?? ""} placeholder="Handover details, domain renewal notes, or the next deployment step. Do not store passwords or API keys here." /></label>
      <div className="website-record-actions"><button className="button primary small" type="submit">Save website details</button><button className="button secondary small" type="button" onClick={() => { setEditing(false); setMessage(""); }}>Cancel</button></div>
    </form> : <><div className="website-record-links">{([["Preview", value?.previewUrl], ["Live website", value?.liveUrl]] as const).map(([label, url]) => <div key={label}><strong>{label}</strong>{url && websiteHref(url) ? <a href={websiteHref(url)!} target="_blank" rel="noopener noreferrer">{url}</a> : <span className="muted">Not added</span>}</div>)}</div><p><strong>Hosting:</strong> {value?.hosting || "Not recorded"}</p>{value?.notes && <p className="website-record-notes">{value.notes}</p>}{value?.updatedAt && <small className="muted">Details updated {new Date(value.updatedAt).toLocaleDateString()}</small>}</>}
    {message && <p role={editing ? "alert" : "status"}>{message}</p>}
  </section>;
}

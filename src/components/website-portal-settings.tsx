"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, KeyRound, LoaderCircle, Wand2, X } from "lucide-react";
import { MAKE_EDITABLE_REQUEST } from "@/lib/builder/content-prompt";
import { parseManifest, MANIFEST_PATH, type Collection } from "@/lib/portal/content-model";
import type { SitePortalSettings } from "@/lib/portal/contracts";
import { brandRequest } from "./brand-kit-api";
import "@/app/client-portal.css";

type Values = Record<string, unknown>;
const show = (value: unknown): string => value === null || value === undefined || value === "" ? "empty"
  : typeof value === "boolean" ? (value ? "yes" : "no")
  : typeof value === "object" && value && "src" in value ? `photo ${(value as { src: string }).src.split("/").pop()}`
  : typeof value === "object" ? "updated" : String(value).length > 80 ? `${String(value).slice(0, 80)}…` : String(value);

const DAYS: [string, string][] = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
/** "Thursday: closed → 09:00–18:30" for each day whose opening hours changed. */
function hoursChanges(before: unknown, after: unknown) {
  const spans = (value: unknown, day: string) => {
    const list = (value as Record<string, { open: string; close: string }[]> | null)?.[day] ?? [];
    return list.length ? list.map(span => `${span.open}–${span.close}`).join(", ") : "closed";
  };
  const lines = DAYS.filter(([day]) => spans(before, day) !== spans(after, day)).map(([day, name]) => `${name}: ${spans(before, day)} → ${spans(after, day)}`);
  return lines.length ? lines : ["Holiday hours updated"];
}

/** Field-level differences for one collection file, in plain words. */
function differences(collection: Collection, beforeText: string | undefined, afterText: string) {
  const parse = (text: string | undefined) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
  const before = parse(beforeText), after = parse(afterText), lines: string[] = [];
  const fieldsOf = (a: Values, b: Values) => Object.keys(collection.fields).filter(key => JSON.stringify(a?.[key] ?? null) !== JSON.stringify(b?.[key] ?? null))
    .flatMap(key => collection.fields[key].type === "hours" ? hoursChanges(a?.[key], b?.[key]) : [`${collection.fields[key].label ?? key}: ${show(a?.[key])} → ${show(b?.[key])}`]);
  if (collection.kind === "single") return fieldsOf(before ?? {}, after ?? {});
  const title = (item: Values) => String(item[collection.titleField ?? Object.keys(collection.fields)[0]] ?? "item");
  const a = new Map<string, Values>((before?.items ?? []).map((item: Values) => [item.id as string, item])), b = new Map<string, Values>((after?.items ?? []).map((item: Values) => [item.id as string, item]));
  for (const [id, item] of b) { const old = a.get(id); if (!old) lines.push(`Added “${title(item)}”`); else { const changed = fieldsOf(old, item); if (changed.length) lines.push(`“${title(item)}”: ${changed.map(line => line.replace(/^[^:]+: /, match => match.toLowerCase())).join("; ")}`); } }
  for (const [id, item] of a) if (!b.has(id)) lines.push(`Removed “${title(item)}”`);
  return lines.slice(0, 40);
}

/** In a client website's Publish tab: turn client editing on, choose what they may edit, and review their changes. */
export default function WebsitePortalSettings({ accountId, workspaceId, artifactId, files, onApproved, onAskBuilder }: {
  accountId: string; workspaceId: string; artifactId: string; files: Record<string, string>; onApproved: () => void;
  /** Puts a request in the builder chat (not sent until the agency presses send). */
  onAskBuilder?: (text: string) => void;
}) {
  const [data, setData] = useState<SitePortalSettings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<string | null>(null);
  const base = `/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/portal`;
  const manifest = useMemo(() => { const parsed = parseManifest(files[MANIFEST_PATH]); return parsed.ok ? parsed.manifest : null; }, [files]);

  const load = useCallback(async () => {
    try { setData(await brandRequest<SitePortalSettings>(accountId, base)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Client editing couldn't load."); }
  }, [accountId, base]);
  useEffect(() => {
    let active = true;
    brandRequest<SitePortalSettings>(accountId, base).then(value => { if (active) setData(value); }, cause => { if (active) setError(cause instanceof Error ? cause.message : "Client editing couldn't load."); });
    return () => { active = false; };
  }, [accountId, base]);

  async function save(enabled: boolean, collections: string[] | null) {
    setBusy("settings"); setError("");
    try { await brandRequest(accountId, base, { method: "PUT", body: JSON.stringify({ enabled, collections }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The setting couldn't be saved."); }
    finally { setBusy(""); }
  }
  async function decide(changeId: string, decision: "approve" | "reject", overwrite = false) {
    setBusy(changeId); setError("");
    try {
      await brandRequest(accountId, `${base}/changes/${changeId}`, { method: "POST", body: JSON.stringify({ decision, note: notes[changeId] ?? "", overwrite }) });
      setConflict(null); await load(); if (decision === "approve") onApproved();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "That didn't work.";
      if (/changed since|conflict/i.test(message)) setConflict(changeId);
      setError(message);
    } finally { setBusy(""); }
  }

  if (!data) return <section className="cpp" aria-busy={!error}>{error ? <p className="cpp-error" role="alert">{error}</p> : <p className="cpp-muted"><LoaderCircle size={14} className="cpp-spin" /> Loading client editing…</p>}</section>;
  if (!data.available || !data.clientId) return null;
  const declared = data.declared;
  return <section className="cpp" aria-label="Client editing">
    <div className="cpp-head"><h3><KeyRound size={17} /> Client editing</h3>
      <p className="cpp-muted">{declared.length ? "Your client can update this content in their portal. You approve every change before it's saved to the website." : "This website has no client-editable content yet. The builder can restructure it so your client can update their services, prices, hours and contact details, without changing how it looks."}</p>
      {!declared.length && onAskBuilder && <button type="button" className="button primary small cpp-make" onClick={() => onAskBuilder(MAKE_EDITABLE_REQUEST)}><Wand2 size={14} /> Make this site client-editable</button>}
      {!declared.length && onAskBuilder && <p className="cpp-muted">This puts the request in the builder chat for you to send. It&apos;s a normal build and uses credits; you can undo it from History.</p>}</div>
    {declared.length > 0 && <div className="cpp-settings">
      <label className="cpp-switch"><input type="checkbox" checked={data.enabled} disabled={busy === "settings"} onChange={event => void save(event.target.checked, data.collections)} /> <span>{data.enabled ? "Client editing is on" : "Client editing is off"}</span></label>
      {data.enabled && <fieldset className="cpp-collections"><legend>They can edit</legend>{declared.map(item => {
        const allowed = data.collections ?? declared.map(entry => entry.key), on = allowed.includes(item.key);
        return <label key={item.key}><input type="checkbox" checked={on} disabled={busy === "settings" || (on && allowed.length === 1)} onChange={event => {
          const next = event.target.checked ? [...allowed, item.key] : allowed.filter(key => key !== item.key);
          void save(true, next.length === declared.length ? null : next);
        }} /> {item.label}</label>;
      })}</fieldset>}
      <p className="cpp-muted">Invite people from the client&apos;s “Brand &amp; client access” tab in Clients.</p>
    </div>}

    {data.pending.length > 0 && <div className="cpp-review">
      <h4>Waiting for your review</h4>
      {data.pending.map(change => <article key={change.id} className="cpp-change">
        <p><strong>{change.authorName || change.authorEmail}</strong> <span className="cpp-muted">sent changes {new Date(change.submittedAt ?? change.updatedAt).toLocaleString()}</span></p>
        <ul className="cpp-diff">{Object.entries(change.files).flatMap(([path, text]) => {
          const key = path.slice("src/content/".length, -5), collection = manifest?.collections[key];
          if (!collection) return [<li key={path}>{path}</li>];
          const lines = differences(collection, files[path], text);
          return [<li key={path}><strong>{collection.label}</strong>{lines.length ? <ul>{lines.map(line => <li key={line}>{line}</li>)}</ul> : <span className="cpp-muted"> no visible change</span>}</li>];
        })}</ul>
        {(() => {
          const text = Object.values(change.files).join(" "), photos = (data.uploads ?? []).filter(photo => text.includes(photo.path));
          return photos.length > 0 && <div className="cpp-photos"><strong>New photos in this change</strong><div>{photos.map(photo =>
            // eslint-disable-next-line @next/next/no-img-element -- authenticated agency preview of a client upload
            <a key={photo.path} href={photo.previewUrl} target="_blank" rel="noreferrer"><img src={photo.previewUrl} alt="Photo uploaded by your client" loading="lazy" /></a>)}</div></div>;
        })()}
        <label className="cpp-note">Note to your client <span className="cpp-muted">(optional)</span><input value={notes[change.id] ?? ""} maxLength={2000} onChange={event => setNotes({ ...notes, [change.id]: event.target.value })} placeholder="Thanks, live from today." /></label>
        <div className="cpp-row">
          <button type="button" className="button primary small" disabled={Boolean(busy)} onClick={() => void decide(change.id, "approve")}>{busy === change.id ? <LoaderCircle size={14} className="cpp-spin" /> : <Check size={14} />} Approve and save</button>
          <button type="button" className="button secondary small" disabled={Boolean(busy)} onClick={() => void decide(change.id, "reject")}><X size={14} /> Don&apos;t approve</button>
          {conflict === change.id && <button type="button" className="button small cpp-danger" disabled={Boolean(busy)} onClick={() => void decide(change.id, "approve", true)}>Approve anyway (replace newer edits)</button>}
        </div>
        <p className="cpp-muted">Approving saves a new version of the website. Publish it as usual to put it live.</p>
      </article>)}
    </div>}
    {error && <p className="cpp-error" role="alert">{error}</p>}
  </section>;
}

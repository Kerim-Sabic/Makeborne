"use client";
import { useRef, useState } from "react";
import { CalendarDays, Save, MessageSquare, Plus } from "lucide-react";
import type { Client } from "./studio-model";
import { emptyOutreach, outreachChannels, outreachStages, saveOutreach, type ClientOutreach } from "@/lib/client-outreach";

export default function ClientOutreachPanel({ client, onSave, storageLabel = "on this device", readOnly = false }: { client: Client; onSave: (client: Client) => boolean | Promise<boolean>; storageLabel?: string; readOnly?: boolean }) {
  const [draft, setDraft] = useState<ClientOutreach>(() => client.outreach ?? emptyOutreach());
  const formRef = useRef<HTMLFormElement>(null);
  const [entry, setEntry] = useState("");
  const [entryType, setEntryType] = useState<"note" | "contact">("note");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const activity = [...(client.outreach?.activity ?? [])].reverse();
  async function save(note?: string) {
    if (saving.current || readOnly) return;
    saving.current = true; setBusy(true);
    try {
      const fields = formRef.current ? new FormData(formRef.current) : null;
      const current = fields ? { ...draft, lastContact: String(fields.get("lastContact") || "") || null, nextFollowUp: String(fields.get("nextFollowUp") || "") || null } : draft;
      const outreach = saveOutreach(client.outreach, current, { id: crypto.randomUUID(), at: new Date().toISOString(), text: note, type: note ? entryType : "update" });
      if (!await onSave({ ...client, outreach })) throw new Error("Could not save. Your edits remain here; check storage availability before retrying.");
      setDraft(outreach); setEntry(""); setFailed(false); setMessage(`Outreach saved ${storageLabel}.`);
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Check the outreach details."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <section className="crm-panel" aria-labelledby="crm-title"><div className="cw-section-heading"><div><h2 id="crm-title">Outreach</h2><p className="crm-subtitle">Track the conversation and your next move.</p></div><span className="crm-stage">{client.outreach?.stage ?? "Lead"}</span></div>
    {readOnly && <p className="crm-subtitle">Read-only access. An owner or editor can update outreach.</p>}
    <fieldset className="crm-edit-controls" disabled={busy || readOnly} aria-busy={busy}>
    <form ref={formRef} onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="crm-fields"><label>Stage<select value={draft.stage} onChange={event => setDraft({ ...draft, stage: event.target.value as ClientOutreach["stage"] })}>{outreachStages.map(stage => <option key={stage}>{stage}</option>)}</select></label><label>Channel<select value={draft.channel} onChange={event => setDraft({ ...draft, channel: event.target.value as ClientOutreach["channel"] })}>{outreachChannels.map(channel => <option key={channel}>{channel}</option>)}</select></label><label>Last contact<input type="date" name="lastContact" value={draft.lastContact ?? ""} onChange={event => setDraft({ ...draft, lastContact: event.target.value || null })} /></label><label>Next follow-up<input type="date" name="nextFollowUp" value={draft.nextFollowUp ?? ""} onChange={event => setDraft({ ...draft, nextFollowUp: event.target.value || null })} /></label></div>
      <label>Profile or contact page<input type="url" maxLength={2000} placeholder="https://…" value={draft.profileUrl} onChange={event => setDraft({ ...draft, profileUrl: event.target.value })} /></label><label>Outreach notes<textarea maxLength={5000} rows={3} placeholder="Their priorities, your offer, and what to remember." value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label><button className="cw-secondary" type="submit"><Save size={15} /> Save outreach</button>
    </form>
    <div className="crm-log"><h3><MessageSquare size={15} /> Log an update</h3><div className="crm-log-fields"><label className="cw-sr" htmlFor="crm-entry-type">Update type</label><select id="crm-entry-type" value={entryType} onChange={event => setEntryType(event.target.value as "contact" | "note")}><option value="note">Note</option><option value="contact">Contact made</option></select><label className="cw-sr" htmlFor="crm-entry">Update details</label><input id="crm-entry" maxLength={2000} value={entry} onChange={event => setEntry(event.target.value)} placeholder="What happened?" /><button type="button" className="cw-secondary" disabled={!entry.trim()} onClick={() => save(entry)}><Plus size={15} /> Add update</button></div><p className="crm-subtitle">Manual records only. No message is sent. Set last contact and follow-up dates above.</p></div>
    </fieldset>
    {busy && <p role="status">Saving outreach…</p>}
    {message && <p className={failed ? "crm-error" : "crm-feedback"} role={failed ? "alert" : "status"}>{message}</p>}
    {activity.length > 0 && <div className="crm-history"><h3><CalendarDays size={15} /> Conversation history</h3><ol>{(expanded ? activity : activity.slice(0, 4)).map(item => <li key={item.id}><span className="crm-history-type">{item.type === "contact" ? "Contact" : item.type === "note" ? "Note" : "Update"}</span><p>{item.text}</p><time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time></li>)}</ol>{activity.length > 4 && <button className="cw-back" type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer updates" : `View all ${activity.length} updates`}</button>}</div>}
  </section>;
}


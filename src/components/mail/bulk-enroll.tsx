"use client";
import { useEffect, useState } from "react";
import { Sparkles, Workflow, X } from "lucide-react";
import { mailApi, type MailOverview } from "./mail-api";
import PersonalizeQueue, { type QueueClient } from "./personalize-queue";

/** Bar shown while clients are selected: write a personal email for each, or add them all to a sequence. */
export default function BulkEnroll({ accountId, workspaceId, clients, onDone, onClear, onOpenEmailCenter }: {
  accountId: string; workspaceId: string; clients: QueueClient[]; onDone: (message: string) => void; onClear: () => void; onOpenEmailCenter: () => void;
}) {
  const clientIds = clients.map(client => client.id);
  const [personalizing, setPersonalizing] = useState(false);
  const [overview, setOverview] = useState<MailOverview | null>(null);
  const [sequence, setSequence] = useState(""), [mailbox, setMailbox] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void mailApi<MailOverview>(accountId, `/api/cloud/workspaces/${workspaceId}/mail`).then(data => {
      if (!live) return;
      setOverview(data);
      setMailbox(data.accounts.find(account => account.mine && account.status === "active")?.id ?? "");
    }).catch(() => undefined);
    return () => { live = false; };
  }, [accountId, workspaceId]);
  const mine = overview?.accounts.filter(account => account.mine && account.status === "active") ?? [];
  async function add() {
    setBusy(true);
    try {
      const result = await mailApi<{ enrolled: number; skipped: { name: string; reason: string }[] }>(accountId, `/api/cloud/workspaces/${workspaceId}/mail/enrollments`, "POST", { sequenceId: sequence, accountId: mailbox, clientIds });
      const reasons = [...new Set(result.skipped.map(item => item.reason))].join(", ");
      onDone(`Added ${result.enrolled} client${result.enrolled === 1 ? "" : "s"} to the sequence.${result.skipped.length ? ` ${result.skipped.length} skipped (${reasons}).` : ""}`);
      onClear();
    } catch (error) { onDone(error instanceof Error ? error.message : "Couldn't add clients to the sequence."); }
    finally { setBusy(false); }
  }
  return <div className="bulk-bar" role="region" aria-label="Selected clients">
    <strong>{clientIds.length} selected</strong>
    <button type="button" className="button primary small bulk-ai" onClick={() => setPersonalizing(true)}><Sparkles size={14} />Write personal emails</button>
    {personalizing && <PersonalizeQueue accountId={accountId} workspaceId={workspaceId} clients={clients} onClose={() => setPersonalizing(false)} onDone={onDone} />}
    {!overview ? <span className="mc-fine">Loading sequences…</span>
      : !mine.length || !overview.sequences.length ? <span className="mc-fine">{!mine.length ? "Connect a mailbox" : "Create a sequence"} in <button type="button" className="mc-link" onClick={onOpenEmailCenter}>Email</button> to automate follow-ups.</span>
      : <>
        <span className="bulk-or">or</span><select aria-label="Sequence" value={sequence} onChange={event => setSequence(event.target.value)}><option value="">Add to sequence…</option>{overview.sequences.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        {mine.length > 1 && <select aria-label="Send from" value={mailbox} onChange={event => setMailbox(event.target.value)}>{mine.map(account => <option key={account.id} value={account.id}>{account.email}</option>)}</select>}
        <button type="button" className="button primary small" disabled={busy || !sequence || !mailbox} onClick={() => void add()}><Workflow size={14} />{busy ? "Adding…" : "Start"}</button>
      </>}
    <button type="button" className="button ghost small" aria-label="Clear selection" onClick={onClear}><X size={14} /></button>
  </div>;
}

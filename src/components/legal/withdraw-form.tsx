"use client";
import { useId, useState } from "react";
import styles from "./withdraw-form.module.css";

export type WithdrawPaymentOption = { paymentId: string; label: string; service: string };
type Result = { reference: string; receivedAt: string; acknowledgement: "queued" | "manual"; statement: string; email: string; paymentId: string | null };
const START = "I hereby give notice that I withdraw from my contract for the supply of the following service:";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }) + " UTC";

/**
 * "Withdraw from contract here" opens this form; "Confirm withdrawal" sends it (Consumer Rights
 * Directive Art. 11a). The notice is saved with the server's time, shown back in full, and
 * acknowledged by email. It never asks for a reason and never decides the refund.
 */
export default function WithdrawForm({ signedIn, accountEmail, payments, mailOn }: { signedIn: boolean; accountEmail: string | null; payments: WithdrawPaymentOption[]; mailOn: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [paymentId, setPaymentId] = useState(payments[0]?.paymentId ?? "");
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const chosen = payments.find(item => item.paymentId === paymentId) ?? null;
  const service = chosen ? chosen.service
    : reference.trim() ? `Makeborne purchase with the payment reference ${reference.trim()}`
    : `Makeborne purchase on the account ${signedIn ? accountEmail ?? "" : email.trim().toLowerCase()}`.trim();
  const statement = `${START} ${service}.`;

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/legal/withdraw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        ...(signedIn ? {} : { email: email.trim() }), ...(name.trim() ? { name: name.trim() } : {}),
        ...(chosen ? { paymentId: chosen.paymentId } : reference.trim() ? { paymentReference: reference.trim() } : {}),
        ...(message.trim() ? { message: message.trim() } : {}), confirm: true,
      }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "Your notice could not be sent. Please email it to admin@makeborne.com; the date you send it counts.");
      setResult(data as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your notice could not be sent. Please email it to admin@makeborne.com."); }
    finally { setBusy(false); }
  }

  if (result) return <section className={styles.done} role="status" aria-live="polite" aria-labelledby={`${id}-done`}>
    <h3 id={`${id}-done`}>We received your withdrawal notice.</h3>
    <dl>
      <div><dt>Reference</dt><dd>{result.reference}</dd></div>
      <div><dt>Received</dt><dd>{when(result.receivedAt)}</dd></div>
      <div><dt>Your notice</dt><dd>{result.statement}</dd></div>
    </dl>
    <p>{result.acknowledgement === "queued"
      ? mailOn ? `An acknowledgement with this content and time is on its way to ${result.email}.` : `An acknowledgement with this content and time will be emailed to ${result.email}.`
      : `We reply from admin@makeborne.com within 2 working days. Keep this reference: it records the time we received your notice.`}</p>
    <p>We check the payment and refund within 14 days of receiving your notice, through Whop, to your original payment method. To stop future renewals, also cancel your membership in your Whop account.</p>
  </section>;

  if (!open) return <p><button type="button" className={styles.primary} onClick={() => setOpen(true)}>Withdraw from contract here</button></p>;

  return <form className={styles.form} onSubmit={confirm} aria-labelledby={`${id}-title`} noValidate>
    <h3 id={`${id}-title`}>Your withdrawal notice</h3>
    {signedIn ? <>
      <p className={styles.hint}>Signed in as {accountEmail}. The acknowledgement goes to this address.</p>
      {payments.length > 0 && <div className={styles.field}>
        <label htmlFor={`${id}-payment`}>Purchase</label>
        <select id={`${id}-payment`} value={paymentId} onChange={event => setPaymentId(event.target.value)}>
          {payments.map(item => <option key={item.paymentId} value={item.paymentId}>{item.label}</option>)}
          <option value="">Another purchase (type its reference)</option>
        </select>
      </div>}
    </> : <div className={styles.field}>
      <label htmlFor={`${id}-email`}>Email address of your Makeborne account</label>
      <input id={`${id}-email`} type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
    </div>}
    {!chosen && <div className={styles.field}>
      <label htmlFor={`${id}-reference`}>Whop payment reference <span>(optional; it starts with pay_ and is on your Whop receipt)</span></label>
      <input id={`${id}-reference`} value={reference} maxLength={200} onChange={event => setReference(event.target.value)} />
    </div>}
    <div className={styles.field}>
      <label htmlFor={`${id}-name`}>Your name <span>(optional)</span></label>
      <input id={`${id}-name`} autoComplete="name" value={name} maxLength={200} onChange={event => setName(event.target.value)} />
    </div>
    <div className={styles.field}>
      <label htmlFor={`${id}-message`}>Anything you want to add <span>(optional; no reason is needed)</span></label>
      <textarea id={`${id}-message`} rows={3} value={message} maxLength={2000} onChange={event => setMessage(event.target.value)} />
    </div>
    <div className={styles.statement}><span>Your notice reads</span><p>{statement}</p></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.actions}>
      <button type="submit" className={styles.primary} disabled={busy || (!signedIn && !email.trim())}>{busy ? "Sending…" : "Confirm withdrawal"}</button>
      <button type="button" className={styles.secondary} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
    </div>
  </form>;
}

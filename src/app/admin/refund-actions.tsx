"use client";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { refundDecisionLabel } from "./format";

/** Begin or cancel a support refund for one payment. The database decides eligibility again under the wallet lock. */
export default function RefundActions({ paymentId, mode }: { paymentId: string; mode: "begin" | "cancel" }) {
  const router = useRouter();
  const id = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/admin/refunds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: mode, paymentId, reason }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) setMessage(body?.error?.message ?? "The request did not complete. Nothing was changed.");
      else if (mode === "begin" && !body.began) setMessage(`Not started. ${refundDecisionLabel(body.decision, body.credits?.spent).text}.`);
      else if (mode === "cancel" && !body.canceled) setMessage(body.blocked === "provider_refunded" ? "Whop already shows a refund for this payment, so its credits stay withheld." : "There is no open refund request for this payment.");
      else {
        setMessage(mode === "begin" ? `${body.withheldCredits} credits frozen. Now refund this payment in the Whop dashboard.` : `${body.restoredCredits} credits returned to the customer.`);
        setReason("");
        router.refresh();
      }
    } catch { setMessage("The request did not complete. Refresh to see the current state."); }
    finally { setBusy(false); }
  }
  return <form className="mbo-refund-form" onSubmit={submit}>
    <label htmlFor={id}>{mode === "begin" ? "Refund reason" : "Why the refund is not going ahead"}</label>
    <div><input id={id} value={reason} onChange={event => setReason(event.target.value)} minLength={5} maxLength={500} required autoComplete="off" />
      <button type="submit" disabled={busy || reason.trim().length < 5}>{busy ? "Working…" : mode === "begin" ? "Freeze credits for refund" : "Cancel refund request"}</button></div>
    {message && <p role="status">{message}</p>}
  </form>;
}

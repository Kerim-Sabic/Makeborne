"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { autotopupConsentText, type AutotopupStatus } from "@/lib/billing/autotopup-consent";
import { usd } from "@/lib/billing/plans";

/**
 * Automatic top-up setup. Records explicit consent to the exact offer shown;
 * it never charges. Rendered only where the setup flag is on (qualification).
 */
export default function BillingAutotopup() {
  const [status, setStatus] = useState<AutotopupStatus | null>(null);
  const [error, setError] = useState("");
  const [threshold, setThreshold] = useState<number | null>(null);
  const [limit, setLimit] = useState(4);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/billing/autotopup", { cache: "no-store", signal: controller.signal })
      .then(async response => { const body = await response.json().catch(() => null); if (!response.ok || !body?.offer) throw new Error(body?.error?.message ?? "Automatic top-up settings could not be loaded."); return body as AutotopupStatus; })
      .then(body => { if (controller.signal.aborted) return; setStatus(body); setThreshold(body.offer.thresholds.includes(50) ? 50 : body.offer.thresholds[0] ?? null); setLimit(Math.min(4, body.offer.maxMonthlyCharges)); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Automatic top-up settings could not be loaded."); });
    return () => controller.abort();
  }, []);

  async function submit(action: "enable" | "disable") {
    if (!status) return;
    setBusy(true); setError("");
    try {
      const body = action === "enable" ? { action, confirmed: true, termsVersion: status.offer.termsVersion, priceCents: status.offer.priceCents, threshold, monthlyLimit: limit } : { action };
      const response = await fetch("/api/billing/autotopup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.offer) throw new Error(result?.error?.message ?? "Nothing was changed. Try again.");
      setStatus(result as AutotopupStatus); setConfirmed(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Nothing was changed. Try again."); }
    finally { setBusy(false); }
  }

  if (!status) return <section className="billing-autotopup" aria-labelledby="autotopup-heading"><h2 id="autotopup-heading">Automatic top-ups</h2>
    {error ? <p role="alert">{error}</p> : <p><LoaderCircle size={14} className="billing-loading" aria-hidden="true" /> Loading…</p>}</section>;
  const { offer, authorization } = status;
  const notCharging = <p className="billing-autotopup-note">Charging is not switched on yet: no payment is taken until Makeborne turns automatic top-ups on, and you will be told before that happens.</p>;
  if (offer.priceCents === null) return <section className="billing-autotopup" aria-labelledby="autotopup-heading"><h2 id="autotopup-heading">Automatic top-ups</h2>
    <p>Automatic {offer.credits}-credit top-ups are being prepared. Their price has not been set, so they cannot be turned on yet.</p></section>;
  if (authorization) return <section className="billing-autotopup" aria-labelledby="autotopup-heading"><h2 id="autotopup-heading">Automatic top-ups are on</h2>
    <p>{autotopupConsentText(authorization, authorization.priceCents, authorization.thresholdCredits, authorization.monthlyLimitCharges, authorization.dailyLimitCharges)}</p>
    {!offer.chargingEnabled && notCharging}
    {(authorization.priceCents !== offer.priceCents || authorization.termsVersion !== offer.termsVersion) && <p className="billing-autotopup-note" role="status">The offer changed since you agreed to it. No automatic charge happens until you confirm the new terms.</p>}
    <button type="button" className="billing-autotopup-secondary" onClick={() => void submit("disable")} disabled={busy}>{busy ? "Turning off…" : "Turn off automatic top-ups"}</button>
    {error && <p role="alert">{error}</p>}</section>;
  const text = threshold === null ? "" : autotopupConsentText(offer, offer.priceCents, threshold, limit, offer.maxDailyCharges);
  return <section className="billing-autotopup" aria-labelledby="autotopup-heading">
    <h2 id="autotopup-heading">Automatic top-ups</h2>
    <p>Add {offer.credits} credits for {usd(offer.priceCents)} when your balance runs low, within a monthly limit you choose. Recommended if you build often, so work in progress does not stop; it stays off unless you turn it on.</p>
    <div className="billing-autotopup-choices">
      <label>When available credits fall below<select value={threshold ?? ""} onChange={event => { setThreshold(Number(event.target.value)); setConfirmed(false); }}>{offer.thresholds.map(value => <option key={value} value={value}>{value} credits</option>)}</select></label>
      <label>At most, per calendar month<select value={limit} onChange={event => { setLimit(Number(event.target.value)); setConfirmed(false); }}>{Array.from({ length: offer.maxMonthlyCharges }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value} top-up{value === 1 ? "" : "s"} ({usd(offer.priceCents! * value)})</option>)}</select></label>
    </div>
    <p className="billing-autotopup-consent">{text}</p>
    {!offer.chargingEnabled && notCharging}
    <label className="billing-autotopup-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I authorize these automatic charges</label>
    <button type="button" onClick={() => void submit("enable")} disabled={busy || !confirmed || threshold === null}>{busy ? <><RefreshCw size={14} aria-hidden="true" /> Saving…</> : "Enable automatic top-ups"}</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}

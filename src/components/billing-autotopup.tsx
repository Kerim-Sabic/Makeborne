"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { autotopupConsentText, type AutotopupStatus } from "@/lib/billing/autotopup-consent";
import { offerChanged, panelHeading, postOutcome, reconcile, type Choice, type PostOutcome } from "@/lib/billing/autotopup-panel";
import { usd } from "@/lib/billing/plans";

const LOAD_ERROR = "Automatic top-up settings could not be loaded.";

async function readStatus(signal?: AbortSignal): Promise<AutotopupStatus> {
  const response = await fetch("/api/billing/autotopup", { cache: "no-store", signal });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.offer) throw new Error(body?.error?.message ?? LOAD_ERROR);
  return body as AutotopupStatus;
}

/**
 * Automatic top-up setup. Records explicit consent to the exact offer shown;
 * it never charges. Rendered only where the setup flag is on (qualification).
 * An existing authorization can always be turned off, whatever the current offer.
 */
export default function BillingAutotopup() {
  const [status, setStatus] = useState<AutotopupStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [limit, setLimit] = useState(4);
  const [confirmed, setConfirmed] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosen = useRef(false);

  // Read-only: never sends a change. Choices already made are kept.
  const apply = useCallback((body: AutotopupStatus) => {
    setStatus(body);
    if (chosen.current) return;
    chosen.current = true;
    setThreshold(body.offer.thresholds.includes(50) ? 50 : body.offer.thresholds[0] ?? null);
    setLimit(Math.min(4, body.offer.maxMonthlyCharges));
  }, []);
  const load = useCallback((signal?: AbortSignal) => readStatus(signal)
    .then(body => { if (!signal?.aborted) { apply(body); setLoadError(""); } })
    .catch(reason => { if (!signal?.aborted) setLoadError(reason instanceof Error ? reason.message : LOAD_ERROR); }), [apply]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  async function submit(action: "enable" | "disable") {
    if (!status) return;
    setBusy(true); setError(""); setNotice(""); setUnconfirmed(false);
    const before = status;
    const choice: Choice | null = action === "enable" && status.offer.priceCents !== null && threshold !== null
      ? { termsVersion: status.offer.termsVersion, priceCents: status.offer.priceCents, threshold, monthlyLimit: limit } : null;
    let outcome: PostOutcome;
    try {
      const response = await fetch("/api/billing/autotopup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "enable" ? { action, confirmed: true, ...choice } : { action }) });
      outcome = postOutcome(response.ok, response.status, await response.json().catch(() => null));
    } catch { outcome = { kind: "uncertain" }; }
    try {
      if (outcome.kind === "saved") { apply(outcome.status); setConfirmed(false); setReviewing(false); setNotice(action === "disable" ? "Automatic top-ups are off. No future automatic charges will be made." : "Your authorization was saved."); return; }
      if (outcome.kind === "rejected") { setError(outcome.message); return; }
      // The result is unknown: ask the server what is now saved before inviting another try.
      try {
        const after = await readStatus();
        apply(after);
        const result = reconcile(action, before, after, choice);
        if (result.saved) { setConfirmed(false); setReviewing(false); setNotice(result.message); } else setError(result.message);
      } catch { setUnconfirmed(true); setError("We couldn't confirm whether your change was saved. Check the current status before trying again."); }
    } finally { setBusy(false); }
  }
  async function checkStatus() {
    setBusy(true);
    try { apply(await readStatus()); setUnconfirmed(false); setError(""); setNotice("These are your current automatic top-up settings."); }
    catch { setError("The status still couldn't be checked. Try again in a moment."); }
    finally { setBusy(false); }
  }

  if (!status) return <section className="billing-autotopup" aria-labelledby="autotopup-heading"><h2 id="autotopup-heading">Automatic top-ups</h2>
    {loadError ? <><p role="alert">{loadError}</p><button type="button" className="billing-autotopup-secondary" onClick={() => { setLoadError(""); void load(); }}>Try again</button></>
      : <p><LoaderCircle size={14} className="billing-loading" aria-hidden="true" /> Loading…</p>}</section>;

  const { offer, authorization } = status;
  const changed = offerChanged(status);
  const notCharging = <p className="billing-autotopup-note">Charging is not switched on yet: no payment is taken until Makeborne turns automatic top-ups on, and you will be told before that happens.</p>;
  const messages = <>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {unconfirmed && <button type="button" className="billing-autotopup-secondary" onClick={() => void checkStatus()} disabled={busy}>Check current status</button>}
  </>;
  const priced = offer.priceCents;
  const showForm = priced !== null && (!authorization || reviewing);
  const text = threshold === null || priced === null ? "" : autotopupConsentText(offer, priced, threshold, limit, offer.maxDailyCharges);

  return <section className="billing-autotopup" aria-labelledby="autotopup-heading">
    <h2 id="autotopup-heading">{panelHeading(status)}</h2>
    {authorization && <>
      <p>{autotopupConsentText(authorization, authorization.priceCents, authorization.thresholdCredits, authorization.monthlyLimitCharges, authorization.dailyLimitCharges)}</p>
      {!offer.chargingEnabled && notCharging}
      {changed && <p className="billing-autotopup-note" role="status">{priced === null
        ? "This offer is not available right now, so no automatic charge happens under your authorization. You can still turn it off."
        : "The offer changed since you agreed to it. No automatic charge happens until you review and confirm the new terms."}</p>}
      {changed && priced !== null && !reviewing && <button type="button" onClick={() => { setReviewing(true); setConfirmed(false); }} disabled={busy}>Review the new terms</button>}
      <button type="button" className="billing-autotopup-secondary" onClick={() => void submit("disable")} disabled={busy}>{busy ? "Working…" : "Turn off automatic top-ups"}</button>
    </>}
    {!authorization && priced === null && <p>Automatic {offer.credits}-credit top-ups are being prepared. Their price has not been set, so they cannot be turned on yet.</p>}
    {showForm && <>
      {reviewing ? <p><strong>New terms.</strong> Confirming replaces your current authorization; until then nothing changes.</p>
        : <p>Add {offer.credits} credits for {usd(priced)} when your balance runs low, within a monthly limit you choose. Recommended if you build often, so work in progress does not stop; it stays off unless you turn it on.</p>}
      <div className="billing-autotopup-choices">
        <label>When available credits fall below<select value={threshold ?? ""} onChange={event => { setThreshold(Number(event.target.value)); setConfirmed(false); }}>{offer.thresholds.map(value => <option key={value} value={value}>{value} credits</option>)}</select></label>
        <label>At most, per calendar month<select value={limit} onChange={event => { setLimit(Number(event.target.value)); setConfirmed(false); }}>{Array.from({ length: offer.maxMonthlyCharges }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value} top-up{value === 1 ? "" : "s"} ({usd(priced * value)})</option>)}</select></label>
      </div>
      <p className="billing-autotopup-consent">{text}</p>
      {!authorization && !offer.chargingEnabled && notCharging}
      <label className="billing-autotopup-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I authorize these automatic charges</label>
      <div className="billing-autotopup-actions">
        <button type="button" onClick={() => void submit("enable")} disabled={busy || !confirmed || threshold === null}>{busy ? <><RefreshCw size={14} aria-hidden="true" /> Saving…</> : reviewing ? "Confirm the new terms" : "Enable automatic top-ups"}</button>
        {reviewing && <button type="button" className="billing-autotopup-secondary" onClick={() => { setReviewing(false); setConfirmed(false); }} disabled={busy}>Cancel</button>}
      </div>
    </>}
    {messages}
  </section>;
}

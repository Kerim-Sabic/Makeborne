"use client";
import { useEffect, useState } from "react";
import { Check, Gauge, LoaderCircle, UserPlus } from "lucide-react";
import type { SiteCheck } from "@/lib/crm-research/site-check";
import type { Fit } from "@/lib/crm-research/score";
import type { FoundLead } from "@/lib/leads/finder-types";
import { crmCall, CrmRequestError, localDay } from "./crm-api";
import WebsiteCheckCard from "./website-check-card";

/** Is CRM research on for this person? One cheap probe per workspace per page load. */
const probes = new Map<string, Promise<boolean>>();
export function useCrmResearch(accountId: string, workspaceId: string) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    const key = `${accountId}:${workspaceId}`;
    if (!probes.has(key)) probes.set(key, crmCall<{ enabled: boolean; canEdit: boolean }>(accountId, `/api/cloud/workspaces/${workspaceId}/crm?probe=1`).then(value => value.enabled && value.canEdit).catch(() => { probes.delete(key); return false; }));
    void probes.get(key)!.then(value => { if (live) setEnabled(value); });
    return () => { live = false; };
  }, [accountId, workspaceId]);
  return enabled;
}

type Result = { checkId: string; check: SiteCheck; fit: Fit; matches: { id: string; name: string }[]; suppressed: { value: string } | null };

/** Under a Lead finder result: check this business's website, then add it as a client with that check. */
export default function LeadWebsiteCheck({ accountId, workspaceId, lead, tag, disabled }: { accountId: string; workspaceId: string; lead: FoundLead; tag: string; disabled?: boolean }) {
  const enabled = useCrmResearch(accountId, workspaceId);
  const [busy, setBusy] = useState<"" | "check" | "add">("");
  const [result, setResult] = useState<Result | null>(null);
  const [added, setAdded] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [error, setError] = useState("");
  const [requestKey] = useState(() => crypto.randomUUID());
  if (!enabled || !lead.website) return null;
  async function check() {
    setBusy("check"); setError("");
    try { setResult(await crmCall<Result>(accountId, `/api/cloud/workspaces/${workspaceId}/crm`, { action: "check", url: lead.website, name: lead.name.slice(0, 120), email: lead.email.slice(0, 254), phone: lead.phone.slice(0, 40), category: lead.category.slice(0, 80) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The check couldn't finish."); } finally { setBusy(""); }
  }
  async function add(allowDuplicate: boolean) {
    if (!result) return;
    setBusy("add"); setError("");
    try {
      await crmCall(accountId, `/api/cloud/workspaces/${workspaceId}/crm`, { action: "add", requestKey, checkId: result.checkId, allowDuplicate, today: localDay(),
        prospect: { name: lead.name.slice(0, 120), website: lead.website, email: lead.email.slice(0, 254), phone: lead.phone.slice(0, 40), address: lead.address.slice(0, 300), category: lead.category.slice(0, 80), source: "Lead finder", tag: tag.slice(0, 30) } });
      setAdded(true); setDuplicate(false);
    } catch (cause) {
      if (cause instanceof CrmRequestError && cause.code === "POSSIBLE_DUPLICATE") setDuplicate(true);
      else setError(cause instanceof Error ? cause.message : "Couldn't add this lead.");
    } finally { setBusy(""); }
  }
  return <div className="crm-lead-check" data-testid="crm-lead-check">
    {!result ? <button type="button" className="lf-more" disabled={disabled || Boolean(busy)} onClick={() => void check()}>{busy === "check" ? <LoaderCircle size={12} className="crm-spin" aria-hidden /> : <Gauge size={12} aria-hidden />}{busy === "check" ? "Checking website…" : "Check website"}</button>
      : <>
        <WebsiteCheckCard check={result.check} compact />
        <p className="crm-muted">Fit {result.fit.score}/100 · {result.fit.reasons.slice(0, 3).map(item => item.text).join(" · ")}</p>
        {result.suppressed ? <p className="crm-warn">On your do-not-contact list ({result.suppressed.value}).</p>
          : added ? <p className="crm-note"><Check size={13} aria-hidden /> Added with its website check. Facts are waiting for your review.</p>
          : duplicate ? <p className="crm-warn">Already in your clients{result.matches[0] ? ` as ${result.matches[0].name}` : ""}. <button type="button" className="crm-link" disabled={Boolean(busy)} onClick={() => void add(true)}>Add anyway</button></p>
          : <button type="button" className="lf-more" disabled={disabled || Boolean(busy)} onClick={() => void add(false)}><UserPlus size={12} aria-hidden />{busy === "add" ? "Adding…" : "Add with this check"}</button>}
      </>}
    {error && <p className="crm-error" role="alert">{error}</p>}
  </div>;
}

"use client";
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import type { SiteCheck } from "@/lib/crm-research/site-check";
import { shortDate } from "./crm-api";

const BAND_LABEL = { strong: "Clear opportunity", some: "Some room to improve", low: "Small issues only", unknown: "Not scored" } as const;

/** One website check: score and why, each finding with where and when it was seen, what we couldn't check. */
export default function WebsiteCheckCard({ check, compact = false }: { check: SiteCheck; compact?: boolean }) {
  if (check.status === "no_website") return <div className="crm-check is-unknown" data-testid="crm-check"><p className="crm-check-summary">{check.summary}</p></div>;
  if (check.status === "inaccessible") return <div className="crm-check is-unknown" data-testid="crm-check">
    <p className="crm-warn"><AlertTriangle size={15} aria-hidden /> {check.summary}</p>
    {check.url && <p className="crm-muted">{check.url} · checked {shortDate(check.checkedAt)}</p>}
  </div>;
  const findings = compact ? check.findings.slice(0, 3) : check.findings;
  return <div className={`crm-check is-${check.band}`} data-testid="crm-check">
    <div className="crm-check-head">
      <span className="crm-score" aria-label={`Website opportunity ${check.score} out of 100`}><strong>{check.score}</strong><small>/100</small></span>
      <div><strong>{BAND_LABEL[check.band]}</strong><p className="crm-check-summary">{check.summary}</p>
        <p className="crm-muted">Checked {shortDate(check.checkedAt)} · {check.pages.length} page{check.pages.length === 1 ? "" : "s"} read{check.platform ? ` · built on ${check.platform}` : ""}</p></div>
    </div>
    {findings.length > 0 && <ul className="crm-findings">{findings.map(item => <li key={item.id} className={`is-${item.level}`}>
      <span className="crm-points" title="Points this adds to the score">+{item.points}</span>
      <div><strong>{item.title}</strong><p>{item.detail}</p>
        {!compact && <details><summary>Where we saw this</summary><p className="crm-muted">
          <a href={item.evidence.url} target="_blank" rel="noopener noreferrer nofollow">{item.evidence.url}<ExternalLink size={11} aria-hidden /></a>, read {shortDate(item.evidence.checkedAt)}
          {item.evidence.quote ? <> · on the page: “{item.evidence.quote}”</> : null}{item.evidence.measured ? <> · measured: {item.evidence.measured}</> : null}</p></details>}
      </div></li>)}</ul>}
    {compact && check.findings.length > findings.length && <p className="crm-muted">+{check.findings.length - findings.length} smaller finding{check.findings.length - findings.length === 1 ? "" : "s"}</p>}
    {!compact && check.strengths.length > 0 && <div className="crm-strengths"><h5>Already good</h5><ul>{check.strengths.map(item => <li key={item.id}><CheckCircle2 size={13} aria-hidden /> {item.title}</li>)}</ul></div>}
    {!compact && check.links.broken.length > 0 && <p className="crm-muted">Broken links: {check.links.broken.map(item => item.url).join(", ")}</p>}
    {!compact && <details className="crm-notchecked"><summary>What this check can&apos;t see</summary><ul>{check.notChecked.map(item => <li key={item}>{item}</li>)}
      {check.inaccessible.map(item => <li key={item.target}>{item.target}: {item.detail}</li>)}</ul></details>}
  </div>;
}

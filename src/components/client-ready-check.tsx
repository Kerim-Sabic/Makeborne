"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Info, XCircle } from "lucide-react";
import { clientReadyCheck, clientReadySummary, type ClientReadyFinding, type ClientReadyInput } from "@/lib/builder/client-ready";

const ICONS = { error: XCircle, warning: AlertTriangle, info: Info } as const;
const LABELS = { error: "Fix before sharing", warning: "Worth fixing", info: "Good to know" } as const;

/** Advisory pre-publish list: computed in the browser from the website source
 * (and the prepared pages when they exist). No AI, no credits; never blocks.
 * A static read of the code, so a clean result is "nothing found by these
 * checks", and a check that can't finish never shows as clean. */
export default function ClientReadyCheck({ source, pages, scope }: { source: ClientReadyInput; pages?: ClientReadyInput["pages"]; /** Which version was read, e.g. "Checked saved version 4". */ scope?: string }) {
  const result = useMemo((): { findings: ClientReadyFinding[] } | { failed: true } => {
    try { return { findings: clientReadyCheck({ ...source, pages }) }; }
    catch { return { failed: true }; }
  }, [source, pages]);
  const intro = <p className="client-ready-intro">A quick read of {pages?.length ? "the prepared pages and " : ""}the website’s code for placeholder text, links that go nowhere, image details and colour pairs set in the same style rule. It’s not a full visual, accessibility or security review. Advice only: you can still publish.</p>;
  if ("failed" in result) return <section className="client-ready" aria-label="Client-ready check">
    <div className="client-ready-heading">
      <ClipboardCheck size={16} aria-hidden="true" />
      <strong>Client-ready check</strong>
      <span className="client-ready-summary" data-state="error">Check couldn’t finish</span>
    </div>
    {intro}
    {scope && <p className="client-ready-scope">{scope}{pages?.length ? " and its prepared pages" : ""}.</p>}
    <p className="client-ready-failed" role="status"><XCircle size={15} aria-hidden="true" />The check stopped on something in this website’s code, so it has no results. Nothing here means the site is ready: look through it yourself before sharing.</p>
  </section>;
  const { findings } = result;
  const summary = clientReadySummary(findings);
  const headline = findings.length === 0 ? "No issues found by these checks"
    : [summary.error && `${summary.error} to fix`, summary.warning && `${summary.warning} to review`, summary.info && `${summary.info} minor`].filter(Boolean).join(" · ");
  return <section className="client-ready" aria-label="Client-ready check">
    <div className="client-ready-heading">
      <ClipboardCheck size={16} aria-hidden="true" />
      <strong>Client-ready check</strong>
      <span className="client-ready-summary" data-state={summary.error ? "error" : summary.warning ? "warning" : "clean"}>{headline}</span>
    </div>
    {intro}
    {scope && <p className="client-ready-scope">{scope}{pages?.length ? " and its prepared pages" : ""}.</p>}
    {findings.length === 0 ? <p className="client-ready-clean"><CheckCircle2 size={15} aria-hidden="true" />These checks found nothing to fix. Look through the site yourself too: layout, colours set in separate rules and how forms behave aren’t covered.</p>
      : <ul className="client-ready-list">{findings.map(finding => {
        const Icon = ICONS[finding.severity];
        return <li key={finding.rule} data-severity={finding.severity}>
          <details>
            <summary>
              <Icon size={15} aria-hidden="true" />
              <span className="client-ready-title"><strong>{finding.title}</strong><small>{LABELS[finding.severity]} · {finding.count === 1 ? "1 place" : `${finding.count} places`}</small></span>
            </summary>
            <p>{finding.detail}</p>
            <ul className="client-ready-locations">
              {finding.locations.map(location => <li key={location}><code>{location}</code></li>)}
              {finding.count > finding.locations.length && <li>and {finding.count - finding.locations.length} more</li>}
            </ul>
          </details>
        </li>;
      })}</ul>}
  </section>;
}

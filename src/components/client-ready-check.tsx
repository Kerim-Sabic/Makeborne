"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Info, XCircle } from "lucide-react";
import { clientReadyCheck, clientReadySummary, type ClientReadyInput } from "@/lib/builder/client-ready";

const ICONS = { error: XCircle, warning: AlertTriangle, info: Info } as const;
const LABELS = { error: "Fix before sharing", warning: "Worth fixing", info: "Good to know" } as const;

/** Advisory pre-publish list: computed in the browser from the website source
 * (and the prepared pages when they exist). No AI, no credits; never blocks. */
export default function ClientReadyCheck({ source, pages }: { source: ClientReadyInput; pages?: ClientReadyInput["pages"] }) {
  const findings = useMemo(() => clientReadyCheck({ ...source, pages }), [source, pages]);
  const summary = clientReadySummary(findings);
  const headline = findings.length === 0 ? "No issues found"
    : [summary.error && `${summary.error} to fix`, summary.warning && `${summary.warning} to review`, summary.info && `${summary.info} minor`].filter(Boolean).join(" · ");
  return <section className="client-ready" aria-label="Client-ready check">
    <div className="client-ready-heading">
      <ClipboardCheck size={16} aria-hidden="true" />
      <strong>Client-ready check</strong>
      <span className="client-ready-summary" data-state={summary.error ? "error" : summary.warning ? "warning" : "clean"}>{headline}</span>
    </div>
    <p className="client-ready-intro">Checks {pages?.length ? "the prepared pages and " : ""}the website’s code for placeholder text, links that go nowhere, image details and hard-to-read colours. Advice only: you can still publish.</p>
    {findings.length === 0 ? <p className="client-ready-clean"><CheckCircle2 size={15} aria-hidden="true" />Nothing to fix before you share this website.</p>
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

"use client";
import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, FileSearch } from "lucide-react";
import { audienceLine, INDEX_LABELS, publishReport, type IndexingPolicy } from "@/lib/hosting/publish-report";

/** Per-page report of the prepared (or just published) output: title, canonical,
 * indexing and share image as visitors and search engines will get them. */
export default function PublishReport({ routes, policy, version, published, address }: { routes: readonly { path: string; html: string }[]; policy: IndexingPolicy; version: number; published: boolean; address?: string }) {
  const report = useMemo(() => publishReport(routes, policy, address), [routes, policy, address]);
  const problems = report.filter(route => route.status === "check").length;
  return <section className="publish-report" aria-label="Publish report">
    <div className="publish-report-heading">
      <FileSearch size={16} aria-hidden="true" />
      <strong>{published ? `Published version ${version}` : `Prepared version ${version}`} · {report.length === 1 ? "1 page" : `${report.length} pages`}</strong>
      <span className="publish-report-summary" data-state={problems ? "check" : "ready"}>{problems ? `${problems} to look at` : "Every page has its details"}</span>
    </div>
    {/* Before publishing, the same line sits next to the consent instead. */}
    {published && <p className="publish-report-audience">{audienceLine(policy)}</p>}
    <ul className="publish-report-list">{report.map(route => <li key={route.path} data-status={route.status}>
      <div className="publish-report-route"><code>{route.path}</code>
        <span>{route.status === "ready" ? <><CheckCircle2 size={13} aria-hidden="true" />Ready</> : <><AlertTriangle size={13} aria-hidden="true" />{route.problems.join(" · ")}</>}</span></div>
      <dl>
        <div><dt>Title</dt><dd>{route.title ?? "None"}</dd></div>
        <div><dt>Canonical</dt><dd>{route.canonical ?? "None"}</dd></div>
        <div><dt>Search engines</dt><dd>{INDEX_LABELS[route.index]}</dd></div>
        <div><dt>Share image</dt><dd>{route.socialImage ? route.socialImage.replace(/^https?:\/\/[^/]+/, "") : "None (links show text only)"}</dd></div>
      </dl>
    </li>)}</ul>
    <p className="publish-report-note">Read from the {published ? "output that was just published" : "prepared output"}. The live server’s HTTP status and response headers aren’t fetched here; open the live site to see them.</p>
  </section>;
}

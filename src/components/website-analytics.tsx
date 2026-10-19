"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, Minus } from "lucide-react";
import ComingSoon from "./coming-soon";
import { cloudAccountGuard } from "./cloud-api";
import { ANALYTICS_RANGES, dimensionLabel, type AnalyticsRange, type Dimension, type Metric, type Summary } from "@/lib/hosting/site-analytics";
import "@/app/website-analytics.css";

type Response = { available: boolean; published: boolean; live: boolean; summary?: Summary };
const number = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
const SECTIONS: [Dimension, string][] = [["path", "Top pages"], ["referrer", "Where visitors came from"], ["country", "Countries"], ["device", "Devices"]];

function countryName(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return dimensionLabel("country", code);
  try { return new Intl.DisplayNames(undefined, { type: "region" }).of(code) ?? code; } catch { return code; }
}

function Change({ metric, suffix = "" }: { metric: Metric; suffix?: string }) {
  if (metric.change === null) return <span className="wa-change is-new">New</span>;
  if (metric.change === 0) return <span className="wa-change"><Minus size={12} />No change</span>;
  const up = metric.change > 0;
  return <span className={`wa-change ${up ? "is-up" : "is-down"}`}>{up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{number(Math.abs(metric.change))}%{suffix}</span>;
}

/** A website's visitors, next to the enquiries and clients they produced. */
export default function WebsiteAnalytics({ accountId, workspaceId, artifactId }: { accountId: string; workspaceId: string; artifactId: string }) {
  const [range, setRange] = useState<AnalyticsRange>(30);
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const guard = cloudAccountGuard(accountId); guard();
    fetch(`/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/analytics?days=${range}`, { cache: "no-store", headers: { "X-Makeborne-Account": accountId } })
      .then(async response => { const value = await response.json().catch(() => ({})); guard(); if (!response.ok) throw new Error(value?.error?.message ?? "Analytics couldn't load."); return value as Response; })
      .then(value => { if (active) { setData(value); setError(""); } }, cause => { if (active) setError(cause instanceof Error ? cause.message : "Analytics couldn't load."); });
    return () => { active = false; };
  }, [accountId, workspaceId, artifactId, range]);

  const summary = data?.summary;
  const peak = useMemo(() => Math.max(1, ...(summary?.series ?? []).map(day => day.visitors)), [summary]);
  const header = <header className="wa-head">
    <h3><BarChart3 size={16} />Visitors</h3>
    {data?.available && <div className="wa-range" role="group" aria-label="Time range">{ANALYTICS_RANGES.map(days =>
      <button key={days} type="button" aria-pressed={range === days} onClick={() => setRange(days)}>{days} days</button>)}</div>}
  </header>;

  if (error && /available here yet/.test(error)) return <ComingSoon title="Visitor analytics" text="See visitors, where they came from and who got in touch, without cookies." />;
  if (error) return <section className="website-publish wa" aria-label="Visitor analytics">{header}<p className="wa-error" role="alert">{error}</p></section>;
  if (!data) return <section className="website-publish wa" aria-label="Visitor analytics">{header}<p role="status">Loading visitors…</p></section>;
  if (!data.available) return <ComingSoon title="Visitor analytics" text="See visitors, where they came from and who got in touch, without cookies." />;
  if (!summary?.hasData) return <section className="website-publish wa" aria-label="Visitor analytics">{header}<p>{data.live ? "No visits counted yet in this period. Share your site's address and check back soon." : "Publish your website to start counting visitors."} Visitors are counted privately: no cookies, no personal data, and bots are left out.</p></section>;

  const { totals } = summary;
  return <section className="website-publish wa" aria-label="Visitor analytics">
    {header}
    <div className="wa-kpis">
      <div className="wa-kpi"><span>Visitors</span><strong>{number(totals.visitors.value)}</strong><Change metric={totals.visitors} /></div>
      <div className="wa-kpi"><span>Page views</span><strong>{number(totals.views.value)}</strong><Change metric={totals.views} /></div>
      <div className="wa-kpi"><span>Enquiries</span><strong>{number(totals.enquiries.value)}</strong><Change metric={totals.enquiries} /></div>
      <div className="wa-kpi"><span>Enquiry rate</span><strong>{number(totals.conversion.value)}%</strong><Change metric={totals.conversion} /></div>
    </div>
    <figure className="wa-chart" aria-label={`Daily visitors over the last ${summary.range} days`}>
      <div className="wa-bars">{summary.series.map(day =>
        <div key={day.day} className="wa-bar" title={`${new Date(`${day.day}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })}: ${day.visitors} visitors, ${day.views} views${day.enquiries ? `, ${day.enquiries} enquir${day.enquiries === 1 ? "y" : "ies"}` : ""}`}>
          <span style={{ height: `${Math.max(day.visitors ? 3 : 0, (day.visitors / peak) * 100)}%` }} />
          {day.enquiries > 0 && <i aria-hidden="true" />}
        </div>)}</div>
      <figcaption><span>{new Date(`${summary.from}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })}</span><span className="wa-legend"><i />Day with an enquiry</span><span>Today</span></figcaption>
    </figure>
    <div className="wa-funnel" aria-label="From visitors to clients">
      <div><strong>{number(totals.visitors.value)}</strong><span>visitors</span></div>
      <div><strong>{number(totals.enquiries.value)}</strong><span>enquiries</span></div>
      <div><strong>{number(totals.leads)}</strong><span>in Clients</span></div>
      <div><strong>{number(totals.won)}</strong><span>won</span></div>
    </div>
    <div className="wa-lists">{SECTIONS.map(([dimension, title]) => summary.top[dimension].length > 0 && <section key={dimension} className="wa-list" aria-label={title}>
      <h4>{title}</h4>
      <ol>{summary.top[dimension].map(item => <li key={item.value}>
        <span className="wa-fill" style={{ width: `${item.share}%` }} aria-hidden="true" />
        <span className="wa-name">{dimension === "country" ? countryName(item.value) : dimensionLabel(dimension, item.value)}</span>
        <span className="wa-count">{number(item.views)}</span>
      </li>)}</ol>
    </section>)}</div>
    <p className="wa-note">Counted privately: no cookies, no personal data, bots left out. Leads and wins count clients whose email wrote through this site in the period.</p>
  </section>;
}

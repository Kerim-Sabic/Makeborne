import Link from "next/link";
import { Activity, AlertTriangle, Bug, CheckCircle2, Eye, Filter } from "lucide-react";
import type { adminHealth } from "@/lib/admin/console";
import { count, exactTime, relative } from "./format";

type Health = Awaited<ReturnType<typeof adminHealth>>;
const WINDOWS = [7, 30, 90];
const STEPS: [keyof Health["funnel"], string][] = [["signedUp", "Signed up"], ["confirmed", "Confirmed email"], ["createdProject", "Created a project"],
  ["ranBuild", "Ran an AI build"], ["sharedReview", "Shared a review link"], ["published", "Published a site"], ["paid", "Became a subscriber"]];
const PAGES: [string, string][] = [["home", "Home"], ["pricing", "Pricing"], ["login", "Sign in"], ["studio", "Studio"], ["portal", "Client portal"], ["help", "Help"]];
const percent = (part: number, whole: number) => whole ? `${Math.round(part / whole * 100)}%` : "–";

/** Errors, visits and the sign-up funnel, from first-party telemetry and existing records. */
export default function HealthTab({ data, now }: { data: Health; now: number }) {
  const top = data.funnel.signedUp;
  const peak = Math.max(1, ...data.errors.byDay.map(day => day.server + day.client));
  return <>
    <nav className="mbo-alerts" aria-label="Time window"><p className="mbo-alert is-ok"><Filter size={16} aria-hidden="true" /><span>
      Show the last {WINDOWS.map((days, index) => <span key={days}>{index ? " · " : ""}{days === data.days ? <strong>{days} days</strong> : <Link href={`?tab=health&days=${days}`}>{days} days</Link>}</span>)}</span></p></nav>

    <div className="mbo-two">
      <section className="mbo-panel" aria-labelledby="funnel-heading">
        <header className="mbo-panel-head"><h2 id="funnel-heading"><Activity size={16} aria-hidden="true" />Sign-up funnel</h2></header>
        <ul className="mbo-bars">{STEPS.map(([key, label]) => <li key={key}><span>{label}</span>
          <span className="mbo-bar" aria-hidden="true"><i style={{ width: `${top ? Math.max(2, data.funnel[key] / top * 100) : 2}%` }} /></span>
          <span>{count(data.funnel[key])} · {percent(data.funnel[key], top)}</span></li>)}</ul>
        <p className="mbo-footnote">Accounts created in this window, and how many of them reached each step since. From existing records; nothing extra is collected.</p>
      </section>
      <section className="mbo-panel" aria-labelledby="visits-heading">
        <header className="mbo-panel-head"><h2 id="visits-heading"><Eye size={16} aria-hidden="true" />Visitors</h2></header>
        <dl className="mbo-stats">{PAGES.map(([page, label]) => <div key={page}><dt>{label}</dt><dd>{count(data.visits[page] ?? 0)}</dd></div>)}</dl>
        <p className="mbo-footnote">Visitor-days per page: each browser counts once per page per day. No cookies; browsers asking not to be tracked are not counted.</p>
      </section>
    </div>

    <section className="mbo-panel" aria-labelledby="errors-heading">
      <header className="mbo-panel-head"><h2 id="errors-heading"><Bug size={16} aria-hidden="true" />Errors<span className="mbo-count">{count(data.errors.last24h)} in 24 h · {count(data.errors.window)} in {data.days} days</span></h2></header>
      {data.errors.byDay.length > 0 && <ul className="mbo-bars" aria-label="Errors per day">{data.errors.byDay.map(day => <li key={day.day}><span>{day.day}</span>
        <span className="mbo-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, (day.server + day.client) / peak * 100)}%` }} /></span>
        <span>{count(day.server)} server · {count(day.client)} browser</span></li>)}</ul>}
      {!data.errors.top.length ? <p className="mbo-alert is-ok"><CheckCircle2 size={16} aria-hidden="true" /><span>No errors recorded in this window.</span></p>
        : <div className="mbo-table-wrap"><table className="mbo-table"><thead><tr><th>Error</th><th>Where</th><th>In window</th><th>Last seen</th></tr></thead><tbody>
          {data.errors.top.map(error => <tr key={error.fingerprint}>
            <td><strong>{error.kind}</strong> <span className="mbo-muted">{error.source === "server" ? "server" : "browser"}</span><br />{error.message || <span className="mbo-muted">(no message)</span>}</td>
            <td><code>{error.route || "–"}</code>{error.release && <><br /><span className="mbo-muted">release {error.release.slice(0, 7)}</span></>}</td>
            <td>{count(error.count)}<br /><span className="mbo-muted">{count(error.total)} total</span></td>
            <td title={exactTime(error.lastSeen)}>{relative(error.lastSeen, now)}<br /><span className="mbo-muted">first {relative(error.firstSeen, now)}</span></td>
          </tr>)}</tbody></table></div>}
      <p className="mbo-footnote"><AlertTriangle size={12} aria-hidden="true" /> Messages are scrubbed before storage (no emails, ids, tokens or long numbers). Server errors come from Next.js request hooks; browser errors from Makeborne&apos;s own scripts only.</p>
    </section>
  </>;
}

"use client";

import { useMemo } from "react";
import { BadgeCheck } from "lucide-react";
import type { ClientReadyInput } from "@/lib/builder/client-ready";
import { siteClaims } from "@/lib/builder/site-claims";

/** Advisory list of statements only the business can confirm (prices, guarantees,
 * awards, reviews, rankings, certifications, figures, hours, contact details).
 * Found by pattern matching in the browser; never blocks publishing. */
export default function SiteClaims({ source, pages, scope }: { source: ClientReadyInput; pages?: ClientReadyInput["pages"]; scope?: string }) {
  const result = useMemo(() => { try { return siteClaims({ ...source, pages }); } catch { return null; } }, [source, pages]);
  const total = result?.reduce((sum, group) => sum + group.count, 0) ?? 0;
  return <section className="site-claims" aria-label="Claims to confirm before publishing">
    <div className="site-claims-heading">
      <BadgeCheck size={16} aria-hidden="true" />
      <strong>Confirm before publishing</strong>
      <span className="site-claims-count">{result === null ? "Couldn’t check" : total === 0 ? "None found" : `${total} to confirm`}</span>
    </div>
    <p className="site-claims-intro">Statements only the business can confirm: prices, guarantees, awards, reviews, “#1”-style claims, certifications, figures, opening hours and contact details. Found by matching patterns in {pages?.length ? "the prepared pages and " : ""}the site’s text, so claims worded differently aren’t listed and a listed item may be fine. Advice only: you can still publish.</p>
    {scope && <p className="site-claims-scope">{scope}{pages?.length ? " and its prepared pages" : ""}.</p>}
    {result === null ? <p className="site-claims-empty" role="status">The text couldn’t be read for claims. Read the site yourself before publishing.</p>
      : total === 0 ? <p className="site-claims-empty">No such statements were found by these patterns. Still read the copy with the client before it goes live.</p>
      : <ul className="site-claims-list">{result.map(group => <li key={group.kind} data-kind={group.kind}>
        <details>
          <summary><span><strong>{group.label}</strong><small>{group.count === 1 ? "1 item" : `${group.count} items`} · {group.hint}</small></span></summary>
          <ul>{group.items.map(item => <li key={item.text}><q>{item.text}</q><small>{item.locations.join(" · ")}{item.count > item.locations.length ? ` · and ${item.count - item.locations.length} more` : ""}</small></li>)}
            {group.count > group.items.length && <li><small>and {group.count - group.items.length} more like these</small></li>}</ul>
        </details>
      </li>)}</ul>}
  </section>;
}

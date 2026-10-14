"use client";
import { useState } from "react";
import { Eye } from "lucide-react";
import { deviceMix, formatDuration, mostTime, pagesInOrder, relativeTime, type ViewSummary } from "@/lib/client-review/views";

type Kind = "website" | "book" | "presentation";
const unit: Record<Kind, [string, string]> = { presentation: ["slide", "slides"], book: ["page", "pages"], website: ["section", "sections"] };

/** Per-link "who opened it and where they spent time", for the person who shared it. */
export default function LinkViewStats({ summary, kind, linkLabel }: { summary: ViewSummary | null; kind: Kind; linkLabel: string }) {
  const [open, setOpen] = useState(false);
  if (!summary || summary.sessions === 0) return <p className="crp-views crp-muted"><Eye size={12} /> Not opened yet</p>;
  const top = mostTime(summary);
  const pages = pagesInOrder(summary.pages.filter(page => page.seconds > 0));
  const longest = Math.max(1, ...pages.map(page => page.seconds));
  const [one, many] = unit[kind];
  return <div className="crp-views">
    <p><Eye size={12} /> <strong>Opened {summary.opens} {summary.opens === 1 ? "time" : "times"}</strong>
      {` · ${summary.sessions} ${summary.sessions === 1 ? "visit" : "visits"} · ${formatDuration(summary.totalSeconds)} in total · last opened ${relativeTime(summary.lastOpenedAt)}`}</p>
    <p className="crp-muted">{deviceMix(summary.devices)}</p>
    {top && <p>Most time: <strong>{top.label}</strong> ({formatDuration(top.seconds)})</p>}
    {pages.length > 1 && <>
      <button type="button" className="crp-text-button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? `Hide time per ${one}` : `Show time per ${one} (${pages.length} ${many})`}</button>
      {open && <ol className="crp-bars" aria-label={`Time per ${one} for ${linkLabel}`}>{pages.map(page => <li key={page.ref}>
        <span>{page.label}</span><small>{formatDuration(page.seconds)}</small>
        <span className="crp-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, Math.round(page.seconds / longest * 100))}%` }} /></span>
      </li>)}</ol>}
    </>}
  </div>;
}

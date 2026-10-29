/**
 * One timeline per client from what the workspace already records: outreach
 * updates, emails sent and received, review links and decisions, projects,
 * research briefs, client facts and website checks. Pure merge of rows the
 * route read under RLS; a missing source is simply absent.
 */
export type TimelineKind = "outreach" | "contact" | "note" | "email_out" | "email_in" | "review_sent" | "review_decision" | "project" | "research" | "fact" | "site_check" | "next_step";
export type TimelineEvent = { id: string; at: string; kind: TimelineKind; title: string; detail: string };
export type TimelineSources = {
  activity?: { id: string; at: string; text: string; type?: string }[];
  emails?: { id: string; direction: "out" | "in"; status: string; subject: string; created_at: string; sent_at?: string | null }[];
  reviews?: { id: string; created_at: string; recipient_name: string; decision: string | null; decided_at: string | null; decision_name: string | null; project_title?: string }[];
  projects?: { id: string; title: string; kind: string; created_at: string }[];
  briefs?: { id: string; created_at: string; method: string }[];
  facts?: { id: string; label: string; status: string; created_at: string; approved_at?: string | null }[];
  checks?: { id: string; checked_at: string; status: string; score: number | null; final_url?: string | null; url: string }[];
  nextStep?: { text: string; updated_at: string } | null;
};
const clip = (value: string, max = 160) => { const text = value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
const valid = (at: string | null | undefined): at is string => Boolean(at && !Number.isNaN(Date.parse(at)));

export function buildTimeline(sources: TimelineSources, limit = 100): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const entry of sources.activity ?? []) if (valid(entry.at)) out.push({ id: `a:${entry.id}`, at: entry.at, kind: entry.type === "contact" ? "contact" : entry.type === "note" ? "note" : "outreach", title: entry.type === "contact" ? "Contact logged" : entry.type === "note" ? "Note" : "Outreach updated", detail: clip(entry.text) });
  for (const mail of sources.emails ?? []) {
    const at = mail.sent_at ?? mail.created_at;
    if (!valid(at)) continue;
    out.push({ id: `m:${mail.id}`, at, kind: mail.direction === "in" ? "email_in" : "email_out", title: mail.direction === "in" ? "Reply received" : mail.status === "sent" ? "Email sent" : mail.status === "failed" ? "Email failed to send" : "Email (sending not confirmed)", detail: clip(mail.subject || "(no subject)") });
  }
  for (const review of sources.reviews ?? []) {
    if (valid(review.created_at)) out.push({ id: `r:${review.id}`, at: review.created_at, kind: "review_sent", title: "Review link shared", detail: clip([review.project_title, review.recipient_name && `for ${review.recipient_name}`].filter(Boolean).join(" ")) });
    if (review.decision && valid(review.decided_at)) out.push({ id: `rd:${review.id}`, at: review.decided_at, kind: "review_decision", title: review.decision === "approved" ? "Approved by the client" : "Client asked for changes", detail: clip([review.project_title, review.decision_name && `by ${review.decision_name}`].filter(Boolean).join(" ")) });
  }
  for (const project of sources.projects ?? []) if (valid(project.created_at)) out.push({ id: `p:${project.id}`, at: project.created_at, kind: "project", title: `Project started (${project.kind === "book" ? "book" : project.kind === "presentation" ? "deck" : "website"})`, detail: clip(project.title) });
  for (const brief of sources.briefs ?? []) if (valid(brief.created_at)) out.push({ id: `b:${brief.id}`, at: brief.created_at, kind: "research", title: "Research brief", detail: brief.method === "assisted" ? "Written with help, from their sources" : "From their sources" });
  for (const fact of sources.facts ?? []) {
    if (valid(fact.created_at)) out.push({ id: `f:${fact.id}`, at: fact.created_at, kind: "fact", title: "Fact suggested", detail: clip(fact.label) });
    if (fact.status === "approved" && valid(fact.approved_at)) out.push({ id: `fa:${fact.id}`, at: fact.approved_at, kind: "fact", title: "Fact approved", detail: clip(fact.label) });
  }
  for (const check of sources.checks ?? []) if (valid(check.checked_at)) out.push({ id: `c:${check.id}`, at: check.checked_at, kind: "site_check", title: "Website checked", detail: clip(check.status === "checked" ? `${check.final_url ?? check.url}: ${check.score}/100 room to improve` : check.status === "no_website" ? "No website to check" : `${check.url}: couldn't be read`) });
  if (sources.nextStep?.text && valid(sources.nextStep.updated_at)) out.push({ id: "n:current", at: sources.nextStep.updated_at, kind: "next_step", title: "Next step set", detail: clip(sources.nextStep.text) });
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, limit);
}

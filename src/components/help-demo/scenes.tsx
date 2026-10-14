"use client";
import type { ReactNode } from "react";
import { ArrowUp, AtSign, BookOpen, Check, ChevronDown, Columns3, Copy, Download, FileText, FolderOpen, Gem, Globe2, List, ListChecks, Mail, MapPin, MessageCircle, Palette, Paperclip, Plus, Presentation, Search, Send, Sparkles, Users, Workflow } from "lucide-react";
import BrandMark from "@/components/brand-mark";
import EffortControl from "@/components/effort-control";
import { EFFORT_PRESENTATION, type EffortLevel } from "@/lib/routing/effort";
import "@/app/composer-controls.css";
import type { DemoState } from "./engine";
import type { DemoId } from "./scripts";

type Scene = (props: { s: DemoState }) => ReactNode;
const t = (value: unknown) => String(value ?? "");
const effortOf = (s: DemoState) => (Object.keys(EFFORT_PRESENTATION).includes(t(s.effort)) ? t(s.effort) : "medium") as EffortLevel;
const caret = (s: DemoState, target: string) => s.focus === target ? <i className="dm-caret" /> : null;

function Shell({ active, children }: { active: "projects" | "clients" | "chat"; children: ReactNode }) {
  const nav: [typeof active | "styles", string, ReactNode][] = [["projects", "Projects", <FolderOpen key="p" size={14} />], ["clients", "Clients", <Users key="c" size={14} />], ["styles", "Styles", <Palette key="s" size={14} />], ["chat", "Expert chat", <MessageCircle key="e" size={14} />]];
  return <div className="dm-app">
    <aside className="dm-side"><div className="dm-logo"><BrandMark size={20} />Makeborne</div><div className="dm-new"><Plus size={13} />New project</div>
      <small>My workspace</small>{nav.map(([id, label, icon]) => <div key={id} className={`dm-nav${id === active ? " is-on" : ""}`}>{icon}{label}</div>)}</aside>
    <main className="dm-main">{children}</main>
  </div>;
}
const Toast = ({ text }: { text: string }) => text ? <div className="dm-toast"><Check size={14} />{text}</div> : null;

function Composer({ s, placeholder }: { s: DemoState; placeholder: string }) {
  const formats: [string, string, ReactNode][] = [["website", "Website", <Globe2 key="w" size={14} />], ["book", "Book", <BookOpen key="b" size={14} />], ["presentation", "Presentation", <Presentation key="p" size={14} />]];
  const files = (s.files as string[] | undefined) ?? [];
  return <div className="dm-hero">
    <h1>What will you make next?</h1>
    <div className="dm-switch">{formats.map(([id, label, icon]) => <span key={id} data-demo={`fmt-${id}`} className={s.format === id ? "is-on" : ""}>{icon}{label}</span>)}</div>
    <div className="dm-composer">
      <div className="dm-textarea" data-demo="brief" data-demo-aim="left">{t(s.brief) ? <>{t(s.brief)}{caret(s, "brief")}</> : <em>{placeholder}</em>}</div>
      {files.length > 0 && <div className="dm-files">{files.map(file => <span key={file}><FileText size={12} />{file}</span>)}</div>}
      <div className="dm-controls">
        <span className="dm-icon" data-demo="attach"><Paperclip size={14} /></span>
        {/* The app's own controls: same classes, and the real effort slider. */}
        <div className="composer-mode"><button type="button" tabIndex={-1} aria-pressed={s.mode !== "plan"}><Sparkles size={14} />Create</button><button type="button" tabIndex={-1} data-demo="mode-plan" aria-pressed={s.mode === "plan"}><ListChecks size={14} />Plan</button></div>
        <button type="button" tabIndex={-1} className="creation-effort-trigger" data-demo="effort" aria-expanded={Boolean(s.effortOpen)}><span className="creation-effort-label">Effort</span><span>{EFFORT_PRESENTATION[effortOf(s)].label}</span><ChevronDown size={14} /></button>
        {Boolean(s.effortOpen) && <div className="creation-effort-panel dm-effort-panel"><EffortControl value={effortOf(s)} variant="menu" onChange={() => undefined} /></div>}
        <span className={`dm-go${t(s.brief) ? " is-ready" : ""}`} data-demo="create">{s.mode === "plan" ? "Plan" : "Create"}<ArrowUp size={13} /></span>
      </div>
    </div>
  </div>;
}

const CreateWebsite: Scene = ({ s }) => {
  if (s.view === "compose") return <div className="dm-page"><Composer s={s} placeholder="A beautiful website for my business, with…" /></div>;
  const build = Number(s.build), steps = ["Planning pages", "Writing copy", "Designing sections", "Checking on mobile"];
  return <Shell active="projects"><div className="dm-editor">
    <div className="dm-chat">
      <div className="dm-msg is-user">A website for Bloom &amp; Co, a flower studio in Sarajevo…</div>
      <ul className="dm-steps">{steps.map((step, index) => <li key={step} className={index + 1 < build || build >= 4 ? "is-done" : index + 1 === build ? "is-now" : ""}><span>{index + 1 < build || build >= 4 ? <Check size={10} /> : null}</span>{step}</li>)}</ul>
      {Boolean(s.edited) && <div className="dm-msg is-user">Make the hero warmer and add our opening hours</div>}
      {Boolean(s.edited) && <div className="dm-msg">Done: warmer hero colours and an Opening hours section.</div>}
      <div className="dm-input" data-demo="edit" data-demo-aim="left">{t(s.edit) ? <>{t(s.edit)}{caret(s, "edit")}</> : <em>Ask for a change…</em>}<span className="dm-send" data-demo="send"><Send size={12} /></span></div>
    </div>
    <div className="dm-preview">
      <div className="dm-site">
        <nav><b>Bloom &amp; Co</b><span>Bouquets</span><span>Weddings</span><span>Order</span></nav>
        <div className={`dm-site-hero${build >= 2 ? " is-in" : ""}${s.edited ? " is-warm" : ""}`}><div><small>FLOWER STUDIO · SARAJEVO</small><h2>Flowers for every moment.</h2><span>Order a bouquet</span></div></div>
        <div className={`dm-site-row${build >= 3 ? " is-in" : ""}`}><i /><i /><i /></div>
        {Boolean(s.edited) && <div className="dm-site-hours is-in"><b>Opening hours</b><span>Mon–Sat · 9:00–19:00</span></div>}
      </div>
    </div>
  </div></Shell>;
};

const MakeBook: Scene = ({ s }) => {
  if (s.view === "compose") return <div className="dm-page"><Composer s={s} placeholder="Describe your book…" /></div>;
  if (s.view === "plan") return <Shell active="projects"><div className="dm-plan">
    <span className="dm-eyebrow">BOOK PLAN</span><h2>The Café Owner’s First Year</h2><p>For first-time owners · warm, practical tone · from your notes</p>
    <ol data-demo="chapters">{["Finding your concept", "Choosing a location", "Menu and suppliers", "Hiring your first team", "Opening week", "Numbers that matter", "Growing regulars", "Your first profitable year"].map(chapter => <li key={chapter}>{chapter}</li>)}</ol>
    <span className="dm-primary" data-demo="approve">Approve plan and create</span>
  </div></Shell>;
  return <Shell active="projects"><div className="dm-book">
    <div className="dm-book-bar"><b>The Café Owner’s First Year</b><span className="dm-pill" data-demo="export"><Download size={12} />Export</span>
      {Boolean(s.menu) && <div className="dm-menu dm-export"><span data-demo="export-pdf">PDF for print</span></div>}</div>
    <div className="dm-spread"><div className="dm-pagel"><small>CHAPTER 1</small><h3>Finding your concept</h3><p /><p /><p className="short" /><p /><p /></div>
      <div className="dm-pager"><p /><p /><p className="short" /><blockquote>“Start with the customer you want on a quiet Tuesday.”</blockquote><p /><p /></div></div>
    <Toast text={t(s.toast)} />
  </div></Shell>;
};

const MakePresentation: Scene = ({ s }) => {
  if (s.view === "compose") return <div className="dm-page"><Composer s={s} placeholder="Describe your presentation…" /></div>;
  const titles = ["Q3 board update", "Revenue up 18%", "Revenue by month", "Two new markets", "Q4 hiring plan", "Next steps"];
  return <Shell active="projects"><div className="dm-deck">
    <div className="dm-book-bar"><b>Q3 board update</b><span className="dm-pill" data-demo="export"><Download size={12} />Export</span>
      {Boolean(s.menu) && <div className="dm-menu dm-export"><span>PDF</span><span data-demo="export-pptx">PowerPoint (.pptx)</span></div>}</div>
    <div className="dm-slides">{titles.slice(0, Number(s.slides)).map((title, index) => <div key={title} data-demo={`slide-${index + 1}`} className={`dm-slide${s.selected === index + 1 ? " is-on" : ""}`}>
      <small>{String(index + 1).padStart(2, "0")}</small><b>{title}</b>
      {index === 2 && s.chart ? <div className="dm-bars">{[38, 52, 47, 66, 74, 88].map(height => <i key={height} style={{ height: `${height}%` }} />)}</div> : <><p /><p className="short" /></>}
    </div>)}</div>
    <div className="dm-input dm-deck-input" data-demo="edit" data-demo-aim="left">{t(s.edit) ? <>{t(s.edit)}{caret(s, "edit")}</> : <em>{s.selected ? "Ask for a change to slide 3…" : "Ask for a change…"}</em>}<span className="dm-send" data-demo="send"><Send size={12} /></span></div>
    <Toast text={t(s.toast)} />
  </div></Shell>;
};

const PEOPLE = [
  { name: "Lena Petrović", company: "Studio Lena", stage: "Lead", follow: "Today", score: 74 },
  { name: "Amra Delić", company: "Bistro Mlin", stage: "Contacted", follow: "Overdue · 2 days", score: 61 },
  { name: "Marko Horvat", company: "Kovač Legal", stage: "Conversation", follow: "Fri", score: 66 },
  { name: "Ines Marić", company: "Green Bikes", stage: "Proposal", follow: "Mon", score: 79 },
];
function ClientsHead({ s, finder = false }: { s: DemoState; finder?: boolean }) {
  return <div className="dm-clients-head"><div><small>YOUR CLIENT RELATIONSHIPS</small><h2>Good work starts with people.</h2></div>
    <div className="dm-actions"><span className="dm-pill" data-demo="find"><Search size={12} />Find <kbd>Ctrl K</kbd></span>{finder && <span className="dm-pill is-accent" data-demo="find-leads"><Sparkles size={12} />Find leads</span>}<span className="dm-primary small"><Plus size={12} />Add client</span></div>
    <div className="dm-tabs"><span className={s.layout !== "board" && s.tab !== "email" ? "is-on" : ""}><List size={12} />List</span><span data-demo="tab-pipeline" className={s.layout === "board" ? "is-on" : ""}><Columns3 size={12} />Pipeline</span><span data-demo="tab-email" className={s.tab === "email" ? "is-on" : ""}><Mail size={12} />Email</span></div>
  </div>;
}

const CrmPipeline: Scene = ({ s }) => <Shell active="clients"><div className="dm-clients">
  <ClientsHead s={s} />
  {s.layout === "list" ? <>
    <div className="dm-buckets"><span>All clients <b>22</b></span><span data-demo="tab-overdue" className="is-warn">Overdue <b>3</b></span><span>Due today <b>1</b></span><span>Upcoming <b>6</b></span></div>
    <div className="dm-list">{PEOPLE.map(person => <div className="dm-row" key={person.name}><span className="dm-av">{person.name[0]}</span><span className="dm-who"><b>{person.name}</b><small>{person.company}</small></span><span className="dm-stage">{person.stage}</span><span className="dm-score">{person.score}</span><small className={person.follow.startsWith("Overdue") ? "is-warn" : ""}>{person.follow}</small></div>)}</div>
  </> : <div className="dm-board">{["Lead", "Contacted", "Conversation", "Proposal"].map(stage => <div className="dm-col" key={stage} data-demo={`col-${stage.toLowerCase()}`}><b>{stage}</b>
    {PEOPLE.filter(person => (person.name === "Lena Petrović" && s.moved ? "Contacted" : person.stage) === stage).map(person => <div key={person.name} className={`dm-card${s.dragging === "card-lena" && person.name === "Lena Petrović" ? " is-placeholder" : ""}`} data-demo={person.name === "Lena Petrović" ? "card-lena" : undefined}><b>{person.name}</b><small>{person.company}</small><span>{person.name === "Lena Petrović" && s.moved ? "Follow up in 3 days" : person.follow}</span></div>)}
  </div>)}</div>}
  {Boolean(s.palette) && <div className="dm-palette"><div className="dm-input" data-demo="palette" data-demo-aim="left"><Search size={13} />{t(s.query) || <em>Find a client or action…</em>}{caret(s, "palette")}</div>
    {t(s.query) && <div className="dm-hit"><span className="dm-av">L</span><b>Lena Petrović</b><small>Studio Lena · Contacted</small></div>}<div className="dm-hit"><Plus size={13} />Add a client</div><div className="dm-hit"><Sparkles size={13} />Find new leads</div></div>}
  <Toast text={t(s.toast)} />
</div></Shell>;

const LEADS = [
  { name: "Riverside Family Dental", fit: 86, why: "Busy family clinic; site has no online booking yet.", angle: "Your reviews praise the kids’ room: put it front and centre with a Book now button.", email: "hello@riversidedental.com" },
  { name: "Barton Creek Smiles", fit: 78, why: "Two locations, dated website, strong local reviews.", angle: "One site for both locations, with booking per clinic.", email: "info@bartoncreeksmiles.com" },
  { name: "Eastside Dental Studio", fit: 71, why: "New practice, building its patient base.", angle: "A launch page that turns your grand-opening offer into bookings.", email: "team@eastsidedental.studio" },
  { name: "Lakeline Orthodontics", fit: 58, why: "Good site already; booking via phone only.", angle: "Add online consult requests to the site you have.", email: "office@lakelineortho.com" },
];
const FindLeads: Scene = ({ s }) => <Shell active="clients"><div className="dm-clients">
  <ClientsHead s={s} finder />
  <div className="dm-list dm-faded">{PEOPLE.slice(0, 3).map(person => <div className="dm-row" key={person.name}><span className="dm-av">{person.name[0]}</span><span className="dm-who"><b>{person.name}</b><small>{person.company}</small></span><span className="dm-stage">{person.stage}</span></div>)}</div>
  {Boolean(s.modal) && <div className="dm-modal"><div className={`dm-sheet${s.results ? " is-results" : ""}`}>
    <small className="dm-eyebrow"><Sparkles size={11} /> LEAD FINDER</small><h3>{s.added ? "Added 4 leads to your clients" : "Find new leads"}</h3>
    {!s.results ? <>
      <div className="dm-seg dm-modes"><b className="is-on"><MapPin size={12} />Local businesses</b><b><List size={12} />From your list</b></div>
      <div className="dm-fields"><label>What kind of business?<div className="dm-field" data-demo="niche" data-demo-aim="left">{t(s.niche) || <em>Dentists, yoga studios…</em>}{caret(s, "niche")}</div></label>
        <label>Where?<div className="dm-field" data-demo="place" data-demo-aim="left">{t(s.place) || <em>City</em>}{caret(s, "place")}</div></label></div>
      <label>What do you offer them?<div className="dm-field" data-demo="offer" data-demo-aim="left">{t(s.offer) || <em>Optional, sharpens the ranking</em>}{caret(s, "offer")}</div></label>
      <div className="dm-findrow"><small>About <b>6 credits</b>. You pay only for leads delivered.</small><span className="dm-primary" data-demo="find"><Search size={12} />Find leads</span></div>
      {Number(s.run) > 0 && <div className="dm-progress"><i style={{ width: `${[0, 25, 60, 88][Number(s.run)]}%` }} /><ol>{["Search the map", "Read their pages", "Rank for your offer"].map((step, index) => <li key={step} className={index + 1 < Number(s.run) ? "is-done" : index + 1 === Number(s.run) ? "is-now" : ""}>{step}</li>)}</ol></div>}
    </> : <>
      <div className="dm-summary"><b>{LEADS.length} leads · Dentists in Austin</b><span>6 credits used</span></div>
      <div className="dm-leads">{LEADS.map((lead, index) => { const picked = index < 3 || Boolean(s.pick4); return <div key={lead.name} className={`dm-lead${picked ? " is-picked" : ""}`} data-demo={`lead-${index + 1}`}>
        <span className={`dm-check${picked ? " is-on" : ""}`} data-demo={`lead-${index + 1}-check`}>{picked && <Check size={10} />}</span>
        <span className={`dm-fit ${lead.fit >= 70 ? "is-hot" : "is-warm"}`}>{lead.fit}</span>
        <div><b>{lead.name}</b><p>{lead.why}</p><p className="dm-angle"><Sparkles size={10} />{lead.angle}</p><span className="dm-mail"><Mail size={10} />{lead.email}</span></div>
      </div>; })}</div>
      <div className="dm-findrow"><small>Business listings © OpenStreetMap contributors</small><span className="dm-primary" data-demo="add">{s.added ? <><Check size={12} />Added</> : <>Add {s.pick4 ? 4 : 3} to clients</>}</span></div>
    </>}
  </div></div>}
</div></Shell>;

const EMAILS = [
  { name: "Lena Petrović", subject: "Your ceramics deserve a shop that sells while you sleep", body: "Hi Lena, I loved the new glaze series you posted on Sunday. 48K people follow your studio, but the bio link goes to a form…" },
  { name: "Amra Delić", subject: "A quick idea for Bistro Mlin’s lunch crowd", body: "Hi Amra, your seasonal menu photos are great. Right now the menu lives in a PDF, so phones show it tiny…" },
  { name: "Ines Marić", subject: "Green Bikes: rentals booked online?", body: "Hi Ines, saw you’re adding e-bikes this spring. Most rental shops lose bookings on Sundays when no one answers…" },
];
const PersonalEmails: Scene = ({ s }) => <Shell active="clients"><div className="dm-clients">
  <ClientsHead s={s} />
  {Number(s.selected) > 0 && !s.queue && <div className="dm-bulk"><b>{t(s.selected)} selected</b><span className="dm-primary small" data-demo="bulk-write"><Sparkles size={12} />Write personal emails</span><span className="dm-pill">Add to sequence</span></div>}
  <div className="dm-list">{PEOPLE.slice(0, 3).map((person, index) => <div className="dm-row" key={person.name}><span className={`dm-check${Number(s.selected) > index ? " is-on" : ""}`} data-demo={`check-${index + 1}`}>{Number(s.selected) > index && <Check size={10} />}</span><span className="dm-av">{person.name[0]}</span><span className="dm-who"><b>{person.name}</b><small>{person.company}</small></span><span className="dm-stage">{person.stage}</span></div>)}</div>
  {Boolean(s.queue) && <div className="dm-modal"><div className="dm-sheet is-wide">
    <small className="dm-eyebrow"><Sparkles size={11} /> PERSONAL EMAILS</small><h3>3 emails, each written for one person</h3>
    <div className="dm-findrow"><span className="dm-pill">Angle: <b>Their audience’s value</b><ChevronDown size={11} /></span><span className="dm-pill is-check"><Check size={11} />Read public profiles</span>{!Number(s.gen) && <span className="dm-primary" data-demo="generate"><Sparkles size={12} />Write 3 emails</span>}</div>
    <div className="dm-emails">{EMAILS.map((email, index) => <div key={email.name} className="dm-email" data-demo={`email-${index + 1}`}>
      <small>To {email.name}</small>{Number(s.gen) > index ? <><b>{email.subject}</b><p>{email.body}</p>{Boolean(s.sent) && <span className="dm-sent"><Check size={10} />Sent</span>}</> : <><i className="dm-shimmer" /><i className="dm-shimmer short" /></>}
    </div>)}</div>
    <div className="dm-findrow"><small><b className="dm-free">Sending is free.</b> Writing used 1 credit.</small><span className="dm-primary" data-demo="send-all"><Send size={12} />{s.sent ? "Sent 3" : "Send all 3"}</span></div>
  </div></div>}
</div></Shell>;

const ConnectEmail: Scene = ({ s }) => <Shell active="clients"><div className="dm-clients">
  <ClientsHead s={s} />
  {s.tab !== "email" ? <div className="dm-list">{PEOPLE.map(person => <div className="dm-row" key={person.name}><span className="dm-av">{person.name[0]}</span><span className="dm-who"><b>{person.name}</b><small>{person.company}</small></span><span className="dm-stage">{person.stage}</span></div>)}</div>
  : <div className="dm-mailcenter">
    <div className="dm-card-lg"><b>Mailboxes</b>{s.connected ? <div className="dm-mailbox"><Mail size={14} /><div><b>studio@bloomandco.ba</b><small data-demo="quota">Gmail · 0/20 sent today (warming up) · reply tracking on</small></div><Check size={14} className="dm-ok" /></div>
      : <div className="dm-findrow"><span className="dm-primary" data-demo="connect-gmail"><AtSign size={12} />Connect Gmail</span><span className="dm-pill">Connect Outlook</span></div>}
      <small className="dm-free">Sending is free. Only AI writing uses credits.</small></div>
    <div className="dm-card-lg"><div className="dm-findrow"><b>Sequences</b><span className="dm-pill" data-demo="new-sequence"><Workflow size={12} />New sequence</span></div>
      {s.seq ? <ol className="dm-seq"><li><b>Day 0</b>Quick idea for {"{{company}}"}</li><li><b>Day 3</b>One example of what I meant</li><li><b>Day 7</b>A useful tip either way</li><li><b>Day 14</b>I’ll stop here</li><li className="dm-stop">Stops automatically when they reply</li></ol> : <small>No sequences yet.</small>}</div>
  </div>}
  {Boolean(s.sheet) && <div className="dm-modal"><div className="dm-sheet dm-consent"><small>Your email provider</small><h3>Allow Makeborne to send email for you?</h3>
    <ul><li><Check size={12} />Send email on your behalf</li><li><Check size={12} />See replies to the emails it sends</li></ul><div className="dm-findrow"><span className="dm-pill">Cancel</span><span className="dm-primary" data-demo="allow">Allow</span></div></div></div>}
</div></Shell>;

const ADVISORS = [["mira", "Mira", "Positioning & brand"], ["nova", "Nova", "Copywriting"], ["rex", "Rex", "Sales & outreach"], ["juno", "Juno", "Offers & pricing"], ["theo", "Theo", "Growth & launches"]] as const;
const ANSWER = ["Price the outcome, not the pages. For a local restaurant, a new site usually earns its cost back through bookings and catering enquiries.",
  "Offer three tiers: **Essentials** (menu, hours, map), **Bookings** (+ table reservations and events) and **Growth** (+ monthly updates and photos).",
  "Anchor with the middle tier, show what one extra booking a week is worth to them, and give a clear deposit and timeline."];
const Advisors: Scene = ({ s }) => <div className="dm-advisors">
  <aside><div className="dm-logo"><BrandMark size={20} />Makeborne</div><small>Your advisors</small>{ADVISORS.map(([id, name, field]) => <div key={id} data-demo={`adv-${id}`} className={`dm-adv${s.expert === id ? " is-on" : ""}`}><span className={`dm-blob is-${id}`} /><div><b>{name}</b><small>{field}</small></div></div>)}</aside>
  <main>
    <header><b>{s.expert === "juno" ? "Juno" : "Mira"}</b><small>{s.expert === "juno" ? "Offers & pricing" : "Positioning & brand"}</small><span className="dm-seg"><b className={s.genius ? "" : "is-on"}>Standard</b><b data-demo="genius" className={s.genius ? "is-on" : ""}><Gem size={11} />Genius</b></span></header>
    {!s.asked ? <div className="dm-adv-intro"><span className={`dm-blob big is-${t(s.expert)}`} /><h3>{s.expert === "juno" ? "Charge what the work is worth." : "A sharper position starts with a better question."}</h3>
      <div className="dm-suggest"><span data-demo="suggest-1">How should I price a website for a local restaurant?</span><span>Should I offer a monthly retainer?</span></div></div>
    : <div className="dm-thread"><div className="dm-msg is-user">How should I price a website for a local restaurant?</div>
      <div className="dm-msg">{ANSWER.slice(0, Number(s.ans)).map(line => <p key={line}>{line.split("**").map((part, index) => index % 2 ? <b key={part}>{part}</b> : part)}</p>)}{Number(s.ans) < 3 && <i className="dm-dots"><span /><span /><span /></i>}</div>
      {Number(s.ans) >= 3 && <small className="dm-cost">{s.genius ? "Genius is on for your next question" : "0.4 credits"}</small>}</div>}
    <div className="dm-input">Ask Juno about offers & pricing…<span className="dm-send"><ArrowUp size={12} /></span></div>
  </main>
</div>;

const ReviewLink: Scene = ({ s }) => s.view === "client" ? <div className="dm-review">
  <header><b>Bloom &amp; Co · website</b><small>Shared by Mila Hart Studio for your review</small></header>
  <div className="dm-review-body"><div className="dm-site small"><nav><b>Bloom &amp; Co</b><span>Bouquets</span><span>Order</span></nav><div className="dm-site-hero is-in"><div><h2>Flowers for every moment.</h2></div></div></div>
    <aside><b>Your feedback</b>{s.posted ? <div className="dm-comment">{t(s.comment)}</div> : <div className="dm-field tall" data-demo="comment" data-demo-aim="left">{t(s.comment) || <em>Add a comment…</em>}{caret(s, "comment")}</div>}
      <div className="dm-findrow"><span className="dm-pill" data-demo="post">Post comment</span><span className={`dm-primary${s.approved ? " is-done" : ""}`} data-demo="approve">{s.approved ? <><Check size={12} />Approved</> : "Approve"}</span></div></aside></div>
</div> : <Shell active="projects"><div className="dm-project">
  <div className="dm-book-bar"><b>Bloom &amp; Co · website</b><span className={`dm-status${s.status === "Delivered" ? " is-done" : ""}`}>{t(s.status)}</span><span className="dm-pill" data-demo="share"><Users size={12} />Share for review</span></div>
  <div className="dm-site"><nav><b>Bloom &amp; Co</b><span>Bouquets</span><span>Weddings</span><span>Order</span></nav><div className="dm-site-hero is-in"><div><small>FLOWER STUDIO · SARAJEVO</small><h2>Flowers for every moment.</h2><span>Order a bouquet</span></div></div><div className="dm-site-row is-in"><i /><i /><i /></div></div>
  {Boolean(s.panel) && <div className="dm-panel"><b>Share for review</b><small>Latest version · anyone with the link can view and comment</small>
    <div className="dm-link"><span>makeborne.com/review/k7Q2…</span><span className="dm-pill" data-demo="copy">{s.copied ? <><Check size={11} />Copied</> : <><Copy size={11} />Copy link</>}</span></div>
    {s.status === "Delivered" && <><div className="dm-comment"><b>Client:</b> Love it! Could the logo be a little larger?</div><div className="dm-comment is-ok"><Check size={11} />Approved version 3</div></>}</div>}
</div></Shell>;

const Publish: Scene = ({ s }) => <Shell active="projects"><div className="dm-project">
  <div className="dm-book-bar"><b>Bloom &amp; Co · website</b>{s.live ? <span className="dm-status is-done"><Globe2 size={11} />Live</span> : <span className="dm-status">Draft</span>}<span className="dm-primary small" data-demo="publish"><Globe2 size={12} />{s.live ? "Republish" : "Publish"}</span></div>
  <div className="dm-site"><nav><b>Bloom &amp; Co</b><span>Bouquets</span><span>Weddings</span><span>Order</span></nav><div className="dm-site-hero is-in is-warm"><div><small>FLOWER STUDIO · SARAJEVO</small><h2>Flowers for every moment.</h2><span>Order a bouquet</span></div></div><div className="dm-site-row is-in"><i /><i /><i /></div></div>
  {Boolean(s.dialog) && <div className="dm-modal"><div className="dm-sheet"><h3>Publish your website</h3><label>Web address<div className="dm-field dm-slug" data-demo="slug" data-demo-aim="left"><span>sites.makeborne.com/</span>{t(s.slug) || <em>your-name</em>}{caret(s, "slug")}</div></label>
    <small>Unlimited websites on every plan · remove the small Makeborne badge in Settings</small><div className="dm-findrow"><span className="dm-pill">Cancel</span><span className="dm-primary" data-demo="go-live"><Globe2 size={12} />Publish</span></div></div></div>}
  {Boolean(s.live) && <div className="dm-toast"><Check size={14} />Live at sites.makeborne.com/bloom-and-co</div>}
</div></Shell>;

export const SCENES: Record<DemoId, Scene> = {
  "create-website": CreateWebsite, "make-book": MakeBook, presentation: MakePresentation, "crm-pipeline": CrmPipeline, "find-leads": FindLeads,
  "personal-emails": PersonalEmails, "connect-email": ConnectEmail, advisors: Advisors, "review-link": ReviewLink, publish: Publish,
};

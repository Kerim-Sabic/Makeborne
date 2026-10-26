import type { DemoId } from "@/components/help-demo/scripts";
import { GROWTH_GUIDES } from "./growth-guides";
import { COMPARISONS } from "./comparisons";

/**
 * Help center articles. Written answer-first (the opening answer is what
 * search and answer engines quote), with numbered steps, short sections and
 * real questions. Keep every claim true to what ships; update `updated`.
 */
export type HelpCategory = "create" | "clients" | "grow" | "compare" | "advisors" | "account";
export type HelpArticle = {
  slug: string;
  title: string;
  /** Meta description: one or two sentences, under ~160 characters. */
  description: string;
  category: HelpCategory;
  updated: string;
  /** Extra words people use when they ask about this (for the help search). */
  keywords: string[];
  /** The short, direct answer shown first. */
  answer: string;
  demo?: DemoId;
  steps?: { name: string; text: string }[];
  sections?: { heading: string; paragraphs?: string[]; list?: string[]; table?: { caption: string; columns: string[]; rows: string[][] } }[];
  /** Official sources for statements about other products (comparison guides). */
  sources?: { label: string; url: string }[];
  faqs?: { q: string; a: string }[];
  related?: string[];
};

export const HELP_CATEGORIES: { id: HelpCategory; label: string; blurb: string }[] = [
  { id: "create", label: "Create", blurb: "Websites, books and presentations from a short brief." },
  { id: "clients", label: "Clients & outreach", blurb: "Your CRM, new leads, personal emails and follow-ups." },
  { id: "grow", label: "Grow your business", blurb: "Win clients: prospecting, outreach, follow-ups, pricing and approvals." },
  { id: "compare", label: "Comparisons", blurb: "How Makeborne compares with other AI builders, checked against their official docs." },
  { id: "advisors", label: "AI advisors", blurb: "Specialist advice on brand, copy, sales, pricing and more." },
  { id: "account", label: "Plans & credits", blurb: "What things cost and how credits work." },
];

const UPDATED = "2026-10-14";

const CORE_ARTICLES: HelpArticle[] = [
  {
    slug: "create-a-website-with-ai", category: "create", updated: UPDATED, demo: "create-website",
    title: "How to create a website with AI in Makeborne",
    description: "Describe your business in a few sentences, choose an effort level and press Create. Makeborne plans, writes and designs the site, then you edit it by asking.",
    keywords: ["website", "build a website", "make a site", "landing page", "web page", "generate website", "ai website builder", "homepage"],
    answer: "Choose Website, describe your business, who it is for and what visitors should do, then press Create. Makeborne plans the pages, writes the copy and designs each section while you watch a live preview. When it is done, ask for changes in plain words, then publish it to a Makeborne web address.",
    steps: [
      { name: "Choose Website", text: "On the home page or in the studio, pick Website in the format switch." },
      { name: "Write a short brief", text: "Say what the business does, who it serves, the pages you need and the one action visitors should take, such as booking or ordering." },
      { name: "Pick a style and effort (optional)", text: "Choose a visual style from the gallery, and an effort level from Light to Ultra. Higher effort gives more planning and review." },
      { name: "Press Create", text: "Makeborne plans the pages and builds them. The preview fills in section by section." },
      { name: "Edit by asking", text: "Type a change such as “make the hero warmer and add opening hours” and it is applied to the live preview." },
      { name: "Publish", text: "When you are happy, publish it. You can republish after every change." },
    ],
    sections: [
      { heading: "What to put in your brief", paragraphs: ["Real details make the difference: your name, what you sell, where you are, your opening hours, prices you are happy to show, and how people should contact you. Supply your own facts and testimonials rather than asking for invented ones."] },
      { heading: "What you get", list: ["A complete, responsive website with real copy written from your brief.", "A live preview that you can change by asking.", "Publishing to a Makeborne address, unlimited websites on every plan (fair use applies)."] },
    ],
    faqs: [
      { q: "How long does it take?", a: "Most websites are planned and built in a few minutes. Higher effort levels take longer because they plan and review more." },
      { q: "Can I edit the text myself?", a: "Yes. Ask for any change in plain words, and you can keep refining until it reads exactly right." },
      { q: "Do I need to know how to code?", a: "No. You describe what you want; Makeborne writes and designs it." },
    ],
    related: ["write-a-great-brief", "plan-create-and-effort", "publish-your-website"],
  },
  {
    slug: "write-a-great-brief", category: "create", updated: UPDATED, demo: "create-website",
    title: "How to write a great brief for an AI website, book or presentation",
    description: "A good brief names the audience, the goal and your real content. Use this simple checklist and example to get a better first result.",
    keywords: ["prompt", "brief", "what to write", "instructions", "description", "better results", "example prompt"],
    answer: "Say who it is for, what it should achieve and what it must include, using your real facts. One or two short paragraphs are enough: the audience, the goal (for example more bookings), the sections or chapters you need, your tone, and any facts, prices or quotes to use word for word.",
    steps: [
      { name: "Name the audience", text: "Who will read or visit it, and what do they care about?" },
      { name: "State the goal", text: "What should happen next: book, buy, enquire, approve a budget, learn a skill?" },
      { name: "List must-haves", text: "Pages, chapters or slides you definitely need." },
      { name: "Add your real content", text: "Facts, figures, prices, opening hours, testimonials and names. Attach documents if you have them." },
      { name: "Set the tone", text: "For example warm and practical, or formal and precise." },
    ],
    sections: [
      { heading: "Example", paragraphs: ["“A website for Bloom & Co, a flower studio in Sarajevo. Visitors are couples planning weddings and people sending gifts. Goal: online orders. Pages: bouquets, weddings, about, order form. Tone: warm and elegant. We deliver same day within the city and are open Monday to Saturday, 9:00–19:00.”"] },
      { heading: "Avoid", list: ["Asking for invented reviews, results or statistics.", "Very long briefs that mix several projects. Make one project at a time."] },
    ],
    faqs: [
      { q: "How long should a brief be?", a: "Usually 50–200 words. Add attachments for longer source material instead of pasting everything." },
      { q: "Should I use Plan or Create?", a: "Use Plan when you want to review the outline first; use Create when your brief is already clear." },
    ],
    related: ["create-a-website-with-ai", "attach-files-to-your-brief", "plan-create-and-effort"],
  },
  {
    slug: "make-a-book-with-ai", category: "create", updated: UPDATED, demo: "make-book",
    title: "How to make a book with AI and export it as a PDF",
    description: "Describe your book, attach your notes, review the chapter plan, and Makeborne writes and typesets it. Export a typeset PDF.",
    keywords: ["book", "ebook", "e-book", "guide", "write a book", "pdf", "print", "chapters", "lead magnet", "workbook"],
    answer: "Choose Book, describe the book and its reader, attach any notes or drafts, and choose Plan to review the chapters first. Approve the plan and Makeborne writes and typesets the book with editorial typography. Read it in the preview, ask for changes, and export a typeset PDF.",
    steps: [
      { name: "Choose Book", text: "Switch the format to Book." },
      { name: "Describe the book", text: "Topic, reader, purpose and tone. For example: a practical guide for first-time café owners." },
      { name: "Attach your material", text: "Add notes, outlines or existing drafts so the book is built from your knowledge." },
      { name: "Choose Plan", text: "Review the proposed title and chapters, then approve or adjust them." },
      { name: "Read and refine", text: "Read the typeset pages in the preview and ask for changes to any chapter." },
      { name: "Export a PDF", text: "Download a typeset PDF to share, sell as an ebook or use as a lead magnet." },
    ],
    sections: [
      { heading: "Good uses", list: ["Guides and handbooks for your clients.", "Lead magnets and e-books for your website.", "Course workbooks and internal playbooks."] },
    ],
    faqs: [
      { q: "Can I use my own writing?", a: "Yes. Attach it and say whether to keep your wording, improve it, or summarise it." },
      { q: "What format is the export?", a: "A 6 × 9 inch PDF laid out for reading, with chapters, contents and consistent typography. Paperback print files (bleed, cover wrap and printer preflight) are not included." },
    ],
    related: ["attach-files-to-your-brief", "plan-create-and-effort", "make-a-presentation-with-ai"],
  },
  {
    slug: "make-a-presentation-with-ai", category: "create", updated: UPDATED, demo: "presentation",
    title: "How to make a presentation with AI and export it to PowerPoint",
    description: "Paste your talking points and facts, and Makeborne designs the slides with speaker notes and charts. Export a PDF or an editable PowerPoint file.",
    keywords: ["presentation", "slides", "deck", "pitch deck", "powerpoint", "pptx", "keynote", "slide deck", "charts"],
    answer: "Choose Presentation, paste your talking points and the facts to use, and press Create. Slides appear one by one with speaker notes. Select any slide to ask for a change, such as turning numbers into a chart, then download a PDF or an editable PowerPoint (.pptx) file.",
    steps: [
      { name: "Choose Presentation", text: "Pick Presentation in the format switch." },
      { name: "Give it the substance", text: "Paste your talking points, the facts and numbers to use, and who the audience is." },
      { name: "Create", text: "Slides are designed one by one, with speaker notes." },
      { name: "Edit a slide", text: "Select it and ask for a change in plain words." },
      { name: "Export", text: "Download a PDF, or a PowerPoint file you can keep editing." },
    ],
    faqs: [
      { q: "Are charts editable in PowerPoint?", a: "Charts are exported as native PowerPoint charts where supported, so you can update the numbers there." },
      { q: "Will it make up numbers?", a: "Give it your real figures. Where something is missing, ask it to leave a clear placeholder rather than invent data." },
    ],
    related: ["write-a-great-brief", "make-a-book-with-ai", "share-work-for-client-review"],
  },
  {
    slug: "plan-create-and-effort", category: "create", updated: UPDATED, demo: "make-book",
    title: "Plan vs Create, and what the effort levels do",
    description: "Plan shows you an outline to approve first; Create starts straight away. Effort runs from Light to Ultra and sets how much planning and review the work gets.",
    keywords: ["plan", "create", "effort", "light", "medium", "high", "super high", "ultra", "quality", "thinking"],
    answer: "Plan proposes an outline (pages, chapters or slides) for you to approve before anything is written; Create starts building straight from your brief. Effort runs from Light to Ultra: higher effort gives the work more planning and review, takes longer and can use more credits. It does not guarantee a better result.",
    sections: [
      { heading: "Effort levels", list: ["Light: focused work for small changes and clear requests.", "Medium: a balanced approach for everyday creation.", "High: more room to plan and review detailed work.", "Super high: deeper planning and review for complex projects.", "Ultra: the largest planning and review allowance for demanding work."] },
      { heading: "Which to choose", paragraphs: ["Start with Medium. Use Plan for longer books and presentations so you can steer the structure early. Raise the effort for complex, multi-page work."] },
    ],
    faqs: [{ q: "Does higher effort cost more?", a: "It can, because the work does more planning and review. Your credit balance is shown in the studio." }],
    related: ["write-a-great-brief", "credits-and-pricing"],
  },
  {
    slug: "attach-files-to-your-brief", category: "create", updated: UPDATED,
    title: "How to attach documents and images to your brief",
    description: "Add PDFs, images and other source files to a brief: up to 10 files, 25 MB each and 100 MB in total.",
    keywords: ["attach", "upload", "files", "pdf", "images", "documents", "source material", "photos", "logo"],
    answer: "Use the paperclip in the composer, or drag files onto it. You can attach up to 10 files per brief, each up to 25 MB and 100 MB in total. Attach notes, drafts, brand guides or photos, and say in your brief how they should be used. Keep your originals.",
    steps: [
      { name: "Open the composer", text: "On the home page or in the studio, start a new website, book or presentation." },
      { name: "Add files", text: "Choose the paperclip, or drag files onto the composer. Each file shows as a chip you can remove." },
      { name: "Say how to use them", text: "For example: “use the menu PDF for prices” or “keep my wording from the attached draft”." },
      { name: "Create or Plan", text: "Your files travel with the brief into the studio." },
    ],
    sections: [{ heading: "Limits", list: ["Up to 10 files per brief.", "Up to 25 MB per file.", "Up to 100 MB in total."] }],
    faqs: [
      { q: "Which files work best?", a: "Text documents and PDFs for content, and images such as photos or logos for visuals." },
      { q: "Should I still write a brief?", a: "Yes. Say what the files are and how to use them, for example “use the menu PDF for prices”." },
    ],
    related: ["write-a-great-brief", "make-a-book-with-ai"],
  },
  {
    slug: "publish-your-website", category: "create", updated: UPDATED, demo: "publish",
    title: "How to publish your website",
    description: "Publish a finished website to a Makeborne web address, republish after changes, and remove the small Makeborne badge in Settings.",
    keywords: ["publish", "go live", "hosting", "web address", "url", "domain", "badge", "republish", "launch site"],
    answer: "Open the website, choose Publish, pick its web address and confirm. When publishing is available for your account, the reviewed version goes live on a Makeborne address; until then the Publish tab says so and your website stays saved. Republish after any change and the address stays the same. Every plan includes unlimited websites with fair use, and you can remove the small “Made with Makeborne” badge in Studio → Settings.",
    steps: [
      { name: "Open the website", text: "From Projects, open the website you want to publish." },
      { name: "Choose Publish", text: "Pick a web address for it." },
      { name: "Confirm", text: "Publish the reviewed version. If publishing is still being prepared, the Publish tab says so." },
      { name: "Republish after changes", text: "Edits stay private until you republish; the address does not change." },
    ],
    faqs: [
      { q: "How many websites can I publish?", a: "Unlimited on every plan, with fair use: up to 50 new websites per day and 1,000 live websites per workspace." },
      { q: "Can I remove the Makeborne badge?", a: "Yes. Turn it off in Studio → Settings → Website badge." },
      { q: "Can I use my own domain?", a: "Today each website gets a Makeborne web address." },
    ],
    related: ["create-a-website-with-ai", "share-work-for-client-review"],
  },
  {
    slug: "share-work-for-client-review", category: "clients", updated: UPDATED, demo: "review-link",
    title: "How to share work with a client for review and approval",
    description: "Send a review link so your client can comment and approve a website, book or presentation, with no account needed. Approval marks the project Delivered.",
    keywords: ["review", "approval", "feedback", "share", "client link", "comments", "approve", "sign off", "proof"],
    answer: "Open the project, choose Client review in the ••• menu at the top right, create a review link, then copy it and send it to your client. They can view the latest version (or a specific one), leave comments and approve it or request changes, without creating an account. Approval marks the project Delivered; a change request marks it Changes requested.",
    steps: [
      { name: "Open the project", text: "Go to the website, book or presentation." },
      { name: "Choose Client review", text: "In the project’s ••• menu at the top right. Pick the latest version or a specific one, then Create review link." },
      { name: "Copy and send the link", text: "Email or message it to your client." },
      { name: "Read feedback", text: "Comments and the client’s decision appear on the project, and you can resolve comments as you act on them." },
    ],
    faqs: [
      { q: "Does my client need an account?", a: "No. Anyone with the link can view and comment." },
      { q: "What happens when they approve?", a: "The approval is recorded with the version number and the project is marked Delivered." },
    ],
    related: ["manage-clients-and-follow-ups", "publish-your-website"],
  },
  {
    slug: "manage-clients-and-follow-ups", category: "clients", updated: UPDATED, demo: "crm-pipeline",
    title: "How to manage clients, pipeline stages and follow-ups",
    description: "Keep every client, conversation and next step in Makeborne’s built-in CRM: a list with follow-up reminders, a drag-and-drop pipeline, lead scores and Ctrl+K search.",
    keywords: ["crm", "clients", "pipeline", "follow up", "reminders", "stages", "kanban", "board", "lead score", "deal", "overdue", "ctrl k"],
    answer: "Open Clients. The list shows every client with their stage and next follow-up, grouped into overdue, due today and upcoming. Switch to Pipeline to drag deals between Lead, Contacted, Conversation, Proposal, Won and Lost. Press Ctrl+K (⌘K on Mac) to jump to any client or action.",
    steps: [
      { name: "Add or import clients", text: "Add one at a time, import a CSV, or use Find leads." },
      { name: "Set the stage and next follow-up", text: "Each client has a stage and a follow-up date. Quick actions log a contact or snooze the follow-up in one click." },
      { name: "Work the follow-up views", text: "Start each day with Overdue and Due today." },
      { name: "Use the pipeline", text: "Drag cards between stages as deals move. Column totals show deal value." },
    ],
    sections: [
      { heading: "Lead scores", paragraphs: ["Each open client gets a transparent 0–100 score: stage, whether you have their email, deal value, audience size and how much you know about them. Hot is 70 and above, warm 45–69, cold below 45. Hover a score to see the reasons."] },
      { heading: "Tags, deal value and source", paragraphs: ["Tag clients (for example “dentists” or “wedding season”), record a deal value and currency, and note where the lead came from. Filter the list by tag."] },
    ],
    faqs: [
      { q: "Do won and lost clients get reminders?", a: "No. Closed clients are left out of follow-up views so your list stays focused." },
      { q: "Can my team use it?", a: "Workspace members see the same clients according to their role; reviewers can read but not change records." },
    ],
    related: ["import-clients-from-csv", "find-new-leads", "send-personal-outreach-emails"],
  },
  {
    slug: "import-clients-from-csv", category: "clients", updated: UPDATED,
    title: "How to import clients from a CSV or spreadsheet",
    description: "Import names, companies, emails, websites, Instagram profiles, notes and tags from a CSV exported from Excel, Google Sheets or another CRM.",
    keywords: ["import", "csv", "excel", "google sheets", "spreadsheet", "upload contacts", "export", "migrate"],
    answer: "In Clients, choose the upload button (or Ctrl+K → Import clients from CSV) and pick your file. Makeborne recognises common column names such as Name, Company, Email, Website, Notes, Instagram or Profile, and Tags, shows you what it found, and imports the valid rows. You can export your clients to CSV at any time.",
    sections: [
      { heading: "Recognised columns", list: ["Name (or First and Last name)", "Company or Organisation", "Email", "Website", "Notes or Comments", "Instagram, handle or profile link", "Tags, labels or lists (separated by commas or semicolons)"] },
      { heading: "Tips", list: ["Save as CSV (UTF-8) to keep accents correct.", "Files can be up to 2 MB; split larger lists.", "Rows without a name are skipped and listed so you can fix them."] },
    ],
    faqs: [{ q: "Will it create duplicates?", a: "Check the preview before importing; rows already in your list are best removed from the file first." }],
    related: ["manage-clients-and-follow-ups", "find-new-leads"],
  },
  {
    slug: "find-new-leads", category: "clients", updated: UPDATED, demo: "find-leads",
    title: "How to find new leads for your business",
    description: "Find local businesses by niche and city or read your own list of profile links and websites. Creator discovery is temporarily unavailable.",
    keywords: ["leads", "find clients", "prospects", "lead generation", "prospecting", "local businesses", "new customers", "lead finder", "outreach list", "instagram creators", "influencers", "tiktok creators", "youtubers", "find creators"],
    answer: "In Clients, choose Find leads. Pick Local businesses (a niche and a city) or paste your own list of profile links and websites. Add what you offer. Makeborne searches the map or reads your list, finds public contact details, skips people already in your CRM and ranks each lead for fit. You pay for delivered leads plus confirmed AI ranking, rounded up together once. Creator discovery, web fallback and More like this are temporarily unavailable.",
    steps: [
      { name: "Open Find leads", text: "In Clients, choose Find leads (or press Ctrl+K and search for it)." },
      { name: "Choose a source", text: "Local businesses (niche and city) or From your list (handles, profile links or websites). Creator discovery is temporarily unavailable." },
      { name: "Describe your offer", text: "One sentence on what you sell sharpens the ranking and the opening ideas." },
      { name: "Find leads", text: "Watch it search, read each page and rank the results." },
      { name: "Add the best ones", text: "Tick the leads you want, choose a tag, and add them to your clients. Adding is free." },
    ],
    sections: [
      { heading: "What each lead includes", list: ["A fit score for your offer, with the reason in one line.", "An opening idea that references something real about them.", "Public contact details: email (and where it was published), website, profile and phone when listed."] },
      { heading: "Current availability", paragraphs: ["Creator discovery, More like this and web fallback are temporarily unavailable while search spending limits are verified. The discovery roadmap includes searching Instagram, TikTok and YouTube by niche. You can currently search local businesses on the map or paste profiles and websites you already know."] },
      { heading: "Where the data comes from", paragraphs: ["Local businesses come from OpenStreetMap listings (© OpenStreetMap contributors). Lists you paste are read from the pages you provide. Websites and Instagram profiles are read, TikTok profiles and YouTube channels are confirmed with the platform, and anything that can’t be confirmed is left out. A busy map returns a retryable error rather than switching to web search."] },
      { heading: "Contacting leads responsibly", paragraphs: ["Use business contact details for relevant, personal outreach, include who you are, and stop when someone asks. Follow the email and privacy rules that apply where you and your leads are."] },
    ],
    faqs: [
      { q: "How much does it cost?", a: "Delivered leads cost 0.2 credits each, plus confirmed AI ranking. The combined total is rounded up once to a whole credit. Searches that return no new leads cost nothing." },
      { q: "Why did I get fewer leads than I asked for?", a: "Only reachable businesses not already in your CRM are delivered. Try a nearby city or a related niche." },
      { q: "Can it find Instagram creators?", a: "Creator discovery by niche is temporarily unavailable while search spending limits are verified. Paste Instagram, TikTok or YouTube profile links in From your list to read profiles you have already found." },
      { q: "Why don’t TikTok and YouTube leads show follower counts?", a: "Those platforms don’t show counts to automated readers. Profiles are still confirmed as real, and Instagram profiles show their follower count." },
    ],
    related: ["send-personal-outreach-emails", "manage-clients-and-follow-ups", "connect-gmail-or-outlook"],
  },
  {
    slug: "send-personal-outreach-emails", category: "clients", updated: UPDATED, demo: "personal-emails",
    title: "How to send a personalised email to each lead with AI",
    description: "Select leads, choose Write personal emails, and AI writes a different email for each person from their public profile. Review, edit and send from your inbox.",
    keywords: ["personalised email", "personalized email", "cold email", "outreach", "bulk email", "ai email", "write emails", "email campaign", "send emails", "email my clients", "email clients", "email leads"],
    answer: "Tick the leads you want to reach in Clients and choose Write personal emails. Pick an angle, keep Read public profiles on, and AI (Claude Haiku) reads each lead’s public page and writes a different email for each person. Review and edit them, then send from your connected Gmail or Outlook. Writing uses a small amount of credits; sending is free.",
    steps: [
      { name: "Select leads", text: "Tick them in the client list." },
      { name: "Write personal emails", text: "Choose the outreach angle and add any notes about your offer." },
      { name: "Review each email", text: "Every email has notes on why it was written that way and what to check. Edit freely." },
      { name: "Send", text: "Send from your own mailbox, one by one or all at once. Sending is free." },
    ],
    sections: [{ heading: "What makes them personal", paragraphs: ["Each email starts from something specific and real: a recent post, their audience, a detail from their website. Facts it could not verify are left out, and low-confidence emails are flagged for you to check."] }],
    faqs: [
      { q: "How much does it cost?", a: "Writing uses a fraction of a credit per email. Sending is always free." },
      { q: "Does it send automatically?", a: "No. You review each email before it goes. Automated sequence sending is disabled for the current launch." },
    ],
    related: ["connect-gmail-or-outlook", "find-new-leads", "ask-an-ai-advisor"],
  },
  {
    slug: "connect-gmail-or-outlook", category: "clients", updated: UPDATED, demo: "connect-email",
    title: "How to connect Gmail or Outlook and manage follow-ups",
    description: "Connect your Gmail or Outlook to send emails from Makeborne. Gmail is currently send-only, and automated sequence sending is disabled for launch.",
    keywords: ["gmail", "outlook", "microsoft 365", "connect email", "mailbox", "sequence", "follow-up", "automation", "automate", "automatic follow", "automate follow ups", "drip", "reply tracking", "warm up"],
    answer: "In Clients, open Email and choose Connect Gmail or Connect Outlook, then approve access with your provider. Emails are sent from your own address. Gmail is currently send-only: read replies in Gmail and update the client yourself. Automated sequence sending is disabled for the current launch. Use CRM follow-up dates and send reviewed messages manually.",
    steps: [
      { name: "Open Email", text: "In Clients, switch to the Email view." },
      { name: "Connect your mailbox", text: "Choose Gmail or Outlook and approve access on your provider’s screen." },
      { name: "Send one-to-one", text: "From any client’s Email tab, write or generate an email and send it." },
      { name: "Plan a manual follow-up", text: "Set a follow-up date in the CRM and review your inbox before sending. Automated sequence sending is disabled for launch." },
    ],
    sections: [{ heading: "Sending limits and warm-up", paragraphs: ["To protect your sender reputation, new mailboxes start with a few emails a day and the limit rises over the following days, up to the mailbox’s daily maximum. Emails are spaced out rather than sent in one burst."] }],
    faqs: [
      { q: "Is sending free?", a: "Sending uses no credits. Only AI writing does. Gmail reply tracking is unavailable and automated sequence sending is disabled for launch." },
      { q: "Can I disconnect?", a: "Yes. Disconnect the mailbox in Email, and you can also revoke access in your Google or Microsoft account." },
      { q: "What happens when someone replies?", a: "Gmail is send-only, so replies stay in Gmail and you update the client yourself. Reply handling depends on your mailbox’s supported connection. Automated sequence sending is disabled for launch; check your inbox before each manual follow-up." },
    ],
    related: ["send-personal-outreach-emails", "manage-clients-and-follow-ups"],
  },
  {
    slug: "ask-an-ai-advisor", category: "advisors", updated: UPDATED, demo: "advisors",
    title: "How to get advice from Makeborne’s AI advisors",
    description: "Eight AI advisors, each limited to one field: brand, copy, sales, pricing, growth, research, product and delivery. Standard answers usually cost under one credit.",
    keywords: ["advisor", "expert", "chat", "advice", "consultant", "pricing advice", "marketing advice", "genius mode", "ask ai"],
    answer: "Open Expert chat, pick the advisor for your question and ask in plain words. Each advisor answers only within their field and gives advice, not finished work. Standard answers use a fast model and usually cost under one credit; Genius uses the most capable model for harder questions and costs more.",
    sections: [
      { heading: "The advisors", list: ["Mira: positioning & brand", "Nova: copywriting", "Rex: sales & outreach", "Juno: offers & pricing", "Theo: growth & launches", "Atlas: research & insight", "Ellis: product & strategy", "Sage: client delivery & operations"] },
      { heading: "Getting better answers", list: ["Give context: your business, your client, the numbers you have.", "Ask one question at a time.", "If a question belongs to another field, the advisor will say who to ask."] },
    ],
    faqs: [
      { q: "What is Genius mode?", a: "A deeper-thinking mode for complex questions. It costs more credits per answer than Standard." },
      { q: "Are conversations private?", a: "Your conversations are kept for you in your browser and are not shown to other workspace members." },
    ],
    related: ["send-personal-outreach-emails", "credits-and-pricing"],
  },
  {
    slug: "credits-and-pricing", category: "account", updated: UPDATED,
    title: "How credits and plans work in Makeborne",
    description: "Plans from US$20 a month include monthly credits for AI work. Sending email, publishing and the CRM use none. Unused credits carry over for two months.",
    keywords: ["credits", "pricing", "plans", "cost", "subscription", "billing", "top up", "credit pack", "refund", "carry over", "how much"],
    answer: "Every plan includes everything; plans differ only in monthly credits for AI work: creating and editing projects, personalised emails, lead finding and advisor answers. Sending email, publishing and the CRM itself use no credits. Automated sequence sending is disabled for the current launch. Unused plan credits carry over for two months. One-time credit packs are planned for members after launch.",
    sections: [
      { heading: "Plans", list: ["Create: US$20 per month, 300 credits.", "Studio: US$49 per month, 750 credits.", "Scale: US$99 per month, 1,550 credits.", "Prices are in US dollars. Any tax or checkout fee is shown by Whop before you pay.", "Yearly plans, when offered at checkout, cost 20% less than twelve monthly payments. They are billed once a year upfront, and their credits are released each month."] },
      { heading: "What uses credits", list: ["Creating and editing websites, books and presentations (more for larger work and higher effort).", "Advisor answers: Standard usually under one credit; Genius more.", "Personal emails: a fraction of a credit each.", "Lead finding: 0.2 credits per delivered lead plus confirmed AI ranking, with the combined total rounded up once. Creator discovery is temporarily unavailable."] },
      { heading: "What is free", list: ["Sending emails. Gmail is currently send-only; automated sequence sending is disabled for launch.", "Publishing and hosting websites (fair use).", "The CRM, client reviews and lead research of a single profile."] },
    ],
    faqs: [
      { q: "Do unused credits expire?", a: "Plan credits carry over for two months after the month they were granted." },
      { q: "Can I get a refund?", a: "Yes, for a payment whose credits are all unused: a subscription payment or a credit pack. Each payment is checked on its own, and the credits expiring soonest are used first. Contact support with your Whop payment reference; support holds that payment's credits and refunds it through Whop. See Subscriptions, pricing and refunds for the full terms." },
    ],
    related: ["plan-create-and-effort", "find-new-leads", "ask-an-ai-advisor"],
  },
];

export const HELP_ARTICLES: HelpArticle[] = [...CORE_ARTICLES, ...GROWTH_GUIDES, ...COMPARISONS];

export const helpArticle = (slug: string) => HELP_ARTICLES.find(article => article.slug === slug) ?? null;

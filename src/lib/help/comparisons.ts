import type { HelpArticle } from "./articles";

/**
 * Comparison guides. Every statement about another product comes from
 * docs/release-review/competitor-verification-20261013.json (official
 * documentation, checked 13 October 2026) and respects its corrections:
 * no "nobody else does this", no superiority claims, Makeborne's gaps stated.
 * "—" means "not covered in the official pages we checked", never "no".
 */
const UPDATED = "2026-10-14";
const CHECKED = "13 October 2026";
const METHOD = { heading: "How we compared", paragraphs: [`We read each product’s official documentation and pricing pages on ${CHECKED}. A dash (—) means the feature wasn’t covered in the pages we checked, not that the product lacks it. Products change often, so check their current pages, and remember that feature lists don’t measure the quality of what each tool makes: try both on a real project.`] };
const SOURCES = {
  lovable: [{ label: "Lovable: subscription plans", url: "https://docs.lovable.dev/introduction/subscription-plans" }, { label: "Lovable: generate files", url: "https://docs.lovable.dev/features/generate-files" }, { label: "Lovable: credits and usage", url: "https://docs.lovable.dev/introduction/credits-and-usage" }],
  bolt: [{ label: "Bolt: hosting", url: "https://support.bolt.new/cloud/hosting" }, { label: "Bolt: analytics", url: "https://support.bolt.new/cloud/hosting/analytics" }, { label: "Bolt: slides", url: "https://support.bolt.new/use-cases/slides" }, { label: "Bolt: plan mode", url: "https://support.bolt.new/best-practices/plan-mode" }, { label: "Bolt: upload files", url: "https://support.bolt.new/building/upload-files" }],
  v0: [{ label: "v0: pricing", url: "https://v0.app/docs/pricing" }, { label: "v0: full-stack apps", url: "https://v0.app/docs/full-stack-apps" }, { label: "v0: GitHub", url: "https://v0.app/docs/github" }],
  framer: [{ label: "Framer: pricing", url: "https://www.framer.com/pricing" }],
  base44: [{ label: "Base44: pricing", url: "https://base44.com/pricing" }, { label: "Base44: credits", url: "https://docs.base44.com/Account-and-billing/Credits" }],
  gamma: [{ label: "Gamma: pricing", url: "https://gamma.app/pricing" }, { label: "Gamma: how credits work", url: "https://help.gamma.app/en/articles/7834324-how-do-credits-work-in-gamma" }, { label: "Gamma: exporting", url: "https://help.gamma.app/en/articles/8022861-what-s-the-easiest-way-to-export-my-gamma" }, { label: "Gamma: shapes", url: "https://help.gamma.app/en/articles/16951068-what-are-shapes-and-how-do-i-use-them" }],
};
const MAKEBORNE_GAPS = { heading: "Where Makeborne is not the right fit (yet)", list: ["Generated app backends, databases and user logins: Makeborne builds websites, books and presentations, not full-stack apps.", "Repository import or two-way code sync.", "Connecting your own domain to a published site.", "Visitor analytics for published sites."] };

export const COMPARISONS: HelpArticle[] = [
  {
    slug: "best-ai-website-builder-for-agencies", category: "compare", updated: UPDATED,
    title: "Best AI website builder for agencies: an honest comparison",
    description: "Makeborne, Lovable, Bolt, v0, Framer and Base44 compared for agencies and freelancers, from their official docs, including where each one fits best.",
    keywords: ["best ai website builder", "ai website builder for agencies", "website builder for freelancers", "lovable alternative", "bolt alternative", "framer alternative", "ai builder comparison", "compare ai builders"],
    answer: "It depends on what your agency sells. For full-stack apps with code workflows, Lovable, v0, Bolt and Base44 are built for that. For hand-crafted marketing sites with seats for your team, Framer. If you make websites, e-books and presentations for clients and also need to find, win and manage those clients, Makeborne combines creation with a CRM, lead finder, outreach and client approvals.",
    sections: [
      { heading: "At a glance", table: { caption: `Features documented on each product’s official pages (checked ${CHECKED}). — = not covered in the pages we checked.`,
        columns: ["", "Makeborne", "Lovable", "Bolt", "v0", "Framer", "Base44"],
        rows: [
          ["Full-stack apps (backend, database)", "No: websites, books, decks", "Yes", "—", "Yes", "—", "Yes: backend, auth, database"],
          ["Code workflow", "Not yet: no repo import or two-way sync", "GitHub sync, code editing, source download", "—", "Git imports, branches, previews, PRs", "—", "—"],
          ["Publishing and hosting", "Yes: unlimited sites, fair use", "—", "Yes", "—", "Yes, plan limits", "—"],
          ["Visitor analytics", "Not yet", "—", "Yes", "—", "Yes, plan limits", "Yes"],
          ["Presentations", "PDF and editable PowerPoint with native charts", "Browser presentations, PPTX/PDF download", "Slides editor with notes", "—", "—", "—"],
          ["Print-ready books (PDF)", "Yes", "—", "—", "—", "—", "—"],
          ["CRM, lead finder and email outreach", "Built in", "—", "—", "—", "—", "—"],
          ["Client review and approval", "Review links, no client account needed", "—", "—", "—", "Free viewer seats", "Collaboration"],
        ] } },
      { heading: "Choose by what you sell", list: ["Apps and internal tools for clients: Lovable, v0, Base44 or Bolt.", "Design-led marketing sites, built by a team in a visual editor: Framer.", "Websites, e-books and pitch decks for small businesses, plus finding and winning those clients: Makeborne."] },
      MAKEBORNE_GAPS, METHOD,
    ],
    faqs: [
      { q: "Is Makeborne a Lovable or Bolt alternative?", a: "For websites, books and decks, yes; for full-stack apps with databases and logins, no. Those tools are designed for apps." },
      { q: "Can I use more than one?", a: "Many agencies do: an app builder for product work, and Makeborne for client websites, content and the sales pipeline." },
    ],
    sources: [...SOURCES.lovable, ...SOURCES.bolt, ...SOURCES.v0, ...SOURCES.framer, ...SOURCES.base44],
    related: ["makeborne-vs-lovable", "makeborne-vs-bolt", "makeborne-vs-framer"],
  },
  {
    slug: "makeborne-vs-lovable", category: "compare", updated: UPDATED,
    title: "Makeborne vs Lovable: which should you use?",
    description: "Lovable builds websites and full-stack apps with GitHub sync; Makeborne builds websites, books and decks with a built-in CRM. How they differ, from official docs.",
    keywords: ["makeborne vs lovable", "lovable vs makeborne", "lovable alternative", "lovable comparison", "lovable for agencies"],
    answer: "Choose Lovable to build full-stack apps and keep working on the code: its docs cover GitHub sync, code editing and source download. Choose Makeborne if your work is websites, e-books and presentations for clients and you also want to find leads, send personal outreach, follow up and get approvals in the same place. Lovable also documents PPTX and PDF downloads of browser presentations.",
    sections: [
      { heading: "Side by side", table: { caption: `From official documentation, checked ${CHECKED}. — = not covered in the pages we checked.`, columns: ["", "Makeborne", "Lovable"], rows: [
        ["Websites from a prompt", "Yes", "Yes"],
        ["Full-stack apps", "No", "Yes"],
        ["Code access", "Not yet: no repo import or two-way sync", "GitHub sync, code editing, source download"],
        ["Attach documents and data", "Yes: up to 10 files per brief", "Yes"],
        ["Presentations", "PDF and editable PowerPoint with native charts", "Browser presentations, PPTX/PDF download"],
        ["Print-ready books", "Yes", "—"],
        ["CRM, lead finder, personal emails", "Built in", "—"],
        ["Client review links with approval", "Yes", "—"],
      ] } },
      MAKEBORNE_GAPS, METHOD,
    ],
    faqs: [{ q: "Which is better for a freelance web designer?", a: "If your clients need marketing websites and you want help winning them, Makeborne fits that workflow. If they need apps, Lovable is built for it." }],
    sources: SOURCES.lovable,
    related: ["best-ai-website-builder-for-agencies", "create-a-website-with-ai", "find-new-leads"],
  },
  {
    slug: "makeborne-vs-bolt", category: "compare", updated: UPDATED,
    title: "Makeborne vs Bolt: which should you use?",
    description: "Bolt documents hosting, analytics, a slides editor and plan mode; Makeborne adds print-ready books, editable PowerPoint and a built-in client CRM. An honest comparison.",
    keywords: ["makeborne vs bolt", "bolt vs makeborne", "bolt.new alternative", "bolt comparison", "bolt for agencies"],
    answer: "Bolt’s docs cover publishing and hosting, visitor analytics, a slides editor with notes, plan mode and file uploads, so it’s strong if you want analytics on what you publish. Makeborne covers websites, print-ready books and presentations you can export to editable PowerPoint, and adds a CRM with lead finding, personal outreach and client approvals for freelancers and agencies.",
    sections: [
      { heading: "Side by side", table: { caption: `From official documentation, checked ${CHECKED}. — = not covered in the pages we checked.`, columns: ["", "Makeborne", "Bolt"], rows: [
        ["Publishing and hosting", "Yes: unlimited sites, fair use", "Yes"],
        ["Visitor analytics", "Not yet", "Yes"],
        ["Plan before building", "Yes: Plan mode", "Yes: plan mode"],
        ["Attach files", "Yes", "Yes"],
        ["Slides", "Designed decks with notes; PDF and editable PowerPoint", "Slides editor with notes"],
        ["Editable PowerPoint export", "Yes, with native charts", "—"],
        ["Print-ready books", "Yes", "—"],
        ["CRM, lead finder, personal emails", "Built in", "—"],
      ] } },
      MAKEBORNE_GAPS, METHOD,
    ],
    faqs: [{ q: "Does Bolt have analytics?", a: "Yes, Bolt documents visitor and page analytics for hosted projects. Makeborne doesn’t offer site analytics yet." }],
    sources: SOURCES.bolt,
    related: ["best-ai-website-builder-for-agencies", "make-a-presentation-with-ai"],
  },
  {
    slug: "makeborne-vs-gamma", category: "compare", updated: UPDATED,
    title: "Makeborne vs Gamma for presentations",
    description: "Gamma documents PDF, PPTX and PNG export, editable shapes and analytics; Makeborne adds websites, books and a client CRM. Which fits your presentations?",
    keywords: ["makeborne vs gamma", "gamma vs makeborne", "gamma alternative", "ai presentation maker", "gamma app comparison", "ai slides"],
    answer: "If presentations are your main job, Gamma documents a lot for them: PDF, PPTX and PNG export, editable shapes and tables, analytics, and paid brand removal. Makeborne makes presentations too (PDF and editable PowerPoint with native charts), and the same account also makes websites and print-ready books and runs your client pipeline, outreach and approvals.",
    sections: [
      { heading: "Side by side", table: { caption: `From official documentation, checked ${CHECKED}. — = not covered in the pages we checked.`, columns: ["", "Makeborne", "Gamma"], rows: [
        ["Export", "PDF and editable PowerPoint (native charts)", "PDF, PPTX and PNG"],
        ["Editable shapes and tables", "Edit in PowerPoint after export", "Yes"],
        ["Presentation analytics", "Not yet", "Yes"],
        ["Credits", "Monthly credits that carry over two months; top-up packs", "Credit top-ups; bounded rollover"],
        ["Websites and print-ready books", "Yes", "—"],
        ["CRM, lead finder, personal emails", "Built in", "—"],
      ] } },
      METHOD,
    ],
    faqs: [{ q: "Can I edit Makeborne slides in PowerPoint?", a: "Yes. Export to .pptx and keep editing, including native charts where supported." }],
    sources: SOURCES.gamma,
    related: ["make-a-presentation-with-ai", "make-a-pitch-deck-with-ai"],
  },
  {
    slug: "makeborne-vs-framer", category: "compare", updated: UPDATED,
    title: "Makeborne vs Framer: which should you use?",
    description: "Framer documents editor seats with free viewers and hosting with analytics; Makeborne generates sites from a brief and adds books, decks and a client CRM.",
    keywords: ["makeborne vs framer", "framer vs makeborne", "framer alternative", "framer comparison", "framer for agencies"],
    answer: "Framer suits teams who design websites themselves in an editor: its pricing documents paid editor seats, free viewers, and hosting with analytics on plan-based limits. Makeborne starts from a short brief and builds the site for you, publishes it with unlimited sites (fair use), and also makes books and presentations and runs your client pipeline, outreach and approvals.",
    sections: [
      { heading: "Side by side", table: { caption: `From official documentation, checked ${CHECKED}. — = not covered in the pages we checked.`, columns: ["", "Makeborne", "Framer"], rows: [
        ["How sites are made", "Generated from a brief, edited by asking", "—"],
        ["Team access", "Workspace members by role; client review links", "Paid editor seats, free viewers"],
        ["Hosting", "Unlimited sites, fair use", "Yes, plan limits"],
        ["Analytics", "Not yet", "Yes, plan limits"],
        ["Books and presentations", "Yes", "—"],
        ["CRM, lead finder, personal emails", "Built in", "—"],
      ] } },
      MAKEBORNE_GAPS, METHOD,
    ],
    faqs: [{ q: "Is Makeborne a Framer alternative?", a: "For agencies who want sites built from a brief plus a sales pipeline, yes. For pixel-level design in a visual editor, Framer is built for that." }],
    sources: SOURCES.framer,
    related: ["best-ai-website-builder-for-agencies", "create-a-website-with-ai"],
  },
];

import type { Metadata } from "next";

/** Public identity shared by search metadata, the sitemap, and link previews. */
export const SITE = {
  name: "Makeborne",
  url: "https://makeborne.com",
  title: "Makeborne — Websites, books & presentations",
  description:
    "Create websites, books and presentations with AI, then win and keep clients with a built-in CRM: leads, follow-ups and email outreach from your own inbox.",
} as const;

export const IS_PREVIEW = process.env.VERCEL_ENV === "preview";

/** Only public, useful pages belong here. Never add customer projects or account URLs. */
export const PUBLIC_PATHS = ["/", "/done-for-you", "/help", "/billing", "/billing/terms", "/privacy"] as const;

export const PUBLIC_ROBOTS: Metadata["robots"] = {
  index: !IS_PREVIEW,
  follow: !IS_PREVIEW,
  googleBot: {
    index: !IS_PREVIEW,
    follow: !IS_PREVIEW,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
  },
};

/** Fixed public pages, plus help articles (listed in the sitemap from the help content). */
export type PublicPath = typeof PUBLIC_PATHS[number] | `/help/${string}`;

export function publicPageMetadata(path: PublicPath, title: string, description: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: PUBLIC_ROBOTS,
    openGraph: {
      type: "website",
      siteName: SITE.name,
      title,
      description,
      url: path,
      locale: "en_US",
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: SITE.title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: "/opengraph-image", alt: SITE.title }],
    },
  };
}

/** What Makeborne is, in plain words: used by structured data and the AI-facing overview (/llms.txt). Keep it true to what ships. */
export const SITE_FACTS = {
  summary: "Makeborne is an AI studio that turns a short brief into a real website, a designed book, or a presentation, and keeps client work, outreach and follow-ups in one built-in CRM.",
  audience: "Freelancers, studios, agencies and small businesses who create for themselves or for clients.",
  makes: [
    "Websites: generated as editable React projects, previewed live, published on Makeborne hosting (unlimited websites, fair use).",
    "Books: structured chapters with editorial typography, exported as a typeset PDF.",
    "Presentations: designed slides with speaker notes and native charts, exported as PDF or editable PowerPoint (PPTX).",
  ],
  crm: [
    "Client list, pipeline board and follow-up reminders (overdue, due today, upcoming).",
    "Lead profiles with tags, deal value, a transparent lead score and free research of a lead's public Instagram or website.",
    "One-to-one email from a connected Gmail account, subject to Google approval and account qualification. Gmail is sending-only; inbox reads and automatic sequences are disabled for launch. Outlook is deferred.",
    "AI-personalised outreach: a unique email for each selected lead, written from their record and public profile (uses credits).",
    "Lead finder: local businesses by niche and city from OpenStreetMap, or public pages from a pasted list. Reachable leads are verified, de-duplicated against the CRM and ranked for the user’s offer. Delivered leads cost 0.2 credits each plus confirmed AI ranking; the combined charge rounds up once. Creator discovery, look-alikes and web-search fallback are unavailable pending spending qualification.",
    "Client review links for approvals and comments.",
  ],
  advisors: "Eight AI advisors, each limited to one field: positioning and brand, copywriting, sales and outreach, offers and pricing, growth and launches, research, product strategy, and client delivery.",
} as const;

/** schema.org graph for the home page: organisation, website and the product with its public plans. */
export function siteStructuredData(plans: readonly { name: string; monthlyCents: number; monthlyCredits: number; description: string }[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${SITE.url}/#organization`, name: SITE.name, url: SITE.url, logo: `${SITE.url}/brand/makeborne-mark.svg`, email: "admin@makeborne.com" },
      { "@type": "WebSite", "@id": `${SITE.url}/#website`, name: SITE.name, url: SITE.url, description: SITE.description, inLanguage: "en", publisher: { "@id": `${SITE.url}/#organization` } },
      {
        "@type": "SoftwareApplication", "@id": `${SITE.url}/#app`, name: SITE.name, url: SITE.url, description: SITE_FACTS.summary,
        applicationCategory: "BusinessApplication", applicationSubCategory: "AI website, book and presentation builder with CRM", operatingSystem: "Web browser",
        audience: { "@type": "Audience", audienceType: SITE_FACTS.audience }, publisher: { "@id": `${SITE.url}/#organization` },
        featureList: [...SITE_FACTS.makes, ...SITE_FACTS.crm, SITE_FACTS.advisors],
        offers: plans.map(plan => ({ "@type": "Offer", name: plan.name, description: `${plan.description} ${plan.monthlyCredits} credits per month.`,
          price: (plan.monthlyCents / 100).toFixed(2), priceCurrency: "USD", url: `${SITE.url}/billing`, category: "subscription" })),
      },
    ],
  };
}

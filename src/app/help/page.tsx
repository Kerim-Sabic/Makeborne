import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Globe2, Presentation } from "lucide-react";
import BrandMark from "@/components/brand-mark";
import { publicPageMetadata, SITE } from "@/lib/site-metadata";
import styles from "./page.module.css";

const description = "A clear guide to Makeborne: website, book and presentation styles, project briefs, attached files, creation access and the optional coffee subscription.";
export const metadata: Metadata = {
  ...publicPageMetadata("/help", "Getting started with Makeborne", description),
  title: { absolute: "Getting started with Makeborne" },
};

const questions = [
  {
    id: "availability",
    question: "What can I use today?",
    answer: "Makeborne is currently in preview. You can explore the website, book and presentation styles and prepare a project brief. Live AI generation and creation memberships are not yet available for public use. The plans page shows their current availability before you make a payment.",
    href: "/billing#plans",
    link: "See plans and availability",
  },
  {
    id: "styles",
    question: "How does a selected style guide my project?",
    answer: "Choose a format, pick a style, then describe your own project. Your selected style carries its typography, palette, layout and image direction with the brief behind the scenes. You do not need to copy a template prompt. A preview illustrates the visual direction; it is not a finished project or a promise of an identical result.",
    href: "/#templates",
    link: "Explore the styles",
  },
  {
    id: "brief",
    question: "What should I put in my prompt?",
    answer: "Describe what you want to make, who it is for and what you want people to do after seeing it. Add your real content, brand details and any must-have pages or sections. For example: “A website for my dog store, with our products, our story and a contact page, in the style I selected.” Supply your own facts and proof rather than asking for invented reviews or results.",
  },
  {
    id: "plan-and-effort",
    question: "What do Plan, Create and effort mean?",
    answer: "Plan is the direction for working through your brief before creating. Create is the direction for starting from the brief you have already written. Effort runs from Light to Ultra and sets the allowance for planning and review when generation is enabled. More effort can require more credits and time; it does not guarantee a better result. These controls do not enable generation while it is unavailable.",
  },
  {
    id: "attachments",
    question: "Can I attach my own documents and images?",
    answer: "Yes. You can add PDFs, images and other source files to your brief: up to 10 files, 25 MB per file and 100 MB in total. Attachments are currently saved in this browser on this device. Keep your originals; attaching a file does not mean its contents have been read by AI or uploaded to cloud storage.",
  },
  {
    id: "account",
    question: "Do I need an account and a paid plan?",
    answer: "Creating projects requires a confirmed account and an active creation membership. If you begin with a prompt on the home page, Makeborne keeps that draft as you continue to sign in. Creation memberships remain unavailable until the generation and credit delivery services are activated.",
    href: "/login",
    link: "Go to your account",
  },
  {
    id: "coffee",
    question: "What does Pay a coffee include?",
    answer: "Pay a coffee is an optional US$1 monthly subscription that supports Makeborne’s development. Checkout is handled by Whop after you sign in. It does not include app access, AI credits or a creation membership. You can manage or cancel the subscription through your Whop account.",
    href: "/billing#support",
    link: "View optional support",
  },
  {
    id: "topups",
    question: "Can I add credits without changing my plan?",
    answer: "One-time credit packs are planned for customers with an active creation membership. You will be able to choose extra credits without upgrading your subscription or enabling automatic purchases. The pack selector currently shows preview prices; purchases will open when credit delivery is ready. Final prices, expiry and refund terms will be shown before purchase.",
    href: "/billing#topups",
    link: "View credit packs",
  },
  {
    id: "client-work",
    question: "How does Makeborne fit client work?",
    answer: "The client workspace is designed to connect each client’s contact details, outreach stage, notes, next follow-up and associated projects. Its purpose is to keep the brief and delivery history together. Workspace access follows the same creation-membership requirement; buying coffee support does not unlock it.",
  },
  {
    id: "publishing",
    question: "Can I publish a generated website yet?",
    answer: "Public self-service website publishing is not live yet. A style preview or an editor view is not a deployed customer website. We will make publishing availability, hosting limits and any domain requirements clear in the app before offering it as part of a paid creation plan.",
  },
] as const;

export default function HelpPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${SITE.url}/help#page`,
        url: `${SITE.url}/help`,
        name: "Getting started with Makeborne",
        description,
        inLanguage: "en",
        isPartOf: { "@id": `${SITE.url}/#website` },
        breadcrumb: { "@id": `${SITE.url}/help#breadcrumb` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${SITE.url}/help#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Makeborne", item: `${SITE.url}/` },
          { "@type": "ListItem", position: 2, name: "Getting started", item: `${SITE.url}/help` },
        ],
      },
    ],
  };

  return <div className={styles.page}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    <a href="#help-content" className={styles.skip}>Skip to content</a>
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="Makeborne home"><BrandMark size={28} /><span>Makeborne</span></Link>
      <nav aria-label="Main navigation"><Link href="/#templates">Styles</Link><Link href="/billing">Plans</Link><Link href="/login" className={styles.signIn}>Log in <ArrowUpRight size={14} aria-hidden="true" /></Link></nav>
    </header>
    <main id="help-content" className={styles.main}>
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}><Link href="/">Makeborne</Link><span aria-hidden="true">/</span><span aria-current="page">Getting started</span></nav>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>A LITTLE CLARITY</span>
        <h1>From your idea<br />to a clear direction.</h1>
        <p>What to bring, how styles work, and what you can use today.</p>
      </div>
      <section className={styles.formats} aria-label="What you can make with Makeborne">
        <article><Globe2 size={19} strokeWidth={1.6} aria-hidden="true" /><h2>Websites</h2><p>Start with your business, your audience and the pages you need.</p></article>
        <article><BookOpen size={19} strokeWidth={1.6} aria-hidden="true" /><h2>Books</h2><p>Bring your knowledge, source material and a sense of your reader.</p></article>
        <article><Presentation size={19} strokeWidth={1.6} aria-hidden="true" /><h2>Presentations</h2><p>Share your text, verified facts and the story you want to tell.</p></article>
      </section>
      <div className={styles.answers}>
        <aside><span className={styles.eyebrow}>GOOD TO KNOW</span><h2>A few useful<br />answers.</h2><p>Makeborne is in preview.<br />Here is where things stand.</p></aside>
        <div className={styles.questions}>{questions.map(({ id, question, answer, ...link }) => <section className={styles.question} id={id} key={id}>
          <h3>{question}</h3><p>{answer}</p>
          {"href" in link && <Link href={link.href}>{link.link} <ArrowUpRight size={13} aria-hidden="true" /></Link>}
        </section>)}</div>
      </div>
      <section className={styles.next} aria-labelledby="next-heading"><div><h2 id="next-heading">Find your starting point.</h2><p>Explore six visual directions for each format.</p></div><Link href="/#templates">Explore styles <ArrowUpRight size={16} aria-hidden="true" /></Link></section>
    </main>
    <footer className={styles.footer}><span>© 2026 Makeborne</span><nav aria-label="Footer navigation"><Link href="/">Home</Link><Link href="/billing">Plans &amp; credits</Link><Link href="#help-content">Back to top</Link></nav></footer>
  </div>;
}

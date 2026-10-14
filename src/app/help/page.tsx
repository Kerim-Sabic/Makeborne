import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import HelpAsk, { DemoGallery } from "@/components/help-demo/help-ask";
import { HELP_ARTICLES, HELP_CATEGORIES } from "@/lib/help/articles";
import { publicPageMetadata, SITE } from "@/lib/site-metadata";
import { HelpFooter, HelpHeader, JsonLd } from "./help-chrome";
import styles from "./page.module.css";

const title = "Makeborne Help Center: guides and how-tos";
const description = "Step-by-step guides with short demos: create websites, books and presentations with AI, find leads, send personal emails, manage clients and understand credits.";
export const metadata: Metadata = { ...publicPageMetadata("/help", title, description), title: { absolute: title } };

export default function HelpPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": `${SITE.url}/help#page`, url: `${SITE.url}/help`, name: title, description, inLanguage: "en",
        isPartOf: { "@id": `${SITE.url}/#website` }, breadcrumb: { "@id": `${SITE.url}/help#breadcrumb` }, mainEntity: { "@id": `${SITE.url}/help#guides` } },
      { "@type": "ItemList", "@id": `${SITE.url}/help#guides`, name: "Makeborne guides", numberOfItems: HELP_ARTICLES.length,
        itemListElement: HELP_ARTICLES.map((article, index) => ({ "@type": "ListItem", position: index + 1, url: `${SITE.url}/help/${article.slug}`, name: article.title })) },
      { "@type": "BreadcrumbList", "@id": `${SITE.url}/help#breadcrumb`, itemListElement: [
        { "@type": "ListItem", position: 1, name: "Makeborne", item: `${SITE.url}/` },
        { "@type": "ListItem", position: 2, name: "Help center", item: `${SITE.url}/help` },
      ] },
    ],
  };
  return <div className={styles.page}>
    <JsonLd data={structuredData} />
    <a href="#help-content" className={styles.skip}>Skip to content</a>
    <HelpHeader />
    <main id="help-content" className={styles.main}>
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}><Link href="/">Makeborne</Link><span aria-hidden="true">/</span><span aria-current="page">Help center</span></nav>
      <section className={styles.hero} aria-labelledby="help-title">
        <span className={styles.eyebrow}>Help center</span>
        <h1 id="help-title">How can we help?</h1>
        <p>Ask in your own words. Every guide comes with a short demo that shows exactly where to click.</p>
        <HelpAsk />
      </section>

      <section className={styles.section} aria-labelledby="watch-title">
        <div className={styles.sectionHead}><div><span className={styles.eyebrow}>See it in action</span><h2 id="watch-title">Watch how it works</h2></div>
          <p>Each demo replays the real steps in the app, so you know what to expect before you start.</p></div>
        <DemoGallery items={[{ id: "create-website", label: "Create a website" }, { id: "find-leads", label: "Find new leads" }, { id: "personal-emails", label: "Personal emails" }, { id: "presentation", label: "Make a presentation" }, { id: "crm-pipeline", label: "Clients & pipeline" }]} />
      </section>

      <section className={styles.section} aria-labelledby="guides-title">
        <div className={styles.sectionHead}><div><span className={styles.eyebrow}>All guides</span><h2 id="guides-title">Browse by topic</h2></div></div>
        <div className={styles.categories}>{HELP_CATEGORIES.map(category => <section key={category.id} className={styles.category} aria-labelledby={`cat-${category.id}`}>
          <h3 id={`cat-${category.id}`}>{category.label}</h3><p>{category.blurb}</p>
          <ul>{HELP_ARTICLES.filter(article => article.category === category.id).map(article => <li key={article.slug}><Link href={`/help/${article.slug}`}>{article.title}<ArrowRight size={14} aria-hidden="true" /></Link></li>)}</ul>
        </section>)}</div>
      </section>

      <section className={styles.contact} aria-labelledby="contact-title">
        <div><h2 id="contact-title">Still need a hand?</h2><p>Email <a href="mailto:admin@makeborne.com">admin@makeborne.com</a> and a person will reply.</p></div>
        <Link className={styles.cta} href="/studio">Open the studio <ArrowRight size={15} aria-hidden="true" /></Link>
      </section>
    </main>
    <HelpFooter />
  </div>;
}

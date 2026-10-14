import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import DemoPlayer from "@/components/help-demo/player";
import { captionsOf } from "@/components/help-demo/engine";
import { DEMO_SCRIPTS } from "@/components/help-demo/scripts";
import { HELP_ARTICLES, HELP_CATEGORIES, helpArticle } from "@/lib/help/articles";
import { publicPageMetadata, SITE } from "@/lib/site-metadata";
import { HelpFooter, HelpHeader, JsonLd } from "../help-chrome";
import styles from "../page.module.css";

export const dynamicParams = false;
export function generateStaticParams() { return HELP_ARTICLES.map(article => ({ slug: article.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const article = helpArticle((await params).slug);
  if (!article) return {};
  const base = publicPageMetadata(`/help/${article.slug}`, article.title, article.description);
  return { ...base, title: { absolute: `${article.title} | Makeborne Help` }, openGraph: { ...base.openGraph, type: "article", modifiedTime: article.updated } };
}

const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const article = helpArticle((await params).slug);
  if (!article) notFound();
  const url = `${SITE.url}/help/${article.slug}`;
  const category = HELP_CATEGORIES.find(item => item.id === article.category)!;
  const related = (article.related ?? []).map(helpArticle).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const text = [article.answer, ...(article.steps ?? []).map(step => step.text), ...(article.sections ?? []).flatMap(section => [...(section.paragraphs ?? []), ...(section.list ?? [])]), ...(article.faqs ?? []).map(faq => faq.a)].join(" ");
  const minutes = Math.max(1, Math.round(words(text) / 200));
  const demo = article.demo ? DEMO_SCRIPTS[article.demo] : null;

  const graph: Record<string, unknown>[] = [
    { "@type": "TechArticle", "@id": `${url}#article`, headline: article.title, description: article.description, url, inLanguage: "en", dateModified: article.updated,
      mainEntityOfPage: url, articleSection: category.label, keywords: article.keywords.join(", "), abstract: article.answer,
      author: { "@id": `${SITE.url}/#organization` }, publisher: { "@id": `${SITE.url}/#organization` }, isPartOf: { "@id": `${SITE.url}/help#page` }, about: { "@id": `${SITE.url}/#app` } },
    { "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`, itemListElement: [
      { "@type": "ListItem", position: 1, name: "Makeborne", item: `${SITE.url}/` },
      { "@type": "ListItem", position: 2, name: "Help center", item: `${SITE.url}/help` },
      { "@type": "ListItem", position: 3, name: article.title, item: url },
    ] },
    { "@type": "Organization", "@id": `${SITE.url}/#organization`, name: SITE.name, url: SITE.url, logo: `${SITE.url}/brand/makeborne-mark.svg` },
  ];
  if (article.steps?.length) graph.push({ "@type": "HowTo", "@id": `${url}#howto`, name: article.title, description: article.answer, totalTime: `PT${Math.max(2, article.steps.length)}M`,
    step: article.steps.map((step, index) => ({ "@type": "HowToStep", position: index + 1, name: step.name, text: step.text, url: `${url}#step-${index + 1}` })) });
  if (article.faqs?.length) graph.push({ "@type": "FAQPage", "@id": `${url}#faq`, mainEntity: article.faqs.map(faq => ({ "@type": "Question", name: faq.q, acceptedAnswer: { "@type": "Answer", text: faq.a } })) });

  return <div className={styles.page}>
    <JsonLd data={{ "@context": "https://schema.org", "@graph": graph }} />
    <a href="#help-content" className={styles.skip}>Skip to content</a>
    <HelpHeader />
    <main id="help-content" className={styles.main}>
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}><Link href="/">Makeborne</Link><span aria-hidden="true">/</span><Link href="/help">Help center</Link><span aria-hidden="true">/</span><span>{category.label}</span></nav>
      <div className={styles.article}>
        <article>
          <header><span className={styles.eyebrow}>{category.label}</span><h1>{article.title}</h1>
            <p className={styles.meta}>Updated <time dateTime={article.updated}>{longDate(article.updated)}</time> · {minutes} min read</p></header>
          <p className={styles.answer}><strong>Quick answer</strong>{article.answer}</p>
          {demo && <section className={styles.block} aria-labelledby="demo-title"><h2 id="demo-title">Watch how</h2><DemoPlayer id={article.demo!} />
            <noscript><ol>{captionsOf(demo).map(caption => <li key={caption}>{caption}</li>)}</ol></noscript></section>}
          {article.steps?.length ? <section className={styles.block} aria-labelledby="steps-title"><h2 id="steps-title">Step by step</h2>
            <ol className={styles.steps}>{article.steps.map((step, index) => <li key={step.name} id={`step-${index + 1}`}><h3>{step.name}</h3><p>{step.text}</p></li>)}</ol></section> : null}
          {article.sections?.map(section => <section key={section.heading} className={styles.block}><h2>{section.heading}</h2>
            {section.paragraphs?.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
            {section.list && <ul>{section.list.map(item => <li key={item}>{item}</li>)}</ul>}</section>)}
          {article.faqs?.length ? <section className={styles.block} aria-labelledby="faq-title"><h2 id="faq-title">Questions</h2>
            <div className={styles.faq}>{article.faqs.map(faq => <div key={faq.q}><h3>{faq.q}</h3><p>{faq.a}</p></div>)}</div></section> : null}
        </article>
        <aside className={styles.aside}>
          {related.length > 0 && <nav aria-labelledby="related-title"><h2 id="related-title">Related guides</h2><ul>{related.map(item => <li key={item.slug}><Link href={`/help/${item.slug}`}>{item.title}</Link></li>)}</ul></nav>}
          <div className={styles.asideCta}><p>Ready to try it? Your studio has everything in this guide.</p><Link href="/studio">Open the studio <ArrowRight size={14} aria-hidden="true" /></Link></div>
        </aside>
      </div>
    </main>
    <HelpFooter />
  </div>;
}

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { DFY_CONTACT, DFY_SUMMARY, DFY_TERMS, DFY_TIERS, usd } from "@/lib/done-for-you";
import { publicPageMetadata, SITE } from "@/lib/site-metadata";
import { HelpFooter, HelpHeader, JsonLd } from "../help/help-chrome";
import styles from "../help/page.module.css";
import dfy from "./page.module.css";

const title = "Done-for-you websites | Makeborne";
const description = "We design, build, host and maintain your website. You approve every page; every site ships with a measured before/after report. Plans from $249/month.";
export const metadata: Metadata = { ...publicPageMetadata("/done-for-you", title, description), title: { absolute: title } };

const auditHref = `mailto:${DFY_CONTACT}?subject=${encodeURIComponent("Free website audit")}&body=${encodeURIComponent("Website address:\nBusiness name:\n")}`;
const callHref = `mailto:${DFY_CONTACT}?subject=${encodeURIComponent("Done-for-you website: 15-minute call")}`;

const steps = [
  ["Free audit of your current site", "Real-visitor speed from Chrome's field data, a mobile Lighthouse test, structured data, sitemap, crawler access, and whether AI assistants cite you for the questions your customers ask. Yours to keep."],
  ["Design and build, with your approval", "We write, design and build the site. You review each page and nothing goes live until you approve it."],
  ["Launch, hosting and care", "We host, monitor and maintain the site, fix what breaks, and keep its technical SEO and structured data current."],
  ["A measured before/after report", "At 28 and 90 days we re-run the same checks: Core Web Vitals field data, Search Console, and the same AI-search questions. Only measured numbers, never estimates."],
] as const;

const measured = [
  ["Core Web Vitals (field data)", "How fast the site really is for visitors on phones, from the Chrome UX Report."],
  ["Lighthouse mobile", "Performance, SEO, accessibility and best-practice scores under the same mobile settings Google PageSpeed uses."],
  ["Search Console", "Clicks, impressions and indexed pages, compared with the 28 days before launch."],
  ["AI-search visibility", "A fixed set of questions asked to Perplexity and ChatGPT search, five runs each, recording who gets cited."],
] as const;

const faq = [
  ["What does the free audit include?", "The same checks we run on our own site: real-visitor speed, a mobile Lighthouse test, structured data, sitemap, crawler access for AI search, and AI citations for your services and city. It's a one-page PDF and it's yours whether or not we work together."],
  ["Can you promise rankings or AI citations?", "No. Rankings and AI answers depend on many things outside a website. We promise the work, and a report that shows what changed on measured numbers."],
  ["Can I keep my current site?", "Yes. Site Care fixes technical SEO and AI-search issues on the site you have, with a monthly measured report."],
  ["How do payments work?", `${DFY_TERMS[0]} ${DFY_TERMS[1]}`],
  ["We're a clinic. What about health information?", "If your site has forms that may collect health information, we build them on form and hosting vendors that will sign a BAA, and keep health information out of analytics tools."],
  ["Why is there no portfolio here?", "We'd rather show you measured facts about your own site than other people's logos. Ask for the free audit and judge the work on that."],
] as const;

export default function DoneForYouPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Service", "@id": `${SITE.url}/done-for-you#service`, name: "Done-for-you websites", serviceType: "Website design, build, hosting and maintenance",
        description: DFY_SUMMARY, url: `${SITE.url}/done-for-you`, provider: { "@id": `${SITE.url}/#organization` }, areaServed: { "@type": "Country", name: "United States" },
        offers: DFY_TIERS.map(tier => ({ "@type": "Offer", name: tier.name, description: `${tier.summary} ${tier.includes.join(", ")}.`, priceCurrency: "USD",
          priceSpecification: [
            ...(tier.build ? [{ "@type": "UnitPriceSpecification", name: "Build fee", price: tier.build, priceCurrency: "USD" }] : []),
            { "@type": "UnitPriceSpecification", name: "Monthly", price: tier.monthly, priceCurrency: "USD", billingDuration: "P1M", unitCode: "MON" },
          ] })) },
      { "@type": "FAQPage", "@id": `${SITE.url}/done-for-you#faq`, mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Makeborne", item: `${SITE.url}/` },
        { "@type": "ListItem", position: 2, name: "Done for you", item: `${SITE.url}/done-for-you` },
      ] },
    ],
  };

  return <div className={styles.page}>
    <JsonLd data={structuredData} />
    <a href="#dfy-content" className={styles.skip}>Skip to content</a>
    <HelpHeader />
    <main id="dfy-content" className={styles.main}>
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}><Link href="/">Makeborne</Link><span aria-hidden="true">/</span><span aria-current="page">Done for you</span></nav>

      <section className={styles.hero} aria-labelledby="dfy-title">
        <span className={styles.eyebrow}>Done for you</span>
        <h1 id="dfy-title">We build it. You approve it.</h1>
        <p>{DFY_SUMMARY}</p>
        <div className={dfy.ctas}>
          <a className={styles.cta} href={auditHref}>Get a free audit <ArrowRight size={15} aria-hidden="true" /></a>
          <a className={dfy.secondary} href={callHref}>Book a 15-minute call</a>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="dfy-how">
        <div className={styles.sectionHead}><div><span className={styles.eyebrow}>How it works</span><h2 id="dfy-how">From audit to measured results</h2></div>
          <p>One team does the work. You make the decisions.</p></div>
        <ol className={styles.steps}>{steps.map(([h, p]) => <li key={h}><h3>{h}</h3><p>{p}</p></li>)}</ol>
      </section>

      <section className={styles.section} aria-labelledby="dfy-pricing">
        <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Pricing</span><h2 id="dfy-pricing">Plans</h2></div>
          <p>{DFY_TERMS[0]} {DFY_TERMS[1]}</p></div>
        <div className={dfy.tiers}>
          {DFY_TIERS.map(tier => <article key={tier.id} className={dfy.tier} aria-labelledby={`tier-${tier.id}`}>
            <h3 id={`tier-${tier.id}`}>{tier.name}</h3>
            <p className={dfy.summary}>{tier.summary}</p>
            <p className={dfy.price}>{tier.build ? <><strong>{usd(tier.build)}</strong> build</> : <strong>No build fee</strong>}</p>
            <p className={dfy.monthly}>then {usd(tier.monthly)}/month</p>
            <ul>{tier.includes.map(item => <li key={item}><Check size={14} aria-hidden="true" />{item}</li>)}</ul>
          </article>)}
        </div>
        <p className={dfy.note}>{DFY_TERMS[2]}</p>
      </section>

      <section className={styles.section} aria-labelledby="dfy-measure">
        <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Measured, not claimed</span><h2 id="dfy-measure">What every report measures</h2></div>
          <p>The same checks before and after, so you can see what changed.</p></div>
        <div className={styles.categories}>{measured.map(([h, p]) => <div key={h} className={styles.category}><h3>{h}</h3><p>{p}</p></div>)}</div>
      </section>

      <section className={styles.section} aria-labelledby="dfy-faq">
        <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Questions</span><h2 id="dfy-faq">Before you ask</h2></div></div>
        <div className={styles.faq}>{faq.map(([q, a]) => <div key={q}><h3>{q}</h3><p>{a}</p></div>)}</div>
      </section>

      <section className={styles.contact} aria-labelledby="dfy-start">
        <div><h2 id="dfy-start">Start with a free audit</h2><p>Send us your website address. We&rsquo;ll reply with a one-page audit of your site.</p></div>
        <a className={styles.cta} href={auditHref}>Get a free audit <ArrowRight size={15} aria-hidden="true" /></a>
      </section>
    </main>
    <HelpFooter />
  </div>;
}

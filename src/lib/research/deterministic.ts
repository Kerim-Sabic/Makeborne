import type { ModelBrief, ModelClaim } from "./contract";
import type { Material, MaterialSource } from "./material";
import { isInjection } from "./page";
import { guardHit } from "./validate";

/**
 * The brief without AI assistance: every claim is a sentence or signal the
 * sources actually show, quoted word for word, plus clearly labelled
 * inferences from the automatic site check. It goes through the same
 * groundBrief validation as an assisted brief.
 */
const prefix = (text: string, max = 300) => text.length <= max ? text : text.slice(0, max).replace(/\s+\S*$/, "");
const fact = (text: string, source: MaterialSource, quote = text): ModelClaim => ({ text: prefix(text, 400), basis: "fact", citations: [{ source: source.id, quote: prefix(quote) }] });
const usable = (sources: readonly MaterialSource[]) => sources.filter(source => !source.excluded);
const lines = (text: string) => text.split(/\n+/).map(line => line.trim()).filter(Boolean);
const safe = (text: string) => !isInjection(text) && !guardHit(text);

const AUDIENCE = /\b(for (?:busy |local |small |young |new |first-time )?(?:families|parents|kids|children|businesses|companies|professionals|teams|students|beginners|couples|owners|startups|homeowners|athletes|women|men|people|clients|customers|everyone)|helping\b|we (?:help|serve|work with)|designed for|perfect for|ideal for|our (?:clients|customers) (?:are|include))\b/i;
const SERVICE_PAGE = /menu|treatments?|services?|what we do|products|shop|rooms|classes|courses|pricing|prices/i;
const SIGNAL_STRENGTH: [RegExp, string][] = [
  [/Secure connection: yes/, "The site loads over a secure (https) connection."],
  [/Phone layout: yes/, "The site has a layout for phones."],
  [/Enquiry form: yes/, "Visitors can send an enquiry from the site."],
  [/Tap-to-call: yes/, "Phone visitors can call with one tap."],
  [/Clear next step: yes/, "The page asks visitors to take a clear next step."],
];
const FINDING_SIGNAL: Record<string, RegExp> = {
  https: /Secure connection: no/, mobile: /Phone layout: no/, form: /Enquiry form: no/, phone: /Tap-to-call: no/, cta: /Clear next step: no/,
  h1: /Main headline: no/, description: /Search description: no/, dated: /Footer year: \d{4}/,
};

export function deterministicBrief(material: Material): ModelBrief {
  const sources = usable(material.sources);
  const pages = sources.filter(source => source.kind === "page" && source.page);
  const home = pages.find(source => source.role === "home");
  const own = pages.filter(source => source.role !== "competitor");
  const documents = sources.filter(source => source.kind === "document" || source.kind === "notes");
  const knowledge = sources.filter(source => source.kind === "knowledge");
  const brief = { offering: [] as ModelClaim[], audience: [] as ModelClaim[], positioning: [] as ModelClaim[], brandCues: [] as ModelClaim[], strengths: [] as ModelClaim[], shortcomings: [] as ModelClaim[] };

  // Offering: saved knowledge first, then the person's documents, then the site.
  for (const source of knowledge) if (/^(offering|services?|products?|menu|price|pricing)([._]|$)/.test(source.key ?? "")) brief.offering.push(fact(lines(source.text)[0], source));
  for (const source of documents) {
    const paragraph = lines(source.text).find(line => line.length >= 40 && safe(line));
    if (paragraph) brief.offering.push(fact(paragraph, source));
  }
  if (home?.page?.description && safe(home.page.description)) brief.offering.push(fact(home.page.description, home));
  for (const page of own.filter(source => source.role === "page" && SERVICE_PAGE.test(`${source.title} ${source.url}`))) {
    for (const item of page.page!.items.filter(safe).slice(0, 4)) brief.offering.push(fact(`Offers: ${item}`, page, `Item: ${item}`));
  }

  // Audience: only sentences that say who it is for.
  for (const source of [...knowledge.filter(item => /^(audience|customers?|clients?)([._]|$)/.test(item.key ?? "")), ...documents, ...own]) {
    for (const line of lines(source.text)) {
      const sentence = line.split(/(?<=[.!?])\s+/).find(part => AUDIENCE.test(part) && part.length >= 20 && safe(part));
      if (sentence && brief.audience.length < 3) brief.audience.push(fact(sentence, source));
    }
  }

  // Positioning: how they present themselves.
  if (home?.page) {
    if (home.page.title && safe(home.page.title)) brief.positioning.push(fact(`Their home page title: “${home.page.title}”`, home, `Title: ${home.page.title}`));
    const headline = home.page.headings.find(safe);
    if (headline) brief.positioning.push(fact(`Their main headline: “${headline}”`, home, `Heading: ${headline}`));
    if (home.page.siteName && home.page.siteName !== home.page.title && safe(home.page.siteName)) brief.positioning.push(fact(`They call the site “${home.page.siteName}”.`, home, `Site name: ${home.page.siteName}`));
    // Brand cues the visitor sees.
    const theme = /Theme colour: (#[0-9a-f]{3,8})/i.exec(home.page.signals)?.[1];
    if (theme) brief.brandCues.push(fact(`Their site uses ${theme} as its theme colour.`, home, `Theme colour: ${theme}`));
    const fonts = /Fonts: ([^.]+)/.exec(home.page.signals)?.[1];
    if (fonts) brief.brandCues.push(fact(`Their site uses the typefaces ${fonts}.`, home, `Fonts: ${fonts}`));
    if (/Logo image: yes/.test(home.page.signals)) brief.brandCues.push(fact("Their site shows a logo image.", home, "Logo image: yes"));
    for (const [pattern, text] of SIGNAL_STRENGTH) { const match = pattern.exec(home.page.signals); if (match) brief.strengths.push(fact(text, home, match[0])); }
    for (const finding of home.page.audit) {
      const signal = FINDING_SIGNAL[finding.id]?.exec(home.page.signals);
      brief.shortcomings.push(signal ? fact(`${finding.title}: ${finding.detail}`, home, signal[0])
        : { text: `${finding.title}: ${finding.detail}`.slice(0, 400), basis: "inference", citations: [], reasoning: "Found by an automatic check of the page's code, not stated on the page." });
    }
  }
  for (const source of knowledge.filter(item => /^brand([._]|$)/.test(item.key ?? ""))) brief.brandCues.push(fact(lines(source.text)[0], source));

  const competitors = pages.filter(source => source.role === "competitor").slice(0, 5).map(page => ({
    source: page.id, name: prefix(page.page!.siteName || page.page!.title || new URL(page.url!).hostname, 120),
    claims: page.page!.description && safe(page.page!.description) ? [fact(page.page!.description, page)] : [],
  }));

  // Recommendations with a business reason tied to the evidence.
  const recommendations: ModelBrief["recommendations"] = [];
  const serious = brief.shortcomings.map((claim, index) => ({ claim, index })).filter(item => /^(Not secure|Not built for phones|No clear next step|No enquiry form)/.test(item.claim.text));
  if (home && serious.length) recommendations.push({ deliverable: "website", title: "A clearer, enquiry-ready website",
    reason: `Their current site has ${serious.length === 1 ? "a problem" : "problems"} visitors notice (${serious.map(item => item.claim.text.split(":")[0].toLowerCase()).join(", ")}). Fixing ${serious.length === 1 ? "it" : "them"} removes a reason prospects leave before getting in touch.`,
    basedOn: serious.slice(0, 6).map(item => `shortcomings:${item.index}`) });
  const writtenWords = documents.reduce((sum, source) => sum + source.text.split(/\s+/).length, 0);
  if (writtenWords >= 400 || brief.offering.some(claim => /\b(guide|course|workshop|coaching|method|process|programme|program|training)\b/i.test(claim.text)))
    recommendations.push({ deliverable: "ebook", title: "A useful first download", basedOn: brief.offering.slice(0, 3).map((_, index) => `offering:${index}`),
      reason: "They already explain how they work in their own material. A short guide built from it can be a free first offer that starts conversations with the right prospects." });
  if (competitors.length) recommendations.push({ deliverable: "deck", title: "A clear proposal deck", basedOn: [],
    reason: "Competitor pages were supplied. A short proposal deck can set out how this business differs and what the agency would change, using only confirmed facts." });
  if (!recommendations.length && home) recommendations.push({ deliverable: "website", title: "A website refresh", basedOn: [],
    reason: "Their site was read and shows no serious problems, so a refresh is optional: confirm what they want to achieve first (more enquiries, bookings or sales)." });
  if (!recommendations.length) recommendations.push({ deliverable: "other", title: "Confirm the details first", basedOn: [],
    reason: "Their website could not be read and there is not enough supplied material yet. Share their content or documents, then run this again." });

  return { ...brief, offering: brief.offering.slice(0, 8), audience: brief.audience.slice(0, 6), positioning: brief.positioning.slice(0, 6), brandCues: brief.brandCues.slice(0, 6),
    strengths: brief.strengths.slice(0, 6), shortcomings: brief.shortcomings.slice(0, 8), competitors, questions: [], recommendations: recommendations.slice(0, 3) };
}

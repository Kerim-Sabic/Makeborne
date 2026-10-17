/** Search and sharing metadata for published websites: per-page titles and
 * descriptions, LocalBusiness structured data, the share image, a sitemap and a
 * pre-publish checklist. Pure: callers pass the rendered page HTML. */
import { z } from "zod";

export const BUSINESS_TYPES = ["LocalBusiness", "Restaurant", "CafeOrCoffeeShop", "Bakery", "BarOrPub", "Store", "ClothingStore", "BeautySalon", "HairSalon", "HealthAndBeautyBusiness", "Dentist", "MedicalClinic", "LegalService", "AccountingService", "RealEstateAgent", "HomeAndConstructionBusiness", "AutoRepair", "Hotel", "ExerciseGym", "ProfessionalService", "Organization"] as const;
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour times like 08:30.");
const pagePath = z.string().max(240).regex(/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/);
const httpsUrl = z.string().trim().max(300).url("Social profiles need full links, like https://instagram.com/yourname.").refine(value => /^https:\/\//.test(value), "Social profile links must start with https://.");

export const SiteSeoSchema = z.object({
  /** Short name used after page titles ("Menu · Saffron Table"). */
  siteName: z.string().trim().max(80).optional(),
  pages: z.array(z.object({ path: pagePath, title: z.string().trim().max(70).optional(), description: z.string().trim().max(200).optional() }).strict()).max(100).optional(),
  /** Public path of a project image, e.g. /images/hero.webp. */
  shareImage: z.string().max(240).regex(/^\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp)$/i).optional(),
  business: z.object({
    type: z.enum(BUSINESS_TYPES),
    name: z.string().trim().min(1, "Add the business name.").max(120, "Keep the business name under 120 characters."),
    street: z.string().trim().max(160, "That street address is too long.").optional(), city: z.string().trim().max(80, "That town name is too long.").optional(), region: z.string().trim().max(80).optional(),
    postcode: z.string().trim().max(20, "That postcode is too long.").optional(), country: z.string().trim().regex(/^[A-Z]{2}$/, "Use a two-letter country code, like GB or US.").optional(),
    phone: z.string().trim().max(40, "That phone number is too long.").regex(/^[+\d][\d\s().-]{5,}$/, "Use a phone number like +44 117 496 0000.").optional(),
    email: z.string().trim().max(254).email("Use a full email address, like hello@yourbusiness.com.").optional(),
    priceRange: z.string().trim().max(10).regex(/^(?:£|\$|€){1,4}$/, "Choose a price range from the list.").optional(),
    hours: z.array(z.object({ days: z.array(z.enum(DAYS)).min(1).max(7), opens: clock, closes: clock }).strict()).max(14).optional(),
    sameAs: z.array(httpsUrl).max(8).optional(),
  }).strict().optional(),
}).strict();
export type SiteSeo = z.infer<typeof SiteSeoSchema>;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", mdash: "—", ndash: "–", middot: "·" };
const decode = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => name[0] === "#" ? String.fromCodePoint(name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)) : ENTITIES[name.toLowerCase()] ?? whole);
const plain = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Clip at a sentence or word boundary, without a trailing ellipsis. */
export function clip(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const sentence = cut.lastIndexOf(". ");
  if (sentence >= max * 0.6) return cut.slice(0, sentence + 1);
  return cut.slice(0, cut.lastIndexOf(" ") > max * 0.6 ? cut.lastIndexOf(" ") : max).replace(/[\s,;:–—-]+$/, "");
}

/** The page's own opening copy: the first substantial paragraph inside <main> (or the body). */
export function pageSummary(html: string) {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const body = main.replace(/<(script|style|nav|header|footer|form|noscript)\b[\s\S]*?<\/\1>/gi, " ");
  // The first real paragraph (90+ characters) usually introduces the page; captions and labels are shorter.
  const candidates = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].slice(0, 12).map(match => plain(match[1])).filter(text => text.length >= 50 && !/[[\]]/.test(text));
  const chosen = candidates.find(text => text.length >= 90) ?? [...candidates].sort((a, b) => b.length - a.length)[0];
  return chosen ? clip(chosen, 158) : null;
}

const headings = (html: string, level: number) => [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi"))].map(match => plain(match[1])).filter(Boolean);

/** Title and description for one page. */
export function pageMeta(input: { path: string; routeTitle?: string; siteTitle: string; html: string; seo?: SiteSeo }) {
  const siteName = input.seo?.siteName || input.siteTitle;
  const custom = input.seo?.pages?.find(page => page.path === input.path);
  const pageName = input.path === "/" ? null : input.routeTitle || headings(input.html, 1)[0] || null;
  // An owner-written title is used exactly as written; otherwise "Page · Site".
  const title = clip(custom?.title || (pageName && pageName.toLowerCase() !== siteName.toLowerCase() ? `${pageName} · ${siteName}` : siteName), 70);
  const description = custom?.description || pageSummary(input.html) || clip(`${siteName}${pageName ? ` — ${pageName}` : ""}.`, 158);
  return { title, description };
}

/** schema.org LocalBusiness (or subtype) as safe JSON for a data script. */
export function structuredData(seo: SiteSeo | undefined, address: string, image?: string) {
  const business = seo?.business;
  if (!business) return null;
  const postal = business.street || business.city || business.postcode ? {
    "@type": "PostalAddress", ...(business.street ? { streetAddress: business.street } : {}), ...(business.city ? { addressLocality: business.city } : {}),
    ...(business.region ? { addressRegion: business.region } : {}), ...(business.postcode ? { postalCode: business.postcode } : {}), ...(business.country ? { addressCountry: business.country } : {}),
  } : null;
  const data = {
    "@context": "https://schema.org", "@type": business.type, name: business.name, url: address,
    ...(image ? { image } : {}), ...(business.phone ? { telephone: business.phone } : {}), ...(business.email ? { email: business.email } : {}),
    ...(postal ? { address: postal } : {}), ...(business.priceRange ? { priceRange: business.priceRange } : {}),
    ...(business.hours?.length ? { openingHoursSpecification: business.hours.map(slot => ({ "@type": "OpeningHoursSpecification", dayOfWeek: slot.days.map(day => `https://schema.org/${{ Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday", Fr: "Friday", Sa: "Saturday", Su: "Sunday" }[day]}`), opens: slot.opens, closes: slot.closes })) } : {}),
    ...(business.sameAs?.length ? { sameAs: business.sameAs } : {}),
  };
  // Inside a <script> data block: no "</script" or HTML comment openers can survive.
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function sitemapXml(origin: string, paths: readonly string[], lastModified?: string) {
  const day = lastModified ? `<lastmod>${xml(lastModified.slice(0, 10))}</lastmod>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(paths)].sort().map(path => `  <url><loc>${xml(`${origin.replace(/\/$/, "")}${path === "/" ? "/" : path}`)}</loc>${day}</url>`).join("\n")}\n</urlset>\n`;
}

// ------------------------------------------------------------------ checklist

export type SeoCheck = { id: string; level: "pass" | "warn" | "fail"; title: string; detail: string; path?: string };
export type SeoPage = { path: string; routeTitle?: string; html: string };

/** Plain-language checks before publishing; warnings never block publishing. */
export function seoChecklist(input: { siteTitle: string; pages: SeoPage[]; seo?: SiteSeo; images?: readonly string[] }): SeoCheck[] {
  const checks: SeoCheck[] = [];
  const titles = new Map<string, string[]>(), routes = new Set(input.pages.map(page => page.path));
  for (const page of input.pages) {
    const meta = pageMeta({ path: page.path, routeTitle: page.routeTitle, siteTitle: input.siteTitle, html: page.html, seo: input.seo });
    titles.set(meta.title, [...(titles.get(meta.title) ?? []), page.path]);
    const where = page.path === "/" ? "the home page" : page.path, Where = page.path === "/" ? "The home page" : `The page ${page.path}`;
    const h1 = headings(page.html, 1).length;
    if (h1 !== 1) checks.push({ id: `h1:${page.path}`, level: "warn", path: page.path, title: h1 ? `${Where} has ${h1} main headings` : `${Where} has no main heading`, detail: "Each page should have exactly one main heading that says what it's about. Ask the builder to fix it." });
    if (meta.description.length < 70) checks.push({ id: `description:${page.path}`, level: "warn", path: page.path, title: `${Where} needs a longer description`, detail: "Search results show about 150 characters under your link. Write one or two sentences about this page." });
    const images = [...page.html.matchAll(/<img\b[^>]*>/gi)].map(match => match[0]);
    const missingAlt = images.filter(tag => !/\balt\s*=\s*"[^"]+"/i.test(tag)).length;
    if (missingAlt) checks.push({ id: `alt:${page.path}`, level: "warn", path: page.path, title: `${missingAlt} image${missingAlt === 1 ? "" : "s"} on ${where} ${missingAlt === 1 ? "has" : "have"} no description`, detail: "Image descriptions help Google Images and people using screen readers. Click the image in Edit mode to add one." });
    const broken = [...new Set([...page.html.matchAll(/<a\b[^>]*\bhref="(\/[^"#?]*)/gi)].map(match => match[1].replace(/\/$/, "") || "/").filter(path => !routes.has(path) && !/\.[a-z0-9]{2,5}$/i.test(path)))];
    if (broken.length) checks.push({ id: `links:${page.path}`, level: "fail", path: page.path, title: `${Where} links to ${broken.length === 1 ? "a page" : "pages"} that don't exist`, detail: `Fix or remove links to ${broken.slice(0, 3).join(", ")}${broken.length > 3 ? "…" : ""}.` });
    const words = plain(page.html.replace(/<(script|style|nav|footer)\b[\s\S]*?<\/\1>/gi, " ")).split(" ").filter(Boolean).length;
    if (words < 150) checks.push({ id: `thin:${page.path}`, level: "warn", path: page.path, title: `${Where} has very little text`, detail: `About ${words} words. Pages with a few useful paragraphs rank better.` });
    if (/\[[^\]]{2,40}\]/.test(plain(page.html))) checks.push({ id: `placeholder:${page.path}`, level: "fail", path: page.path, title: `${Where} still has placeholders`, detail: "Replace the text in [square brackets] with real details before publishing." });
  }
  for (const [title, paths] of titles) if (paths.length > 1) checks.push({ id: `duplicate:${title}`, level: "warn", title: "Some pages share the same title", detail: `${paths.join(", ")} are all called “${title}”. Give each page its own title.` });
  if (!input.seo?.business) checks.push({ id: "business", level: "warn", title: "Add your business details", detail: "Your address, phone and opening hours help you appear in Google's local results and on Maps." });
  else if (input.seo.business.type !== "Organization" && !(input.seo.business.street && input.seo.business.city)) checks.push({ id: "business-address", level: "warn", title: "Add your street address", detail: "Local results need a full address." });
  if (!input.seo?.shareImage && (input.images?.length ?? 0) > 0) checks.push({ id: "share-image", level: "warn", title: "Choose a share image", detail: "It appears when your link is shared on WhatsApp, Facebook or LinkedIn." });
  if (!checks.length || checks.every(check => check.level === "pass")) checks.push({ id: "ready", level: "pass", title: "Ready for search", detail: "Every page has a title, a description and one main heading." });
  return checks;
}

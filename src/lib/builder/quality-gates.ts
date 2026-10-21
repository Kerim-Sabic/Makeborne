/**
 * Finish-time quality gates for generated websites: cheap, deterministic source
 * checks for contracts the eval kept finding broken (form feedback, page
 * orientation on multi-page sites, reduced motion, image dimensions). They run
 * only on files changed in this run, so a small edit to an older project is
 * never forced into unrelated rework. Messages say exactly what to add.
 */

import type { DesignAnswers } from "./brief-questions";

export type QualityInput = {
  files: ReadonlyMap<string, string>;
  /** Paths written or edited in this run. */
  changed: ReadonlySet<string>;
  /** finish.routes (real page paths). */
  routes?: readonly { path: string }[];
  /** Completeness: the approved brief's sections (by anchor), the client's must-haves and the brief text. */
  required?: { sections?: readonly { name: string; anchor: string }[]; design?: DesignAnswers; brief?: string };
};

/** Evidence in the source that a section exists (generous: a heading, a label or a placeholder counts). */
const SECTION_EVIDENCE: Record<string, { label: string; evidence: RegExp }> = {
  prices: { label: "Prices or menu", evidence: /\b(prices?|pricing|menu|tariff|rates?)\b|[£€$]\s?\d/i },
  hours: { label: "Opening hours", evidence: /\b(opening hours|hours|open (daily|today|from)|mon(day)?\s*[–-])/i },
  gallery: { label: "Gallery", evidence: /\bgallery\b/i },
  team: { label: "Team", evidence: /\b(team|meet (the|our)|who we are|staff)\b/i },
  testimonials: { label: "Testimonials", evidence: /\b(testimonials?|reviews?|what (our )?(clients|customers|people|patients|guests) say)\b/i },
  faq: { label: "FAQ", evidence: /\b(faqs?|frequently asked|questions)\b/i },
  contact: { label: "Contact form", evidence: /<form\b/ },
  map: { label: "Map or directions", evidence: /\b(map|directions|find us|getting here)\b/i },
  signup: { label: "Email sign-up", evidence: /<form\b|type=["']email["']/ },
};
/** Sections a brief names in so many words ("opening hours", "an FAQ", "a contact form"). */
const BRIEF_ASKS: readonly (readonly [RegExp, string])[] = [
  [/\b(menu|price list|prices up front|pricing|our prices)\b/i, "prices"],
  [/\b(opening hours|open(ing)? times)\b/i, "hours"],
  [/\bgallery\b/i, "gallery"],
  [/\b(meet the team|team section|our team)\b/i, "team"],
  [/\btestimonials?\b/i, "testimonials"],
  [/\b(faqs?|frequently asked)\b/i, "faq"],
  [/\b(contact|enquiry|inquiry|booking|quote) form\b/i, "contact"],
  [/\b(map|directions)\b/i, "map"],
  [/\b(email list|mailing list|newsletter|wait[- ]?list|launch list)\b/i, "signup"],
];
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Sections the brief, the approved enhanced brief or the client's answers ask for that the site lacks. */
export function missingSections(scripts: string, required: NonNullable<QualityInput["required"]>): string[] {
  const missing: string[] = [];
  for (const section of required.sections ?? []) {
    if (!new RegExp(`["'\`]${escapeRegExp(section.anchor)}["'\`]`).test(scripts)) missing.push(`${section.name} (id="${section.anchor}")`);
  }
  const asked = new Set<string>(required.design?.sections ?? []);
  for (const [pattern, id] of BRIEF_ASKS) if (required.brief && pattern.test(required.brief)) asked.add(id);
  for (const id of asked) {
    const rule = SECTION_EVIDENCE[id];
    if (rule && !rule.evidence.test(scripts) && !missing.some(item => item.toLowerCase().startsWith(rule.label.toLowerCase()))) missing.push(rule.label);
  }
  return missing;
}

const isScript = (path: string) => /\.(?:tsx|jsx|ts|js)$/.test(path);
const isStyle = (path: string) => path.endsWith(".css");
const join = (files: ReadonlyMap<string, string>, test: (path: string) => boolean) => [...files].filter(([path]) => test(path)).map(([, content]) => content).join("\n");

/** CSS with every block opened by `opener` (an @media prelude ending in "{") removed, braces matched. */
export function withoutBlocks(css: string, opener: RegExp) {
  let out = "", at = 0;
  for (const match of css.matchAll(opener)) {
    const start = match.index!;
    if (start < at) continue;
    let depth = 1, index = start + match[0].length;
    for (; index < css.length && depth > 0; index++) {
      if (css[index] === "{") depth++;
      else if (css[index] === "}") depth--;
    }
    out += css.slice(at, start);
    at = index;
  }
  return out + css.slice(at);
}

/** <img ...> tags (JSX attributes may span lines) whose src is a generated /images/ path. */
function generatedImagesWithoutSize(source: string) {
  const offenders: string[] = [];
  // JSX images are self-closing; matching to "/>" skips arrow functions inside attributes.
  for (const match of source.matchAll(/<img\b[\s\S]*?\/>/g)) {
    const tag = match[0];
    if (!/src=\{?\s*["'`]\/images\/[a-z0-9-]+\.webp/.test(tag)) continue;
    if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag)) offenders.push(/\/images\/[a-z0-9-]+\.webp/.exec(tag)?.[0] ?? "an image");
  }
  return offenders;
}

const digitsOf = (value: string) => value.replace(/\D/g, "");
/** Phone numbers in the site's source that the client never gave: every tel: href (an unfilled token such as
 * tel:{PHONE} included) and every phone-shaped number in the text. A number counts as given when its last
 * seven digits match a number in the brief, so "+1 520 555 0187" and "(520) 555-0187" are the same phone. */
export function inventedPhoneNumbers(source: string, brief: string): string[] {
  const given = [...brief.matchAll(/\+?\(?\d[\d\s().-]{5,}\d/g)].map(match => digitsOf(match[0])).filter(digits => digits.length >= 7);
  const known = (digits: string) => digits.length >= 7 && given.some(value => value.endsWith(digits.slice(-7)) || digits.endsWith(value.slice(-7)));
  const out = new Set<string>();
  for (const match of source.matchAll(/tel:([^"'`\s>]*)/g)) {
    const value = match[1].startsWith("{") ? match[1] : match[1].replace(/\}+$/, "");
    // An expression (`tel:${phone}`, "tel:" + phone) takes its number from a literal checked below; a literal must be a given number.
    if (!value || value.startsWith("${")) continue;
    if (!known(digitsOf(value))) out.add(`tel:${value}`.slice(0, 40));
  }
  // Phone-shaped: groups split by dashes, dots or brackets (or by spaces when the number starts with 0 or +, or a group of
  // three or more digits leads), 9 to 13 digits, never part of a price, date, decimal or a run of SVG coordinates.
  for (const match of source.matchAll(/(?<![\w£$€.,/:#-]|\d\s)(\+?\(?\d{2,5}\)?[ .-]\d{3,4}[ .-]\d{3,4})(?![ \w.,/%-]*\d)/g)) {
    const raw = match[1], digits = digitsOf(raw);
    const spacesOnly = !/[().-]/.test(raw) && !raw.startsWith("+");
    if (spacesOnly && !/^0\d{2,4} /.test(raw)) continue;
    if (digits.length >= 9 && digits.length <= 13 && !known(digits)) out.add(raw);
  }
  return [...out];
}

export function qualityProblems({ files, changed, routes = [], required }: QualityInput): string[] {
  const problems: string[] = [];
  const touched = [...changed].filter(path => files.has(path));
  if (!touched.length) return problems;
  const scripts = join(files, isScript), styles = join(files, isStyle);
  const touchedScripts = touched.filter(isScript).map(path => [path, files.get(path)!] as const);

  // Forms: accessible error handling and success focus.
  const formFiles = touchedScripts.filter(([, content]) => /<form\b/.test(content)).map(([path]) => path);
  if (formFiles.length) {
    const missing = [
      !/aria-invalid/.test(scripts) && "aria-invalid on invalid fields",
      !/aria-describedby/.test(scripts) && "aria-describedby linking each invalid field to its error message",
      !/role=["'{]*alert/.test(scripts) && "an error summary with role=\"alert\" and tabIndex={-1}",
      !/\.focus\(/.test(scripts) && "focus moved to the error summary on a failed submit and to the success message after success",
    ].filter(Boolean);
    if (missing.length) problems.push(`${formFiles[0]} has a form without accessible feedback. Add ${missing.join("; ")} (see "Forms" in the system prompt).`);
    if (/\/_mb\/enquiries/.test(scripts) && !/role=["'{]*status/.test(scripts)) problems.push(`${formFiles[0]}: the confirmed-success message needs role="status" and tabIndex={-1}, and focus moves to it after accepted === true.`);
  }

  // Multi-page sites: page titles, focus after page changes and a not-found page.
  const multiPage = routes.length > 1 || touchedScripts.some(([, content]) => /addEventListener\(\s*["']hashchange["']/.test(content));
  if (multiPage && touchedScripts.length) {
    const missing = [
      !/document\.title\s*=/.test(scripts) && "set document.title for every page",
      !/\.focus\(/.test(scripts) && "move focus to the new page's h1 after a client-side page change",
      !/aria-live/.test(scripts) && "announce the new page in an aria-live=\"polite\" region",
      !/page not found/i.test(scripts) && "render a \"Page not found\" page (title and h1) with a link home for unknown paths",
    ].filter(Boolean);
    if (missing.length) problems.push(`This site has several pages: ${missing.join("; ")} (see "Multi-page sites" in the system prompt).`);
  }

  // Motion must have a reduced-motion fallback.
  const touchedStyles = touched.filter(isStyle).map(path => files.get(path)!).join("\n");
  if (/@keyframes|\[data-reveal|animation-timeline/.test(touchedStyles) && !/prefers-reduced-motion:\s*reduce/.test(styles)) {
    problems.push("The site animates but has no @media (prefers-reduced-motion: reduce) block: add the reduced-motion block from the motion pattern.");
  }
  if (/\[data-reveal[^{]*\{[^}]*opacity:\s*0(?![.\d])/.test(withoutBlocks(touchedStyles, /@media\s*\(\s*prefers-reduced-motion:\s*no-preference\s*\)\s*\{/g))) {
    problems.push("A [data-reveal] hidden state sits outside @media (prefers-reduced-motion: no-preference) and html.js: move it inside both gates so content is never stuck invisible.");
  }

  // Fixed or sticky bars and floating buttons at the bottom of the screen cover content: the judge
  // penalised floating buttons and, in round 4, fixed quick-action bars sitting over menus and tickets.
  // Quick actions for a local business now sit in the page flow below the first screen (the pattern).
  const bottomFixed = [...touchedStyles.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter(([, , body]) => /position:\s*(?:fixed|sticky)/.test(body) && /(?:^|[;\s])(?:bottom|inset-block-end):\s*(?:0|[0-9.]+(?:px|rem|em))/.test(body) && !/(?:^|[;\s])top:/.test(body))
    .map(([, selector]) => selector.trim().split(/\s*,\s*/).pop()!.slice(-60));
  const covering = [...new Set(bottomFixed)];
  if (covering.length) problems.push(`Remove the fixed bottom bar or floating button (${covering.slice(0, 3).join(", ")}): it covers content on phones. Keep the action in the sticky header, the first screen and the closing section; quick actions for a local business go in the page flow below the first screen (the quick-action row pattern, never fixed).`);

  // Body copy in a monospace face reads as a code page (the judge marked it down); mono is for data and labels only.
  const monoBody = [...touchedStyles.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
    .filter(([, selector, body]) => /(?:^|[\s,>])(?:body|p|main|article)(?![\w-])/.test(selector) && /font-family:\s*[^;}]*(?:\bmono\b|monospace|--font-mono|--mono\b)/i.test(body))
    .map(([, selector]) => selector.trim().split(/\s*,\s*/).slice(0, 2).join(", "));
  if (monoBody.length) problems.push(`Body copy is set in a monospace face (${[...new Set(monoBody)].slice(0, 3).join("; ")}): use the text family for paragraphs; keep the mono face for data, labels and code.`);

  // Completeness: every section the brief, the approved enhanced brief or the client's answers ask for.
  if (required && touchedScripts.length) {
    const missing = missingSections(scripts, required);
    if (missing.length) problems.push(`The brief asks for sections this site doesn't have yet: ${missing.slice(0, 6).join("; ")}. Add each as a real section (a visible placeholder where the client gave no facts, never invented ones).`);
  }

  // Phone numbers: never invented. Every tel: link and every phone-shaped number on the page must be one the client gave.
  if (required?.brief !== undefined && touchedScripts.length) {
    const invented = inventedPhoneNumbers(join(files, path => isScript(path) || path.endsWith(".html")), required.brief);
    if (invented.length) problems.push(`Phone number${invented.length > 1 ? "s" : ""} ${invented.slice(0, 3).map(value => `"${value}"`).join(", ")} ${invented.length > 1 ? "are" : "is"} not in the client's brief: never invent a phone number. Use the number the client gave; if they gave none, remove the Call link and tel: href and show a plain-text [Your phone] placeholder in the contact details. Form hints describe the format in words ("include the area code"), never with a made-up number.`);
  }

  // Generated images keep their returned size so nothing shifts.
  const unsized =touchedScripts.flatMap(([, content]) => generatedImagesWithoutSize(content));
  if (unsized.length) problems.push(`Give every generated image its width and height attributes (from the generate_image result): ${[...new Set(unsized)].slice(0, 4).join(", ")}.`);
  return problems;
}

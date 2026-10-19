/** Client-ready check: deterministic, advisory findings about a generated
 * website before it is published or shown to a client. Pure and synchronous
 * (no model call, no network, no credits); runs in the browser on the saved
 * source and, when available, on the prepared static pages. Findings warn and
 * never block publishing. */

export type ClientReadySeverity = "error" | "warning" | "info";
export type ClientReadyRule =
  | "placeholder-text" | "placeholder-contact" | "placeholder-image" | "unfinished-note"
  | "empty-link" | "dead-route" | "missing-anchor" | "missing-image"
  | "image-alt" | "image-size" | "low-contrast" | "link-name"
  | "page-title" | "meta-description" | "html-lang";
export type ClientReadyFinding = {
  rule: ClientReadyRule; severity: ClientReadySeverity; title: string; detail: string;
  /** Where it was found ("src/components/Footer.tsx:12", "page /menu"), at most MAX_LOCATIONS. */
  locations: string[];
  /** Total occurrences, including those beyond the listed locations. */
  count: number;
};
export type ClientReadyInput = {
  files: ReadonlyArray<{ path: string; content: string }>;
  routes?: ReadonlyArray<{ path: string; title?: string }>;
  /** Project images, e.g. { path: "public/images/hero.webp" }. */
  assets?: ReadonlyArray<{ path: string }>;
  /** Rendered static HTML per route (e.g. the prepared publication), when available. */
  pages?: ReadonlyArray<{ path: string; html: string }>;
};

const MAX_LOCATIONS = 6;
const RULES: Record<ClientReadyRule, { severity: ClientReadySeverity; title: string; detail: string }> = {
  "placeholder-text": { severity: "error", title: "Placeholder text is still on the site", detail: "Replace sample text such as “Lorem ipsum”, “Your Company” or anything in [square brackets] with the client’s real details." },
  "placeholder-contact": { severity: "error", title: "Contact details look made up", detail: "Example phone numbers, emails and addresses (555 numbers, example.com, 123 Main Street) must be replaced with the client’s real details." },
  "placeholder-image": { severity: "error", title: "Placeholder images", detail: "Images from placeholder services don’t load on the published site. Generate an image or remove it." },
  "unfinished-note": { severity: "warning", title: "Unfinished notes in visible text", detail: "Text such as TODO, FIXME or TBD is visible to visitors. Finish or remove it." },
  "empty-link": { severity: "error", title: "Links that go nowhere", detail: "These links use href=\"#\", an empty address or an empty mailto:/tel:. Point each one at a real page, section, phone number or email, or make it plain text." },
  "dead-route": { severity: "error", title: "Links to pages that don’t exist", detail: "These links point at pages or files the website doesn’t have. Fix the address or add the page." },
  "missing-anchor": { severity: "warning", title: "Links to missing sections", detail: "These in-page links point at a section id that isn’t on the site, so clicking them does nothing." },
  "missing-image": { severity: "error", title: "Images that don’t exist", detail: "These image paths are not among the project’s images, so they show as broken." },
  "image-alt": { severity: "warning", title: "Images without a description", detail: "Add alt text that describes each image (use alt=\"\" only for purely decorative images). Screen readers and search engines rely on it." },
  "image-size": { severity: "warning", title: "Images without width and height", detail: "Images without width and height make the page jump while it loads. Add both attributes with the image’s proportions." },
  "low-contrast": { severity: "warning", title: "Text colour is hard to read", detail: "These colour pairs are below the WCAG AA contrast of 4.5:1 for body text. Darken the text or lighten the background." },
  "link-name": { severity: "warning", title: "Link labels don’t match their visible text", detail: "An aria-label should contain the words people see, so voice-control users can say them (WCAG 2.5.3). Remove the label or start it with the visible text." },
  "page-title": { severity: "warning", title: "The page title is missing or generic", detail: "Set a <title> in index.html with the business name. It appears in browser tabs and in exported or downloaded code." },
  "meta-description": { severity: "info", title: "No meta description in index.html", detail: "Published pages get descriptions from Search & sharing; downloaded source and GitHub exports use the one in index.html." },
  "html-lang": { severity: "info", title: "The page language isn’t set", detail: "Add lang to <html> (for example lang=\"en\") so screen readers pronounce the text correctly." },
};
const ORDER: ClientReadySeverity[] = ["error", "warning", "info"];

// ------------------------------------------------------------------ text scanning

const CODE = /\.(?:tsx?|jsx?|mjs)$/i;
const blank = (match: string) => match.replace(/[^\n]/g, " ");
/** Comments replaced by spaces so offsets (and line numbers) stay exact. */
function stripComments(code: string) {
  return code.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:"'`\\/])(\/\/[^\n]*)/g, (_, before: string, comment: string) => before + blank(comment));
}
const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

type Segment = { text: string; index: number };
const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
/** Text a visitor could see: string literals and JSX text in code, the whole file otherwise. */
function segments(path: string, content: string): Segment[] {
  if (!CODE.test(path)) {
    if (/\.css$/i.test(path)) return [];
    const html = /\.html?$/i.test(path) ? content.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, blank).replace(/<[^>]*>/g, blank) : content;
    return [{ text: html, index: 0 }];
  }
  const code = stripComments(content), found: Segment[] = [];
  for (const match of code.matchAll(STRING)) found.push({ text: match[0].slice(1, -1).replace(/\$\{[^}]*\}/g, " "), index: match.index! + 1 });
  if (/\.[jt]sx$/i.test(path)) for (const match of code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) found.push({ text: match[1], index: match.index! + 1 });
  return found;
}

const PLACEHOLDER: RegExp[] = [
  /\blorem ipsum\b|\bdolor sit amet\b|\bconsectetur adipiscing\b/i,
  // Title Case only: "Your name" and "Company name" are ordinary form labels.
  /^\s*(?:Your (?:Company|Business|Brand)(?: Name)?|(?:Company|Business|Brand) Name|Your Logo|Your Tagline)\s*$/,
  /\bAcme (?:Inc|Corp|Co|Ltd)\b|\b(?:John|Jane) Doe\b/,
];
/** Bracketed placeholders such as [Your phone] or [Street address]; not regex classes, selectors or markdown links. */
const BRACKET_WORDS = /^(?:your|insert|add|enter|client|business|company|street|address|phone|email|name|city|town|postcode|zip|hours|price|tbd|todo)\b/i;
const bracketed = (text: string) => [...text.matchAll(/\[([^\][\n<>{}=:"'`\\]{2,50})\](?!\()/g)]
  .some(match => BRACKET_WORDS.test(match[1].trim()) || (/^[A-Z]/.test(match[1].trim()) && /[a-z]{2}/.test(match[1])));
const placeholder = (text: string) => bracketed(text) || PLACEHOLDER.some(pattern => pattern.test(text));
const CONTACT: RegExp[] = [
  /\b[\w.+-]+@(?:example|domain|yourdomain|yourcompany|yourbusiness|company|email)\.(?:com|org|net|co)\b/i,
  /\(?\b555\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\b555[\s.-]\d{4}\b|\b123[\s.-]?456[\s.-]?7890\b|\b000[\s.-]?000[\s.-]?0000\b|\(?\b0?(?:20 ?7946|11[3-8] ?496|1[2-9]1 ?496) ?0\d{3}\b|\b07700 ?900 ?\d{3}\b|\b01632 ?960 ?\d{3}\b/,
  /\b123 Main (?:St|Street|Ave|Avenue|Road|Rd)\b|\b\d+ (?:Example|Sample|Fake|Any|Placeholder) (?:St|Street|Ave|Avenue|Road|Rd|Lane)\b|\bAnytown\b/i,
];
const UNFINISHED = /\b(?:TODO|FIXME|TBD|XXX)\b/;
const PLACEHOLDER_IMAGE = /^(?:https?:)?\/\/(?:via\.placeholder\.com|placehold\.(?:co|it)|placekitten\.com|picsum\.photos|dummyimage\.com|source\.unsplash\.com|loremflickr\.com|fakeimg\.pl)\b/i;

// ------------------------------------------------------------------ tags

type Tag = { name: string; attrs: Map<string, string | null>; spread: boolean; index: number; end: number };
/** Opening tags of the given names in JSX or HTML, brace and quote aware. Values in
 * braces are kept only when they are a plain string literal; otherwise null. */
function tags(code: string, names: string): Tag[] {
  const found: Tag[] = [];
  for (const match of code.matchAll(new RegExp(`<(${names})(?=[\\s/>])`, "g"))) {
    let index = match.index! + match[0].length, depth = 0, quote = "";
    const start = index;
    for (; index < code.length; index++) {
      const char = code[index];
      if (quote) { if (char === "\\") index++; else if (char === quote) quote = ""; continue; }
      if (char === "\"" || char === "'" || char === "`") quote = char;
      else if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth <= 0) break;
    }
    const body = code.slice(start, index), attrs = new Map<string, string | null>();
    let spread = false;
    for (const attr of body.matchAll(/([A-Za-z_:][\w:.-]*)(?:\s*=\s*("[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\}))?|\{\s*\.\.\.[^}]*\}/g)) {
      if (attr[0].startsWith("{")) { spread = true; continue; }
      const raw = attr[2];
      let value: string | null = "";
      if (raw === undefined) value = "";
      else if (raw[0] === "{") value = /^\{\s*(["'`])([^"'`$]*)\1\s*\}$/.exec(raw)?.[2] ?? null;
      else value = raw.slice(1, -1);
      attrs.set(attr[1], value);
    }
    found.push({ name: match[1], attrs, spread, index: match.index!, end: index + 1 });
  }
  return found;
}

// ------------------------------------------------------------------ colour

type Rgba = [number, number, number, number];
const NAMED: Record<string, Rgba> = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (NAMED[text]) return NAMED[text];
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex].map(char => char + char).join("") : hex;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : Number(rgb[4])];
  return null;
}
const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]: Rgba) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export function contrastRatio(a: string, b: string): number | null {
  const fg = parseColor(a), bg = parseColor(b);
  if (!fg || !bg || fg[3] < 1 || bg[3] < 1) return null;
  const [light, dark] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return Math.round((light + 0.05) / (dark + 0.05) * 100) / 100;
}

function resolveVar(value: string, vars: Map<string, string>, depth = 0): string {
  const match = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(value.trim());
  if (!match || depth > 4) return value.trim();
  return resolveVar(vars.get(match[1]) ?? match[2] ?? "", vars, depth + 1);
}
/** A background value that is one solid colour (not a gradient or image). */
const solidBackground = (value: string) => /\b(?:url|gradient)\(/i.test(value) ? "" : value.trim().split(/\s+(?![^(]*\))/)[0] ?? "";

// ------------------------------------------------------------------ check

const routeKey = (path: string) => (path.replace(/\/+$/, "") || "/");
const plain = (html: string) => html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&[a-z#0-9]+;/gi, " ");

export function clientReadyCheck(input: ClientReadyInput): ClientReadyFinding[] {
  const found = new Map<ClientReadyRule, { locations: string[]; count: number }>();
  const add = (rule: ClientReadyRule, location: string) => {
    const entry = found.get(rule) ?? { locations: [], count: 0 };
    if (entry.locations.includes(location)) return;
    entry.count++;
    if (entry.locations.length < MAX_LOCATIONS) entry.locations.push(location);
    found.set(rule, entry);
  };
  const files = input.files.filter(file => !/(?:^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*|vite\.config[^/]*)$/i.test(file.path));
  const routes = new Set((input.routes?.length ? input.routes : [{ path: "/" }]).map(route => routeKey(route.path)));
  const assets = new Set((input.assets ?? []).map(asset => `/${asset.path.replace(/^public\//, "")}`));

  // Section ids anywhere in the source or pages; string literals count too (ids often come from data).
  const ids = new Set<string>();
  for (const file of files) {
    for (const match of file.content.matchAll(/\bid\s*[=:]\s*\{?\s*["'`]([^"'`\s]+)["'`]/g)) ids.add(match[1]);
    if (CODE.test(file.path)) for (const match of file.content.matchAll(STRING)) { const value = match[0].slice(1, -1).trim(); if (/^[\w-]+$/.test(value)) ids.add(value); }
  }
  for (const page of input.pages ?? []) for (const match of page.html.matchAll(/\bid=["']([^"']+)["']/g)) ids.add(match[1]);

  const checkLink = (href: string | null | undefined, where: string) => {
    if (href === null || href === undefined) return;
    const value = href.trim();
    if (value === "" || value === "#" || /^javascript:/i.test(value) || /^(?:mailto|tel|sms):\s*$/i.test(value)) { add("empty-link", where); return; }
    if (/^(?:mailto|tel|sms):/i.test(value)) { if (CONTACT.some(pattern => pattern.test(value))) add("placeholder-contact", where); return; }
    if (value.startsWith("#")) {
      const id = decodeURIComponent(value.slice(1));
      // "#top" scrolls to the top in every browser even without an element.
      if (id !== "top" && !id.startsWith("/") && !id.startsWith("!") && !ids.has(id)) add("missing-anchor", `${where} (${value})`);
      return;
    }
    if (!value.startsWith("/") || value.startsWith("//")) return;
    const [path, hash = ""] = value.split("#");
    const clean = routeKey(path.split("?")[0]);
    if (/\.[a-z0-9]{2,5}$/i.test(clean) ? !assets.has(clean) : !routes.has(clean)) add("dead-route", `${where} (${value})`);
    else if (hash && !hash.startsWith("/") && !ids.has(decodeURIComponent(hash))) add("missing-anchor", `${where} (${value})`);
  };
  const checkImage = (tag: Tag, where: string) => {
    const src = tag.attrs.get("src");
    if (src && PLACEHOLDER_IMAGE.test(src)) add("placeholder-image", where);
    else if (src && src.startsWith("/") && !src.startsWith("//") && !assets.has(src.split(/[?#]/)[0])) add("missing-image", `${where} (${src})`);
    if (tag.spread) return;
    if (!tag.attrs.has("alt")) add("image-alt", where);
    if (!tag.attrs.has("width") || !tag.attrs.has("height")) add("image-size", where);
  };
  const checkText = (text: string, where: string) => {
    if (placeholder(text)) add("placeholder-text", where);
    if (CONTACT.some(pattern => pattern.test(text))) add("placeholder-contact", where);
    if (UNFINISHED.test(text)) add("unfinished-note", where);
  };

  // CSS custom properties for resolving var() in colour pairs.
  const vars = new Map<string, string>();
  for (const file of files) if (/\.css$/i.test(file.path)) {
    for (const rule of file.content.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (/:root|\bhtml\b|\bbody\b/.test(rule[1])) {
      for (const declaration of rule[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) if (!vars.has(declaration[1])) vars.set(declaration[1], declaration[2].trim());
    }
  }
  const checkPair = (color: string | undefined, background: string | undefined, where: string) => {
    if (!color || !background) return;
    const ratio = contrastRatio(resolveVar(color, vars), resolveVar(solidBackground(resolveVar(background, vars)), vars));
    if (ratio !== null && ratio < 4.5) add("low-contrast", `${where} (${ratio}:1)`);
  };

  for (const file of files) {
    const { path, content } = file;
    const code = CODE.test(path) ? stripComments(content) : /\.css$/i.test(path) ? content.replace(/\/\*[\s\S]*?\*\//g, blank) : content;
    const at = (index: number) => `${path}:${lineAt(content, index)}`;
    for (const segment of segments(path, content)) {
      if (/\.html?$/i.test(path) || CODE.test(path)) checkText(segment.text, at(segment.index));
      else if (/\.(?:json|md|txt)$/i.test(path)) for (const [index, line] of segment.text.split("\n").entries()) checkText(line, `${path}:${index + 1}`);
    }
    if (/\.css$/i.test(path)) {
      for (const rule of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (/::selection|:disabled|::placeholder/.test(rule[1])) continue;
        const color = /(?:^|[;\s])color\s*:\s*([^;!]+)/.exec(rule[2])?.[1], background = /(?:^|[;\s])background(?:-color)?\s*:\s*([^;!]+)/.exec(rule[2])?.[1];
        checkPair(color, background, `${at(rule.index! + rule[1].length - rule[1].trimStart().length)} ${rule[1].trim().slice(0, 40)}`);
        const body = rule.index! + rule[1].length + 1;
        for (const url of rule[2].matchAll(/url\(\s*["']?(\/[^"')?#]+)/g)) if (!assets.has(url[1])) add("missing-image", `${at(body + url.index!)} (${url[1]})`);
      }
      continue;
    }
    if (!CODE.test(path) && !/\.html?$/i.test(path)) continue;
    for (const tag of tags(code, "a|img|area|button|Link")) {
      const where = at(tag.index);
      if (tag.name === "img") { checkImage(tag, where); continue; }
      if (tag.name !== "button") checkLink(tag.attrs.has("href") ? tag.attrs.get("href") : tag.attrs.get("to"), where);
      const label = tag.attrs.get("aria-label");
      if (label && (tag.name === "a" || tag.name === "button")) {
        const close = code.indexOf(`</${tag.name}>`, tag.end);
        const inner = close < 0 ? "" : code.slice(tag.end, close);
        const visible = /[{}]/.test(inner) ? "" : plain(inner).replace(/\s+/g, " ").trim();
        // Whitespace-insensitive: inline markup splits words visually but not audibly.
        const squash = (text: string) => text.toLowerCase().replace(/[\s.,·:;!?'’"“”-]+/g, "");
        if (visible && !squash(label).includes(squash(visible))) add("link-name", `${where} (“${visible.slice(0, 40)}” vs “${label.slice(0, 40)}”)`);
      }
    }
    if (CODE.test(path)) {
      // Navigation data: { label: "Menu", href: "#" } rendered by a component.
      for (const match of code.matchAll(/\b(?:href|to|link|url)\s*:\s*(["'`])([^"'`$\n]*)\1/g)) {
        const value = match[2];
        if (value === "" || value.startsWith("#") || (value.startsWith("/") && !value.startsWith("//")) || /^(?:mailto|tel):/i.test(value)) checkLink(value, at(match.index!));
      }
      for (const match of code.matchAll(/style=\{\{([^{}]*)\}\}/g)) {
        const pick = (name: string) => new RegExp(`\\b${name}\\s*:\\s*(["'\`])([^"'\`]+)\\1`).exec(match[1])?.[2];
        checkPair(pick("color"), pick("background(?:Color)?"), at(match.index!));
      }
    }
    if (path === "index.html") {
      const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(content)?.[1].trim() ?? "";
      if (!title || /^(?:vite \+ react(?: \+ ts)?|react app|website|my website|document|untitled|home|index|title|site|t)$/i.test(title) || placeholder(title)) add("page-title", at(Math.max(0, content.search(/<title\b|<\/head>/i))));
      if (!/<meta\b[^>]*name=["']description["'][^>]*content=["'][^"']+["']|<meta\b[^>]*content=["'][^"']+["'][^>]*name=["']description["']/i.test(content)) add("meta-description", at(Math.max(0, content.search(/<\/head>/i))));
      if (!/<html\b[^>]*\blang=["'][a-z]{2}/i.test(content)) add("html-lang", at(Math.max(0, content.search(/<html\b/i))));
    }
  }

  // The rendered pages catch what code builds from data (links, images, text).
  for (const page of input.pages ?? []) {
    const where = `page ${page.path}`;
    for (const tag of tags(page.html, "a|img|area")) {
      if (tag.name === "img") checkImage(tag, where);
      else if (!tag.attrs.has("data-makeborne-attribution")) checkLink(tag.attrs.get("href"), where);
    }
    checkText(plain(page.html), where);
  }

  return [...found.entries()]
    .map(([rule, entry]) => ({ rule, ...RULES[rule], locations: entry.locations, count: entry.count }))
    .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || Object.keys(RULES).indexOf(a.rule) - Object.keys(RULES).indexOf(b.rule));
}

/** Counts per severity for a summary line. */
export function clientReadySummary(findings: readonly ClientReadyFinding[]) {
  return { error: findings.filter(finding => finding.severity === "error").length, warning: findings.filter(finding => finding.severity === "warning").length, info: findings.filter(finding => finding.severity === "info").length };
}

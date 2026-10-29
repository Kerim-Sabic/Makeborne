/**
 * Linear-time scanning of untrusted HTML (fetched pages are up to 600 KB).
 *
 * Patterns such as `<meta\b[^>]*>`, `<p\b[^>]*>([\s\S]*?)<\/p>` or
 * `<!--[\s\S]*?-->` backtrack across the whole document from every start when
 * the construct is never finished (`<a<a<a…` with no `>`, `<p>x<p>x…` with no
 * `</p>`), so a hostile page costs O(n²) CPU on the request thread.
 *
 * Each helper below returns exactly what the regular expression in its comment
 * returns (the same matches in the same order, case-insensitive like the `i`
 * flag), but a start that cannot succeed is never retried from a later start
 * that would fail for the same reason:
 * - an open tag whose `>` is missing means no later tag can close either;
 * - an element whose `</name>` is missing means no later element of that name
 *   can close either;
 * - a failed start inside a tag fails for every later start inside that tag.
 * src/lib/html/check-html-scan.cjs compares every helper with its regular
 * expression on random input and times adversarial 600 KB pages.
 *
 * Tag names given as lists must be lower case, letters and digits only, and no
 * name may be a prefix of another (true of every caller).
 */

const isAlpha = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isAlnum = (code: number) => isAlpha(code) || (code >= 48 && code <= 57);
const isWord = (code: number) => isAlnum(code) || code === 95;
const lower = (code: number) => code >= 65 && code <= 90 ? code + 32 : code;

/** `s` has the lower-case ASCII literal `literal` at `pos`, ignoring ASCII case. */
function literalAt(s: string, pos: number, literal: string) {
  if (pos + literal.length > s.length) return false;
  for (let k = 0; k < literal.length; k++) if (lower(s.charCodeAt(pos + k)) !== literal.charCodeAt(k)) return false;
  return true;
}

const finders = new Map<string, RegExp>();
/** First index ≥ `from` of `literal` (lower case), ignoring ASCII case, or -1. A literal search never backtracks. */
export function indexOfCI(s: string, literal: string, from: number) {
  let re = finders.get(literal);
  if (!re) { re = new RegExp(literal.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "gi"); finders.set(literal, re); }
  re.lastIndex = from;
  return re.exec(s)?.index ?? -1;
}

/** Remembers the last answer so that a scan asking with growing `from` reads the document once. */
class Finder {
  private from = Number.POSITIVE_INFINITY;
  private at = -1;
  constructor(private readonly s: string, private readonly literal: string, private readonly caseless: boolean) {}
  next(from: number) {
    if (from >= this.from && (this.at === -1 || this.at >= from)) return this.at;
    this.from = from;
    this.at = this.caseless ? indexOfCI(this.s, this.literal, from) : this.s.indexOf(this.literal, from);
    return this.at;
  }
}

const starts = new Map<string, RegExp>();
/**
 * Index ≥ `from` of the next `<` (or `<` + optional `/`) that is followed by one of
 * `names` (any letter when null), ignoring case, or -1. A literal search finds
 * candidates natively, so a page of bare `<` costs one pass, not one step per `<`.
 */
function nextStart(s: string, from: number, names: readonly string[] | null, slash = false) {
  const key = `${slash ? "/" : ""}${names ? names.join("|") : "*"}`;
  let re = starts.get(key);
  if (!re) { re = new RegExp(`<${slash ? "\\/?" : ""}${names ? `(?:${names.join("|")})` : "[a-z]"}`, "gi"); starts.set(key, re); }
  re.lastIndex = from;
  return re.exec(s)?.index ?? -1;
}

/**
 * End of the tag name at `pos` (just after `<` or `</`), or -1.
 * names null: `[a-z][a-z0-9]*` (greedy, so `\b` only fails on `_`).
 */
function nameEnd(s: string, pos: number, names: readonly string[] | null, boundary: boolean) {
  if (names === null) {
    if (pos >= s.length || !isAlpha(s.charCodeAt(pos))) return -1;
    let end = pos + 1;
    while (end < s.length && isAlnum(s.charCodeAt(end))) end++;
    return boundary && end < s.length && isWord(s.charCodeAt(end)) ? -1 : end;
  }
  for (const name of names) {
    if (!literalAt(s, pos, name)) continue;
    const end = pos + name.length;
    if (!boundary || end >= s.length || !isWord(s.charCodeAt(end))) return end;
  }
  return -1;
}

/** `s.replace(/<!--[\s\S]*?-->/g, replacement)` */
export function stripComments(s: string, replacement = " ") {
  let out = "", from = 0, at = s.indexOf("<!--");
  while (at !== -1) {
    const close = s.indexOf("-->", at + 4);
    if (close === -1) break;
    out += s.slice(from, at) + replacement;
    from = close + 3;
    at = s.indexOf("<!--", from);
  }
  return from === 0 ? s : out + s.slice(from);
}

/** `s.replace(/<[^>]+>/g, replacement)` */
export function stripTags(s: string, replacement = " ") {
  let out = "", from = 0, at = s.indexOf("<");
  while (at !== -1) {
    const close = s.indexOf(">", at + 1);
    if (close === -1) break;
    if (close === at + 1) { at = s.indexOf("<", at + 1); continue; }
    out += s.slice(from, at) + replacement;
    from = close + 1;
    at = s.indexOf("<", from);
  }
  return from === 0 ? s : out + s.slice(from);
}

export type Tag = { start: number; end: number; name: string; attrs: string; raw: string };
/**
 * The next match at or after `from` of `/<(names)\b([^>]*)>/gi`
 * (names null: `/<([a-z][a-z0-9]*)\b([^>]*)>/gi`; boundary false drops `\b`).
 * `name` is lower case.
 */
export function nextTag(s: string, from: number, names: readonly string[] | null = null, boundary = true): Tag | null {
  for (let at = nextStart(s, from, names); at !== -1; at = nextStart(s, at + 1, names)) {
    const end = nameEnd(s, at + 1, names, boundary);
    if (end === -1) continue;
    const close = s.indexOf(">", end);
    if (close === -1) return null;
    return { start: at, end: close + 1, name: s.slice(at + 1, end).toLowerCase(), attrs: s.slice(end, close), raw: s.slice(at, close + 1) };
  }
  return null;
}
/** `s.match(/<(names)\b[^>]*>/gi) ?? []` */
export function tags(s: string, names: readonly string[] | null, boundary = true) {
  const out: string[] = [];
  for (let tag = nextTag(s, 0, names, boundary); tag; tag = nextTag(s, tag.end, names, boundary)) out.push(tag.raw);
  return out;
}

/** The next match at or after `from` of `/<(\/?)name\b[^>]*>/gi`, with whether it closes. */
export function nextOpenOrClose(s: string, from: number, name: string): { start: number; end: number; closing: boolean; raw: string } | null {
  const names = [name];
  for (let at = nextStart(s, from, names, true); at !== -1; at = nextStart(s, at + 1, names, true)) {
    const closing = s.charCodeAt(at + 1) === 47;
    const end = nameEnd(s, at + (closing ? 2 : 1), names, true);
    if (end === -1) continue;
    const close = s.indexOf(">", end);
    if (close === -1) return null;
    return { start: at, end: close + 1, closing, raw: s.slice(at, close + 1) };
  }
  return null;
}

export type Element = { start: number; end: number; name: string; content: string; raw: string };
/**
 * Every match of an element pattern, in order:
 * - open "tag": `/<(names)\b[^>]*>([\s\S]*?)<\/\1>/gi` (content is group 2);
 * - open "name": `/<(names)\b[\s\S]*?<\/\1>/gi` (content runs from the name).
 * boundary false drops `\b`. `limit` stops after that many matches.
 */
export function elements(s: string, names: readonly string[], options: { open: "tag" | "name"; boundary?: boolean; limit?: number }): Element[] {
  const out: Element[] = [], boundary = options.boundary ?? true, limit = options.limit ?? Number.POSITIVE_INFINITY;
  // A name whose closing tag no longer appears is dropped: no later element of that name can close.
  let alive = names;
  let at = nextStart(s, 0, alive);
  while (at !== -1 && out.length < limit) {
    const end = nameEnd(s, at + 1, alive, boundary);
    const name = end === -1 ? "" : s.slice(at + 1, end).toLowerCase();
    if (end === -1) { at = nextStart(s, at + 1, alive); continue; }
    let contentStart = end;
    if (options.open === "tag") {
      const close = s.indexOf(">", end);
      if (close === -1) break;
      contentStart = close + 1;
    }
    const closeAt = indexOfCI(s, `</${name}>`, contentStart);
    if (closeAt === -1) { alive = alive.filter(item => item !== name); if (!alive.length) break; at = nextStart(s, at + 1, alive); continue; }
    const stop = closeAt + name.length + 3;
    out.push({ start: at, end: stop, name, content: s.slice(contentStart, closeAt), raw: s.slice(at, stop) });
    at = nextStart(s, stop, alive);
  }
  return out;
}
/** `elements(...)[0]`, i.e. the first match (what `.exec` without `g` returns). */
export const firstElement = (s: string, names: readonly string[], options: { open: "tag" | "name"; boundary?: boolean }) => elements(s, names, { ...options, limit: 1 })[0];
/** `s.replace(<element pattern>, replacement)` */
export function replaceElements(s: string, names: readonly string[], options: { open: "tag" | "name"; boundary?: boolean }, replacement = " ") {
  const found = elements(s, names, options);
  if (!found.length) return s;
  let out = "", from = 0;
  for (const item of found) { out += s.slice(from, item.start) + replacement; from = item.end; }
  return out + s.slice(from);
}

/**
 * `pattern.test(s)` for a pattern of the form `<name` + (`\b`) + `[^>]*` or `[^>]+` + rest,
 * given as `sticky` (the same pattern with the `y` flag). A start that fails is
 * skipped to the end of its tag, because every later start inside the tag can
 * only try the same rest.
 */
export function tagTest(s: string, name: string, boundary: boolean, sticky: RegExp) {
  if (!sticky.sticky) throw new Error("tagTest needs a sticky pattern");
  const names = [name];
  for (let at = nextStart(s, 0, names); at !== -1; at = nextStart(s, at + 1, names)) {
    const end = nameEnd(s, at + 1, names, boundary);
    if (end === -1) continue;
    sticky.lastIndex = at;
    if (sticky.test(s)) return true;
    const close = s.indexOf(">", end);
    if (close === -1) return false;
    at = close;
  }
  return false;
}

/**
 * Group 1 of every match of `/<script[^>]+application\/ld\+json[^>]*>([\s\S]{0,max}?)<\/script>/gi`
 * (max Infinity: `[\s\S]*?`).
 */
export function jsonLdBlocks(s: string, max = Number.POSITIVE_INFINITY) {
  const out: string[] = [], marker = new Finder(s, "application/ld+json", true), closer = new Finder(s, "</script>", true), names = ["script"];
  for (let at = nextStart(s, 0, names); at !== -1; at = nextStart(s, at + 1, names)) {
    const end = nameEnd(s, at + 1, names, false);
    if (end === -1) continue;
    const close = s.indexOf(">", end);
    if (close === -1) break;
    // `[^>]+` takes at least one character, and the marker has no `>`, so it sits inside this tag.
    const mark = marker.next(end + 1);
    const closeAt = mark !== -1 && mark + 19 <= close ? closer.next(close + 1) : -1;
    if (mark !== -1 && mark + 19 <= close && closeAt === -1) break;
    if (closeAt !== -1 && closeAt - (close + 1) <= max) { out.push(s.slice(close + 1, closeAt)); at = closeAt + 8; continue; }
    at = close;
  }
  return out;
}

const SPACE = /\s/;
const HREF = /\shref\s*=\s*["']([^"']{1,500})["']/iy;
/**
 * `[href, label]` of every match of
 * `/<a\b[^>]*\shref\s*=\s*["']([^"']{1,500})["'][^>]*>([\s\S]{0,300}?)<\/a>/gi`.
 * The greedy `[^>]*` tries the last `href` in the tag first, as the pattern does.
 */
export function anchorsWithHref(s: string): [string, string][] {
  const out: [string, string][] = [], names = ["a"], closer = new Finder(s, "</a>", true), hrefs = new Finder(s, "href", true);
  // A label is at most 300 characters, so a label after an unusual tag end is looked for in a short slice.
  const nearby = (from: number) => { const at = indexOfCI(s.slice(from, from + 304), "</a>", 0); return at === -1 ? -1 : from + at; };
  for (let at = nextStart(s, 0, names); at !== -1; at = nextStart(s, at + 1, names)) {
    const end = nameEnd(s, at + 1, names, true);
    if (end === -1) continue;
    const close = s.indexOf(">", end);
    if (close === -1) break;
    const candidates: number[] = [];
    for (let h = hrefs.next(end + 1); h !== -1 && h <= close; h = hrefs.next(h + 1)) if (SPACE.test(s[h - 1])) candidates.push(h - 1);
    let afterTag: number | undefined, nextClose: number | undefined, found = false;
    for (let k = candidates.length - 1; k >= 0 && !found; k--) {
      HREF.lastIndex = candidates[k];
      const value = HREF.exec(s);
      if (!value) continue;
      // `[^>]*>` after the closing quote: this tag's `>`, unless the value itself ran past it.
      const quote = HREF.lastIndex - 1;
      let tagEnd: number;
      if (quote < close) tagEnd = close;
      else {
        nextClose ??= s.indexOf(">", close + 1);
        tagEnd = nextClose !== -1 && quote < nextClose ? nextClose : s.indexOf(">", quote + 1);
      }
      if (tagEnd === -1) continue;
      let closeAt: number;
      if (tagEnd === close) { afterTag ??= closer.next(close + 1); closeAt = afterTag !== -1 && afterTag - (close + 1) <= 300 ? afterTag : -1; }
      else closeAt = nearby(tagEnd + 1);
      if (closeAt === -1) continue;
      out.push([value[1], s.slice(tagEnd + 1, closeAt)]);
      at = closeAt + 3; found = true;
    }
    if (!found) at = close;
  }
  return out;
}

/** Group 1 of every match of `/fonts\.googleapis\.com\/css2?\?[^"'>]*family=([^"'&>:]+)/gi`. */
export function googleFontFamilies(s: string) {
  const out: string[] = [], host = "fonts.googleapis.com/css", family = new Finder(s, "family=", true);
  const stopsWindow = (code: number) => code === 34 || code === 39 || code === 62;
  const stopsName = (code: number) => code === 34 || code === 39 || code === 38 || code === 62 || code === 58;
  let at = indexOfCI(s, host, 0);
  while (at !== -1) {
    let q = at + host.length;
    if (s.charCodeAt(q) === 50 && s.charCodeAt(q + 1) === 63) q += 2;
    else if (s.charCodeAt(q) === 63) q += 1;
    else { at = indexOfCI(s, host, at + 1); continue; }
    let windowEnd = q;
    while (windowEnd < s.length && !stopsWindow(s.charCodeAt(windowEnd))) windowEnd++;
    // Greedy `[^"'>]*`: the last `family=` in the window that is followed by a name character.
    let best = -1;
    for (let k = family.next(q); k !== -1 && k + 7 <= windowEnd; k = family.next(k + 1)) {
      if (k + 7 < s.length && !stopsName(s.charCodeAt(k + 7))) best = k;
    }
    if (best === -1) { at = indexOfCI(s, host, Math.max(windowEnd, at + 1)); continue; }
    let stop = best + 7;
    while (stop < s.length && !stopsName(s.charCodeAt(stop))) stop++;
    out.push(s.slice(best + 7, stop));
    at = indexOfCI(s, host, stop);
  }
  return out;
}

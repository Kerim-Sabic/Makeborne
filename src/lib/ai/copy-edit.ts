/**
 * Copy edits: requests that replace, correct or remove existing content with values the customer gives
 * explicitly ("Change the phone number to +387 61 123 456", "Replace "Book now" with "Reserve a table"",
 * "Promijeni radno vrijeme subotom na 10:00–14:00"). They are the cheapest class to route down, because the
 * result can be checked without any model: the new values must appear, the old ones must go, and nothing
 * else may change. Pure: no SDK, database or server-only imports.
 */

/** Quoted text in the quote styles customers type (straight, curly, low-high, guillemets, single quotes
 * that are not apostrophes). */
const QUOTED = /"([^"\n]{1,200})"|“([^”\n]{1,200})”|„([^“”\n]{1,200})[“”]|«([^»\n]{1,200})»|(?<![\p{L}\d])'([^'\n]{2,200})'(?![\p{L}\d])/gu;
const PHONE = /\+?\(?\d[\d ()/.-]{6,}\d/g, EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Values that are specific without quotes: phone numbers, emails, links, times, prices. */
const VALUE_PATTERNS = [PHONE, EMAIL, /https?:\/\/[^\s"'<>]+/g,
  /\b\d{1,2}[:.]\d{2}(?:\s?[–-]\s?\d{1,2}[:.]\d{2})?\b/g,
  /(?:[$€£]\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:KM|BAM|EUR|USD|GBP|kn|din|€|\$))(?![\w])/gi];
/** Whole words in any script (\b only knows ASCII letters, so it fails after š, č or ž). */
const words = (alternatives: string) => `(?<![\\p{L}\\d])(?:${alternatives})(?![\\p{L}\\d])`;
const REMOVE = "delete|remove|obriši|obrisi|izbriši|izbrisi|ukloni\\p{L}*";
/** Asking for a replacement, correction or removal (English and Bosnian/Croatian/Serbian). */
const COPY_VERBS = new RegExp(words(`change|replace|rename|update|correct|fix|set|swap|reword|make it (?:say|read)|should (?:say|read)|instead of|${REMOVE}|promijeni\\p{L}*|promjeni\\p{L}*|zamijeni\\p{L}*|izmijeni\\p{L}*|ispravi\\p{L}*|stavi|postavi|umjesto`), "iu");
/** Adding structure, or changing appearance or behaviour, is not a copy edit. */
const NOT_COPY = new RegExp(words("add|insert|create|new|include|layout|design|style|styling|colou?rs?|background|border|shadow|font|bold|italic|bold\\p{L}*|hero|bigger|smaller|larger|size|spacing|margin|padding|align\\p{L}*|cent(?:er|re)\\p{L}*|width|height|stack|columns?|grid|image|photo|picture|icon|logo|animat\\p{L}*|hover|responsive|form|dodaj\\p{L}*|novi|nova|novu|boj\\p{L}*|pozadin\\p{L}*|slik\\p{L}*|font\\p{L}*"), "iu");
/** Removing a whole block changes the page's structure. */
const STRUCTURAL_REMOVAL = new RegExp(`${words(REMOVE)}[^.!?\\n]*${words("sections?|pages?|blocks?|strips?|cards?|menus?|footer|header|nav\\p{L}*|sekcij\\p{L}*|stranic\\p{L}*|meni\\p{L}*")}`, "iu");

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const digits = (text: string) => text.replace(/\D/g, "");

type Kind = "text" | "phone" | "email" | "link" | "time" | "price";
const PATTERN_KINDS: readonly Kind[] = ["phone", "email", "link", "time", "price"];
/** Any value of a kind on a line (no global flag: these are tested line by line). */
const KIND_ON_LINE: Readonly<Record<Exclude<Kind, "text">, RegExp>> = {
  phone: /tel:|\+?\(?\d[\d ()/.-]{6,}\d/, email: /[\w.+-]+@[\w-]+\.[\w-]+/, link: /https?:\/\//, time: /\d{1,2}[:.]\d{2}/,
  price: /[$€£]\s?\d|\d\s?(?:KM|BAM|EUR|USD|GBP|kn|din|€)(?![\w])/i,
};
type Value = { text: string; kind: Kind };
const isContact = (value: Value) => value.kind === "phone" || value.kind === "email";
function values(request: string): Value[] {
  const found = new Map<string, Value>();
  for (const match of request.matchAll(QUOTED)) {
    const text = normalize(match.slice(1).find(Boolean) ?? "");
    if (text) found.set(text, { text, kind: "text" });
  }
  const unquoted = request.replace(QUOTED, " ");
  VALUE_PATTERNS.forEach((pattern, index) => {
    for (const match of unquoted.matchAll(pattern)) {
      // A value at the end of a sentence ("... to $1,350.") does not include the full stop.
      const text = normalize(match[0]).replace(/[.,;:!?]+$/, "");
      if (!found.has(text)) found.set(text, { text, kind: PATTERN_KINDS[index] });
    }
  });
  return [...found.values()];
}

/** The request without its quoted text: what the customer asks for, not the words they want on the page. */
export const withoutQuoted = (request: string) => request.replace(QUOTED, " ");

/** The explicit values a request names, in order (quoted text first, then specific values). */
export const explicitValues = (request: string) => values(request).map(value => value.text);

/** A replacement, correction or removal with one to six explicit values, and nothing that adds, restyles or removes a block. */
export function looksLikeCopyEdit(request: string): boolean {
  const named = explicitValues(request), outside = request.replace(QUOTED, " ");
  return named.length > 0 && named.length <= 6 && COPY_VERBS.test(outside) && !NOT_COPY.test(outside) && !STRUCTURAL_REMOVAL.test(outside);
}

const count = (haystack: string, needle: string) => {
  if (!needle) return 0;
  let n = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) n++;
  return n;
};
/** Occurrences across the project with whitespace collapsed; phone numbers by their last nine digits, so tel: links and
 * national or international formats of the same number (0131 496 0412, +44 131 496 0412) count too. */
function occurrences(files: ReadonlyMap<string, string>, value: Value) {
  const phone = value.kind === "phone", needle = phone ? digits(value.text).slice(-9) : value.text;
  let n = 0;
  for (const content of files.values()) n += count(phone ? digits(content) : normalize(content), needle);
  return n;
}
/** Whether one line carries a value: a phone number by its last nine digits, a time range also when its two times are
 * written apart ("between 07:30 and 14:00"). */
function mentions(line: string, value: Value) {
  if (value.kind === "phone") return digits(line).includes(digits(value.text).slice(-9));
  const text = normalize(line), range = value.kind === "time" ? value.text.split(/\s?[–-]\s?/) : [];
  return text.includes(value.text) || (range.length === 2 && range.every(time => text.includes(time)));
}

/** The distinct phone numbers (by digits, from tel: links) or emails in a project. */
function contacts(files: ReadonlyMap<string, string>, kind: "phone" | "email"): string[] {
  const found = new Set<string>();
  for (const content of files.values()) {
    if (kind === "phone") for (const match of content.matchAll(/tel:([+\d][\d\s().-]{5,})/g)) found.add(digits(match[1]));
    else for (const match of content.matchAll(EMAIL)) found.add(match[0].toLowerCase());
  }
  return [...found].filter(Boolean);
}

/** Lines removed and added between two versions of one file (longest common subsequence after trimming the shared
 * start and end; a change too large to compare counts as replacing everything in between). */
export function lineDiff(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split("\n"), b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const x = a.slice(start, endA), y = b.slice(start, endB);
  if (x.length * y.length > 1_000_000) return { removed: x, added: y };
  const table = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const removed: string[] = [], added: string[] = [];
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { i++; j++; } else if (table[i + 1][j] >= table[i][j + 1]) removed.push(x[i++]); else added.push(y[j++]);
  }
  return { removed: [...removed, ...x.slice(i)], added: [...added, ...y.slice(j)] };
}
/** How many lines a change removed and added. */
export function lineChanges(before: string, after: string): { removed: number; added: number } {
  const diff = lineDiff(before, after);
  return { removed: diff.removed.length, added: diff.added.length };
}

/** Limits for a copy edit's footprint. A changed line is explained when it carries a named value (new or old), a value
 * of the kind being replaced when the old one isn't named, or (a removal) is a shortened removed line; a value that
 * appears nine times may change eighteen lines, but only a few lines may change without carrying one. */
export const COPY_EDIT_LIMITS = Object.freeze({ files: 8, unexplainedLines: 4, maxLines: 80, netLines: 4 });

/**
 * What a copy edit's result fails, with no model call: files added or removed, too many files touched, changed lines that
 * carry none of the requested values, structure added or dropped, a new value missing, an old value still in place, or
 * an old phone number or email left anywhere (tel: and mailto: links included). Empty: the change is what was asked. The
 * findings are the repair notes when the attempt is retried. allowStylesheetFixes: the builder's own finish checks asked
 * for fixes during the run (a layout already cut off at 360 px, say), so stylesheet changes are the platform's, not the
 * model's; they still had to pass those checks.
 */
export function copyEditFindings(input: { request: string; before: ReadonlyMap<string, string>; after: ReadonlyMap<string, string>; allowStylesheetFixes?: boolean }): string[] {
  const { before, after } = input, findings: string[] = [];
  const created = [...after.keys()].filter(path => !before.has(path)), deleted = [...before.keys()].filter(path => !after.has(path));
  if (created.length || deleted.length) findings.push(`A copy edit must not add or delete files (${[...created, ...deleted].slice(0, 3).join(", ")}).`);
  const changed = [...after.keys()].filter(path => before.has(path) && before.get(path) !== after.get(path) && !(input.allowStylesheetFixes && path.endsWith(".css")));
  if (!changed.length && !created.length && !deleted.length && !(input.allowStylesheetFixes && [...after.keys()].some(path => before.get(path) !== after.get(path)))) findings.push("Nothing was changed.");
  if (changed.length > COPY_EDIT_LIMITS.files) findings.push(`Only the text that was asked for may change; ${changed.length} files changed.`);
  const named = values(input.request);
  // A value already in the project is one to replace or remove; a value not yet there is one to add.
  const old = named.filter(value => occurrences(before, value) > 0), fresh = named.filter(value => occurrences(before, value) === 0);
  // "Change the phone number to X" names no old number: when the project has exactly one of that kind, it is the one replaced.
  const implied: Value[] = fresh.filter(isContact).flatMap(value => {
    const existing = contacts(before, value.kind as "phone" | "email");
    return !old.some(item => item.kind === value.kind) && existing.length === 1 ? [{ text: existing[0], kind: value.kind }] : [];
  });
  const replacing = [...old, ...implied];
  // Kinds whose old value nobody named ("Change the opening hours to 09:00–17:30"): any value of that kind may go.
  const unnamed = [...new Set(fresh.filter(value => value.kind !== "text" && !replacing.some(item => item.kind === value.kind)).map(value => value.kind as Exclude<Kind, "text">))];
  let total = 0, net = 0, unexplained = 0, removedChars = 0, addedChars = 0;
  const stray: string[] = [];
  for (const path of changed) {
    const diff = lineDiff(before.get(path)!, after.get(path)!);
    total += diff.removed.length + diff.added.length; net += diff.added.length - diff.removed.length;
    const explained = diff.removed.filter(line => replacing.some(value => mentions(line, value)) || unnamed.some(kind => KIND_ON_LINE[kind].test(line)));
    const longest = Math.max(0, ...explained.map(line => line.trim().length));
    const added = diff.added.filter(line => !fresh.some(value => mentions(line, value)) && !(!fresh.length && line.trim().length < longest) && !unnamed.some(kind => KIND_ON_LINE[kind].test(line))).length;
    unexplained += diff.removed.length - explained.length + added;
    // A file that changed without any requested value in it was changed for another reason, except a removal deleting the
    // few stylesheet lines that only styled what it removed (it adds nothing).
    const cleanup = old.length > 0 && !fresh.length && path.endsWith(".css") && !diff.added.length && diff.removed.length <= COPY_EDIT_LIMITS.unexplainedLines;
    if (!explained.length && added === diff.added.length && !cleanup) stray.push(path);
    removedChars += diff.removed.reduce((sum, line) => sum + line.trim().length, 0); addedChars += diff.added.reduce((sum, line) => sum + line.trim().length, 0);
  }
  if (stray.length) findings.push(`Only the text that was asked for may change; ${stray.slice(0, 3).join(", ")} changed without any of the requested values.`);
  else if (total > COPY_EDIT_LIMITS.maxLines || unexplained > COPY_EDIT_LIMITS.unexplainedLines) findings.push(`Only the text that was asked for may change; ${unexplained} changed lines carry none of the requested values.`);
  if (Math.abs(net) > COPY_EDIT_LIMITS.netLines) findings.push("A copy edit must keep the page structure: lines were added or removed beyond the replaced text.");
  for (const value of fresh) if (occurrences(after, value) === 0) findings.push(`The new text "${value.text}" does not appear in the project.`);
  if (old.length && !old.some(value => occurrences(after, value) < occurrences(before, value))) {
    findings.push(fresh.length ? `The text to replace ("${old[0].text}") is still in place.` : `The text to remove ("${old[0].text}") is still in place.`);
  } else if (old.length && !fresh.length && addedChars > removedChars - Math.min(...old.map(value => value.text.length)) + 2) {
    // A removal leaves less text than it found; rewording the text is not removing it.
    findings.push(`The text to remove ("${old[0].text}") was reworded instead of removed.`);
  }
  // An old phone number or email that stays anywhere (a tel: or mailto: link, the footer) still reaches the wrong person.
  if (fresh.length) for (const value of replacing) if (isContact(value) && occurrences(after, value) > 0) findings.push(`The old contact "${value.text}" is still used somewhere, for example in a tel: or mailto: link.`);
  return findings;
}

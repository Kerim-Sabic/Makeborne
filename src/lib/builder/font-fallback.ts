/** Which characters of approved text the embedded font files can't draw
 * (audit FNT §5.7). Websites and documents embed only the Latin and Latin
 * Extended subsets of each catalogue face, so any other letter (Greek,
 * Cyrillic, Vietnamese tone marks, CJK...) is drawn by whatever fallback font
 * the reader's device has. Pure and client-safe; no network.
 *
 * Limits: this compares code points with the subsets' declared unicode-range
 * (the same ranges the @font-face rules use), after NFC normalisation. It does
 * not open the font files, so it can't see a glyph missing inside a declared
 * range (check-font-coverage.cjs qualifies those against every face's cmap),
 * and it can't tell which fallback font a device will pick. Emoji, symbols
 * from icon fonts (private use) and invisible formatting characters are not
 * reported: they are expected to come from other fonts. */
import { UNICODE_RANGES, type FontSubset } from "./fonts";

const RANGES = (Object.values(UNICODE_RANGES) as string[]).flatMap(range => range.split(",").map(part => {
  const [low, high = low] = part.trim().slice(2).split("-").map(value => parseInt(value, 16));
  return [low, high] as const;
}));
const covered = (point: number) => RANGES.some(([low, high]) => point >= low && point <= high);
/** Expected to come from another font, or never drawn at all. */
const IGNORED = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{E0020}-\u{E007F}‍⃣\p{Co}\p{Cc}\p{Cf}\p{White_Space}\p{Cs}]/u;

export const EMBEDDED_SUBSETS: readonly FontSubset[] = ["latin", "latin-ext"];

/** NFC form, used before choosing font subsets: "c" + U+030C (combining caron)
 * becomes the single letter "č" that the Latin Extended file contains. */
export const nfc = (text: string) => text.normalize("NFC");

/** Unique characters (after NFC) outside every embedded subset, in first-seen order. */
export function uncoveredCharacters(text: string): string[] {
  const found = new Set<string>();
  for (const char of nfc(text)) {
    const point = char.codePointAt(0)!;
    if (point < 0x80 || covered(point) || IGNORED.test(char)) continue;
    found.add(char);
  }
  return [...found];
}

/** Letters typed as a base letter plus separate accent marks that NFC joins
 * into one letter, e.g. "č" → "č". Shown as "c + ˇ → č". */
export function decomposedLetters(text: string): { typed: string; letter: string }[] {
  const found = new Map<string, string>();
  for (const match of text.matchAll(/\P{M}\p{M}+/gu)) {
    const letter = nfc(match[0]);
    if (letter !== match[0] && !found.has(match[0])) found.set(match[0], letter);
  }
  return [...found].map(([typed, letter]) => ({ typed, letter }));
}

/** "c + U+030C" style description of a decomposed sequence, readable without the font. */
export const describeTyped = (typed: string) => [...typed].map(char => /\p{M}/u.test(char) ? `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}` : char).join(" + ");

export type FontCoverage = {
  /** Characters the embedded fonts don't cover, with where they appear (at most 6 places each). */
  uncovered: { char: string; locations: string[]; count: number }[];
  decomposed: { typed: string; letter: string; locations: string[]; count: number }[];
};

/** Collects both findings over labelled text, e.g. [{ text, where: "src/App.tsx:12" }]. */
export function fontCoverage(texts: Iterable<{ text: string; where: string }>, maxLocations = 6): FontCoverage {
  const uncovered = new Map<string, { locations: string[]; count: number }>();
  const decomposed = new Map<string, { letter: string; locations: string[]; count: number }>();
  const note = <T extends { locations: string[]; count: number }>(entry: T, where: string) => {
    if (entry.locations.includes(where)) return;
    entry.count++;
    if (entry.locations.length < maxLocations) entry.locations.push(where);
  };
  for (const { text, where } of texts) {
    for (const char of uncoveredCharacters(text)) { const entry = uncovered.get(char) ?? { locations: [], count: 0 }; note(entry, where); uncovered.set(char, entry); }
    for (const { typed, letter } of decomposedLetters(text)) { const entry = decomposed.get(typed) ?? { letter, locations: [], count: 0 }; note(entry, where); decomposed.set(typed, entry); }
  }
  return {
    uncovered: [...uncovered].map(([char, entry]) => ({ char, ...entry })),
    decomposed: [...decomposed].map(([typed, entry]) => ({ typed, ...entry })),
  };
}

/** Every string value of a book or deck, labelled "chapter 2", "slide 3" or "details". */
export function documentTexts(value: unknown, where = ""): { text: string; where: string }[] {
  const place = () => {
    const match = /^\.(chapters|slides)\[(\d+)\]/.exec(where);
    return match ? `${match[1] === "chapters" ? "chapter" : "slide"} ${Number(match[2]) + 1}` : /^\.title$/.test(where) ? "title" : "details";
  };
  if (typeof value === "string") return [{ text: value, where: place() }];
  if (Array.isArray(value)) return value.flatMap((item, index) => documentTexts(item, `${where}[${index}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => documentTexts(item, `${where}.${key}`));
  return [];
}

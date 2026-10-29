import type { FontPairing } from "./schema";

/**
 * The reference art-direction pattern (owner, Kerim, 26 Oct 2026, pointing at Z:\makeborne-films\v14\gen: "i want these
 * examples to be how actual websites and presentations and books turn out"). Every generated page is described in one
 * precise paragraph: the brand, the exact layout split in percentages, the colours as words plus hex, the typeface
 * STYLE in words, every line of text quoted exactly with its line breaks, the accent words, the small furniture
 * (wordmark, page number) and the photographic subject in specific cinematic terms; then a fixed tail per format.
 * Pure helpers shared by slides and books.
 */

/** Fixed tails, from the reference's write_prompts.py (TAIL_SLIDE, TAIL_BOOK), with the shape filled in. */
export const tailSlide = (shape: string) => `A flat, straight-on ${shape} presentation slide filling the entire image (no laptop, no screen, no room, no perspective). Perfect alignment, generous margins, crisp vector-sharp typography. All text spelled exactly as given, perfectly legible, no extra words, no garbled letters.`;
export const tailBook = (shape: string) => `Flat, straight-on artwork filling the entire ${shape} image edge to edge: no mock-up, no table, no hands, no perspective, no visible book edges. Museum-quality book design. All text spelled exactly as given, perfectly legible, no extra words, no garbled letters.`;
/** The tail of a text-free image (plates, book art without words). */
export const tailNoText = (shape: string) => `Flat, straight-on artwork filling the entire ${shape} image edge to edge: no mock-up, no frame, no hands, no perspective. Absolutely no text, letters, numbers, logos or signatures anywhere.`;
export const AVOID_AI_LOOK = "Never the AI look: no oversaturated colour, HDR glow, lens flare, plastic or posed stock people, clip-art icons or random gradients; photographs read as real editorial photography, illustration as one consistent hand.";

const hsl = (hex: string) => {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
};
const HUES: [number, string][] = [[12, "red"], [26, "terracotta"], [34, "orange"], [50, "amber"], [66, "yellow"], [90, "lime"], [150, "green"], [172, "emerald"], [192, "teal"], [212, "sky blue"], [236, "cobalt blue"], [256, "indigo"], [285, "violet"], [320, "magenta"], [345, "pink"], [360, "red"]];
/** A colour in plain designer's words ("warm cream", "deep brown-black", "terracotta", "cobalt blue"). */
export function colourName(hex: string): string {
  if (!/^#?[0-9a-f]{6}/i.test(hex)) return "colour";
  const { h, s, l } = hsl(hex);
  const warm = h < 62 || h >= 340, cool = h >= 180 && h < 270;
  if (l < 0.16) return s < 0.12 ? "near-black" : warm ? "deep brown-black" : cool ? "deep navy-black" : h >= 62 && h < 180 ? "deep green-black" : "near-black";
  if (l > 0.97 && s < 0.3) return "white";
  if (s < 0.12 || (l > 0.9 && s < 0.25)) {
    const tint = s >= 0.04 ? (warm ? "warm " : cool ? "cool " : "") : "";
    return l > 0.93 ? `${tint}off-white` : l > 0.78 ? `${tint}light grey` : l > 0.5 ? `${tint}grey` : l > 0.28 ? `${tint}charcoal` : "near-black";
  }
  if (l > 0.86 && h >= 22 && h < 62) return "warm cream";
  if (h >= 14 && h < 46 && l < 0.36 && s < 0.65) return l < 0.26 ? "deep brown" : "brown";
  const hue = HUES.find(([edge]) => h < edge)?.[1] ?? "red";
  const shade = l > 0.85 ? "pale " : l > 0.7 ? "light " : l < 0.24 ? "very deep " : l < 0.36 ? "deep " : s > 0.8 && l > 0.42 && l < 0.65 ? "bright " : "";
  return `${shade}${hue}`;
}
/** "warm cream #F4EDE3". */
export const swatch = (hex: string) => `${colourName(hex)} ${hex.toUpperCase()}`;

/** Each pairing's typeface style in words (what the image model can draw; never a font name it cannot know). */
export const TYPE_STYLE: Readonly<Record<FontPairing, { heading: string; body: string; italicAccent: boolean }>> = Object.freeze({
  editorial: { heading: "assured editorial serif", body: "clean sans", italicAccent: true },
  modern: { heading: "neutral semibold sans", body: "neutral sans", italicAccent: false },
  geometric: { heading: "round geometric sans", body: "clean sans", italicAccent: false },
  classic: { heading: "traditional book serif", body: "traditional book serif", italicAccent: true },
  garamond: { heading: "literary old-style serif", body: "old-style serif", italicAccent: true },
  grotesk: { heading: "newsy bold grotesk", body: "plain sans", italicAccent: false },
  humanist: { heading: "friendly rounded humanist sans", body: "very legible sans", italicAccent: false },
  condensed: { heading: "industrial DIN-style condensed sans", body: "clean sans", italicAccent: false },
  fraunces: { heading: "warm, soft high-contrast serif", body: "crisp sans", italicAccent: true },
  instrument: { heading: "tall, elegant high-contrast display serif", body: "clean sans", italicAccent: true },
  playfair: { heading: "elegant high-contrast Didone serif", body: "clean geometric sans", italicAccent: true },
  newsreader: { heading: "refined editorial text serif", body: "editorial serif", italicAccent: true },
  "space-grotesk": { heading: "quirky techno-grotesk", body: "clean sans", italicAccent: false },
  bricolage: { heading: "characterful bold ink-trap grotesk", body: "friendly sans", italicAccent: false },
  sora: { heading: "wide, future-facing geometric sans", body: "clean sans", italicAccent: false },
  archivo: { heading: "huge bold condensed poster sans in capitals", body: "clean sans", italicAccent: false },
  geist: { heading: "precise Swiss neo-grotesk", body: "precise sans", italicAccent: false },
});

const wordCount = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0;
/** Line breaks for display type, as the reference writes them ("Fresh lemonade." / "Finally," / "on Mars."): the
 * writer's own breaks; else breaks after sentence punctuation when every piece is short; else balanced lines. */
export function displayLines(text: string, oneLineWords = 3): string[] {
  const clean = text.trim();
  if (clean.includes("\n")) return clean.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const words = clean.split(/\s+/);
  if (words.length <= oneLineWords) return [clean];
  const pieces = clean.split(/(?<=[.!?,;:—])\s+/).filter(Boolean);
  if (pieces.length > 1 && pieces.length <= 3 && pieces.every(piece => wordCount(piece) <= 4)) return pieces;
  const count = words.length <= 8 ? 2 : 3;
  // Balanced: choose the breaks that minimise the longest line (in characters).
  let best: string[] = [clean], bestLongest = Infinity;
  const tryBreaks = (breaks: number[]) => {
    const lines = [0, ...breaks, words.length].slice(1).map((end, i, all) => words.slice(i ? all[i - 1] : 0, end).join(" "));
    if (lines.some(line => !line)) return;
    const longest = Math.max(...lines.map(line => line.length));
    if (longest < bestLongest) { bestLongest = longest; best = lines; }
  };
  for (let a = 1; a < words.length; a++) {
    if (count === 2) tryBreaks([a]);
    else for (let b = a + 1; b < words.length; b++) tryBreaks([a, b]);
  }
  return best;
}
export const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six"];
/** "a" or "an" before a word. */
export const article = (word: string) => /^[aeiou]/i.test(word.trim()) ? `an ${word.trim()}` : `a ${word.trim()}`;
/** Capital first letter (a sentence that starts with a generated phrase). */
export const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** `on two lines "A second" / "oven."` or `"Sold out by 11 a.m."`. */
export function quotedLines(text: string, lines = displayLines(text)) {
  const quoted = lines.map(line => `"${line.replace(/"/g, "'")}"`).join(" / ");
  return lines.length > 1 ? `on ${NUMBER_WORDS[lines.length - 1] ?? lines.length} lines ${quoted}` : quoted;
}
/** True when the accent words are part of the text (case-insensitive, whitespace-normalised). */
export function accentInText(accent: string, text: string) {
  const norm = (value: string) => value.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();
  return Boolean(accent.trim()) && norm(text).includes(norm(accent));
}

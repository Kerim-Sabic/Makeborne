import { z } from "zod";
import { cropFor, cropMargins, resolveCell, type ResolvedCell } from "../ai/image-cells";
import type { ImageQuality, ImageSize } from "../ai/prices";
import type { ArtSystem, Concept, SectionPlan } from "./concept";

/**
 * Design comps written like the owner's reference images (Z:/makeborne-films/v14/gen/write_prompts.py, owner Kerim,
 * 26 Oct 2026: "i want these examples to be how actual websites ... turn out"): one precise art-direction paragraph per
 * screen (the brand, the colours with their hex values, the typeface style in words, the top navigation spelled out
 * with its pill, the layout as exact percentages, every line of text quoted with its line breaks, the accent words,
 * the photograph in specific cinematic terms), then a fixed tail (TAIL_SITE). Pure: no provider, no server.
 */

/** The reference's site tail, for a desktop screen (16:9). */
export const TAIL_SITE = "Flat, straight-on, pixel-perfect screenshot of the homepage filling the entire 16:9 image edge to edge: no browser chrome, no device, no hands, no desk, no perspective. Award-winning, distinctive design with its own typefaces and colours, crisp typography, generous whitespace. All text spelled exactly as given, perfectly legible, correctly kerned, no extra words, no garbled letters, no lorem ipsum.";
/** The same tail for the first phone screen. */
export const TAIL_PHONE = "Flat, straight-on, pixel-perfect screenshot of the phone screen filling the entire image edge to edge: no phone frame, no browser chrome, no hands, no desk, no perspective. Award-winning, distinctive design with its own typefaces and colours, crisp typography, generous whitespace. All text spelled exactly as given, perfectly legible, correctly kerned, no extra words, no garbled letters, no lorem ipsum.";

/** The comp's frame (what the stored comp shows and what read_comp's percentages refer to). */
export const COMP_SHAPE = { desktop: { width: 1440, height: 810 }, mobile: { width: 390, height: 844 } } as const;
/** Canvases per viewport: the native size first (used once measured), then measured canvases cropped to the shape. */
export const COMP_CANVASES: Readonly<Record<"desktop" | "mobile", readonly ImageSize[]>> = { desktop: ["2560x1440", "1536x1024"], mobile: ["1152x2496", "1024x1536"] };
/** Comps are made at high quality (the reference's quality), at medium only where no high canvas is measured. */
export const COMP_QUALITY: ImageQuality = "high";

/** The measured canvas and quality for a comp on this model, or a refusal. */
export function compCell(model: string, viewport: "desktop" | "mobile"): ResolvedCell {
  const ratio = COMP_SHAPE[viewport].width / COMP_SHAPE[viewport].height;
  const high = resolveCell(model, COMP_QUALITY, COMP_CANVASES[viewport], ratio);
  return high.ok ? high : resolveCell(model, "medium", COMP_CANVASES[viewport], ratio);
}

const hex = z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, "a #RRGGBB colour");
const words = (max: number) => z.string().trim().min(1).max(max);
export const CompInputSchema = z.object({
  section: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/, "Use the section id from the section plan."),
  viewport: z.enum(["desktop", "mobile"]),
  brand: words(40),
  mark: z.string().trim().max(80).optional(),
  colors: z.object({ ground: hex, ink: hex, accent: hex }).strict(),
  type: words(120),
  nav: z.array(words(24)).max(5).optional(),
  cta: z.object({ label: words(32), style: z.enum(["filled", "outlined"]), color: hex }).strict(),
  layout: z.array(z.object({ area: z.enum(["left", "right", "top", "bottom", "full"]), pct: z.number().int().min(10).max(100), content: words(300) }).strict()).min(1).max(3),
  lines: z.array(z.object({ role: z.enum(["headline", "subline", "eyebrow", "label"]), text: words(120) }).strict()).min(1).max(5),
  accent: z.object({ words: words(40), treatment: words(60) }).strict().optional(),
  subject: words(500),
  prompt: z.string().trim().max(1500).optional(),
}).strict();
export type CompInput = z.infer<typeof CompInputSchema>;

/** The JSON schema of generate_comp's input (the same fields, for the model). */
export const COMP_INPUT_JSON = {
  type: "object" as const,
  properties: {
    section: { type: "string", description: "The section id from the section plan" },
    viewport: { type: "string", enum: ["desktop", "mobile"] },
    brand: { type: "string", description: "The wordmark exactly as it appears (the business name)" },
    mark: { type: "string", description: "Optional: the wordmark's small mark, e.g. \"a small paw mark\", \"a crescent moon mark\"" },
    colors: { type: "object", description: "Exact hex values from the art system's palette", properties: { ground: { type: "string" }, ink: { type: "string" }, accent: { type: "string" } }, required: ["ground", "ink", "accent"], additionalProperties: false },
    type: { type: "string", description: "The headline typeface STYLE in words, e.g. \"huge bold condensed sans\", \"elegant high-contrast serif\", \"friendly rounded bold\"" },
    nav: { type: "array", items: { type: "string" }, description: "Desktop: the 2-4 top navigation items, exactly as written in the site's header" },
    cta: { type: "object", description: "The primary action pill: its exact label, filled or outlined, and its colour", properties: { label: { type: "string" }, style: { type: "string", enum: ["filled", "outlined"] }, color: { type: "string" } }, required: ["label", "style", "color"], additionalProperties: false },
    layout: { type: "array", description: "The screen as exact percentages (left + right = 100, or top + bottom = 100, or one full area): what fills each area, e.g. {area:'left', pct:46, content:'solid cobalt #1D3FA8 type field with the headline and the pill'}, {area:'right', pct:54, content:'full-bleed photograph'}",
      items: { type: "object", properties: { area: { type: "string", enum: ["left", "right", "top", "bottom", "full"] }, pct: { type: "integer" }, content: { type: "string" } }, required: ["area", "pct", "content"], additionalProperties: false } },
    lines: { type: "array", description: "Every line of words the screen shows besides the wordmark, navigation and pill, in reading order, exactly as the site will say it; break a headline into its lines with \" / \" (e.g. \"Fixed by / Friday.\")",
      items: { type: "object", properties: { role: { type: "string", enum: ["headline", "subline", "eyebrow", "label"] }, text: { type: "string" } }, required: ["role", "text"], additionalProperties: false } },
    accent: { type: "object", description: "Optional: the words set in the accent, and how (e.g. words \"Friday.\", treatment \"in lime\")", properties: { words: { type: "string" }, treatment: { type: "string" } }, required: ["words", "treatment"], additionalProperties: false },
    subject: { type: "string", description: "The photograph or drawing in specific, cinematic terms: subject, action, place, light, lens or technique, crop" },
    prompt: { type: "string", description: "Optional extra composition notes (overlaps, motif, empty space)" },
  },
  required: ["section", "viewport", "brand", "colors", "type", "cta", "layout", "lines", "subject"],
  additionalProperties: false,
};

const quote = (value: string) => `"${value.replace(/"/g, "'").trim()}"`;
const splitLines = (text: string) => text.split(/\s+\/\s+|\n/).map(part => part.trim()).filter(Boolean);
const NUMBER = ["one", "two", "three", "four", "five", "six"];
const wordCount = (text: string) => splitLines(text).join(" ").split(/\s+/).filter(Boolean).length;
/** At most this many words on a comp besides the navigation (image models set short copy well). */
export const COMP_WORDS = { desktop: 40, mobile: 30 } as const;

/** A plain colour name for a hex value, so the prompt reads like an art director's ("cobalt blue #1D3FA8"). */
export function colourName(value: string) {
  const n = parseInt(value.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + 6) % 6 * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  if (s < 0.12 || d < 0.06) return l > 0.93 ? "white" : l > 0.8 ? "pale grey" : l < 0.1 ? "near-black" : l < 0.3 ? "charcoal" : "grey";
  const hue = h < 12 || h >= 345 ? "red" : h < 28 ? "vermilion" : h < 42 ? "orange" : h < 52 ? "amber" : h < 64 ? "yellow" : h < 85 ? "lime" : h < 150 ? "green" : h < 175 ? "teal" : h < 200 ? "cyan" : h < 225 ? "sky blue" : h < 250 ? "cobalt blue" : h < 270 ? "indigo" : h < 295 ? "violet" : h < 330 ? "magenta" : "pink";
  if (l > 0.85) return h < 64 || h >= 330 ? (h >= 20 && h < 64 ? "warm cream" : "blush pink") : `pale ${hue}`;
  if (l > 0.65) return `light ${hue}`;
  if (l < 0.2) return h >= 12 && h < 52 ? "deep brown-black" : `deep ${hue}`;
  if (l < 0.35) return h < 12 || h >= 330 ? "deep burgundy" : `deep ${hue}`;
  return s > 0.75 && l > 0.45 ? `bright ${hue}` : hue;
}

/** Why a comp input cannot be drawn as written (the model rewrites it), or []. */
export function compInputIssues(input: CompInput): string[] {
  const issues: string[] = [];
  const sum = (areas: string[]) => input.layout.filter(item => areas.includes(item.area)).reduce((total, item) => total + item.pct, 0);
  const areas = new Set(input.layout.map(item => item.area));
  if (areas.has("full") && input.layout.length > 1) issues.push("layout: a full area is the whole screen; give no other areas with it");
  else if (areas.has("full") && input.layout[0].pct !== 100) issues.push("layout: a full area is 100%");
  else if ((areas.has("left") || areas.has("right")) && sum(["left", "right"]) !== 100) issues.push(`layout: left + right must be 100% (they are ${sum(["left", "right"])}%)`);
  else if ((areas.has("top") || areas.has("bottom")) && sum(["top", "bottom"]) !== 100) issues.push(`layout: top + bottom must be 100% (they are ${sum(["top", "bottom"])}%)`);
  if (new Set(input.layout.map(item => item.area)).size !== input.layout.length) issues.push("layout: each area once");
  if (!input.lines.some(line => line.role === "headline")) issues.push("lines: the screen needs its headline (role headline)");
  if (input.viewport === "desktop" && !input.nav?.length) issues.push("nav: a desktop screen spells out its 2-4 top navigation items");
  if (input.accent && !input.lines.some(line => splitLines(line.text).join(" ").includes(input.accent!.words.trim()))) issues.push(`accent: "${input.accent.words}" is not in any line; quote words that are`);
  const total = input.lines.reduce((count, line) => count + wordCount(line.text), 0) + wordCount(input.cta.label);
  if (total > COMP_WORDS[input.viewport]) issues.push(`${total} words besides the navigation; at most ${COMP_WORDS[input.viewport]} on a ${input.viewport} comp (put the rest of the copy in the code, not the comp)`);
  if (input.viewport === "mobile") {
    const headline = input.lines.find(line => line.role === "headline");
    if (headline && splitLines(headline.text).length > 4) issues.push("mobile: a headline of at most four lines, so it and the action fit the first phone screen");
  }
  return issues;
}

/** Every word the comp shows, for the image router's exact-text instruction. */
export function compText(input: CompInput) {
  return [input.brand, ...(input.viewport === "desktop" ? input.nav ?? [] : []), ...input.lines.flatMap(line => splitLines(line.text)), input.cta.label].join(" / ");
}

const AREA = { left: "Left", right: "Right", top: "Top", bottom: "Bottom", full: "The whole screen" } as const;
/** One line of the type field, in the reference's words. */
function lineWords(line: CompInput["lines"][number], input: CompInput) {
  const parts = splitLines(line.text), quoted = parts.map(quote).join(" / ");
  const accent = input.accent && parts.join(" ").includes(input.accent.words.trim()) ? ` with ${quote(input.accent.words)} ${input.accent.treatment.trim()}` : "";
  switch (line.role) {
    case "headline": return `a huge ${input.type.trim()} headline${parts.length > 1 ? ` on ${NUMBER[parts.length - 1] ?? parts.length} lines` : ""} ${quoted}${accent}`;
    case "eyebrow": return `a small label ${quoted}${accent} above it`;
    case "subline": return `a short line ${quoted}${accent}`;
    default: return `a small line ${quoted}${accent}`;
  }
}
const pill = (cta: CompInput["cta"]) => `a ${colourName(cta.color)} ${cta.style === "outlined" ? "outlined pill" : "pill"} ${quote(cta.label)} (${cta.color})`;

/** The comp prompt in the reference pattern: the paragraph, the crop note when the canvas is cut to the shape, the
 * phone first-screen rule, the art system, then the tail. `size` is the canvas the call generates. */
export function compPrompt(input: CompInput, concept: { artSystem?: ArtSystem; chosen: Pick<Concept, "name">; sections?: readonly SectionPlan[] }, size: ImageSize = input.viewport === "desktop" ? "1536x1024" : "1024x1536") {
  const desktop = input.viewport === "desktop", first = concept.sections?.[0]?.id === input.section || /^(top|hero|home|first|intro|landing)/i.test(input.section);
  const job = concept.sections?.find(section => section.id === input.section)?.job;
  const { ground, ink, accent } = input.colors;
  const screen = desktop ? (first ? "The homepage" : `A section of the homepage${job ? ` (${job.replace(/\.$/, "")})` : ""}`) : (first ? "The first phone screen of the homepage" : `A phone screen of the homepage${job ? ` (${job.replace(/\.$/, "")})` : ""}`);
  const nav = desktop
    ? `Top navigation: wordmark ${quote(input.brand)} left${input.mark ? ` with ${input.mark.trim()}` : ""}; ${(input.nav ?? []).map(quote).join(", ")} right of centre; ${pill(input.cta)} right.`
    : `Top bar: wordmark ${quote(input.brand)} left${input.mark ? ` with ${input.mark.trim()}` : ""}, a simple menu icon right.`;
  const layout = input.layout.map(item => `${AREA[item.area]}${item.area === "full" ? "" : ` ${item.pct}%`}: ${item.content.trim().replace(/\.$/, "")}.`).join(" ");
  const type = `Type field: ${input.lines.map(line => lineWords(line, input)).join("; ")}; ${desktop ? "and" : "below it"} ${pill(input.cta)}.`;
  const shape = COMP_SHAPE[input.viewport], crop = cropFor(size, shape.width / shape.height), margins = cropMargins(size, crop);
  const cropNote = margins.y > 0.5 ? `The top ${margins.y}% and bottom ${margins.y}% of the canvas are cropped away: keep the navigation, every word and the pill inside the middle ${Math.round((100 - 2 * margins.y) * 10) / 10}%, and continue the background there.`
    : margins.x > 0.5 ? `The left ${margins.x}% and right ${margins.x}% of the canvas are cropped away: keep the wordmark, every word and the pill inside the middle ${Math.round((100 - 2 * margins.x) * 10) / 10}%, and continue the background there.` : "";
  const phone = desktop ? "" : `This is one phone screen, ${shape.width} × ${shape.height} px: the top bar, the whole headline and the ${quote(input.cta.label)} pill sit fully inside it, the pill above the bottom tenth; the photograph is a band at least a quarter of the screen tall, under the top bar or between the headline and the pill, never pushing the headline or the pill off the screen.`;
  const art = concept.artSystem;
  return [
    `${screen} of a website called ${quote(input.brand)}: ${colourName(ground)} background ${ground}, ${colourName(ink)} text ${ink}, ${colourName(accent)} accent ${accent}. ${nav} ${layout} ${type} The photograph: ${input.subject.trim().replace(/\.$/, "")}.`,
    input.prompt?.trim() ?? "",
    cropNote,
    phone,
    art ? `Art system: palette ${art.palette}. Type: ${art.type}. Imagery: ${art.imagery}. Motif: ${art.motif}.` : "",
    "Colours flat and at full strength exactly as given, like a printed poster: no washed-out tints, no gradients, no vignette. The headline set at poster scale in the heaviest cut of its typeface, its longest line spanning most of the type field.",
    "Any other body copy appears only as quiet thin lines, never as words. Real-looking photography or a crafted drawing as the art system says; never stock-looking, no AI look (oversaturation, HDR glow, plastic skin).",
    desktop ? TAIL_SITE : TAIL_PHONE,
  ].filter(Boolean).join("\n");
}

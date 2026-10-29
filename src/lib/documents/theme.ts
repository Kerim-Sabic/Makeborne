import type { FontPairing, Motif, Theme } from "./schema";
import type { FaceId } from "./fonts";

export type FontPairingSpec = {
  /** CSS stacks for the preview and PDF. */
  heading: string; body: string;
  /** Office faces written into the editable PPTX (PowerPoint cannot embed fonts). */
  pptxHeading: string; pptxBody: string;
  /** Whether a heading at the pairing's own weight is bold in PPTX; omitted keeps the original rule. */
  pptxHeadingBold?: boolean;
  headingWeight: number; headingTracking: string;
  /** Conservative average glyph advance (em) for fitting: the wider of the web and Office faces, plus margin. */
  width: number; bodyWidth: number;
  /** Bold ÷ regular advance, the larger of the web and Office faces (Georgia Bold runs 17% wider). Default 1.05. */
  headingBold?: number; bodyBold?: number;
  /** Display faces that run narrow may be set larger. */
  scale?: number;
  /** Average advance (em) of an UPPERCASE heading line: the wider of the web and Office faces. Uppercase display type is fitted with it. */
  caps: number;
  /** CSS font-stretch for the heading (the poster pairing uses Archivo's condensed cut). */
  headingStretch?: string;
  /** Open-licensed faces embedded with @font-face; legacy system pairings use them only where the Office face is missing (e.g. the serverless PDF printer). */
  faces: FaceId[];
  label: string; voice: string;
};

/** The first eight pairings are built on faces installed with Windows/macOS/
 * Office; each now names an open-licensed fallback right after its Office face,
 * so a machine without that face (the serverless PDF printer has only Open
 * Sans) gets a close match instead of a generic substitute. The newer pairings
 * lead with embedded faces in the preview and PDF and map to Office faces in
 * the PPTX. Glyph-width factors are measured in Chromium (see
 * scripts/render-document-quality.cjs) and padded ~19%. PDFs set the static
 * cuts (fonts.ts), whose single optical size is the text one: Fraunces runs up
 * to 8% wider there than the display sizes the preview's variable font picks,
 * so the fraunces pairing is fitted at 0.5 (measured: wide-glyph copy spilled
 * at 0.48). */
export const FONTS: Record<FontPairing, FontPairingSpec> = {
  editorial: { heading: 'Georgia, Newsreader, "Times New Roman", serif', body: '"Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif', pptxHeading: "Georgia", pptxBody: "Segoe UI", headingWeight: 400, headingTracking: "-0.02em", width: 0.52, bodyWidth: 0.52, headingBold: 1.17, bodyBold: 1.07, caps: 0.594, faces: ["newsreader", "inter"], label: "Georgia + Segoe UI", voice: "assured editorial serif with a clean sans; consulting, proposals, culture" },
  modern: { heading: '"Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif', body: '"Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif', pptxHeading: "Segoe UI Semibold", pptxBody: "Segoe UI", headingWeight: 600, headingTracking: "-0.025em", width: 0.53, bodyWidth: 0.52, headingBold: 1.07, bodyBold: 1.07, caps: 0.569, faces: ["inter"], label: "Segoe UI", voice: "neutral corporate sans; internal updates and operations" },
  geometric: { heading: '"Century Gothic", Outfit, "Avenir Next", Futura, sans-serif', body: '"Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif', pptxHeading: "Century Gothic", pptxBody: "Segoe UI", headingWeight: 700, headingTracking: "-0.02em", width: 0.6, bodyWidth: 0.52, headingBold: 1.05, bodyBold: 1.07, caps: 0.574, faces: ["outfit", "inter"], label: "Century Gothic + Segoe UI", voice: "round geometric; consumer, education, lifestyle" },
  classic: { heading: '"Palatino Linotype", Palatino, Newsreader, "Book Antiqua", serif', body: '"Palatino Linotype", Palatino, Newsreader, "Book Antiqua", serif', pptxHeading: "Palatino Linotype", pptxBody: "Palatino Linotype", headingWeight: 400, headingTracking: "-0.01em", width: 0.52, bodyWidth: 0.5, headingBold: 1.05, bodyBold: 1.05, caps: 0.599, faces: ["newsreader"], label: "Palatino", voice: "traditional book serif; history, heritage, memoir" },
  garamond: { heading: 'Garamond, "EB Garamond", "Adobe Garamond Pro", Cormorant, Georgia, serif', body: 'Garamond, "EB Garamond", "Adobe Garamond Pro", Newsreader, Georgia, serif', pptxHeading: "Garamond", pptxBody: "Garamond", headingWeight: 400, headingTracking: "-0.01em", width: 0.47, bodyWidth: 0.46, headingBold: 1.1, bodyBold: 1.1, caps: 0.573, faces: ["cormorant", "newsreader"], label: "Garamond", voice: "literary book face; fiction, essays, poetry" },
  grotesk: { heading: '"Franklin Gothic Medium", "Franklin Gothic", Archivo, "Arial Narrow", Arial, sans-serif', body: 'Arial, Inter, "Helvetica Neue", sans-serif', pptxHeading: "Franklin Gothic Medium", pptxBody: "Arial", headingWeight: 400, headingTracking: "-0.01em", width: 0.5, bodyWidth: 0.5, headingBold: 1.08, bodyBold: 1.08, caps: 0.588, faces: ["archivo", "inter"], label: "Franklin Gothic + Arial", voice: "newsy American grotesk; reports, journalism, public sector" },
  humanist: { heading: '"Trebuchet MS", "DM Sans", "Gill Sans", "Segoe UI", sans-serif', body: 'Verdana, "DM Sans", "Segoe UI", sans-serif', pptxHeading: "Trebuchet MS", pptxBody: "Verdana", headingWeight: 700, headingTracking: "-0.015em", width: 0.58, bodyWidth: 0.58, headingBold: 1.06, bodyBold: 1.12, caps: 0.57, faces: ["dm-sans"], label: "Trebuchet + Verdana", voice: "friendly and very legible; training, community, accessibility" },
  condensed: { heading: 'Bahnschrift, "DIN Alternate", Archivo, "Arial Narrow", sans-serif', body: '"Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif', pptxHeading: "Bahnschrift", pptxBody: "Segoe UI", headingWeight: 600, headingTracking: "-0.01em", width: 0.48, bodyWidth: 0.52, headingBold: 1.08, bodyBold: 1.07, caps: 0.592, faces: ["archivo", "inter"], label: "Bahnschrift + Segoe UI", voice: "industrial DIN; engineering, logistics, sport" },
  fraunces: { heading: 'Fraunces, Georgia, serif', body: 'Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif', pptxHeading: "Georgia", pptxBody: "Segoe UI", pptxHeadingBold: false, headingWeight: 600, headingTracking: "-0.02em", width: 0.5, bodyWidth: 0.5, headingBold: 1.17, bodyBold: 1.07, caps: 0.594, faces: ["fraunces", "inter"], label: "Fraunces + Inter", voice: "warm soft serif with a crisp sans; hospitality, food, wellness, consumer brands, guides" },
  instrument: { heading: '"Instrument Serif", Georgia, serif', body: 'Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif', pptxHeading: "Georgia", pptxBody: "Segoe UI", pptxHeadingBold: false, headingWeight: 400, headingTracking: "-0.01em", width: 0.48, bodyWidth: 0.48, scale: 1.2, headingBold: 1.17, bodyBold: 1.07, caps: 0.594, faces: ["instrument-serif", "inter"], label: "Instrument Serif + Inter", voice: "tall high-contrast display serif; architecture, fashion, studios, premium SaaS" },
  playfair: { heading: '"Playfair Display", Georgia, serif', body: '"Plus Jakarta Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif', pptxHeading: "Georgia", pptxBody: "Segoe UI", pptxHeadingBold: false, headingWeight: 600, headingTracking: "-0.015em", width: 0.5, bodyWidth: 0.51, headingBold: 1.17, bodyBold: 1.07, caps: 0.594, faces: ["playfair-display", "plus-jakarta-sans"], label: "Playfair Display + Plus Jakarta Sans", voice: "Didone luxury; hotels, weddings, fashion, fine dining" },
  newsreader: { heading: 'Newsreader, Georgia, serif', body: 'Newsreader, Georgia, serif', pptxHeading: "Georgia", pptxBody: "Georgia", pptxHeadingBold: false, headingWeight: 400, headingTracking: "-0.015em", width: 0.48, bodyWidth: 0.48, headingBold: 1.17, bodyBold: 1.17, caps: 0.594, faces: ["newsreader"], label: "Newsreader", voice: "editorial text serif; research, policy, long-form reports and nonfiction books" },
  "space-grotesk": { heading: '"Space Grotesk", "Segoe UI", sans-serif', body: 'Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif', pptxHeading: "Segoe UI Semibold", pptxBody: "Segoe UI", headingWeight: 600, headingTracking: "-0.02em", width: 0.53, bodyWidth: 0.48, headingBold: 1.07, bodyBold: 1.07, caps: 0.55, faces: ["space-grotesk", "inter"], label: "Space Grotesk + Inter", voice: "quirky techno-grotesk; AI, creative technology, agencies, events" },
  bricolage: { heading: '"Bricolage Grotesque", "Franklin Gothic Medium", sans-serif', body: '"DM Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif', pptxHeading: "Franklin Gothic Medium", pptxBody: "Segoe UI", pptxHeadingBold: false, headingWeight: 700, headingTracking: "-0.025em", width: 0.48, bodyWidth: 0.51, headingBold: 1.05, bodyBold: 1.07, caps: 0.529, faces: ["bricolage-grotesque", "dm-sans"], label: "Bricolage Grotesque + DM Sans", voice: "characterful ink-trap grotesk; studios, food and drink, culture, indie brands" },
  sora: { heading: 'Sora, "Century Gothic", sans-serif', body: 'Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif', pptxHeading: "Century Gothic", pptxBody: "Segoe UI", pptxHeadingBold: true, headingWeight: 600, headingTracking: "-0.03em", width: 0.56, bodyWidth: 0.48, headingBold: 1.05, bodyBold: 1.07, caps: 0.612, faces: ["sora", "inter"], label: "Sora + Inter", voice: "wide future-facing geometric; AI products, mobility, climate tech" },
  archivo: { heading: 'Archivo, Impact, "Arial Narrow", sans-serif', body: 'Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif', pptxHeading: "Impact", pptxBody: "Segoe UI", pptxHeadingBold: false, headingWeight: 700, headingTracking: "-0.005em", width: 0.48, bodyWidth: 0.48, headingBold: 1, bodyBold: 1.07, caps: 0.44, headingStretch: "62%", faces: ["archivo", "inter"], label: "Archivo Condensed + Inter", voice: "compressed poster grotesk set in capitals; bold launches, sport, culture, campaigns (PPTX: Impact)" },
  geist: { heading: 'Geist, "Segoe UI", sans-serif', body: 'Geist, "Segoe UI", "Helvetica Neue", Arial, sans-serif', pptxHeading: "Segoe UI Semibold", pptxBody: "Segoe UI", headingWeight: 600, headingTracking: "-0.03em", width: 0.525, bodyWidth: 0.5, headingBold: 1.07, bodyBold: 1.07, caps: 0.575, faces: ["geist"], label: "Geist", voice: "precise Swiss-technical sans; developer tools, B2B SaaS, data, fintech" },
};

/** Decorative system for covers, dividers and page furniture. Omitted = "orbit",
 * the original look, so saved documents render exactly as before. */
export const MOTIF_NOTES: Record<Motif, string> = {
  orbit: "soft circles and rings (the original look)",
  grid: "Swiss: hairline rules, numbered furniture, oversized flush-left type",
  band: "bold color bands and blocks; confident, poster-like",
  frame: "inset hairline frame and centered, formal composition; editorial or luxury",
  quiet: "no decoration; large type and generous space carry the design",
};
export const motifOf = (theme: Theme): Motif => theme.motif ?? "orbit";

const channel = (value: number) => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16 & 255) + 0.7152 * channel(n >> 8 & 255) + 0.0722 * channel(n & 255);
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Mix two colors; amount 0 = a, 1 = b. */
export function mix(a: string, b: string, amount: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const part = (shift: number) => Math.round((pa >> shift & 255) * (1 - amount) + (pb >> shift & 255) * amount);
  return `#${[16, 8, 0].map(shift => part(shift).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
/** Pick whichever candidate reads best on the background. */
export const readableOn = (background: string, ...candidates: string[]) =>
  [...candidates, "#FFFFFF", "#111111"].find(color => contrast(color, background) >= 4.5) ?? (luminance(background) > 0.4 ? "#111111" : "#FFFFFF");

/** Contrast problems the builder must fix before finishing. */
export function themeIssues(theme: Theme): string[] {
  const p = theme.palette, issues: string[] = [];
  if (contrast(p.ink, p.background) < 7) issues.push(`ink ${p.ink} on background ${p.background} has contrast ${contrast(p.ink, p.background).toFixed(1)}:1; body text needs at least 7:1.`);
  if (contrast(p.muted, p.background) < 4.5) issues.push(`muted ${p.muted} on background ${p.background} is ${contrast(p.muted, p.background).toFixed(1)}:1; needs at least 4.5:1.`);
  if (contrast(p.dark, p.background) < 4.5) issues.push(`dark ${p.dark} must contrast with background ${p.background} (at least 4.5:1) so dark slides read as dark.`);
  if (contrast(p.ink, p.surface) < 4.5) issues.push(`ink ${p.ink} on surface ${p.surface} needs at least 4.5:1.`);
  return issues;
}

export function defaultTheme(kind: "deck" | "book", styleId = "editorial"): Theme {
  if (kind === "book") return { fonts: styleId === "venture" ? "classic" : "garamond", mood: "Literary, warm and calm", imageStyle: "",
    palette: { background: "#FBF8F2", surface: "#F1EBDF", ink: "#1F1B16", muted: "#5F574C", accent: "#9B4A2E", accent2: "#41655E", dark: "#24302D" } };
  if (styleId === "venture") return { fonts: "modern", mood: "Confident and precise", imageStyle: "",
    palette: { background: "#F7F8FA", surface: "#E9EDF3", ink: "#0E1726", muted: "#4A5568", accent: "#2F5BEA", accent2: "#14A38B", dark: "#0B1220" } };
  if (styleId === "studio") return { fonts: "geometric", mood: "Crafted and warm", imageStyle: "",
    palette: { background: "#F6F3EE", surface: "#E8E1D6", ink: "#1E2422", muted: "#55605B", accent: "#C2562F", accent2: "#33544C", dark: "#1E2B27" } };
  return { fonts: "editorial", mood: "Editorial and assured", imageStyle: "",
    palette: { background: "#F8F6F1", surface: "#ECE7DD", ink: "#16181D", muted: "#555A63", accent: "#9B583C", accent2: "#3D5A73", dark: "#16181D" } };
}

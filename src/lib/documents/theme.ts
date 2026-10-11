import type { FontPairing, Theme } from "./schema";

/** Font pairings built only from faces installed with Windows/macOS/Office, so
 * the preview, the printed PDF and the editable PPTX all use the same type. */
export const FONTS: Record<FontPairing, { heading: string; body: string; pptxHeading: string; pptxBody: string; headingWeight: number; headingTracking: string; width: number; label: string }> = {
  editorial: { heading: 'Georgia, "Times New Roman", serif', body: '"Segoe UI", "Helvetica Neue", Arial, sans-serif', pptxHeading: "Georgia", pptxBody: "Segoe UI", headingWeight: 400, headingTracking: "-0.02em", width: 0.52, label: "Georgia + Segoe UI" },
  modern: { heading: '"Segoe UI", "Helvetica Neue", Arial, sans-serif', body: '"Segoe UI", "Helvetica Neue", Arial, sans-serif', pptxHeading: "Segoe UI Semibold", pptxBody: "Segoe UI", headingWeight: 600, headingTracking: "-0.025em", width: 0.53, label: "Segoe UI" },
  geometric: { heading: '"Century Gothic", "Avenir Next", Futura, sans-serif', body: '"Segoe UI", "Helvetica Neue", Arial, sans-serif', pptxHeading: "Century Gothic", pptxBody: "Segoe UI", headingWeight: 700, headingTracking: "-0.02em", width: 0.6, label: "Century Gothic + Segoe UI" },
  classic: { heading: '"Palatino Linotype", Palatino, "Book Antiqua", serif', body: '"Palatino Linotype", Palatino, "Book Antiqua", serif', pptxHeading: "Palatino Linotype", pptxBody: "Palatino Linotype", headingWeight: 400, headingTracking: "-0.01em", width: 0.52, label: "Palatino" },
  garamond: { heading: 'Garamond, "EB Garamond", "Adobe Garamond Pro", Georgia, serif', body: 'Garamond, "EB Garamond", "Adobe Garamond Pro", Georgia, serif', pptxHeading: "Garamond", pptxBody: "Garamond", headingWeight: 400, headingTracking: "-0.01em", width: 0.47, label: "Garamond" },
  grotesk: { heading: '"Franklin Gothic Medium", "Franklin Gothic", "Arial Narrow", Arial, sans-serif', body: 'Arial, "Helvetica Neue", sans-serif', pptxHeading: "Franklin Gothic Medium", pptxBody: "Arial", headingWeight: 400, headingTracking: "-0.01em", width: 0.5, label: "Franklin Gothic + Arial" },
  humanist: { heading: '"Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif', body: 'Verdana, "Segoe UI", sans-serif', pptxHeading: "Trebuchet MS", pptxBody: "Verdana", headingWeight: 700, headingTracking: "-0.015em", width: 0.58, label: "Trebuchet + Verdana" },
  condensed: { heading: 'Bahnschrift, "DIN Alternate", "Arial Narrow", sans-serif', body: '"Segoe UI", "Helvetica Neue", Arial, sans-serif', pptxHeading: "Bahnschrift", pptxBody: "Segoe UI", headingWeight: 600, headingTracking: "-0.01em", width: 0.48, label: "Bahnschrift + Segoe UI" },
};

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

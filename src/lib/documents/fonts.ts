/** Open-licensed (OFL-1.1) faces for presentations and books, taken from the
 * Fontsource packages already installed for generated websites (the latin file
 * plus its complementary latin-ext file; see infra/project-runtime/font-catalog.json).
 * They are declared with @font-face so the live preview, the client review and every PDF render the
 * same type on any OS. This matters most for the PDF exporter: the serverless
 * Chromium ships only Open Sans, so without embedded faces every exported
 * book and deck was set in Open Sans whatever its theme said.
 *
 * PPTX cannot embed fonts, so every pairing also names Office faces for the
 * editable file, and slide layout is fitted against the wider of the two. */
import { FONT_SUBSETS, UNICODE_RANGES, type FontSubset } from "../builder/fonts";

/* Print/PDF: Chromium's PDF backend embeds any variable font as Type 3 (unhinted outlines that some prepress
 * checks reject), so the PDF printer uses the static per-weight cuts of the same faces from the @fontsource
 * packages (OFL-1.1, 5.3.0; owner approval 2026-10-22), which embed as CID TrueType. Only PRINT_WEIGHTS are
 * read: every slide and book weight is one of them. The screen preview keeps the variable files.
 * Static cuts have one optical size (the text one), so print headings in Fraunces, Inter and Bricolage
 * Grotesque use the text cut where the preview's variable font switches to the display cut.
 * REMAINING GAP: the Archivo Condensed headings of the archivo pairing (font-stretch 62%) have no static cut,
 * so the printer keeps the variable Archivo for condensed text only (declared for 62%-99% stretch) and that
 * one face still embeds as Type 3. A static condensed instance would close it. */
export type DocumentFace ={ id: string; family: string; pkg: "@fontsource" | "@fontsource-variable"; axis: string; weight: string; italic: boolean; stretch?: string };

export const DOCUMENT_FACES = {
  fraunces: { id: "fraunces", family: "Fraunces", pkg: "@fontsource-variable", axis: "opsz", weight: "100 900", italic: true },
  "instrument-serif": { id: "instrument-serif", family: "Instrument Serif", pkg: "@fontsource", axis: "400", weight: "400", italic: true },
  "playfair-display": { id: "playfair-display", family: "Playfair Display", pkg: "@fontsource-variable", axis: "wght", weight: "400 900", italic: true },
  newsreader: { id: "newsreader", family: "Newsreader", pkg: "@fontsource-variable", axis: "wght", weight: "200 800", italic: true },
  cormorant: { id: "cormorant", family: "Cormorant", pkg: "@fontsource-variable", axis: "wght", weight: "300 700", italic: true },
  "space-grotesk": { id: "space-grotesk", family: "Space Grotesk", pkg: "@fontsource-variable", axis: "wght", weight: "300 700", italic: false },
  "bricolage-grotesque": { id: "bricolage-grotesque", family: "Bricolage Grotesque", pkg: "@fontsource-variable", axis: "opsz", weight: "200 800", italic: false },
  sora: { id: "sora", family: "Sora", pkg: "@fontsource-variable", axis: "wght", weight: "100 800", italic: false },
  geist: { id: "geist", family: "Geist", pkg: "@fontsource-variable", axis: "wght", weight: "100 900", italic: true },
  inter: { id: "inter", family: "Inter", pkg: "@fontsource-variable", axis: "opsz", weight: "100 900", italic: true },
  "dm-sans": { id: "dm-sans", family: "DM Sans", pkg: "@fontsource-variable", axis: "wght", weight: "100 1000", italic: true },
  "plus-jakarta-sans": { id: "plus-jakarta-sans", family: "Plus Jakarta Sans", pkg: "@fontsource-variable", axis: "wght", weight: "200 800", italic: true },
  outfit: { id: "outfit", family: "Outfit", pkg: "@fontsource-variable", axis: "wght", weight: "100 900", italic: false },
  // The wdth file carries both axes; the stretch range lets the poster pairing use its condensed cut.
  archivo: { id: "archivo", family: "Archivo", pkg: "@fontsource-variable", axis: "wdth", weight: "100 900", italic: true, stretch: "62% 125%" },
  // Monospaced labels for the technical and brutalist art directions (PPTX: Consolas).
  "jetbrains-mono": { id: "jetbrains-mono", family: "JetBrains Mono", pkg: "@fontsource-variable", axis: "wght", weight: "100 800", italic: true },
} as const satisfies Record<string, DocumentFace>;
export type FaceId = keyof typeof DOCUMENT_FACES;
export type FaceStyle = "normal" | "italic";

/** `${id}:${style}` (latin) or `${id}:${style}:latin-ext` → variable (or single static) font URL; with a weight,
 * `${id}:${style}:${weight}[:latin-ext]` → that static cut (print). Data: URLs for the offline PDF printer. */
export type FontSources = Partial<Record<string, string>>;
export type { FontSubset };
/** Declaration order: latin-ext, then the latin base, each limited to its unicode-range. */
export const FACE_SUBSETS = FONT_SUBSETS;
/** The weights slides and books set (directions.ts Weight; book CSS 400/700 and the pairing's heading weight). */
export const PRINT_WEIGHTS = [400, 600, 700] as const;
export type PrintWeight = (typeof PRINT_WEIGHTS)[number];
export const faceKey = (id: FaceId, style: FaceStyle, subset: FontSubset = "latin", weight?: PrintWeight) => `${id}:${style}${weight ? `:${weight}` : ""}${subset === "latin" ? "" : `:${subset}`}`;
export const faceStyles = (id: FaceId): FaceStyle[] => DOCUMENT_FACES[id].italic ? ["normal", "italic"] : ["normal"];
/** File inside node_modules/<pkg>/<id>/files/ (copied to public by prepare-builder-runtime). */
export const faceFile = (id: FaceId, style: FaceStyle, subset: FontSubset = "latin") => `${id}-${subset}-${DOCUMENT_FACES[id].axis}-${style}.woff2`;
/** Faces whose screen file is variable have static per-weight cuts for print. */
export const hasStaticCuts = (id: FaceId) => DOCUMENT_FACES[id].pkg === "@fontsource-variable";
/** Static cut inside node_modules/@fontsource/<id>/files/ (print only). */
export const staticFaceFile = (id: FaceId, style: FaceStyle, weight: PrintWeight, subset: FontSubset = "latin") => `${id}-${subset}-${weight}-${style}.woff2`;
/** Same-origin copy served with the app (scripts/prepare-builder-runtime.mjs). */
export const facePublicUrl = (id: FaceId, style: FaceStyle, subset: FontSubset = "latin") => `/builder-runtime/fonts/${id}-${subset === "latin" ? "" : `${subset}-`}${style}.woff2`;

const SAFE_SOURCE = /^(data:font\/woff2;base64,[A-Za-z0-9+/]+=*|\/builder-runtime\/fonts\/[a-z0-9-]+\.woff2)$/;

/** @font-face rules for the given faces: per style, the latin-ext and latin
 * files with their unicode-ranges, so names such as Ćevapčići or Łódź keep the
 * chosen face. Without explicit sources the preview uses the app's same-origin
 * copies; a subset whose explicit source is missing is omitted so the stack's
 * next family applies (for those characters only) instead of a blocked request.
 * Where sources carry static cuts (print), each weight is its own rule and the
 * variable file is declared only for condensed widths (Archivo at 62%), which
 * have no static cut. */
export function fontFaceCss(ids: readonly FaceId[], sources?: FontSources) {
  return [...new Set(ids)].flatMap(id => faceStyles(id).flatMap(style => FACE_SUBSETS.map(subset => {
    const face = DOCUMENT_FACES[id], rule = (src: string | undefined, weight: string, stretch?: string) =>
      src && SAFE_SOURCE.test(src) ? `@font-face{font-family:"${face.family}";font-style:${style};font-weight:${weight};${stretch ? `font-stretch:${stretch};` : ""}font-display:block;src:url(${src}) format("woff2");unicode-range:${UNICODE_RANGES[subset]}}` : "";
    const cuts = sources && hasStaticCuts(id) ? PRINT_WEIGHTS.map(weight => rule(sources[faceKey(id, style, subset, weight)], String(weight))).join("") : "";
    const variable = sources ? sources[faceKey(id, style, subset)] : facePublicUrl(id, style, subset);
    const stretch = "stretch" in face ? face.stretch : undefined;
    if (!cuts) return rule(variable, face.weight, stretch);
    // Below 100% only: normal-width text keeps matching the static cuts exactly.
    return stretch ? `${cuts}${rule(variable, face.weight, `${stretch.split(" ")[0]} 99%`)}` : cuts;
  }))).join("");
}

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

/* KNOWN GAP (print/PDF): Chromium's PDF backend embeds variable fonts as Type 3 (outlines without hinting; some
 * prepress checks reject them). Static instances would embed as TrueType/CID fonts, but only bebas-neue,
 * dm-serif-display and instrument-serif are installed as static @fontsource packages. Embedding static faces for
 * print needs, with owner approval (new dependencies, OFL-1.1, version 5.x to match): @fontsource/fraunces,
 * @fontsource/inter, @fontsource/newsreader, @fontsource/playfair-display, @fontsource/cormorant,
 * @fontsource/space-grotesk, @fontsource/bricolage-grotesque, @fontsource/sora, @fontsource/geist-sans (Fontsource's
 * static Geist package name to be confirmed), @fontsource/dm-sans, @fontsource/plus-jakarta-sans, @fontsource/outfit,
 * @fontsource/archivo and @fontsource/jetbrains-mono; then fonts-server.ts would read their per-weight files for PDFs. */
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

/** `${id}:${style}` (latin) or `${id}:${style}:latin-ext` → font URL (a data: URL for the offline PDF printer). */
export type FontSources = Partial<Record<string, string>>;
export type { FontSubset };
/** Declaration order: latin-ext, then the latin base, each limited to its unicode-range. */
export const FACE_SUBSETS = FONT_SUBSETS;
export const faceKey = (id: FaceId, style: FaceStyle, subset: FontSubset = "latin") => subset === "latin" ? `${id}:${style}` : `${id}:${style}:${subset}`;
export const faceStyles = (id: FaceId): FaceStyle[] => DOCUMENT_FACES[id].italic ? ["normal", "italic"] : ["normal"];
/** File inside node_modules/<pkg>/<id>/files/ (copied to public by prepare-builder-runtime). */
export const faceFile = (id: FaceId, style: FaceStyle, subset: FontSubset = "latin") => `${id}-${subset}-${DOCUMENT_FACES[id].axis}-${style}.woff2`;
/** Same-origin copy served with the app (scripts/prepare-builder-runtime.mjs). */
export const facePublicUrl = (id: FaceId, style: FaceStyle, subset: FontSubset = "latin") => `/builder-runtime/fonts/${id}-${subset === "latin" ? "" : `${subset}-`}${style}.woff2`;

/** @font-face rules for the given faces: per style, the latin-ext and latin
 * files with their unicode-ranges, so names such as Ćevapčići or Łódź keep the
 * chosen face. Without explicit sources the preview uses the app's same-origin
 * copies; a subset whose explicit source is missing is omitted so the stack's
 * next family applies (for those characters only) instead of a blocked request. */
export function fontFaceCss(ids: readonly FaceId[], sources?: FontSources) {
  return [...new Set(ids)].flatMap(id => faceStyles(id).flatMap(style => FACE_SUBSETS.map(subset => {
    const face = DOCUMENT_FACES[id], src = sources ? sources[faceKey(id, style, subset)] : facePublicUrl(id, style, subset);
    if (!src || !/^(data:font\/woff2;base64,[A-Za-z0-9+/]+=*|\/builder-runtime\/fonts\/[a-z0-9-]+\.woff2)$/.test(src)) return "";
    const stretch = "stretch" in face ? `font-stretch:${face.stretch};` : "";
    return `@font-face{font-family:"${face.family}";font-style:${style};font-weight:${face.weight};${stretch}font-display:block;src:url(${src}) format("woff2");unicode-range:${UNICODE_RANGES[subset]}}`;
  }))).join("");
}

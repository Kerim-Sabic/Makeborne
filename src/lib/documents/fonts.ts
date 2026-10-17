/** Open-licensed (OFL-1.1) faces for presentations and books, taken from the
 * Fontsource packages already installed for generated websites (latin subset;
 * see infra/project-runtime/font-catalog.json). They are declared with
 * @font-face so the live preview, the client review and every PDF render the
 * same type on any OS. This matters most for the PDF exporter: the serverless
 * Chromium ships only Open Sans, so without embedded faces every exported
 * book and deck was set in Open Sans whatever its theme said.
 *
 * PPTX cannot embed fonts, so every pairing also names Office faces for the
 * editable file, and slide layout is fitted against the wider of the two. */
export type DocumentFace = { id: string; family: string; pkg: "@fontsource" | "@fontsource-variable"; axis: string; weight: string; italic: boolean; stretch?: string };

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

/** `${id}:${style}` → font URL (a data: URL for the offline PDF printer). */
export type FontSources = Partial<Record<string, string>>;
export const faceKey = (id: FaceId, style: FaceStyle) => `${id}:${style}`;
export const faceStyles = (id: FaceId): FaceStyle[] => DOCUMENT_FACES[id].italic ? ["normal", "italic"] : ["normal"];
/** File inside node_modules/<pkg>/<id>/files/ (copied to public by prepare-builder-runtime). */
export const faceFile = (id: FaceId, style: FaceStyle) => `${id}-latin-${DOCUMENT_FACES[id].axis}-${style}.woff2`;
/** Same-origin copy served with the app (scripts/prepare-builder-runtime.mjs). */
export const facePublicUrl = (id: FaceId, style: FaceStyle) => `/builder-runtime/fonts/${id}-${style}.woff2`;

/** @font-face rules for the given faces. Without explicit sources the preview
 * uses the app's same-origin copies; a face whose explicit source is missing is
 * omitted so the stack's next family applies instead of a blocked request. */
export function fontFaceCss(ids: readonly FaceId[], sources?: FontSources) {
  return [...new Set(ids)].flatMap(id => faceStyles(id).map(style => {
    const face = DOCUMENT_FACES[id], src = sources ? sources[faceKey(id, style)] : facePublicUrl(id, style);
    if (!src || !/^(data:font\/woff2;base64,[A-Za-z0-9+/]+=*|\/builder-runtime\/fonts\/[a-z0-9-]+\.woff2)$/.test(src)) return "";
    const stretch = "stretch" in face ? `font-stretch:${face.stretch};` : "";
    return `@font-face{font-family:"${face.family}";font-style:${style};font-weight:${face.weight};${stretch}font-display:block;src:url(${src}) format("woff2")}`;
  })).join("");
}

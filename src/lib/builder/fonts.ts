/** Curated self-hosted font library for generated websites. The woff2 files are
 * copied from @fontsource packages (OFL-1.1; latin and its complementary
 * latin-ext subset) into public/builder-runtime/fonts by
 * scripts/prepare-builder-runtime.mjs. The bundler embeds only the families a
 * project uses as data: URLs (latin-ext only when the project's text needs it),
 * so previews (opaque sandbox origin) and published static snapshots need no
 * font host. */
import catalog from "../../../infra/project-runtime/font-catalog.json";
import portableFonts from "../../../infra/project-runtime/font-portability.cjs";

export type FontEntry = {
  id: string; family: string; category: "serif" | "sans" | "mono" | "display";
  /** Fontsource file axis ("wght", "opsz", "wdth") or the static weight ("400"). */
  axis: string; weight: string; stretch?: string; italic: boolean; fallback: string; voice: string;
};

export const FONT_CATALOG = catalog as FontEntry[];
export const FONTS_BY_ID = new Map(FONT_CATALOG.map(font => [font.id, font]));
/** Optional explicit import: `import "@makeborne/fonts/fraunces.css"`. */
export const FONT_IMPORT = /^@makeborne\/fonts\/([a-z0-9-]+)(?:\.css)?$/;
export type FontSubset = "latin" | "latin-ext";
/** Name of the same-origin copy (public/builder-runtime/fonts) of one subset file. */
export const fontFileName = portableFonts.runtimeFontFile as (font: FontEntry, style: "normal" | "italic", subset?: FontSubset) => string;
/** Declaration order for @font-face rules: latin-ext, then latin. */
export const FONT_SUBSETS = portableFonts.FONT_SUBSETS as readonly FontSubset[];
export const UNICODE_RANGES = portableFonts.UNICODE_RANGES as Record<FontSubset, string>;
/** Subsets a self-contained output must embed so this text renders in the chosen face. */
export const fontSubsets = portableFonts.fontSubsets as (texts: Iterable<string>) => FontSubset[];

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Shared with portable exports and the verified isolated runtime. */
export function detectFonts(files: Iterable<[string, string]>) {
  return portableFonts.detectFonts(files) as { fonts: FontEntry[]; italic: boolean };
}
export const fontFaceRule = portableFonts.fontFaceRule as (font: FontEntry, style: "normal" | "italic", source: string, subset?: FontSubset) => string;

/** Popular web fonts that are NOT available; static checks suggest the catalogue. */
const UNAVAILABLE = ["Poppins", "Montserrat", "Lato", "Open Sans", "Raleway", "Nunito", "Oswald", "Merriweather", "Lora", "Cormorant Garamond", "EB Garamond", "Libre Baskerville", "Work Sans", "Rubik", "IBM Plex Sans", "IBM Plex Serif", "IBM Plex Mono", "Space Mono", "Geist Mono", "Instrument Sans", "Satoshi", "General Sans", "Clash Display", "Cabinet Grotesk", "Inter Tight", "Libre Franklin", "Josefin Sans", "Quicksand", "Karla", "Mulish", "Barlow", "Figtree", "Epilogue", "Lexend", "Urbanist", "Red Hat Display", "Hanken Grotesk", "Schibsted Grotesk", "Spectral", "Crimson Pro", "Crimson Text", "Source Serif Pro", "Source Serif 4", "PT Serif", "Bodoni Moda", "Cinzel", "Abril Fatface", "Archivo Black", "Anton", "Big Shoulders Display", "Caveat", "Dancing Script", "Pacifico", "Great Vibes", "Young Serif", "Literata", "Alegreya", "Jost", "Neue Montreal", "Roboto Slab", "Fira Code", "Source Code Pro"];
const UNAVAILABLE_USE = new RegExp(`(?:font-family|font|fontFamily|--[\\w-]+)\\s*:\\s*["'\`]?\\s*(${UNAVAILABLE.map(escape).join("|")})\\s*["'\`]?\\s*[,;}\\n]`, "gi");

export function unavailableFonts(content: string) {
  return [...new Set([...content.matchAll(UNAVAILABLE_USE)].map(match => match[1]))];
}

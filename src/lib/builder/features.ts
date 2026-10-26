/**
 * Generation features that are built but not yet qualified for production. Each is OFF unless its
 * server-side environment variable is exactly "on"; the browser learns the result from GET /api/build
 * and can never turn one on. Off means the flow behaves as it did before the feature existed:
 * - MAKEBORNE_BRIEF_ENHANCER: the optional "improve my brief" step before a first website build
 *   (route POST /api/build/enhance refuses new actions; existing actions can still be read and settled).
 * - MAKEBORNE_DESIGN_COMPS: comp-first website builds (generate_comp / read_comp are not offered).
 * - MAKEBORNE_DECK_FULL_IMAGE: full-image slides (new decks are editable text slides; the slide-style
 *   question is not asked).
 * - MAKEBORNE_BOOK_IMAGE_PAGES: generated book pages (cover and chapter openers, or picture-book spreads, rendered
 *   with their words). Off: books are typeset exactly as before, even when image spending is open; book images
 *   stay the ordinary illustrations of the book's image plan, and the book quality/shape control is not shown.
 * documentImages is not a flag: it says whether this deployment can generate images right now (an image model is
 * configured and OpenAI spending is open), so books and decks never ask image questions they could not honour.
 * These sit on top of the existing gates (AI provider limits, builder configuration, the image model
 * allowlist), which still apply when a flag is on.
 */
export type BuilderFeatures = { briefEnhancer: boolean; fullImageSlides: boolean; bookImagePages: boolean; documentImages: boolean };
export const FEATURES_OFF: BuilderFeatures = Object.freeze({ briefEnhancer: false, fullImageSlides: false, bookImagePages: false, documentImages: false });

type Env = Record<string, string | undefined>;
export const briefEnhancerEnabled = (env: Env = process.env) => env.MAKEBORNE_BRIEF_ENHANCER === "on";
export const designCompsEnabled = (env: Env = process.env) => env.MAKEBORNE_DESIGN_COMPS === "on";
export const fullImageSlidesEnabled = (env: Env = process.env) => env.MAKEBORNE_DECK_FULL_IMAGE === "on";
export const bookImagePagesEnabled = (env: Env = process.env) => env.MAKEBORNE_BOOK_IMAGE_PAGES === "on";

/** The flag part of what GET /api/build tells the studio (server side); the route adds documentImages. */
export function builderFeatures(env: Env = process.env): Omit<BuilderFeatures, "documentImages"> {
  return { briefEnhancer: briefEnhancerEnabled(env), fullImageSlides: fullImageSlidesEnabled(env), bookImagePages: bookImagePagesEnabled(env) };
}

/** Reads the `features` of a GET /api/build body. Anything missing or unexpected is off. */
export function parseBuilderFeatures(value: unknown): BuilderFeatures {
  if (!value || typeof value !== "object") return FEATURES_OFF;
  const body = value as Partial<Record<keyof BuilderFeatures, unknown>>;
  return { briefEnhancer: body.briefEnhancer === true, fullImageSlides: body.fullImageSlides === true, bookImagePages: body.bookImagePages === true, documentImages: body.documentImages === true };
}

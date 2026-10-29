/** Trusted, pure responsive-image rules shared by image storage, the studio
 * bundler, the trusted Vite build, the hosted snapshot and the eval harness.
 *
 * A stored project image (public/images/<name>.webp, W x H) may have downscaled
 * WebP copies registered as assets of the same source revision at
 *   public/images/_r/<first 16 hex of the original's sha256>-<W>x<H>/<w>.webp
 * The directory binds every copy to the exact original bytes, so a replaced
 * image never picks up stale copies, and it carries the original's size, so
 * every consumer derives the same srcset from asset paths alone (no decoding).
 * Copies are never upscaled and only exist where they save real bytes. */

/** Device widths that matter: 640 (small phones), 828 (390-414 px phones at 1.75-2x, the
 * Lighthouse mobile profile), 1280 (3x phones, tablets). Wider screens keep the original. */
const RESPONSIVE_WIDTHS = Object.freeze([640, 828, 1280]);
/** A copy must be at most this share of the original width to be worth a file. */
const MIN_REDUCTION = 0.85;
/** One layout-free rule: the image may span the viewport. Lazy and eager images
 * use the same value so the hosted snapshot, the preload and React's re-render
 * choose the same file (one download). */
const RESPONSIVE_SIZES = "100vw";
/** Published sites accept at most 40 images and 6 MB in total (site-policy.js);
 * copies stop well before either so publishing never fails because of them. */
const VARIANT_LIMITS = Object.freeze({images: 36, bytes: 4_000_000});
/** A new original must leave the site publishable: one more file within the 40,
 * and room in the 6 MB for that image (up to ~700 KB) plus the site's own code. */
const SITE_IMAGE_LIMITS = Object.freeze({images: 40, bytes: 4_800_000});

const VARIANT_PATH = /^public\/images\/_r\/([a-f0-9]{16})-([1-9][0-9]{0,4})x([1-9][0-9]{0,4})\/([1-9][0-9]{0,4})\.webp$/;
const ORIGINAL_PATH = /^public\/images\/(?!_r\/)(?:[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\/){0,6}[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\.(?:webp|png|jpe?g)$/i;
const SHA256 = /^[a-f0-9]{64}$/;

/** Widths worth storing for an original of `width` pixels (ascending, never upscaled). */
function variantWidths(width) {
  if (!Number.isInteger(width) || width < 1) return [];
  return RESPONSIVE_WIDTHS.filter(candidate => candidate <= width * MIN_REDUCTION);
}

function variantPath(original, width) {
  if (!SHA256.test(original.sha256) || !Number.isInteger(original.width) || !Number.isInteger(original.height) || !Number.isInteger(width)) throw new Error("Invalid responsive image");
  return `public/images/_r/${original.sha256.slice(0, 16)}-${original.width}x${original.height}/${width}.webp`;
}

const isVariantPath = path => typeof path === "string" && VARIANT_PATH.test(path);
const isOriginalPath = path => typeof path === "string" && ORIGINAL_PATH.test(path);
const publicUrl = path => `/${path.slice("public/".length)}`;

/**
 * Public image URL -> {width, height, srcset} for every original that has at
 * least one matching copy. `assets` are source assets ({path, sha256}); a
 * compiled site file list works too once its paths are given the public/ prefix.
 * Copies whose directory names a different size for the same bytes are ignored.
 */
function responsiveManifest(assets) {
  const groups = new Map();
  for (const asset of assets ?? []) {
    const match = typeof asset?.path === "string" ? VARIANT_PATH.exec(asset.path) : null;
    if (!match) continue;
    const [, prefix, width, height, size] = match;
    const group = groups.get(prefix) ?? {sizes: new Set(), copies: new Map()};
    group.sizes.add(`${width}x${height}`);
    group.width = Number(width); group.height = Number(height);
    group.copies.set(Number(size), publicUrl(asset.path));
    groups.set(prefix, group);
  }
  /** @type {Record<string, {width: number, height: number, srcset: string}>} */
  const manifest = {};
  for (const asset of assets ?? []) {
    if (!isOriginalPath(asset?.path) || !SHA256.test(asset?.sha256 ?? "")) continue;
    const group = groups.get(asset.sha256.slice(0, 16));
    if (!group || group.sizes.size !== 1) continue;
    const copies = [...group.copies].filter(([width]) => width < group.width).sort((a, b) => a[0] - b[0]);
    if (!copies.length) continue;
    const url = publicUrl(asset.path);
    manifest[url] = {width: group.width, height: group.height,
      srcset: [...copies.map(([width, path]) => `${path} ${width}w`), `${url} ${group.width}w`].join(", ")};
  }
  return manifest;
}

/** Copies of originals that are no longer in the source are dead weight: drop them. */
function pruneVariants(assets) {
  const live = new Set((assets ?? []).filter(asset => isOriginalPath(asset?.path) && SHA256.test(asset?.sha256 ?? "")).map(asset => asset.sha256.slice(0, 16)));
  return (assets ?? []).filter(asset => !isVariantPath(asset?.path) || live.has(VARIANT_PATH.exec(asset.path)[1]));
}

/** Whether adding `added` copies keeps the site's images within VARIANT_LIMITS. */
function variantsFit(assets, added) {
  const images = (assets ?? []).filter(asset => typeof asset?.path === "string" && asset.path.startsWith("public/"));
  const count = images.length + added.length;
  const bytes = images.reduce((total, asset) => total + (asset.bytes ?? 0), 0) + added.reduce((total, asset) => total + (asset.bytes ?? 0), 0);
  return count <= VARIANT_LIMITS.images && bytes <= VARIANT_LIMITS.bytes;
}

/** Whether one more generated original still fits the published site's image limits. */
function siteImageFits(assets) {
  const images = (assets ?? []).filter(asset => typeof asset?.path === "string" && asset.path.startsWith("public/"));
  const bytes = images.reduce((total, asset) => total + (asset.bytes ?? 0), 0);
  return images.length + 1 <= SITE_IMAGE_LIMITS.images && bytes <= SITE_IMAGE_LIMITS.bytes;
}

/**
 * Source of a module that replaces `react/jsx-runtime` for project code. It
 * forwards to `runtimeSpecifier` and gives every <img> of a manifest original
 * its srcset and sizes (and its real size when neither width nor height is set,
 * so the rendered size never changes and nothing shifts), decoding="async", and
 * loading="lazy" unless the element says otherwise or is the high-priority hero.
 * Authored srcSet values are left alone.
 */
function jsxRuntimeModule(manifest, runtimeSpecifier = "react/jsx-runtime") {
  for (const [url, image] of Object.entries(manifest)) {
    if (!/^\/images\/[A-Za-z0-9_./-]+$/.test(url) || !/^[A-Za-z0-9_./ ,-]+$/.test(image.srcset) || !Number.isInteger(image.width) || !Number.isInteger(image.height)) throw new Error("Invalid responsive manifest");
  }
  return `import * as runtime from ${JSON.stringify(runtimeSpecifier)};
const images = ${JSON.stringify(manifest)};
const own = Object.prototype.hasOwnProperty;
function patch(type, props) {
  if (type !== "img" || props == null || typeof props.src !== "string" || props.srcSet != null || !own.call(images, props.src)) return props;
  const image = images[props.src], next = Object.assign({}, props, {srcSet: image.srcset});
  if (props.sizes == null) next.sizes = ${JSON.stringify(RESPONSIVE_SIZES)};
  if (props.width == null && props.height == null) { next.width = image.width; next.height = image.height; }
  if (props.decoding == null) next.decoding = "async";
  if (props.loading == null && props.fetchPriority !== "high" && props.fetchpriority !== "high") next.loading = "lazy";
  return next;
}
export const Fragment = runtime.Fragment;
export function jsx(type, props, key) { return runtime.jsx(type, patch(type, props), key); }
export function jsxs(type, props, key) { return runtime.jsxs(type, patch(type, props), key); }
`;
}

module.exports = {RESPONSIVE_WIDTHS, RESPONSIVE_SIZES, VARIANT_LIMITS, SITE_IMAGE_LIMITS, siteImageFits, variantWidths, variantPath, isVariantPath, isOriginalPath, responsiveManifest, pruneVariants, variantsFit, jsxRuntimeModule};

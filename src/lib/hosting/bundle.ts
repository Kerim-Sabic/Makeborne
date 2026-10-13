import { createHash } from "node:crypto";
import { SITE_CONTENT_TYPES, SITE_IMAGE_PATH, SITE_LIMITS, siteFileContentType } from "../../../infra/customer-sites/site-policy";

/** One stored file of a published site, served by the site Worker at `path`. */
export type SiteFile = { path: string; contentType: string; body: Buffer; sha256: string };
export type SiteBundle = { files: SiteFile[]; script: string; stylesheet: string | null; assetPaths: Set<string> };
export class SiteBundleError extends Error {}

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const isWebp = (bytes: Uint8Array) => bytes.length > 12 && Buffer.from(bytes.subarray(0, 4)).toString("latin1") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("latin1") === "WEBP";
const text = (value: string, name: string, limit: number, required: boolean) => {
  if (typeof value !== "string" || (required && !value.trim())) throw new SiteBundleError(`The website ${name} is missing. Open the preview and publish again.`);
  if (!value.isWellFormed() || value.includes("\0")) throw new SiteBundleError(`The website ${name} is not valid text.`);
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > limit) throw new SiteBundleError(`The website ${name} exceeds ${Math.round(limit / 1000)} kB. Simplify the site before publishing.`);
  return bytes;
};

/** Validate the browser-built production bundle plus server-loaded images and
 * give each a content-addressed or project path. The bundle is untrusted site
 * code: it is never executed here and only ever served from the site's own
 * isolated origin under a script-src 'self' policy. */
export function prepareSiteBundle(input: { js: string; css: string; images: { path: string; bytes: Uint8Array }[] }): SiteBundle {
  const js = text(input.js, "script", SITE_LIMITS.script, true);
  const css = text(input.css, "stylesheet", SITE_LIMITS.style, false);
  if (input.images.length > SITE_LIMITS.images) throw new SiteBundleError(`Published websites support up to ${SITE_LIMITS.images} images.`);
  const jsHash = digest(js), script = `/_mb/app-${jsHash.slice(0, 16)}.js`;
  const files: SiteFile[] = [{ path: script, contentType: SITE_CONTENT_TYPES.script, body: js, sha256: jsHash }];
  let stylesheet: string | null = null;
  if (css.length) {
    const cssHash = digest(css);
    stylesheet = `/_mb/app-${cssHash.slice(0, 16)}.css`;
    files.push({ path: stylesheet, contentType: SITE_CONTENT_TYPES.style, body: css, sha256: cssHash });
  }
  const assetPaths = new Set<string>();
  for (const image of input.images) {
    if (!SITE_IMAGE_PATH.test(image.path) || image.path.includes("..") || image.path.includes("//")) throw new SiteBundleError(`The image path ${image.path.slice(0, 80)} cannot be published.`);
    if (assetPaths.has(image.path)) throw new SiteBundleError("Two website images share one address.");
    if (!isWebp(image.bytes)) throw new SiteBundleError("A website image could not be prepared for publishing.");
    if (image.bytes.length > SITE_LIMITS.image) throw new SiteBundleError("A website image exceeds 2 MB after optimisation.");
    const body = Buffer.from(image.bytes);
    assetPaths.add(image.path);
    files.push({ path: image.path, contentType: SITE_CONTENT_TYPES.image, body, sha256: digest(body) });
  }
  if (files.reduce((total, file) => total + file.body.length, 0) > SITE_LIMITS.total) throw new SiteBundleError("This website’s script, styles and images exceed the 6 MB publishing limit.");
  return { files, script, stylesheet, assetPaths };
}

/** Wire format for the publishing RPC (bytes travel as base64 inside JSON). */
export function serializeSiteFiles(files: SiteFile[]) {
  return files.map(file => ({ path: file.path, content_type: file.contentType, sha256: file.sha256, body: file.body.toString("base64") }));
}

/** Exact retained Vite bytes only; callers must verify the build receipt first.
 * Private compiler metadata/licenses remain in retained storage, never hosted. */
export function prepareCompiledSiteFiles(input: readonly {path: string; bytes: Uint8Array; sha256: string}[]): SiteFile[] {
  const paths = new Set<string>(); let total = 0, images = 0;
  const files = input.map(file => {
    const path = `/${file.path}`, contentType = siteFileContentType(path);
    if (!contentType || paths.has(path.toLowerCase())) throw new SiteBundleError("PUBLICATION_OUTPUT_PATH_INVALID");
    paths.add(path.toLowerCase());
    const body = Buffer.from(file.bytes), sha256 = digest(body);
    const limit = contentType === SITE_CONTENT_TYPES.script ? SITE_LIMITS.script : contentType === SITE_CONTENT_TYPES.style ? SITE_LIMITS.style : SITE_LIMITS.image;
    if (sha256 !== file.sha256 || body.length > limit) throw new SiteBundleError("PUBLICATION_OUTPUT_BYTES_INVALID");
    if ((contentType === SITE_CONTENT_TYPES.font && body.subarray(0,4).toString("ascii") !== "wOF2")
      || (contentType === SITE_CONTENT_TYPES.image && !isWebp(body))
      || (contentType === SITE_CONTENT_TYPES.png && !body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
      || (contentType === SITE_CONTENT_TYPES.jpeg && !body.subarray(0,3).equals(Buffer.from([255,216,255])))) throw new SiteBundleError("PUBLICATION_OUTPUT_FORMAT_INVALID");
    if (contentType.startsWith("image/")) images++;
    total += body.length;
    return {path, contentType, body, sha256};
  });
  if (files.length > SITE_LIMITS.files || images > SITE_LIMITS.images || total > SITE_LIMITS.total) throw new SiteBundleError("PUBLICATION_OUTPUT_LIMIT");
  return files;
}

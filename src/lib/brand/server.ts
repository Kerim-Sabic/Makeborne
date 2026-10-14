import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pinnedPageFetch, publicTarget, type Fetcher, type Lookup } from "../mail/research";
import { readWithHtml } from "../leads/enrich";
import { storeProjectImage } from "../builder/images";
import type { ProjectFiles } from "../builder/files";
import { BRAND_LOGO_PATH, BRAND_LOGO_URL, brandFont, LOGO_DATA_URL, LOGO_MAX_BYTES, parseBrandKit, type BrandKit, type BrandKitInput } from "./kit";
import { extractBrand, safeSvg, stylesheetLinks } from "./extract";

type Deps = { fetcher?: Fetcher; resolve?: Lookup };
const LOGO_EDGE = 512;
const MISSING_TABLE = ["42P01", "PGRST205"];

/** GET one public resource under the research guard rails (public addresses
 * only, pinned DNS, re-checked redirects, size and time limits). */
export async function fetchPublic(raw: string, accept: string, type: RegExp, deps: Deps = {}) {
  const fetcher = deps.fetcher ?? pinnedPageFetch;
  let target = await publicTarget(raw, deps.resolve);
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetcher(target.url.toString(), { redirect: "manual", signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MakeborneResearch/1.0; +https://makeborne.com)", Accept: accept, "Accept-Encoding": "identity" } }, target.addresses);
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next || hop === 3) throw new Error("Too many redirects.");
      target = await publicTarget(new URL(next, target.url).toString(), deps.resolve);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`The resource answered ${response.status}.`); }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!type.test(contentType)) { await response.body?.cancel(); throw new Error("Unexpected content type."); }
    return { bytes: Buffer.from(await response.arrayBuffer()), contentType, url: target.url };
  }
  throw new Error("Too many redirects.");
}

/** Re-encodes any logo (PNG, JPEG, WebP, GIF or a self-contained SVG) to a
 * PNG or WebP data URL, at most 512 px on its long side and 300 KB. Re-encoding
 * strips metadata and anything that isn't pixels. */
export async function normaliseLogo(input: Buffer | string): Promise<string> {
  let bytes: Buffer;
  if (typeof input === "string") {
    const svg = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
    if (svg) bytes = Buffer.from(svg[1], "base64");
    else if (LOGO_DATA_URL.test(input) || /^data:image\/gif;base64,/.test(input)) bytes = Buffer.from(input.slice(input.indexOf(",") + 1), "base64");
    else throw new Error("Upload a PNG, JPG, WebP or SVG logo.");
  } else bytes = input;
  if (bytes.length > 2_000_000) throw new Error("Use a logo file under 2 MB.");
  const text = bytes.subarray(0, 400).toString("utf8");
  if (/<svg\b|<\?xml/i.test(text) && !safeSvg(bytes.toString("utf8"))) throw new Error("This SVG links to outside files. Export it as a PNG instead.");
  let image;
  try {
    image = sharp(bytes, { density: 300, limitInputPixels: 40_000_000, animated: false }).rotate().resize({ width: LOGO_EDGE, height: LOGO_EDGE, fit: "inside", withoutEnlargement: !/<svg\b/i.test(text) });
    const meta = await image.metadata();
    if (!meta.width || !meta.height) throw new Error("unreadable");
  } catch { throw new Error("That file isn't a readable image."); }
  for (const encode of [() => image.clone().png({ compressionLevel: 9, palette: true }), () => image.clone().webp({ quality: 88, alphaQuality: 100 }), () => image.clone().webp({ quality: 70 })]) {
    const out = await encode().toBuffer();
    if (out.length <= LOGO_MAX_BYTES) return `data:image/${out[0] === 0x89 ? "png" : "webp"};base64,${out.toString("base64")}`;
  }
  throw new Error("The logo is too detailed to store. Try a simpler PNG under 300 KB.");
}

export type ImportResult = { kit: BrandKitInput; notes: string[] };

/** Builds a draft kit from a public website. Nothing is saved; the owner reviews it first. */
export async function importBrandFromWebsite(raw: string, deps: Deps = {}): Promise<ImportResult> {
  const address = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const { facts, html } = await readWithHtml(address, deps);
  return brandFromPage(html, new URL(facts.url || address), deps);
}

/** The draft kit for an already-fetched page (its same-site stylesheets and logo are fetched through the guard). */
export async function brandFromPage(html: string, base: URL, deps: Deps = {}): Promise<ImportResult> {
  const sheets = await Promise.all(stylesheetLinks(html, base).map(href => fetchPublic(href, "text/css,*/*;q=0.1", /^text\/css$|^text\/plain$/, deps).then(result => result.bytes.toString("utf8").slice(0, 600_000), () => "")));
  const brand = extractBrand(html, sheets.join("\n"), base);
  const notes: string[] = [];

  let logo: string | null = null;
  for (const candidate of brand.logoCandidates) {
    try {
      const bytes = candidate.svg ? Buffer.from(candidate.svg) : (await fetchPublic(candidate.url, "image/png,image/webp,image/jpeg,image/svg+xml,image/gif;q=0.5", /^image\/(png|webp|jpeg|svg\+xml|gif)$/, deps)).bytes;
      logo = await normaliseLogo(bytes);
      break;
    } catch { /* try the next candidate */ }
  }
  if (!logo) notes.push("No logo was found. Upload one so it appears on your sites.");

  for (const role of ["heading", "body"] as const) {
    const font = brandFont(brand.fonts[role]), original = brand.fontSources[role];
    if (font && original && original.toLowerCase() !== font.family.toLowerCase())
      notes.push(`Your site's ${role === "heading" ? "heading" : "body"} font, ${original}, isn't in our library, so we picked ${font.family}, the closest match.`);
  }
  if (!brand.colors.primary) notes.push("No brand colour stood out. Pick your main colour.");
  notes.push("Add a tone of voice and words you use so copy and outreach sound like you.");

  return {
    kit: {
      name: brand.name || base.hostname, tagline: brand.tagline,
      colors: { primary: brand.colors.primary ?? "#1f6f5b", secondary: brand.colors.secondary, accent: brand.colors.accent, background: brand.colors.background, text: brand.colors.text },
      fonts: { heading: brand.fonts.heading, body: brand.fonts.body },
      tone: "", wordsToUse: [], wordsToAvoid: [], logo, sourceUrl: base.href.slice(0, 500),
    },
    notes: [...new Set(notes)],
  };
}

/** The saved kit for a client (or the workspace's own brand when clientId is null), read with the caller's RLS-bound client. */
export async function readBrandKit(client: SupabaseClient, workspaceId: string, clientId: string | null): Promise<BrandKit | null> {
  let query = client.from("brand_kits").select("kit").eq("workspace_id", workspaceId);
  query = clientId ? query.eq("client_id", clientId) : query.is("client_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) { if (MISSING_TABLE.includes(error.code ?? "")) return null; throw new Error("Brand kit unavailable."); }
  return data ? parseBrandKit(data.kit) : null;
}

/** A client project uses that client's kit only; the workspace's own kit is for projects without a client. */
export const projectBrandKit = (client: SupabaseClient, workspaceId: string, project: { clientId?: string | null }) =>
  readBrandKit(client, workspaceId, project.clientId ?? null).catch(() => null);

/** Stores the kit's logo as the project's `/images/brand-logo.webp` (once per logo) and returns its size for the prompt. */
export async function ensureBrandLogo(client: SupabaseClient, scope: { workspaceId: string; projectId: string }, kit: BrandKit, files: ProjectFiles) {
  if (!kit.logo) return null;
  try {
    const bytes = Buffer.from(kit.logo.slice(kit.logo.indexOf(",") + 1), "base64");
    const stored = await storeProjectImage(client, scope, bytes, { kind: "brand-logo", brand: kit.name.slice(0, 80) });
    const existing = files.assets.get(BRAND_LOGO_PATH);
    if (existing?.sha256 !== stored.sha256) files.addAsset({ id: stored.id, path: BRAND_LOGO_PATH, sha256: stored.sha256, bytes: stored.bytes, mediaType: "image/webp" });
    return { url: BRAND_LOGO_URL, width: stored.width, height: stored.height };
  } catch { return null; }
}

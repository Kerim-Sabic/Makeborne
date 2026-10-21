// Derive a run set whose projects carry the responsive image copies the builder
// now stores with every generated image (src/lib/builder/image-variants.ts,
// infra/project-runtime/responsive-images.cjs). Offline: the copies are made
// from each item's stored original bytes with the app's own code; no provider,
// storage or database is touched. Everything else is copied unchanged, so a
// before/after measurement differs only by the copies (and the platform code).
//
//   node scripts/eval/responsive-copies.mjs <runDir> <outRunDir>
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cpSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { REPO, ensureDir, readJson, writeJson, rel } from './lib/paths.mjs';
import { asWebsiteSource, resolveAssets } from './lib/website.mjs';

const require = createRequire(import.meta.url);
const { loadApp } = require('./lib/app-modules.cjs');
const responsive = require(path.join(REPO, 'infra', 'project-runtime', 'responsive-images.cjs'));
const { responsiveVariantBytes } = loadApp('src/lib/builder/image-variants.ts');
// The builder stores generated photos at this WebP quality (images.ts GENERATED_PHOTO_QUALITY).
const GENERATED_PHOTO_QUALITY = 76;

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
/** Same id scheme as images.ts assetId(), bound to a fixed eval scope. */
function assetId(sha256) {
  const digest = createHash('sha256').update(`eval-workspace:eval-project:${sha256}`).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

async function deriveItem(itemDir, outDir) {
  cpSync(itemDir, outDir, { recursive: true });
  const sourceFile = path.join(outDir, 'source.json');
  if (!existsSync(sourceFile)) return { item: path.basename(itemDir), copies: 0, skipped: 'no source.json' };
  const raw = readJson(sourceFile);
  const source = asWebsiteSource(raw);
  const { found } = resolveAssets(source, outDir);
  const assets = [...source.assets];
  let copies = 0, bytes = 0;
  for (const original of found) {
    if (!responsive.isOriginalPath(original.path)) continue;
    const descriptor = source.assets.find(asset => asset.path === original.path);
    const variants = await responsiveVariantBytes(original.bytes, { quality: GENERATED_PHOTO_QUALITY });
    if (!variants.length || !responsive.variantsFit(assets, variants.map(variant => ({ bytes: variant.bytes.length })))) continue;
    const { default: sharp } = await import('sharp');
    const meta = await sharp(original.bytes).metadata();
    for (const variant of variants) {
      const digest = sha(variant.bytes), id = assetId(digest);
      writeFileSync(path.join(outDir, 'assets', `${id}.webp`), variant.bytes);
      assets.push({ id, path: responsive.variantPath({ sha256: descriptor.sha256, width: meta.width, height: meta.height }, variant.width), sha256: digest, bytes: variant.bytes.length, mediaType: 'image/webp' });
      copies++; bytes += variant.bytes.length;
    }
  }
  const next = { ...source, assets };
  writeJson(sourceFile, raw.content?.websiteSource ? { ...raw, content: { ...raw.content, websiteSource: next } } : raw.websiteSource ? { ...raw, websiteSource: next } : next);
  return { item: path.basename(itemDir), copies, bytes };
}

const [runDir, outRunDir] = process.argv.slice(2);
if (!runDir || !outRunDir) {
  console.error('usage: node scripts/eval/responsive-copies.mjs <runDir> <outRunDir>');
  process.exit(2);
}
const from = path.resolve(runDir), to = path.resolve(outRunDir);
if (existsSync(to)) throw new Error(`${rel(to)} exists; choose a new folder`);
ensureDir(to);
for (const entry of readdirSync(from, { withFileTypes: true })) {
  const source = path.join(from, entry.name), target = path.join(to, entry.name);
  if (!entry.isDirectory()) { cpSync(source, target); continue; }
  const result = await deriveItem(source, target);
  console.log(`${result.item}: ${result.copies} responsive cop${result.copies === 1 ? 'y' : 'ies'}${result.bytes ? ` (${Math.round(result.bytes / 1024)} KiB)` : ''}${result.skipped ? ` (${result.skipped})` : ''}`);
}

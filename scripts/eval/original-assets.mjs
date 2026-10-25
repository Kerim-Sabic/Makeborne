// Derive a run set whose items carry the STORED original image bytes.
//
// The live runner saves artwork through the asset route's export variant, which
// re-encodes it as lossless WebP (src/lib/cloud/image-preview.ts renderAssetExport):
// a generated q76 photo of ~130 KB comes back as ~1.2 MB, its sha256 no longer
// matches the source record, and measure.mjs then either counts it missing or
// (EVAL_ACCEPT_REENCODED_ASSETS=1) serves the inflated file without the srcset the
// published site has. Page weight (W12) and LCP read far worse than what a visitor
// downloads. This copies a run and replaces each item's assets with the registered
// original objects: the asset rows are read in a read-only transaction and each
// object is fetched from the ISOLATED release-auth stack's storage (127.0.0.1 only,
// its local key is never printed), verified against the source record's sha256,
// and written where resolveAssets() looks. Everything else is copied unchanged.
// No provider is called and nothing is written to the stack.
//
//   node scripts/eval/original-assets.mjs <runDir> <outRunDir> [itemId ...]
import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isolatedStack, assertLocalOrigin } from './lib/stack.mjs';
import { withReadOnly } from './lib/fixtures.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function originalAssets(runDir, outDir, only = []) {
  const stack = isolatedStack();
  assertLocalOrigin(stack.apiUrl);
  mkdirSync(outDir, { recursive: true });
  for (const name of readdirSync(runDir)) if (statSync(path.join(runDir, name)).isFile()) copyFileSync(path.join(runDir, name), path.join(outDir, name));
  const items = readdirSync(runDir).filter(name => statSync(path.join(runDir, name)).isDirectory() && (!only.length || only.includes(name)));
  const results = [];
  for (const item of items) {
    const from = path.join(runDir, item), to = path.join(outDir, item), assetsDir = path.join(from, 'assets');
    cpSync(from, to, { recursive: true, filter: file => file !== assetsDir && !file.startsWith(assetsDir + path.sep) });
    const sourceFile = path.join(from, 'source.json');
    const assets = existsSync(sourceFile) ? JSON.parse(readFileSync(sourceFile, 'utf8')).assets ?? [] : [];
    const result = { item, assets: assets.length, originals: 0, bytes: 0, problems: [] };
    results.push(result);
    if (!assets.length) continue;
    const rows = await withReadOnly('release-auth', client => client.query('select id, object_path from public.assets where id = any($1::uuid[])', [assets.map(asset => asset.id)]).then(answer => answer.rows));
    const objects = new Map(rows.map(row => [row.id, row.object_path]));
    for (const asset of assets) {
      const objectPath = objects.get(asset.id);
      if (!objectPath) { result.problems.push(`${asset.path}: not registered`); continue; }
      const response = await fetch(`${stack.apiUrl}/storage/v1/object/project-assets/${objectPath.split('/').map(encodeURIComponent).join('/')}`,
        { headers: { apikey: stack.secretKey, Authorization: `Bearer ${stack.secretKey}` } });
      if (!response.ok) { result.problems.push(`${asset.path}: HTTP ${response.status}`); continue; }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (sha(bytes) !== asset.sha256) { result.problems.push(`${asset.path}: sha256 differs from the source record`); continue; }
      const target = path.resolve(to, 'assets', asset.path.replace(/^public\//, ''));
      if (!target.startsWith(path.join(to, 'assets') + path.sep)) { result.problems.push(`${asset.path}: outside assets/`); continue; }
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      result.originals++; result.bytes += bytes.length;
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [runDir, outDir, ...only] = process.argv.slice(2);
  if (!runDir || !outDir) { console.error('usage: node scripts/eval/original-assets.mjs <runDir> <outRunDir> [itemId ...]'); process.exit(2); }
  for (const result of await originalAssets(path.resolve(runDir), path.resolve(outDir), only))
    console.log(`${result.item}: ${result.originals}/${result.assets} original asset(s), ${Math.round(result.bytes / 1024)} KiB${result.problems.length ? `; ${result.problems.join('; ')}` : ''}`);
}

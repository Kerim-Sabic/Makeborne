// Fixture export: the projects Makeborne already generated on the local
// stacks, written in the run layout of scripts/eval/README.md so the measure
// and judge steps can treat them exactly like a live run.
//
// Every database access is `begin read only ... rollback` on a loopback stack.
// Nothing here writes to any database or calls a provider. Document exports are
// rendered offline with the app's own exporters (the same functions the
// document-export route calls), so they reflect today's exporter, not the one
// that happened to run when the fixture was made.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import pg from 'pg';
import { REPO, RUNS, BRIEFS_DIR, ensureDir, readJson, writeJson, rel, stamp } from './paths.mjs';
import { isolatedStack } from './stack.mjs';
import { summary as budgetSummary } from './budget.mjs';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Local databases (read-only)
// ---------------------------------------------------------------------------

/** The three local stacks fixtures come from. Only release-auth is the harness's own stack. */
export const STACKS = Object.freeze({
  'release-auth': { port: 55438, short: 'ra', note: 'isolated release-auth stack (the harness stack)',
    generation: 'Built by scripts/qualify-products.mjs posting straight to /api/build (no plan, no review round); per-run effort not recorded (script default high).' },
  'makeborne-local': { port: 55322, short: 'lo', note: 'developer local stack',
    generation: 'Built in the studio at the project effort; the version history shows the stages where present (continuation and "Design review" versions).' },
  'fresh-quality': { port: 55468, short: 'fq', note: 'fresh-quality qualification stack',
    generation: 'Built by scripts/qualify-fresh-products.mjs at high effort (fresh-quality-common.mjs CASES); the deck v2 is a light-effort edit.' },
});

/** Connection string for a local stack; refuses anything that is not loopback. */
export function stackDbUrl(stack) {
  const known = STACKS[stack];
  assert(known, `Unknown stack ${stack}`);
  const value = stack === 'release-auth' ? isolatedStack().dbUrl : `postgresql://postgres:postgres@127.0.0.1:${known.port}/postgres`;
  const url = new URL(value);
  assert.equal(url.hostname, '127.0.0.1', `Refusing non-loopback database for ${stack}`);
  assert.equal(Number(url.port), known.port, `Refusing unexpected port for ${stack}`);
  return value;
}

/** Run fn(client) inside `begin read only` and always roll back. */
export async function withReadOnly(stack, fn) {
  const client = new pg.Client({ connectionString: stackDbUrl(stack), connectionTimeoutMillis: 5000, query_timeout: 60_000, application_name: 'makeborne-eval-readonly' });
  await client.connect();
  try {
    await client.query('begin read only');
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// The fixture set
// ---------------------------------------------------------------------------

/**
 * Directions are the ten industry directions of src/lib/builder/prompt.ts,
 * assigned by reading each brief. Decks and books get the direction of the
 * business or audience they are about, so the set can be sliced the same way.
 * brief: 'qualify:<case>' = the prompt in scripts/qualify-products.mjs (those
 * projects were created without a brief; the prompt was the build message),
 * 'project' = public.projects.brief, 'v1-message' = the first build message
 * recorded in artifact_versions.change_summary of version 1.
 */
export const FIXTURES = Object.freeze([
  { id: 'fx-ra-saffron-table', stack: 'release-auth', workspaceId: 'bbc276ae-1a66-45df-bb61-61ac6c14d865', artifactId: 'f70c3257-6a5b-46fa-9ced-63ab6f3eab37', direction: 'restaurant', brief: 'qualify:restaurant',
    note: 'Current v17 restores v2 (identical websiteSource); v3-v16 were visual-edit trials.' },
  { id: 'fx-ra-relay-operations', stack: 'release-auth', workspaceId: 'bbc276ae-1a66-45df-bb61-61ac6c14d865', artifactId: 'd1f91647-ee9d-4bf7-9157-4358257319c7', direction: 'saas', brief: 'qualify:saas' },
  { id: 'fx-ra-mira-objects', stack: 'release-auth', workspaceId: 'bbc276ae-1a66-45df-bb61-61ac6c14d865', artifactId: '97126fea-08cc-40e3-9843-b6eb0f528251', direction: 'creator', brief: 'qualify:portfolio' },
  { id: 'fx-ra-from-brief-to-better-work', stack: 'release-auth', workspaceId: 'bbc276ae-1a66-45df-bb61-61ac6c14d865', artifactId: '2ab1c257-29a8-4595-a443-91853be348eb', direction: 'creator', brief: 'qualify:presentation',
    note: 'Deck for freelance designers selling their process.' },
  { id: 'fx-ra-useful-client-brief', stack: 'release-auth', workspaceId: 'bbc276ae-1a66-45df-bb61-61ac6c14d865', artifactId: 'f6c608e5-42c9-47ec-ba4a-ae3980b6ef5c', direction: 'creator', brief: 'qualify:book',
    note: 'Ebook for freelance designers.' },
  { id: 'fx-lo-lumen-atelier', stack: 'makeborne-local', workspaceId: '0a3d6952-0e17-492f-a83b-f48b11796b77', artifactId: 'c8d1717f-3afe-430e-973c-e8fedf5b55c7', direction: 'ecommerce', brief: 'project',
    note: 'Makeup brand selling three products: product brand (beauty overlaps wellness).' },
  { id: 'fx-lo-saltwater-smoke', stack: 'makeborne-local', workspaceId: '0a3d6952-0e17-492f-a83b-f48b11796b77', artifactId: '2b295963-c4ce-4162-8770-918bb61d6251', direction: 'restaurant', brief: 'project' },
  { id: 'fx-lo-osteria-brina', stack: 'makeborne-local', workspaceId: '0a3d6952-0e17-492f-a83b-f48b11796b77', artifactId: 'd3451074-014b-451d-ba20-010e2c7e5c90', direction: 'restaurant', brief: 'project' },
  { id: 'fx-lo-kafa-tamo', stack: 'makeborne-local', workspaceId: '0a3d6952-0e17-492f-a83b-f48b11796b77', artifactId: '44782994-b6f9-409d-9ace-c21ae854c9a2', direction: 'ecommerce', brief: 'project',
    note: 'Project is titled "Untitled website"; the brief is Kafa Tamo. Online bean subscriptions lead; the cafe is secondary (restaurant).' },
  { id: 'fx-lo-ledgerline', stack: 'makeborne-local', workspaceId: '0a3d6952-0e17-492f-a83b-f48b11796b77', artifactId: '911f301e-8a08-4bdd-a7fe-70b7f7c42860', direction: 'saas', brief: 'project' },
  { id: 'fx-lo-marlow-hayes', stack: 'makeborne-local', workspaceId: '0a3d6952-0e17-492f-a83b-f48b11796b77', artifactId: '89cdacf0-0fb6-46c0-a70d-5635a66eb928', direction: 'professional', brief: 'project' },
  { id: 'fx-lo-crux-yard', stack: 'makeborne-local', workspaceId: '0a3d6952-0e17-492f-a83b-f48b11796b77', artifactId: '98060eaa-e808-4fbb-9d3c-a8c965263a03', direction: 'wellness', brief: 'project',
    note: 'Bouldering gym: health and fitness.' },
  { id: 'fx-lo-halden-ceramics', stack: 'makeborne-local', workspaceId: '0a3d6952-0e17-492f-a83b-f48b11796b77', artifactId: '71e79d38-cb45-43cd-9cee-44d7e4e16f7c', direction: 'ecommerce', brief: 'v1-message',
    note: 'projects.brief is empty; brief recovered from the v1 build message. Shop collections lead; classes and studio story are secondary (creator).' },
  { id: 'fx-lo-tide-pools', stack: 'makeborne-local', workspaceId: '0a3d6952-0e17-492f-a83b-f48b11796b77', artifactId: '61eeaf74-e60f-4354-8c8a-b19b5f69bd0a', direction: 'civic', brief: 'project',
    note: 'Nature non-fiction for curious adults: education.' },
  { id: 'fx-lo-tidewater-seed-round', stack: 'makeborne-local', workspaceId: '0a3d6952-0e17-492f-a83b-f48b11796b77', artifactId: '400bf89c-013a-4f1d-bbf3-e723265c2198', direction: 'saas', brief: 'project',
    note: 'Seed pitch for an energy-storage startup: closest is the startup/tech direction.' },
  { id: 'fx-fq-repair-table', stack: 'fresh-quality', workspaceId: '2767387c-52d7-4f8d-b699-dd15c53af238', artifactId: '972063d7-b858-4189-85f3-442d832e0176', direction: 'civic', brief: 'project',
    note: 'Ebook for community repair cafe volunteers.' },
  { id: 'fx-fq-keep-the-wheels-turning', stack: 'fresh-quality', workspaceId: '2767387c-52d7-4f8d-b699-dd15c53af238', artifactId: '12e2fcb0-926d-47ee-89b4-129f0c0b26fd', direction: 'trades', brief: 'project',
    note: 'Proposal deck for a bicycle workshop: local service.' },
]);

/** Workspaces scanned for generated artifacts the list above does not cover (reported, not exported). */
const SCANNED = Object.freeze([...new Set(FIXTURES.map(item => `${item.stack}|${item.workspaceId}`))].map(key => {
  const [stack, workspaceId] = key.split('|');
  return { stack, workspaceId };
}));

/** The briefs of the release-auth qualification cases, read from their script. */
export function qualificationBriefs() {
  const text = readFileSync(path.join(REPO, 'scripts', 'qualify-products.mjs'), 'utf8');
  const cases = {};
  for (const match of text.matchAll(/(\w+):\{kind:'(\w+)',title:'((?:[^'\\]|\\.)*)',prompt:'((?:[^'\\]|\\.)*)'\}/g)) {
    cases[match[1]] = { kind: match[2], title: match[3], prompt: match[4].replace(/\\(.)/g, '$1') };
  }
  return cases;
}

const sha256 = value => createHash('sha256').update(value).digest('hex');
const KIND = { website: 'website', presentation: 'presentation', book: 'book' };

/**
 * Golden briefs adapted from a fixture's brief (their source.path names the
 * fixture's project, or the script case with the same title). Lets a later
 * round compare a fixture with the live result of the frozen brief. The texts
 * differ by design (see the brief's source.adaptation).
 */
export function relatedBriefIds(fixtures, projectIds) {
  const related = new Map();
  const index = path.join(BRIEFS_DIR, 'index.json');
  if (!existsSync(index)) return related;
  for (const id of readJson(index).order ?? []) {
    const file = path.join(BRIEFS_DIR, `${id}.json`);
    if (!existsSync(file)) continue;
    const brief = readJson(file);
    const source = String(brief.source?.path ?? '');
    for (const item of fixtures) {
      const byProject = projectIds.get(item.id) && source.includes(projectIds.get(item.id));
      const byScript = /^scripts\/(qualify-products|fresh-quality-common)\.mjs/.test(source) && brief.title === item.title;
      if (byProject || byScript) related.set(item.id, id);
    }
  }
  return related;
}

// ---------------------------------------------------------------------------
// Offline document exports (the app's own exporters)
// ---------------------------------------------------------------------------

let exporters = null;
function documentExporters() {
  // fonts-server.ts reads the font files from process.cwd().
  assert.equal(path.resolve(process.cwd()), path.resolve(REPO), 'Run document exports from the repo root (fonts are read from process.cwd())');
  exporters ??= require('./app-modules.cjs').loadApp('src/lib/documents/export-server.ts');
  return exporters;
}

/**
 * Render exports/document.pdf (and .pptx for decks) for a saved document.
 * Images are not supported here (none of the fixtures has document assets);
 * a document with assets is exported without them and the result says so.
 */
export async function renderDocumentExports(document, dir) {
  const { documentPdf, documentPptx } = documentExporters();
  const out = ensureDir(path.join(dir, 'exports'));
  const results = {};
  const missingImages = document.assets?.length ?? 0;
  const formats = document.kind === 'deck' ? ['pdf', 'pptx'] : ['pdf'];
  for (const format of formats) {
    const started = Date.now();
    try {
      const bytes = format === 'pdf' ? await documentPdf(document, {}) : await documentPptx(document, {});
      writeFileSync(path.join(out, `document.${format}`), bytes);
      results[format] = { ok: true, bytes: bytes.length, ms: Date.now() - started, file: rel(path.join(out, `document.${format}`)), renderer: 'offline: src/lib/documents/export-server.ts', missingImages };
    } catch (error) {
      results[format] = { ok: false, ms: Date.now() - started, error: String(error?.message ?? error).slice(0, 500) };
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Database fixtures
// ---------------------------------------------------------------------------

async function readFixture(client, item) {
  const { rows: [row] } = await client.query(`
    select a.id artifact_id, a.title artifact_title, a.kind, a.current_version, a.project_id,
           p.title project_title, p.brief, p.style_id, p.effort, p.audience, p.purpose,
           (select max(version_number) from public.artifact_versions x where x.artifact_id = a.id) latest_version,
           (select count(*)::int from public.artifact_versions x where x.artifact_id = a.id) version_count
      from public.artifacts a join public.projects p on p.id = a.project_id
     where a.id = $1 and a.workspace_id = $2`, [item.artifactId, item.workspaceId]);
  if (!row) throw new Error('artifact not found in its workspace');
  const { rows: [version] } = await client.query(`
    select id, version_number, parent_version_id, content, style_snapshot, asset_manifest, change_summary, created_by, created_at
      from public.artifact_versions where artifact_id = $1 and version_number = $2`, [item.artifactId, row.current_version]);
  if (!version) throw new Error(`current version ${row.current_version} not found`);
  let firstMessage = null;
  if (item.brief === 'v1-message') {
    const { rows: [first] } = await client.query('select change_summary from public.artifact_versions where artifact_id = $1 and version_number = 1', [item.artifactId]);
    // Saved summaries are "<request> → <result>"; the request is the brief.
    firstMessage = first?.change_summary?.split(' → ')[0]?.trim() || null;
  }
  return { row, version, firstMessage };
}

/** Artifacts with generated content in the scanned workspaces that FIXTURES does not export. */
async function unlisted(client, workspaceId, listed) {
  const { rows } = await client.query(`
    select a.id, a.title, a.kind, a.current_version, (v.content ? 'websiteSource') has_source, (v.content ? 'document') has_document
      from public.artifacts a join public.artifact_versions v on v.artifact_id = a.id and v.version_number = a.current_version
     where a.workspace_id = $1`, [workspaceId]);
  return rows.filter(entry => !listed.has(entry.id)).map(entry => ({
    artifactId: entry.id, title: entry.title, kind: entry.kind, version: entry.current_version,
    skipped: entry.has_source || entry.has_document ? 'generated content, not in the fixture list' : 'no websiteSource or live-built document (empty or legacy outline)',
  }));
}

function briefFor(item, row, firstMessage, cases) {
  if (item.brief.startsWith('qualify:')) {
    const entry = cases[item.brief.slice(8)];
    if (!entry) throw new Error(`qualification case ${item.brief} not found in scripts/qualify-products.mjs`);
    return { text: entry.prompt, source: `scripts/qualify-products.mjs cases.${item.brief.slice(8)}.prompt (sent as the build message; projects.brief is empty)` };
  }
  if (item.brief === 'v1-message') return { text: firstMessage, source: 'artifact_versions.change_summary of v1 (the first build message; projects.brief is empty)' };
  return { text: row.brief, source: 'public.projects.brief' };
}

async function exportOne(item, client, dir, cases) {
  const { row, version, firstMessage } = await readFixture(client, item);
  const kind = KIND[row.kind];
  const content = version.content ?? {};
  const brief = briefFor(item, row, firstMessage, cases);
  const title = (kind === 'website' ? content.title : content.document?.title) || row.artifact_title;
  writeJson(path.join(dir, 'item.json'), {
    id: item.id, kind, title, direction: item.direction, briefId: null, brief: brief.text, briefSource: brief.source,
    origin: { type: 'fixture', stack: `${item.stack}:${STACKS[item.stack].port}`, workspaceId: item.workspaceId, projectId: row.project_id,
      artifactId: item.artifactId, version: row.current_version, latestVersion: row.latest_version, path: null },
    generation: { styleId: row.style_id, projectEffort: row.effort, note: STACKS[item.stack].generation },
    note: item.note ?? null,
    evidence: { events: 'not available (fixture)', cost: 'not available (fixture)', requests: 'not available (fixture)' },
  });
  writeJson(path.join(dir, 'version.json'), {
    id: version.id, versionNumber: version.version_number, parentVersionId: version.parent_version_id, createdAt: version.created_at,
    createdBy: version.created_by, changeSummary: version.change_summary, contentSha256: sha256(JSON.stringify(content)),
    styleSnapshot: version.style_snapshot ? { id: version.style_snapshot.id ?? null, name: version.style_snapshot.name ?? null } : null,
    assetManifest: version.asset_manifest, artifactTitle: row.artifact_title, projectTitle: row.project_title,
    currentVersion: row.current_version, latestVersion: row.latest_version, versionCount: row.version_count,
  });
  writeJson(path.join(dir, 'cost.json'), { available: false, reason: 'Fixture generated before the eval harness; its provider calls are not linked to this item.', boundUsd: null, actualUsd: null, calls: [], credits: null });

  const status = { ok: true, stage: 'fixture-export', code: null, message: 'Exported' };
  const detail = { id: item.id, kind, title, direction: item.direction, version: row.current_version, projectId: row.project_id };
  if (kind === 'website') {
    const source = content.websiteSource;
    if (!source?.files?.length) throw Object.assign(new Error('current version has no websiteSource'), { code: 'NO_SOURCE' });
    writeJson(path.join(dir, 'source.json'), source);
    Object.assign(detail, { files: source.files.length, assets: source.assets?.length ?? 0, routes: source.routes?.length ?? 0 });
    if (source.assets?.length) { status.ok = false; status.code = 'ASSETS_NOT_EXPORTED'; status.message = 'Website assets live in project storage and were not copied'; }
  } else {
    const document = content.document;
    if (!document) throw Object.assign(new Error('current version has no live-built document'), { code: 'NO_DOCUMENT' });
    writeJson(path.join(dir, 'document.json'), document);
    const exports = await renderDocumentExports(document, dir);
    Object.assign(detail, { documentKind: document.kind, slides: document.slides?.length, chapters: document.chapters?.length, exports });
    const failed = Object.entries(exports).filter(([, result]) => !result.ok);
    if (failed.length) { status.ok = false; status.code = 'EXPORT_FAILED'; status.message = failed.map(([format, result]) => `${format}: ${result.error}`).join('; '); }
  }
  writeJson(path.join(dir, 'status.json'), status);
  return { ...detail, status: status.ok ? 'exported' : status.code };
}

/**
 * Export the database fixtures into outputs/eval/runs/fixtures-<stamp>/.
 * Returns the run.json object (also written to disk).
 */
export async function exportFixtures({ only, log = console.log } = {}) {
  const runId = `fixtures-${stamp()}`;
  const runDir = ensureDir(path.join(RUNS, runId));
  const startedAt = new Date().toISOString();
  const cases = qualificationBriefs();
  const items = [];
  const notExported = [];
  const selected = FIXTURES.filter(item => !only || only.includes(item.id));
  for (const stack of Object.keys(STACKS)) {
    const group = selected.filter(item => item.stack === stack);
    if (!group.length) continue;
    try {
      await withReadOnly(stack, async client => {
        for (const item of group) {
          const dir = ensureDir(path.join(runDir, item.id));
          try {
            const result = await exportOne(item, client, dir, cases);
            items.push(result);
            log(`  ${result.status === 'exported' ? 'ok  ' : 'warn'} ${item.id} (${result.kind} v${result.version}${result.exports ? `, exports ${Object.entries(result.exports).map(([format, value]) => `${format}:${value.ok ? 'ok' : 'FAILED'}`).join(' ')}` : `, ${result.files} files`})`);
          } catch (error) {
            writeJson(path.join(dir, 'status.json'), { ok: false, stage: 'fixture-export', code: error.code ?? 'EXPORT_FAILED', message: String(error.message).slice(0, 500) });
            items.push({ id: item.id, kind: null, status: 'failed', error: String(error.message).slice(0, 300) });
            log(`  FAIL ${item.id}: ${error.message}`);
          }
        }
        const listed = new Set(FIXTURES.map(item => item.artifactId));
        for (const scope of SCANNED.filter(entry => entry.stack === stack)) {
          notExported.push(...(await unlisted(client, scope.workspaceId, listed)).map(entry => ({ stack, workspaceId: scope.workspaceId, ...entry })));
        }
      });
    } catch (error) {
      for (const item of group.filter(entry => !items.some(done => done.id === entry.id))) {
        items.push({ id: item.id, kind: null, status: 'failed', error: `stack ${stack} unavailable: ${error.message}` });
      }
      log(`  FAIL stack ${stack} (${STACKS[stack].port}): ${error.message}`);
    }
  }
  // Link fixtures to the frozen golden brief adapted from them (written into item.json too).
  const related = relatedBriefIds(items.filter(entry => entry.title), new Map(items.map(entry => [entry.id, entry.projectId])));
  for (const entry of items) {
    entry.relatedBriefId = related.get(entry.id) ?? null;
    const file = path.join(runDir, entry.id, 'item.json');
    if (entry.relatedBriefId && existsSync(file)) {
      writeJson(file, { ...readJson(file), relatedBriefId: entry.relatedBriefId, relatedNote: 'This golden brief was adapted from this fixture\'s brief; the texts differ (see the brief\'s source.adaptation).' });
    }
  }
  const run = {
    runId, mode: 'fixtures', startedAt, finishedAt: new Date().toISOString(), effort: null,
    stack: Object.fromEntries(Object.entries(STACKS).map(([name, value]) => [name, { port: value.port, access: 'read-only', note: value.note }])),
    briefsSha256: null,
    items: items.map(entry => ({ id: entry.id, kind: entry.kind, direction: entry.direction ?? null, status: entry.status, costUsd: null, relatedBriefId: entry.relatedBriefId ?? null, ...(entry.error ? { error: entry.error } : {}) })),
    counts: countByKind(items),
    exportFailures: items.filter(entry => entry.exports && Object.values(entry.exports).some(result => !result.ok)).map(entry => entry.id),
    notExported,
    budget: safeBudget(),
  };
  writeJson(path.join(runDir, 'run.json'), run);
  return { run, runDir };
}

export function countByKind(items) {
  const counts = { total: items.length, exported: items.filter(entry => entry.status === 'exported').length };
  for (const entry of items) if (entry.kind) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  return counts;
}

function safeBudget() {
  try { return budgetSummary(); } catch (error) { return { error: error.message }; }
}

// ---------------------------------------------------------------------------
// Redesign fixtures (work/redesign-quality, files on disk)
// ---------------------------------------------------------------------------

const IMAGE_TYPES = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const REDESIGN_DIRECTIONS = { 'Frazierz Bakery': 'restaurant', 'Monee Dental': 'wellness' };

/** A stable UUID-shaped id derived from content, so re-exports are identical. */
function stableId(value) {
  const hex = sha256(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) out.push(...walk(file, base));
    else out.push(path.relative(base, file).split(path.sep).join('/'));
  }
  return out;
}

/** Build a WebsiteProjectSource from a project folder: text files + public/ images as assets. */
function sourceFromFolder(projectDir, title) {
  const files = [], assets = [];
  for (const file of walk(projectDir)) {
    const absolute = path.join(projectDir, file);
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (file.startsWith('public/') && type) {
      const bytes = readFileSync(absolute);
      const hash = sha256(bytes);
      assets.push({ id: stableId(`${file}:${hash}`), path: file, sha256: hash, bytes: bytes.length, mediaType: type, absolute });
    } else {
      files.push({ path: file, content: readFileSync(absolute, 'utf8') });
    }
  }
  return {
    // routes are not recorded on disk; ProjectFiles.toSource() uses the same default.
    source: { schemaVersion: 1, toolchainId: 'react-vite-v1', entrypoint: 'src/main.tsx', files,
      assets: assets.map(asset => ({ id: asset.id, path: asset.path, sha256: asset.sha256, bytes: asset.bytes, mediaType: asset.mediaType })),
      routes: [{ path: '/', title: title || 'Home' }] },
    assets,
  };
}

/** The business a redesign run is about: its report, else its folder name. */
function redesignBusiness(name, report) {
  return report.businessName ?? (name.includes('monee') ? 'Monee Dental' : name.includes('bakery') ? 'Frazierz Bakery' : null);
}

/**
 * The run an edit run was made from. Edit runs (work/redesign-quality/edit.cjs)
 * write no brief.txt and do not record their source folder, but their
 * report.json lists every file they changed; the parent is the sibling run
 * (one with a brief.txt) whose project holds every OTHER file of the edit
 * byte for byte. Only a unique full match counts; otherwise parent is null and
 * the candidates' scores say why.
 */
export function redesignParent(root, name, runs) {
  const reportFile = path.join(root, name, 'report.json');
  const report = existsSync(reportFile) ? readJson(reportFile) : {};
  if (!Array.isArray(report.changed)) return { parent: null, reason: 'report.json lists no changed files, so the unchanged files cannot be compared' };
  const changed = new Set(report.changed);
  const hashes = dir => new Map(walk(dir).map(file => [file, sha256(readFileSync(path.join(dir, file)))]));
  const child = hashes(path.join(root, name, 'project'));
  const kept = [...child.keys()].filter(file => !changed.has(file));
  if (!kept.length) return { parent: null, reason: 'the edit changed every file' };
  const candidates = runs.filter(other => other !== name && existsSync(path.join(root, other, 'brief.txt'))).map(other => {
    const files = hashes(path.join(root, other, 'project'));
    return { run: other, identical: kept.filter(file => files.get(file) === child.get(file)).length, of: kept.length };
  });
  const full = candidates.filter(candidate => candidate.identical === candidate.of);
  return full.length === 1
    ? { parent: full[0].run, reason: `all ${kept.length} files the edit did not change are identical to ${full[0].run}/project (no other run matches all of them)`, changed: report.changed.length, candidates }
    : { parent: null, reason: full.length ? `${full.length} runs match every unchanged file: ${full.map(entry => entry.run).join(', ')}` : 'no run matches every unchanged file', candidates };
}

/** Export work/redesign-quality/<run>/project as a separate fixture set (outputs/eval/runs/fixtures-redesign-<stamp>/). */
export async function exportRedesigns({ log = console.log } = {}) {
  const root = path.join(REPO, 'work', 'redesign-quality');
  const runId = `fixtures-redesign-${stamp()}`;
  const runDir = ensureDir(path.join(RUNS, runId));
  const startedAt = new Date().toISOString();
  const items = [];
  const runs = existsSync(root) ? readdirSync(root).filter(name => existsSync(path.join(root, name, 'project', 'src', 'main.tsx'))).sort() : [];
  for (const name of runs) {
    const id = `fx-rd-${name}`;
    const dir = ensureDir(path.join(runDir, id));
    try {
      const folder = path.join(root, name);
      const report = existsSync(path.join(folder, 'report.json')) ? readJson(path.join(folder, 'report.json')) : {};
      let brief = existsSync(path.join(folder, 'brief.txt')) ? readFileSync(path.join(folder, 'brief.txt'), 'utf8').trim() : null;
      let business = redesignBusiness(name, report);
      let briefSource = brief ? `work/redesign-quality/${name}/brief.txt` : 'none recorded (edit run on an earlier redesign)';
      let title = report.result?.title ?? null;
      // An edit run (no brief.txt) inherits title, business (direction) and brief from the run it edited.
      const lineage = brief ? null : redesignParent(root, name, runs);
      if (lineage?.parent) {
        const parentFolder = path.join(root, lineage.parent);
        const parentReport = existsSync(path.join(parentFolder, 'report.json')) ? readJson(path.join(parentFolder, 'report.json')) : {};
        brief = readFileSync(path.join(parentFolder, 'brief.txt'), 'utf8').trim();
        business = redesignBusiness(lineage.parent, parentReport);
        title ??= parentReport.result?.title ?? null;
        briefSource = `inherited from work/redesign-quality/${lineage.parent}/brief.txt (parent run: ${lineage.reason})`;
      }
      title ??= business ?? name;
      const { source, assets } = sourceFromFolder(path.join(folder, 'project'), business);
      writeJson(path.join(dir, 'source.json'), source);
      // Images under assets/ keep their in-code path: assets/images/x.webp is served at /images/x.webp.
      for (const asset of assets) {
        const target = path.join(dir, 'assets', asset.path.replace(/^public\//, ''));
        ensureDir(path.dirname(target));
        copyFileSync(asset.absolute, target);
      }
      writeJson(path.join(dir, 'item.json'), {
        id, kind: 'website', title, direction: REDESIGN_DIRECTIONS[business] ?? null, briefId: null,
        // briefGroup: the business the brief is about; diversity.mjs counts distinct briefs by it.
        brief, briefSource, briefGroup: business,
        ...(lineage ? { parentRun: lineage.parent ? `fx-rd-${lineage.parent}` : null, lineage } : {}),
        origin: { type: 'fixture', stack: null, artifactId: null, version: null, path: `work/redesign-quality/${name}/project`, ...(lineage?.parent ? { parentPath: `work/redesign-quality/${lineage.parent}/project` } : {}) },
        generation: { effort: report.effort ?? null, seconds: report.seconds ?? null, finished: report.result?.finished ?? report.finished ?? null,
          builder: lineage ? `work/redesign-quality/edit.cjs (an edit of ${lineage.parent ?? 'an earlier run'}; ${report.changed?.length ?? '?'} files changed)` : 'work/redesign-quality/build.cjs (runBuilder outside the app routes; no plan, no review round)' },
        assetsDir: 'assets', assetsServedAt: '/',
        note: 'Redesign of a real business site from its public pages; for internal measurement only.',
        evidence: { events: 'not available (fixture)', requests: 'not available (fixture)' },
      });
      const usd = report.confirmedUsd ?? report.usd ?? null;
      writeJson(path.join(dir, 'cost.json'), { available: usd !== null, source: 'report.json of the redesign run (in-memory spend gate, not the DB ledger)', boundUsd: null, actualUsd: usd,
        // Older reports keep a call list, newer ones only a count.
        calls: Array.isArray(report.calls) ? report.calls.map(call => ({ model: call.model, boundUsd: call.boundUsd, actualUsd: call.actualUsd ?? null })) : [],
        callCount: Array.isArray(report.calls) ? report.calls.length : report.calls ?? null, credits: report.result?.credits ?? null });
      writeJson(path.join(dir, 'version.json'), { available: false, reason: 'Built on disk, never saved as an artifact version', files: source.files.length, assets: source.assets.length, contentSha256: sha256(JSON.stringify(source)) });
      writeJson(path.join(dir, 'status.json'), { ok: true, stage: 'fixture-export', code: null, message: 'Exported from disk' });
      items.push({ id, kind: 'website', direction: REDESIGN_DIRECTIONS[business] ?? null, briefGroup: business, ...(lineage ? { parentRun: lineage.parent ? `fx-rd-${lineage.parent}` : null } : {}), status: 'exported', files: source.files.length, assets: assets.length, costUsd: usd });
      log(`  ok   ${id} (${source.files.length} files, ${assets.length} images${lineage ? `; parent ${lineage.parent ?? 'not found'}: ${lineage.reason}` : ''})`);
    } catch (error) {
      writeJson(path.join(dir, 'status.json'), { ok: false, stage: 'fixture-export', code: 'EXPORT_FAILED', message: String(error.message).slice(0, 500) });
      items.push({ id, kind: 'website', status: 'failed', error: String(error.message).slice(0, 300) });
      log(`  FAIL ${id}: ${error.message}`);
    }
  }
  const run = { runId, mode: 'fixtures', set: 'redesign', startedAt, finishedAt: new Date().toISOString(), effort: null, stack: null, briefsSha256: null,
    items: items.map(entry => ({ id: entry.id, kind: entry.kind, direction: entry.direction ?? null, briefGroup: entry.briefGroup ?? null, ...(entry.parentRun !== undefined ? { parentRun: entry.parentRun } : {}), status: entry.status, costUsd: entry.costUsd ?? null, ...(entry.error ? { error: entry.error } : {}) })),
    briefGroups: [...new Set(items.map(entry => entry.briefGroup).filter(Boolean))],
    counts: countByKind(items), budget: safeBudget() };
  writeJson(path.join(runDir, 'run.json'), run);
  return { run, runDir };
}

// ---------------------------------------------------------------------------
// CLI: the redesign set alone. `run.mjs --fixtures --include-redesign` exports
// the database fixtures first; this exports only work/redesign-quality.
//   node scripts/eval/lib/fixtures.mjs --only-redesign

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--only-redesign')) {
    console.error('usage: node scripts/eval/lib/fixtures.mjs --only-redesign   (database fixtures: node scripts/eval/run.mjs --fixtures)');
    process.exitCode = 2;
  } else {
    console.log('Exporting the redesign fixtures only (files on disk; no database, no paid calls)');
    exportRedesigns().then(({ run, runDir }) => {
      console.log(`  ${run.counts.exported}/${run.counts.total} exported from ${run.briefGroups.length} business(es): ${run.briefGroups.join(', ')}`);
      console.log(`  ${rel(runDir)}`);
      if (run.items.some(item => item.status !== 'exported')) process.exitCode = 1;
    }).catch(error => { console.error(error?.stack ?? error); process.exitCode = 1; });
  }
}

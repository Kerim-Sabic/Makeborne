// Set summary for a measured set (outputs/eval/measure/<setId>/summary.{json,md}).
//
// Reads the per-item records measure.mjs writes (metrics.json) and the D1–D5
// result of diversity.mjs, and answers four questions:
//   1. Set thresholds: for every W/P/K check, the share of measured items that
//      pass, against the set threshold of QUALITY_BAR (with its tier).
//   2. Items: one row per item with its key numbers and failed checks.
//   3. Worst items: score = Σ over failed metrics of tier weight (L 3, C 2,
//      F 1) × severity. Severity (0.1–1) is how far the item is from the
//      threshold, capped at 1; measure.mjs computes it per check and documents
//      the scale. A metric with several failing parts (W4 launch + claim)
//      counts once, at its heaviest part.
//   4. Failure taxonomy: failures grouped into classes, ranked by
//      frequency (items affected / items measured) × tier weight.
// A failure marked setLevel (a product capability gap identical on every item,
// such as K2 "no wrap cover") still fails its metric per item, but is reported
// once in "Set-level findings" instead of in 3 and 4. Passes that tested
// nothing (W14 on a page with 0 images) are listed under "Passes not exercised".
// Plus every instrument error and every "not measured" reason, so nothing is
// skipped silently, the machine-dependent font findings of decks and books
// ("Environment findings"), a caveat when the sites come from few distinct
// briefs (D1–D5 then measure run-to-run similarity), and the provenance of
// the harness that produced the set (code hash, Node, OS, tool versions).
//
// Item record contract (metrics.json, written by measure.mjs):
//   { itemId, kind, title, direction, status, statusReason, keyNumbers, environment?,
//     metrics: { <id>: { label, tier, status: 'pass'|'fail'|'n/a', pass, reason,
//       failureClass?, severity, parts: [{ key, label, tier, set, status, pass,
//       value, threshold, severity, reason, failureClass? }] } },
//     instrumentErrors: [{ instrument, message, timedOut? }] }
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { WEBSITE, DOCUMENTS, QUALITY_BAR_VERSION } from './thresholds.mjs';
import { EVAL_DIR, REPO, ensureDir, writeJson } from './paths.mjs';

// ---------------------------------------------------------------------------
// Provenance: which code produced a result.

// Folders under scripts/eval that hold data or installs, not harness code.
const NOT_HARNESS = new Set(['node_modules', 'briefs', 'captures', 'test-results', 'playwright-report']);

/** Harness source files: scripts/eval/**\/*.{mjs,cjs,json}, minus NOT_HARNESS folders; repo-relative, sorted. */
export function harnessFiles(dir = EVAL_DIR) {
  const files = [];
  const walk = folder => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { if (!NOT_HARNESS.has(entry.name)) walk(file); continue; }
      if (/\.(?:mjs|cjs|json)$/.test(entry.name)) files.push(file);
    }
  };
  walk(dir);
  return files.map(file => path.relative(REPO, file).split(path.sep).join('/')).sort();
}

/**
 * { commit, dirty, harness: { sha256, files, gitState } } recorded in every
 * metrics.json and summary.json. sha256 is over "path NUL sha256(content) LF"
 * for every harness file in path order (line endings as on disk), so two runs
 * with the same hash ran the same harness code even when the tree is dirty or
 * the harness is not committed yet. Git failures are recorded, never thrown.
 */
export function harnessProvenance() {
  const git = args => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  const out = { commit: null, dirty: null };
  try { out.commit = git(['rev-parse', 'HEAD']); } catch (error) { out.commitError = String(error?.message ?? error).split('\n')[0].slice(0, 200); }
  let harnessState = null;
  try {
    const status = git(['status', '--porcelain', '--untracked-files=normal']);
    out.dirty = status.length > 0;
    out.dirtyEntries = status ? status.split('\n').length : 0;
    const harness = git(['status', '--porcelain', '--untracked-files=normal', '--', path.relative(REPO, EVAL_DIR).split(path.sep).join('/')]);
    harnessState = !harness ? 'clean' : harness.split('\n').every(line => line.startsWith('??')) ? 'untracked' : 'modified';
  } catch (error) { out.statusError = String(error?.message ?? error).split('\n')[0].slice(0, 200); }
  const files = harnessFiles();
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${file}\0${createHash('sha256').update(readFileSync(path.join(REPO, file))).digest('hex')}\n`);
  out.harness = { sha256: hash.digest('hex'), files: files.length, gitState: harnessState, scope: 'scripts/eval/**/*.{mjs,cjs,json} excluding node_modules/, briefs/, competitors/captures/, test-results/, playwright-report/' };
  out.tools = toolVersions();
  return out;
}

/**
 * The runtime and instrument versions a result depends on: Node, the OS
 * release, and the installed (not the declared) versions of Playwright,
 * Lighthouse, axe-core and html-validate, read from their package.json under
 * scripts/eval/node_modules. Chromium: the version Playwright pins
 * (playwright-core browsers.json); measure.mjs replaces it with the version a
 * launched browser reports (chromiumVersion). Failures are recorded, never thrown.
 */
export function toolVersions() {
  const require = createRequire(path.join(EVAL_DIR, 'package.json'));
  const version = name => { try { return require(`${name}/package.json`).version; } catch (error) { return `unknown (${String(error?.code ?? error?.message ?? error).slice(0, 60)})`; } };
  let pinned = null;
  try {
    // browsers.json is not in playwright-core's exports map: read it next to its package.json.
    const file = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'browsers.json');
    const browsers = JSON.parse(readFileSync(file, 'utf8')).browsers ?? [];
    pinned = browsers.find(entry => entry.name === 'chromium')?.browserVersion ?? null;
  } catch { pinned = null; }
  return {
    node: process.version,
    os: { platform: process.platform, type: os.type(), release: os.release(), version: typeof os.version === 'function' ? os.version() : null, arch: process.arch },
    playwright: version('playwright'), lighthouse: version('lighthouse'), axeCore: version('axe-core'), htmlValidate: version('html-validate'),
    chromium: { version: pinned, source: pinned ? 'playwright-core browsers.json (pinned; not yet launched)' : 'unknown' },
  };
}

/** The Chromium version a launched browser reports (browser.version()); falls back to the pinned one. */
export async function chromiumVersion(chromium) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    return { version: browser.version(), source: 'browser.version() of the headless Chromium measure launches (Lighthouse uses chromium.executablePath() of the same revision)' };
  } catch (error) {
    return { ...toolVersions().chromium, launchError: String(error?.message ?? error).split('\n')[0].slice(0, 200) };
  } finally {
    await browser?.close().catch(() => {});
  }
}

export const TIER_WEIGHT = Object.freeze({ L: 3, C: 2, F: 1 });
export const METRIC_ORDER = Object.freeze([...Object.keys(WEBSITE), ...Object.keys(DOCUMENTS)]);
const KIND_ORDER = ['website', 'presentation', 'book'];

// Failure classes. A check may override its class (measure.mjs sets e.g.
// 'missing first-screen action' on W16 or 'generation failed' on W1).
const DEFAULT_CLASS = Object.freeze({
  W1: 'does not compile', W2: 'type errors', W3: 'Lighthouse accessibility', W4: 'slow load (performance / LCP)',
  W5: 'SEO / best practices', 'W6.critical': 'axe critical', 'W6.serious': 'axe serious', W7: 'layout shift',
  W8: 'slow load (performance / LCP)', W9: 'overflow', W10: 'contrast', W11: 'invalid HTML', W12: 'weight',
  W13: 'dead links/placeholders', 'W14.brokenAlt': 'broken images / missing alt', 'W14.dims': 'images without dimensions',
  W15: 'template look', W16: 'first screen incomplete', W17: 'invented contact details',
  P1: 'deck text not editable', P2: 'deck charts not native', P3: 'deck overflow', P4: 'deck fit warnings',
  P5: 'deck layout rotation', P6: 'missing speaker notes', K1: 'KDP preflight', K2: 'no KDP wrap cover', K3: 'book overflow',
});

export function failureClassOf(metricId, part, metric) {
  return part?.failureClass ?? metric?.failureClass ?? DEFAULT_CLASS[`${metricId}.${part?.key}`] ?? DEFAULT_CLASS[metricId] ?? metricId;
}

const pct = value => (value == null ? 'n/a' : `${Math.round(value * 1000) / 10}%`);
const round = (value, digits = 3) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : value);
const cell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/**
 * Failed parts of an item's metric, heaviest first (tier weight × severity).
 * Parts marked setLevel (a product capability gap the same for every item,
 * e.g. K2 "no wrap cover") are left out: they are reported once per set
 * (setFindings), not as a per-item weight in the ranking or the taxonomy.
 */
function failedParts(metricId, metric) {
  return (metric?.parts ?? []).filter(part => part.status === 'fail' && !part.setLevel)
    .map(part => ({ metricId, part, weight: TIER_WEIGHT[part.tier] ?? 1, severity: part.severity ?? 1, score: (TIER_WEIGHT[part.tier] ?? 1) * (part.severity ?? 1) }))
    .sort((p, q) => q.score - p.score);
}

// ---------------------------------------------------------------------------
// 1. Set thresholds

function thresholdRows(items) {
  const rows = [];
  for (const metricId of METRIC_ORDER) {
    const owners = items.filter(item => item.metrics?.[metricId]);
    if (!owners.length) continue;
    // Parts are keyed per metric; take the part list from the first item that has the metric.
    const keys = [...new Map(owners.flatMap(item => item.metrics[metricId].parts ?? []).map(part => [part.key, part])).values()];
    for (const template of keys) {
      const entries = owners.map(item => ({ item, part: (item.metrics[metricId].parts ?? []).find(part => part.key === template.key) })).filter(entry => entry.part);
      const measured = entries.filter(entry => entry.part.pass !== null && entry.part.pass !== undefined);
      const passed = measured.filter(entry => entry.part.pass === true);
      const rate = measured.length ? passed.length / measured.length : null;
      const naReasons = {};
      for (const entry of entries.filter(entry => entry.part.pass === null || entry.part.pass === undefined)) {
        const reason = entry.part.reason ?? entry.item.metrics[metricId].reason ?? 'not measured';
        naReasons[reason] = (naReasons[reason] ?? 0) + 1;
      }
      rows.push({
        metric: metricId, part: template.key, label: template.label, tier: template.tier, set: template.set,
        items: entries.length, measured: measured.length, passed: passed.length, failed: measured.length - passed.length, notMeasured: entries.length - measured.length,
        rate: round(rate), meets: rate === null ? null : rate >= template.set - 1e-9,
        failing: measured.filter(entry => entry.part.pass === false).map(entry => entry.item.itemId),
        naReasons,
      });
    }
  }
  return rows;
}

/**
 * Set-level rules that are not a pass rate: W10 "no site above 3 failing
 * nodes" and W15 "the cream/serif/italic/pill combination on ≤ 1 of 20 sites"
 * (a cap: never scaled down; indicative below 20 sites, like the D targets).
 */
function setRules(items) {
  const sites = items.filter(item => item.kind === 'website');
  const rules = [];
  const contrast = sites.filter(item => Number.isFinite(item.metrics?.W10?.value?.failing));
  if (contrast.length) {
    const ceiling = WEBSITE.W10.siteCeiling;
    const above = contrast.filter(item => item.metrics.W10.value.failing > ceiling);
    rules.push({ metric: 'W10', rule: `no site above ${ceiling} failing nodes`, tier: WEBSITE.W10.tier, value: above.length, target: 0, pass: above.length === 0, items: above.map(item => `${item.itemId} (${item.metrics.W10.value.failing})`) });
  }
  const tells = sites.filter(item => typeof item.metrics?.W15?.value?.creamSerifItalicPill === 'boolean');
  if (tells.length) {
    const hits = tells.filter(item => item.metrics.W15.value.creamSerifItalicPill);
    const unrequested = hits.filter(item => item.metrics.W15.value.byBrief?.creamSerifItalicPill?.requestedByBrief !== true);
    // A cap, so never scaled down (QUALITY_BAR §3); below 20 sites the verdict is indicative.
    const target = WEBSITE.W15.maxCreamSerifItalicPill;
    const indicative = tells.length < 20;
    rules.push({
      metric: 'W15', rule: `cream ground + serif display + coloured italic + pill on ≤ ${target} of 20 sites (cap not scaled${indicative ? `; indicative at ${tells.length} sites` : ''}); counts every site, requested by the brief or not`,
      tier: WEBSITE.W15.tier, value: hits.length, target, pass: hits.length <= target, indicative, unrequested: unrequested.length,
      items: hits.map(item => (unrequested.includes(item) ? item.itemId : `${item.itemId} (requested)`)),
    });
  }
  return rules;
}

/**
 * The tells against the brief: for each tell, the sites showing it and how
 * many of them the brief explicitly asked for (requestedByBrief, see web.mjs
 * STYLE_REQUEST_PATTERNS). "Unrequested" is drift; "requested" is the client
 * style winning, as prompt.ts allows. W15's per-site rule counts every tell;
 * passUnrequestedOnly shows what it would be if requested tells were not counted.
 */
function tellsVsBrief(items) {
  const sites = items.filter(item => item.kind === 'website' && Array.isArray(item.metrics?.W15?.value?.present));
  if (!sites.length) return null;
  const names = [...new Set(sites.flatMap(item => item.metrics.W15.value.present))];
  const order = ['creamSerifItalicPill', 'marqueeAndWordmark', 'equalCardRow', 'centredHeroTwoButtons', 'bannedCopy'];
  names.sort((p, q) => (order.indexOf(p) + 1 || 99) - (order.indexOf(q) + 1 || 99));
  const rows = names.map(name => {
    const withTell = sites.filter(item => item.metrics.W15.value.present.includes(name));
    const requested = withTell.filter(item => (item.metrics.W15.value.requested ?? []).includes(name));
    return {
      tell: name, judged: ['creamSerifItalicPill', 'marqueeAndWordmark'].includes(name), sites: withTell.length, measured: sites.length,
      requested: requested.length, unrequested: withTell.length - requested.length,
      items: withTell.map(item => (requested.includes(item) ? `${item.itemId} (requested: ${(item.metrics.W15.value.byBrief?.[name]?.briefMatches ?? []).join(', ')})` : item.itemId)),
    };
  });
  const max = WEBSITE.W15.maxTells;
  return {
    rows,
    perSite: {
      measured: sites.length,
      passAllTells: sites.filter(item => item.metrics.W15.value.present.length <= max).length,
      passUnrequestedOnly: sites.filter(item => (item.metrics.W15.value.unrequested ?? item.metrics.W15.value.present).length <= max).length,
    },
  };
}

/**
 * Set-level findings: failures marked setLevel by measure.mjs (a capability
 * the product lacks, identical on every item), listed once with the items
 * they fail. They still fail their metric in the per-item tables.
 */
function setFindings(items) {
  const findings = new Map();
  for (const item of items) {
    for (const [metricId, metric] of Object.entries(item.metrics ?? {})) {
      for (const part of metric.parts ?? []) {
        if (part.status !== 'fail' || !part.setLevel) continue;
        const key = `${metricId}|${part.setLevel}`;
        const entry = findings.get(key) ?? { metric: part.key === 'site' ? metricId : `${metricId}.${part.key}`, tier: part.tier, finding: part.setLevel, reason: part.reason ?? null, items: [] };
        entry.items.push(item.itemId);
        findings.set(key, entry);
      }
    }
  }
  return [...findings.values()].map(entry => ({ ...entry, affected: entry.items.length, measured: items.filter(item => item.metrics?.[entry.metric.split('.')[0]]?.pass !== null && item.metrics?.[entry.metric.split('.')[0]]?.pass !== undefined).length }));
}

/** Passes that tested nothing (exercised: false), e.g. W14 on a page with 0 images. */
function notExercised(items) {
  return items.flatMap(item => Object.entries(item.metrics ?? {}).filter(([, metric]) => metric.exercised === false && metric.status === 'pass').map(([metricId, metric]) => ({ metric: metricId, itemId: item.itemId, reason: metric.reason ?? 'not exercised' })));
}

/**
 * Machine-dependent findings of decks and books (measure.mjs
 * documentEnvironment: deck render, deck/book PDF export, PPTX fonts), one row
 * per item and finding with the fonts involved. They fail no metric.
 */
function environmentFindings(items) {
  return items.flatMap(item => (item.environment ?? []).map(entry => ({ itemId: item.itemId, kind: item.kind, flag: entry.flag, scope: entry.scope ?? null, fonts: entry.fonts ?? [], note: entry.note ?? null })));
}

/** Declared fonts that did not render (web.mjs decideFonts), per website. */
function missingFonts(items) {
  return items.filter(item => item.kind === 'website' && item.identity?.fonts?.missing?.length)
    .flatMap(item => item.identity.fonts.missing.map(entry => ({ itemId: item.itemId, role: entry.role, declared: entry.declared, rendered: entry.rendered, fontFace: entry.fontFace ?? null })));
}

// ---------------------------------------------------------------------------
// 3. Worst items, 4. taxonomy

function worstItems(items) {
  return items.map(item => {
    const failed = Object.entries(item.metrics ?? {}).map(([metricId, metric]) => failedParts(metricId, metric)[0]).filter(Boolean);
    const score = failed.reduce((sum, entry) => sum + entry.score, 0);
    return {
      itemId: item.itemId, kind: item.kind, title: item.title, score: round(score, 2),
      failed: failed.sort((p, q) => q.score - p.score).map(entry => ({ metric: entry.part.key === 'site' ? entry.metricId : `${entry.metricId}.${entry.part.key}`, tier: entry.part.tier, severity: round(entry.severity, 2), contribution: round(entry.score, 2), reason: entry.part.reason ?? null })),
    };
  }).filter(entry => entry.score > 0).sort((p, q) => q.score - p.score || p.itemId.localeCompare(q.itemId));
}

function taxonomy(items) {
  const classes = new Map();
  const touch = name => {
    if (!classes.has(name)) classes.set(name, { name, metrics: new Set(), affected: new Map(), measured: new Set(), tiers: new Set() });
    return classes.get(name);
  };
  for (const item of items) {
    for (const [metricId, metric] of Object.entries(item.metrics ?? {})) {
      for (const part of metric.parts ?? []) {
        if (part.status !== 'fail' || part.setLevel) continue;
        const entry = touch(failureClassOf(metricId, part, metric));
        entry.metrics.add(part.key === 'site' ? metricId : `${metricId}.${part.key}`);
        entry.tiers.add(part.tier);
        const previous = entry.affected.get(item.itemId);
        if (!previous || (part.severity ?? 1) > previous.severity) entry.affected.set(item.itemId, { severity: part.severity ?? 1, reason: part.reason ?? null });
      }
    }
  }
  // Denominator: items on which any metric of the class was measured.
  for (const entry of classes.values()) {
    for (const item of items) {
      for (const key of entry.metrics) {
        const [metricId, partKey] = key.split('.');
        const part = (item.metrics?.[metricId]?.parts ?? []).find(candidate => candidate.key === (partKey ?? 'site') || (!partKey && candidate.key === 'site'));
        if (part && part.pass !== null && part.pass !== undefined) entry.measured.add(item.itemId);
      }
    }
  }
  return [...classes.values()].map(entry => {
    const weight = Math.max(...[...entry.tiers].map(tier => TIER_WEIGHT[tier] ?? 1));
    const frequency = entry.measured.size ? entry.affected.size / entry.measured.size : 0;
    const severities = [...entry.affected.values()].map(value => value.severity);
    return {
      name: entry.name, metrics: [...entry.metrics].sort(), tier: [...entry.tiers].sort((p, q) => (TIER_WEIGHT[q] ?? 0) - (TIER_WEIGHT[p] ?? 0)).join('/'),
      affected: entry.affected.size, measured: entry.measured.size, frequency: round(frequency),
      severityWeight: weight, meanSeverity: round(severities.reduce((sum, value) => sum + value, 0) / Math.max(1, severities.length), 2),
      rankScore: round(frequency * weight), items: [...entry.affected.keys()],
      examples: [...entry.affected.entries()].slice(0, 3).map(([itemId, value]) => `${itemId}: ${value.reason ?? ''}`.trim()),
    };
  }).sort((p, q) => q.rankScore - p.rankScore || q.meanSeverity - p.meanSeverity || p.name.localeCompare(q.name))
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}

// ---------------------------------------------------------------------------
// Assemble

/**
 * @param {object} input
 * @param {string} input.setId
 * @param {object} input.set        { type, dir (repo-relative), runId?, tool? }
 * @param {object[]} input.items    metrics.json records
 * @param {object} [input.diversity] measureDiversity() result
 * @param {object} [input.run]      { startedAt, finishedAt, wallMs, options, missing }
 * @returns {object} summary (also what summary.json holds)
 */
export function buildSummary({ setId, set, items, diversity = null, run = {} }) {
  const sorted = [...items].sort((p, q) => KIND_ORDER.indexOf(p.kind) - KIND_ORDER.indexOf(q.kind) || String(p.itemId).localeCompare(String(q.itemId)));
  const counts = { total: sorted.length };
  for (const item of sorted) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  const statuses = {};
  for (const item of sorted) statuses[item.status] = (statuses[item.status] ?? 0) + 1;
  const instrumentErrors = sorted.flatMap(item => (item.instrumentErrors ?? []).map(error => ({ itemId: item.itemId, ...error })));
  const errorCounts = {};
  for (const error of instrumentErrors) errorCounts[error.instrument] = (errorCounts[error.instrument] ?? 0) + 1;
  return {
    schemaVersion: 1,
    setId, set, qualityBar: QUALITY_BAR_VERSION,
    startedAt: run.startedAt ?? null, finishedAt: run.finishedAt ?? null, wallMs: run.wallMs ?? null, options: run.options ?? null,
    // Which code produced the set (git commit, dirty tree, harness sha256): see harnessProvenance().
    provenance: run.provenance ?? null,
    counts, statuses,
    missingItems: run.missing ?? [],
    thresholds: thresholdRows(sorted),
    setRules: setRules(sorted),
    setFindings: setFindings(sorted),
    notExercised: notExercised(sorted),
    missingFonts: missingFonts(sorted),
    environment: environmentFindings(sorted),
    tellsVsBrief: tellsVsBrief(sorted),
    diversity: diversity ? Object.fromEntries(['D1', 'D2', 'D3', 'D4', 'D5'].map(id => [id, { label: diversity[id].label, tier: diversity[id].tier, value: diversity[id].value, target: diversity[id].target ?? null, pass: diversity[id].pass, status: diversity[id].status ?? null, checks: diversity[id].checks ?? null, model: diversity[id].model ?? null, reason: diversity[id].reason ?? null }])) : null,
    diversityNote: diversity ? diversity.note : null,
    diversityIndicative: diversity ? Boolean(diversity.indicative) : null,
    diversityRepeats: diversity?.repeats ?? null,
    // How many distinct briefs the sites come from; caveat when D1–D5 measure run-to-run similarity (diversity.mjs briefProvenance).
    diversityBriefs: diversity?.briefs ?? null,
    diversityCaveat: diversity?.caveat ?? null,
    items: sorted.map(item => ({
      itemId: item.itemId, kind: item.kind, title: item.title, direction: item.direction ?? null, status: item.status, statusReason: item.statusReason ?? null,
      keyNumbers: item.keyNumbers ?? {},
      fails: Object.entries(item.metrics ?? {}).flatMap(([metricId, metric]) => (metric.parts ?? []).filter(part => part.status === 'fail').map(part => (part.key === 'site' ? metricId : `${metricId}.${part.key}`))),
      notMeasured: Object.entries(item.metrics ?? {}).filter(([, metric]) => metric.status === 'n/a').map(([metricId]) => metricId),
    })),
    worstItems: worstItems(sorted),
    taxonomy: taxonomy(sorted),
    instrumentErrors, instrumentErrorCounts: errorCounts,
  };
}

// ---------------------------------------------------------------------------
// Markdown

const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(row => `| ${row.map(cell).join(' | ')} |`)].join('\n');
const yesNo = value => (value === true ? 'yes' : value === false ? '**no**' : 'n/a');
const fmt = value => (value === null || value === undefined ? '–' : typeof value === 'number' ? String(round(value, 3)) : String(value));

function diversityValue(id, value) {
  if (!value) return 'n/a';
  switch (id) {
    case 'D1': return `${value.clusters} clusters over ${value.sites} sites; largest ${value.largestCluster}`;
    case 'D2': return `warm-light ${pct(value.warmLightShare)}; ${value.classesUsed} classes (${Object.entries(value.distribution).map(([key, n]) => `${key} ${n}`).join(', ')})`;
    case 'D3': return `${value.pairings} pairings; largest ${value.largestPairing}`;
    case 'D4': return `${value.namedAppearing} named of 6 (${Object.entries(value.distribution).map(([key, n]) => `${key} ${n}`).join(', ')}); largest ${value.largest ? `${value.largest.name} ${pct(value.largest.share)}` : '–'}; centred ${pct(value.centredShare)}`;
    case 'D5': return `${fmt(value.index)} (D1 ${fmt(value.entropies.D1)}, D3 ${fmt(value.entropies.D3)}, D4 ${fmt(value.entropies.D4)}; ground classes ${fmt(value.groundClassEntropy)}, not in the index)`;
    default: return JSON.stringify(value);
  }
}

function diversityTarget(id, target) {
  if (!target) return '–';
  switch (id) {
    case 'D1': return `≥ ${target.minClusters} clusters in 20; ≤ ${target.maxPerCluster} per cluster`;
    case 'D2': return `warm-light ≤ ${pct(target.maxWarmLightShare)}; ≥ ${target.minClasses} classes in 20`;
    case 'D3': return `≥ ${target.minPairings} pairings in 20; ≤ ${target.maxPerPairing} per pairing`;
    case 'D4': return `all ${target.namedAppearing} named in 20; none > ${pct(target.maxShare)}; centred ≤ ${pct(target.maxCentredShare)}`;
    case 'D5': return `≥ ${target.min}`;
    default: return JSON.stringify(target);
  }
}

/** The count a generator that just meets the 20-site target would show at this n (diversity.mjs model). */
function diversityExpected(entry) {
  if (!entry.model) return '–';
  return `${fmt(entry.model.expectedDistinct)}${entry.model.pool ? ` (M ${fmt(entry.model.pool)})` : entry.model.note ? ` (${entry.model.note})` : ''}`;
}

/** Caps and shares checked as written, even when the D metric is indicative. */
function diversityChecks(entry) {
  return (entry.checks ?? []).filter(check => check.within !== null).map(check => `${check.check}: ${fmt(check.value)} ${check.within ? 'within' : '**misses**'}`).join('; ') || '–';
}

const diversityStatus = entry => (entry.status === 'indicative' ? 'indicative' : yesNo(entry.pass));

const WEBSITE_COLUMNS = [
  ['LH perf/a11y', k => (k.lighthouse ? `${fmt(k.lighthouse.performance)}/${fmt(k.lighthouse.accessibility)}` : '–')],
  ['LCP s', k => (Number.isFinite(k.lighthouse?.lcpMs) ? (k.lighthouse.lcpMs / 1000).toFixed(1) : '–')],
  ['axe crit/ser', k => (k.axe ? `${k.axe.critical}/${k.axe.serious}` : '–')],
  ['CLS max/median (loads ≥ 0.1)', k => (k.cls && typeof k.cls === 'object' ? `${fmt(k.cls.max)}/${fmt(k.cls.median)} (${pct(k.cls.shareAtOrAbove)} of ${k.cls.loads})` : fmt(k.cls))],
  ['overflow px user/script/els', k => (k.overflow ? `${k.overflow.px}/${k.overflow.scriptPx ?? k.overflow.px}/${k.overflow.elements}` : '–')],
  ['contrast fail (indet.; from pixels)', k => (k.contrast ? `${k.contrast.failing} (${k.contrast.indeterminate}; ${k.contrast.pixelResolved ?? 0})` : '–')],
  ['images', k => (k.images === 0 ? '0 (W14 not exercised)' : fmt(k.images))],
  ['ground', k => fmt(k.groundClass)],
  ['HTML err', k => fmt(k.htmlErrors)],
  ['KiB total/JS', k => (k.weight ? `${k.weight.totalKiB}/${k.weight.jsKiB}` : '–')],
  ['dead links', k => fmt(k.deadLinks)],
  ['tells (* requested)', k => (k.tells ? `${k.tells.count}${k.tells.present?.length ? ` (${k.tells.present.map(name => (k.tells.requested?.includes(name) ? `${name}*` : name)).join(', ')})` : ''}` : '–')],
  ['archetype', k => fmt(k.archetype)],
];
const DECK_COLUMNS = [
  ['slides', k => fmt(k.slides)], ['P1 chars', k => fmt(k.charRate)], ['P2 native', k => fmt(k.nativeChartRate)], ['P3 slides', k => fmt(k.overflowSlides)],
  ["P4 current fit warnings (today's composer)", k => fmt(k.fitWarnings)], ['P5 runs', k => fmt(k.rotationViolations)], ['P6 notes (PPTX)', k => (k.pptx === false ? 'n/a (no PPTX)' : fmt(k.notesRate))],
];
/** "3: a, b, c" for a K1 error list (codes from measure.mjs bookK1), "0" when empty. */
const codes = (n, list) => (n === null || n === undefined ? '–' : list?.length ? `${n}: ${list.join(', ')}` : String(n));
const BOOK_COLUMNS = [
  ['pages', k => fmt(k.pages)], ['KDP status', k => `${fmt(k.kdpStatus)}${k.belowMinimum ? `: ${k.belowMinimum}` : k.rejected ? ': below 24-page KDP minimum' : ''}`],
  ['K1 validator errors', k => codes(k.validatorErrors, k.validatorErrorCodes)], ['K1 harness errors', k => codes(k.harnessErrors, k.harnessErrorCodes)], ['unknowns', k => fmt(k.unknowns)],
  ['at 24 pages err/unk/warn (not gated)', k => (k.atMinimumPageCount ? `${k.atMinimumPageCount.errors}/${k.atMinimumPageCount.unknowns}/${k.atMinimumPageCount.warnings}` : '–')],
  ['wrap cover', k => yesNo(k.wrapCover)], ['K3 overflow', k => fmt(k.overflow)],
];

/** summary.md: the tables a reader needs, in the order they need them. */
export function summaryMarkdown(summary) {
  const out = [];
  const minutes = summary.wallMs ? `${(summary.wallMs / 60000).toFixed(1)} min` : 'n/a';
  out.push(`# Measure summary: ${summary.setId}`);
  out.push('');
  out.push(`Set \`${summary.set?.dir ?? '?'}\` (${summary.set?.type ?? '?'}), measured ${summary.finishedAt ?? '?'} in ${minutes}. Quality bar version ${summary.qualityBar}.`);
  out.push(`Items: ${Object.entries(summary.counts).map(([key, n]) => `${key} ${n}`).join(', ')}. Status: ${Object.entries(summary.statuses).map(([key, n]) => `${key} ${n}`).join(', ')}.`);
  if (summary.options) out.push(`Options: widths ${summary.options.widths?.join(', ')}; Lighthouse runs ${summary.options.lighthouseRuns}${summary.options.lighthouseRuns < 3 ? ' (exploratory: a gate decision needs 3)' : ''}; skipped ${summary.options.skip?.length ? summary.options.skip.join(', ') : 'nothing'}; concurrency ${summary.options.concurrency}.`);
  if (summary.missingItems?.length) out.push(`Listed in run.json but missing on disk: ${summary.missingItems.join(', ')}.`);
  const p = summary.provenance;
  if (p) out.push(`Provenance: commit ${p.commit ?? `unknown (${p.commitError ?? 'git failed'})`}${p.dirty ? `, dirty tree (${p.dirtyEntries} entries)` : p.dirty === false ? ', clean tree' : ''}; harness sha256 ${p.harness?.sha256 ?? '?'} over ${p.harness?.files ?? '?'} files (harness ${p.harness?.gitState ?? 'git state unknown'}).`);
  const t = p?.tools;
  if (t) out.push(`Tools: Node ${t.node}; ${t.os?.version ?? t.os?.type ?? '?'} (${t.os?.platform} ${t.os?.release}, ${t.os?.arch}); Chromium ${t.chromium?.version ?? '?'}${t.chromium?.launchError ? ' (pinned, launch failed)' : ''}; Playwright ${t.playwright}; Lighthouse ${t.lighthouse}; axe-core ${t.axeCore}; html-validate ${t.htmlValidate}.`);
  out.push('');

  out.push('## Set thresholds');
  out.push('');
  out.push('Pass rate = items passing / items measured. "n/a" items could not be measured (reasons below) and are not in the rate.');
  out.push('');
  out.push(table(['Metric', 'Check', 'Tier', 'Measured', 'Pass', 'Rate', 'Set threshold', 'Meets', 'n/a', 'Failing items'], summary.thresholds.map(row => [
    row.metric, row.label, row.tier, row.measured, row.passed, pct(row.rate), `≥ ${pct(row.set)}`, yesNo(row.meets), row.notMeasured, row.failing.join(', '),
  ])));
  if (summary.setRules.length) {
    out.push('');
    out.push(table(['Metric', 'Set rule', 'Tier', 'Value', 'Pass', 'Items'], summary.setRules.map(rule => [
      rule.metric, rule.rule, rule.tier, Number.isFinite(rule.unrequested) ? `${rule.value} (${rule.unrequested} unrequested)` : rule.value, rule.indicative ? `indicative (${rule.pass ? 'within' : '**misses**'})` : yesNo(rule.pass), rule.items.join(', '),
    ])));
  }
  out.push('');

  if (summary.setFindings?.length) {
    out.push('## Set-level findings');
    out.push('');
    out.push('Product capability gaps, identical on every item: each still fails its metric per item in the tables above, but is reported once here and kept out of the worst-items ranking and the taxonomy.');
    out.push('');
    out.push(table(['Metric', 'Tier', 'Finding', 'Items affected', 'Why'], summary.setFindings.map(entry => [entry.metric, entry.tier, entry.finding, `${entry.affected} of ${entry.measured}: ${entry.items.join(', ')}`, entry.reason])));
    out.push('');
  }
  if (summary.notExercised?.length) {
    out.push('## Passes not exercised');
    out.push('');
    out.push('These checks pass because there was nothing to test; read them as untested, not as good.');
    out.push('');
    out.push(table(['Metric', 'Item', 'Reason'], summary.notExercised.map(entry => [entry.metric, entry.itemId, entry.reason])));
    out.push('');
  }
  if (summary.missingFonts?.length) {
    out.push('## Missing fonts');
    out.push('');
    out.push('A declared family that did not render on the measuring machine (CDP platform fonts); D3 pairs the rendered families. "no @font-face" = the site relies on a locally installed font.');
    out.push('');
    out.push(table(['Item', 'Role', 'Declared', 'Rendered', '@font-face'], summary.missingFonts.map(entry => [entry.itemId, entry.role, entry.declared, entry.rendered, entry.fontFace ?? 'none'])));
    out.push('');
  }
  if (summary.environment?.length) {
    out.push('## Environment findings');
    out.push('');
    out.push('Decks and books whose render or export depended on the fonts installed on the measuring machine (the theme stacks list system faces before the embedded ones; the production exporter has only the embedded faces) or whose PPTX embeds no font. No metric fails on these; read the affected numbers as this machine\'s.');
    out.push('');
    out.push(table(['Item', 'Kind', 'Finding', 'Where', 'Fonts'], summary.environment.map(entry => [entry.itemId, entry.kind, entry.flag, entry.scope, entry.fonts.join(', ') || '–'])));
    out.push('');
  }

  const tells = summary.tellsVsBrief;
  if (tells?.rows.length) {
    out.push('## Template tells vs the brief');
    out.push('');
    out.push('A tell is "requested" when the brief explicitly asks for a warm/cream/ivory/beige ground or a serif/editorial look (marquee/wordmark also: the device itself); keyword list in web.mjs STYLE_REQUEST_PATTERNS. Unrequested = drift. Only the cream/serif/italic/pill and marquee/wordmark tells are judged against the brief; the others always count as unrequested.');
    out.push('');
    out.push(table(['Tell', 'Sites', 'Of which unrequested', 'Requested by brief', 'Items'], tells.rows.map(row => [
      row.tell, `${row.sites} of ${row.measured}`, row.judged ? row.unrequested : `${row.unrequested} (not judged)`, row.judged ? row.requested : '–', row.items.join(', '),
    ])));
    out.push('');
    out.push(`W15 per site (≤ ${WEBSITE.W15.maxTells} tell): ${tells.perSite.passAllTells} of ${tells.perSite.measured} pass counting every tell (the bar); ${tells.perSite.passUnrequestedOnly} of ${tells.perSite.measured} would pass counting unrequested tells only (informational).`);
    out.push('');
  }

  if (summary.diversity) {
    out.push('## Diversity (D1–D5)');
    out.push('');
    if (summary.diversityCaveat) {
      out.push(`**Caveat:** ${summary.diversityCaveat}`);
      out.push('');
    } else if (summary.diversityBriefs) {
      out.push(`Briefs: ${summary.diversityBriefs.sites} site(s) from ${summary.diversityBriefs.distinct} distinct brief(s)${summary.diversityBriefs.unknown ? `, ${summary.diversityBriefs.unknown} without a brief` : ''}.`);
      out.push('');
    }
    out.push(summary.diversityNote ?? '');
    out.push('');
    out.push(table(['D', 'Metric', 'Tier', 'Value', 'Target', 'Expected at this n (model)', 'Caps and shares as written', 'Pass'], Object.entries(summary.diversity).map(([id, entry]) => [
      id, entry.label, entry.tier, entry.reason ?? diversityValue(id, entry.value), diversityTarget(id, entry.target), diversityExpected(entry), diversityChecks(entry), diversityStatus(entry),
    ])));
    const r = summary.diversityRepeats;
    if (r) {
      out.push('');
      out.push(`Repeats: ${pct(r.palette.share)} of sites share their palette cluster with another site (expected ${pct(r.palette.expected)} from a generator just meeting the target); ${pct(r.pairing.share)} share their type pairing (expected ${pct(r.pairing.expected)}); ${pct(r.paletteAndPairing.share)} share both with the same site${r.paletteAndPairing.sites.length ? ` (${r.paletteAndPairing.sites.join(', ')})` : ''}.`);
    }
    out.push('');
  }

  out.push('## Items');
  out.push('');
  for (const [kind, columns, heading] of [['website', WEBSITE_COLUMNS, 'Websites'], ['presentation', DECK_COLUMNS, 'Decks'], ['book', BOOK_COLUMNS, 'Books']]) {
    const rows = summary.items.filter(item => item.kind === kind);
    if (!rows.length) continue;
    out.push(`### ${heading}`);
    out.push('');
    out.push(table(['Item', 'Title', 'Direction', ...columns.map(([name]) => name), 'Fails', 'n/a'], rows.map(item => [
      item.itemId, item.title, item.direction, ...columns.map(([, read]) => read(item.keyNumbers ?? {})), item.fails.join(' ') || 'none', item.notMeasured.join(' '),
    ])));
    out.push('');
  }

  out.push('## Worst items');
  out.push('');
  out.push('Score = Σ over failed metrics of tier weight (L 3, C 2, F 1) × severity (0.1–1, distance from the threshold, capped).');
  out.push('');
  out.push(summary.worstItems.length ? table(['#', 'Item', 'Kind', 'Score', 'Failed (contribution)'], summary.worstItems.map((entry, index) => [
    index + 1, entry.itemId, entry.kind, entry.score, entry.failed.map(fail => `${fail.metric} ${fail.tier}×${fail.severity}=${fail.contribution}`).join('; '),
  ])) : 'No failures.');
  out.push('');

  out.push('## Failure taxonomy');
  out.push('');
  out.push('Frequency = items affected / items on which the class was measured. Rank by frequency × tier weight (ties: mean severity).');
  out.push('');
  out.push(summary.taxonomy.length ? table(['Rank', 'Class', 'Metrics', 'Tier', 'Affected / measured', 'Frequency', 'Weight', 'Freq × weight', 'Mean severity', 'Items'], summary.taxonomy.map(entry => [
    entry.rank, entry.name, entry.metrics.join(' '), entry.tier, `${entry.affected} / ${entry.measured}`, pct(entry.frequency), entry.severityWeight, entry.rankScore, entry.meanSeverity, entry.items.join(', '),
  ])) : 'No failures.');
  out.push('');

  out.push('## Instrument errors');
  out.push('');
  out.push(summary.instrumentErrors.length ? table(['Item', 'Instrument', 'Timed out', 'Message'], summary.instrumentErrors.map(error => [error.itemId, error.instrument, error.timedOut ? 'yes' : '', error.message?.slice(0, 220)])) : 'None.');
  out.push('');

  const naRows = summary.thresholds.filter(row => row.notMeasured).flatMap(row => Object.entries(row.naReasons).map(([reason, n]) => [row.metric, row.label, n, reason]));
  out.push('## Not measured');
  out.push('');
  out.push(naRows.length ? table(['Metric', 'Check', 'Items', 'Reason'], naRows) : 'Every check was measured on every item.');
  out.push('');
  return out.join('\n');
}

/** Write summary.json and summary.md into outDir; returns both paths. */
export function writeSummary(outDir, summary) {
  ensureDir(outDir);
  const json = path.join(outDir, 'summary.json');
  const md = path.join(outDir, 'summary.md');
  writeJson(json, summary);
  writeFileSync(md, summaryMarkdown(summary));
  return { json, md };
}

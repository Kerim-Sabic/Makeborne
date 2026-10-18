// Set-level diversity of the websites in one measured set (QUALITY_BAR §3, D1–D5).
//
// Input: each website's metrics.identity as written by measurePage() (web.mjs):
// ground, ink and accent as #rrggbb, groundClass, fonts {display, text} and
// the first-screen archetype. Output: one object per D metric with the value,
// the target scaled to the set size, pass/fail and the evidence behind it.
//
// Set size. The targets in QUALITY_BAR are written for a round of 20 sites.
// From 20 sites up, every target is used as written and D1–D5 pass or fail.
// Below 20 (SMALL_SET) the D results are INDICATIVE: pass is null and status
// 'indicative'. Count minimums (14 palette clusters, 12 pairings, 4 ground
// classes, the 6 named archetypes) cannot be judged on fewer sites, so each
// is reported with the count EXPECTED from a generator that would just meet
// the 20-site target (the model below). The per-category caps (≤ 3 sites per
// palette cluster, ≤ 3 per pairing) are NOT scaled down (an earlier version
// scaled 3 to 1.65 for 11 sites, i.e. "no repeat at all", which is stricter
// than the bar); they and the SHARE targets (warm-light ≤ 35%, one archetype
// ≤ 40%, centred stack ≤ 10%) are checked as written and shown beside the
// indicative status. The share of sites that repeat another site's palette,
// pairing, or both, is reported with its expected value under the same model.
//
// Model ("just meets the target"): each site draws its label independently
// and uniformly from M equally likely options, M fitted so that 20 draws give
// the 20-site target on average: M(1 − (1 − 1/M)^20) = T (stats.mjs
// fitUniformPool). Then n sites are expected to show M(1 − (1 − 1/M)^n)
// distinct labels, and a site repeats another one with probability
// 1 − (1 − 1/M)^(n−1). For T = 14 palettes M ≈ 25.3 (11 sites: ≈ 9.1 expected),
// for T = 12 pairings M ≈ 17.2 (11 sites: ≈ 8.3).
//
// D5 normalises each entropy by ln(min(n, K)), K = the number of labels that
// can occur: palettes and pairings are open sets (K = n); archetypes K = 8 (the
// six named, centred-stack and other: every label the classifier emits); the
// ground classes (K = 5) are reported as an extra entropy, not in the index.
// So the index no longer falls just because a set has more sites than categories.
//
// Briefs (briefProvenance): D1–D5 are meant to compare sites made for
// DIFFERENT briefs. The result says how many distinct briefs the sites come
// from (briefGroup, briefId/relatedBriefId, or near-identical brief text), and
// when that is at most half the sites (the redesign set: 8 runs of 2
// businesses) it carries a caveat: D1–D5 then measure run-to-run similarity.
//
// CLI: node scripts/eval/lib/diversity.mjs --selftest  (CIEDE2000 reference data, clustering, D5, small-set rules, brief provenance)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIVERSITY } from './thresholds.mjs';
import { normalisedEntropy, expectedDistinct, fitUniformPool } from './stats.mjs';

export const SMALL_SET = 20;
// Every label the archetype classifier (web.mjs ARCHETYPE_ORDER) can emit, plus 'other'.
export const ARCHETYPE_LABELS = Object.freeze(['poster', 'photographic', 'index', 'product-stage', 'editorial-split', 'type-as-image', 'centred-stack', 'other']);
export const GROUND_CLASSES = Object.freeze(['dark', 'saturated', 'warm-light', 'cool-light', 'mid-tone']);

// ---------------------------------------------------------------------------
// Colour: sRGB hex → CIE L*a*b* (D65, 2°) → CIEDE2000.

function hexToRgb(hex) {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex ?? '');
  return match ? { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) } : null;
}

/** CIE L*a*b* (D65 white, sRGB primaries); the same conversion web.mjs uses for identity. */
export function hexToLab(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const linear = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [linear(rgb.r), linear(rgb.g), linear(rgb.b)];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

const RAD = Math.PI / 180;
const POW25_7 = 25 ** 7;

/**
 * CIEDE2000 colour difference ΔE00 with kL = kC = kH = 1.
 *
 * Implemented from G. Sharma, W. Wu and E. N. Dalal, "The CIEDE2000
 * color-difference formula: Implementation notes, supplementary test data,
 * and mathematical observations", Color Research & Application 30(1), 21–30
 * (2005), equations (1)–(22). The hue-angle conventions follow the paper:
 * h' = 0 when a' = b = 0; Δh' = 0 and h̄' = h1' + h2' when C1'·C2' = 0.
 * The paper's test pairs are checked by --selftest.
 */
export function ciede2000(lab1, lab2) {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;
  // (2)–(4): a' rescaled by G so neutral colours are not over-weighted.
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + POW25_7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  // (6)–(7)
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b, ap) => (b === 0 && ap === 0 ? 0 : (Math.atan2(b, ap) / RAD + 360) % 360);
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  // (8)–(11)
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);
  // (12)–(14)
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  // (15)–(22)
  const T = 1 - 0.17 * Math.cos((hbarp - 30) * RAD) + 0.24 * Math.cos(2 * hbarp * RAD)
    + 0.32 * Math.cos((3 * hbarp + 6) * RAD) - 0.20 * Math.cos((4 * hbarp - 63) * RAD);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + POW25_7));
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * RAD) * RC;
  const l = dLp / SL;
  const c = dCp / SC;
  const h = dHp / SH;
  return Math.sqrt(l * l + c * c + h * h + RT * c * h);
}

/** Sharma, Wu & Dalal (2005) Table 1: a sample of the 34 reference pairs. */
export const CIEDE2000_TEST_PAIRS = Object.freeze([
  [{ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 }, 2.0425],
  [{ L: 50, a: 3.1571, b: -77.2803 }, { L: 50, a: 0, b: -82.7485 }, 2.8615],
  [{ L: 50, a: 0, b: 0 }, { L: 50, a: -1, b: 2 }, 2.3669],
  [{ L: 50, a: -1, b: 2 }, { L: 50, a: 0, b: 0 }, 2.3669],
  [{ L: 50, a: 2.49, b: -0.001 }, { L: 50, a: -2.49, b: 0.0009 }, 7.1792],
  [{ L: 50, a: 2.5, b: 0 }, { L: 73, a: 25, b: -18 }, 27.1492],
  [{ L: 50, a: 2.5, b: 0 }, { L: 61, a: -5, b: 29 }, 22.8977],
  [{ L: 50, a: 2.5, b: 0 }, { L: 56, a: -27, b: -3 }, 31.903],
  [{ L: 50, a: 2.5, b: 0 }, { L: 58, a: 24, b: 15 }, 19.4535],
  [{ L: 60.2574, a: -34.0099, b: 36.2677 }, { L: 60.4626, a: -34.1751, b: 39.4387 }, 1.2644],
  [{ L: 22.7233, a: 20.0904, b: -46.694 }, { L: 23.0331, a: 14.973, b: -42.5619 }, 2.0373],
  [{ L: 2.0776, a: 0.0795, b: -1.135 }, { L: 0.9033, a: -0.0636, b: -0.5514 }, 0.9082],
]);

// ---------------------------------------------------------------------------
// D1 palettes

export const PALETTE_ROLES = Object.freeze(['ground', 'ink', 'accent']);

/**
 * Ink compared by lightness only: ΔE00 between the two inks as neutral greys
 * (a* = b* = 0). Body text is near-black (or near-white) on almost every site;
 * the faint warm or cool cast of #131417 vs #2b1d18 is not what makes two
 * palettes look different, while a grey #6a5145 body against #111 is.
 */
export function inkDistance(a, b) {
  return ciede2000({ L: a.L, a: 0, b: 0 }, { L: b.L, a: 0, b: 0 });
}

/**
 * Per-role distance between two palettes and the largest of them (the linkage
 * distance: two sites share a palette only when EVERY role is within ΔE):
 * ΔE00 for ground and accent, inkDistance() (lightness only) for the ink.
 * A missing accent on both sides counts as the same role (0); on one side
 * only, as different (Infinity).
 */
export function paletteDistance(p, q) {
  const roles = {};
  for (const role of PALETTE_ROLES) {
    const a = p.lab[role], b = q.lab[role];
    roles[role] = !a && !b ? 0 : !a || !b ? Infinity : role === 'ink' ? inkDistance(a, b) : ciede2000(a, b);
  }
  return { ...roles, max: Math.max(...Object.values(roles)) };
}

/**
 * Complete-linkage agglomerative clustering on the max-role ΔE00 distance:
 * start with one cluster per site and repeatedly merge the two clusters whose
 * FARTHEST members are closest, while that distance is ≤ deltaE. Every pair of
 * sites inside a final cluster is therefore within ΔE in all three roles
 * (QUALITY_BAR's "share a cluster" definition holds pairwise, so chaining
 * through intermediates, as single linkage or a greedy pass would allow,
 * cannot create a cluster). Ties merge the lowest site indexes first, so the
 * result is deterministic for a given site order.
 */
export function clusterPalettes(palettes, { deltaE = DIVERSITY.D1.deltaE } = {}) {
  const n = palettes.length;
  const distance = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) distance[i][j] = distance[j][i] = paletteDistance(palettes[i], palettes[j]).max;
  let clusters = palettes.map((_, index) => [index]);
  const linkage = (x, y) => Math.max(...x.flatMap(i => y.map(j => distance[i][j])));
  for (;;) {
    let best = null;
    for (let x = 0; x < clusters.length; x++) {
      for (let y = x + 1; y < clusters.length; y++) {
        const d = linkage(clusters[x], clusters[y]);
        if (d <= deltaE && (!best || d < best.d)) best = { x, y, d };
      }
    }
    if (!best) break;
    clusters[best.x] = [...clusters[best.x], ...clusters[best.y]].sort((p, q) => p - q);
    clusters = clusters.filter((_, index) => index !== best.y);
  }
  clusters.sort((p, q) => q.length - p.length || p[0] - q[0]);
  const round = value => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
  // Nearest other site per site, so a reader can see how close the call was.
  const nearest = palettes.map((palette, i) => {
    let best = null;
    for (let j = 0; j < n; j++) if (j !== i && (!best || distance[i][j] < best.d)) best = { j, d: distance[i][j] };
    return best ? { id: palettes[best.j].id, maxDeltaE: round(best.d), roles: Object.fromEntries(Object.entries(paletteDistance(palette, palettes[best.j])).map(([k, v]) => [k, round(v)])) } : null;
  });
  return {
    method: `complete linkage on max(ΔE00 ground, ΔE00 accent, ink lightness ΔE00), merge while ≤ ${deltaE}`,
    deltaE,
    clusters: clusters.map((members, index) => ({
      cluster: index + 1,
      size: members.length,
      members: members.map(i => palettes[i].id),
      palettes: members.map(i => ({ id: palettes[i].id, ...palettes[i].hex })),
      maxInternalDeltaE: members.length > 1 ? round(linkage(members, members)) : 0,
    })),
    labelOf: Object.fromEntries(clusters.flatMap((members, index) => members.map(i => [palettes[i].id, `palette-${index + 1}`]))),
    nearest: Object.fromEntries(palettes.map((palette, i) => [palette.id, nearest[i]])),
  };
}

// ---------------------------------------------------------------------------
// D1–D5

const countBy = values => {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0])));
};
const round3 = value => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value);
const face = value => (value ? String(value).replace(/["']/g, '').trim().toLowerCase() : '(none)');

/**
 * Pull the D-inputs out of measured items. `items` are metrics.json records (or
 * any {id, title, identity}); items without a usable identity are listed in
 * `excluded` with the reason, never silently dropped.
 */
export function diversityInputs(items) {
  const sites = [], excluded = [];
  for (const item of items) {
    const identity = item.identity;
    const id = item.itemId ?? item.id;
    if (!identity || identity.error) { excluded.push({ id, reason: identity?.error ?? item.identityReason ?? 'no identity measured' }); continue; }
    const hex = { ground: identity.ground ?? null, ink: identity.ink ?? null, accent: identity.accent ?? null };
    const lab = Object.fromEntries(PALETTE_ROLES.map(role => [role, hex[role] ? hexToLab(hex[role]) : null]));
    sites.push({
      id, title: item.title ?? null, hex, lab,
      groundClass: identity.groundClass ?? null,
      pairing: `${face(identity.fonts?.display)} / ${face(identity.fonts?.text)}`,
      archetype: identity.archetype ?? 'other',
      paletteComplete: Boolean(hex.ground && hex.ink),
      brief: { group: item.item?.briefGroup ?? item.briefGroup ?? null, ids: [item.briefId, item.relatedBriefId, item.item?.briefId, item.item?.relatedBriefId].filter(Boolean), text: textOf(item.brief ?? item.item?.brief) },
    });
  }
  return { sites, excluded };
}

// ---------------------------------------------------------------------------
// Brief provenance: how many distinct briefs the sites come from

/** Two brief texts are one brief when their word sets overlap at least this much (Jaccard): re-runs of one brief differ by a few edits (≥ 0.95 on the redesign set), different businesses share ≤ 0.4. */
export const SAME_BRIEF_JACCARD = 0.8;

const textOf = value => (value == null ? '' : typeof value === 'string' ? value : Array.isArray(value) ? value.map(textOf).join('\n') : typeof value === 'object' ? Object.values(value).map(textOf).join('\n') : String(value));
const wordSet = text => new Set(text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
const jaccard = (a, b) => {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return a.size + b.size ? shared / (a.size + b.size - shared) : 0;
};

/**
 * Group sites by brief: the same explicit group (item.json briefGroup, e.g. the
 * business of a redesign run), the same golden brief id (briefId or
 * relatedBriefId), or brief texts with word-set Jaccard ≥ SAME_BRIEF_JACCARD
 * (union-find, so the relation is transitive). A site with none of these is
 * "unknown" and not counted as a distinct brief. D1–D5 are meant to measure
 * how different the sites for DIFFERENT briefs look; when the sites come from
 * at most half as many briefs, they mostly measure how alike repeated runs on
 * the same brief are, and `caveat` says so.
 */
export function briefProvenance(sites) {
  const parent = sites.map((_, index) => index);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (i, j) => { parent[find(i)] = find(j); };
  const words = sites.map(site => (site.brief?.text?.trim() ? wordSet(site.brief.text) : null));
  const known = sites.map((site, i) => Boolean(site.brief?.group || site.brief?.ids?.length || words[i]?.size));
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      const a = sites[i].brief ?? {}, b = sites[j].brief ?? {};
      if ((a.group && a.group === b.group) || (a.ids ?? []).some(id => (b.ids ?? []).includes(id)) || (words[i]?.size && words[j]?.size && jaccard(words[i], words[j]) >= SAME_BRIEF_JACCARD)) join(i, j);
    }
  }
  const groups = new Map();
  sites.forEach((site, i) => {
    if (!known[i]) return;
    const root = find(i);
    const entry = groups.get(root) ?? { label: null, title: null, sites: [] };
    entry.label ??= site.brief.group ?? site.brief.ids[0] ?? null;
    entry.title ??= site.title ?? null;
    entry.sites.push(site.id);
    groups.set(root, entry);
  });
  const list = [...groups.values()].map((entry, index) => ({ brief: entry.label ?? (entry.title ? `${entry.title} (same brief text)` : `brief ${index + 1} (same brief text)`), sites: entry.sites })).sort((p, q) => q.sites.length - p.sites.length || p.brief.localeCompare(q.brief));
  const unknown = sites.filter((_, i) => !known[i]).map(site => site.id);
  const distinct = list.length;
  const n = sites.length;
  const repeated = n > 1 && distinct > 0 && distinct * 2 <= n - unknown.length;
  const caveat = repeated
    ? `the ${n} sites come from ${distinct} distinct brief${distinct === 1 ? '' : 's'} (${list.map(entry => `${entry.brief}: ${entry.sites.length}`).join('; ')}${unknown.length ? `; ${unknown.length} without a brief` : ''})`
    : null;
  return {
    sites: n, distinct, unknown: unknown.length, unknownSites: unknown, groups: list, repeatedBriefs: distinct < n - unknown.length,
    method: `same item.json briefGroup, same briefId/relatedBriefId, or brief-text word-set Jaccard ≥ ${SAME_BRIEF_JACCARD} (transitive)`,
    caveat,
  };
}

/**
 * The "just meets the 20-site target" model for one count target T (see the
 * header): pool M, the distinct count expected at n and the probability that a
 * site repeats another site's label at n.
 */
export function targetModel(target, n, perSet = SMALL_SET) {
  const pool = fitUniformPool(target, perSet);
  if (!pool) return null;
  return { target, perSet, pool: round3(pool), expectedDistinct: round3(expectedDistinct(pool, n)), expectedRepeatShare: n > 1 ? round3(1 - (1 - 1 / pool) ** (n - 1)) : 0 };
}

/**
 * D1–D5 for the website items of a set.
 * @param {Array<{itemId?: string, id?: string, title?: string, identity: object}>} items
 * @param {{thresholds?: typeof DIVERSITY, perSet?: number}} [options] perSet: the size the targets are written for (20)
 * @returns {{n, perSet, indicative, note, sites, excluded, repeats, D1, D2, D3, D4, D5}}
 */
export function measureDiversity(items, { thresholds = DIVERSITY, perSet = SMALL_SET } = {}) {
  const { sites, excluded } = diversityInputs(items);
  const n = sites.length;
  const indicative = n < perSet;
  const note = indicative
    ? `Indicative (n = ${n} < ${perSet}): D1–D5 are reported, not passed or failed. Count minimums are written for ${perSet} sites; each comes with the count expected at n = ${n} from a generator that would just meet the ${perSet}-site target (uniform draws from M options, M fitted so ${perSet} draws give the target on average). Caps (≤ 3 per palette cluster or pairing) and share targets are checked as written, not scaled.`
    : `n = ${n} ≥ ${perSet}: every target as written.`;
  const status = pass => (indicative ? 'indicative' : pass === null ? 'n/a' : pass ? 'pass' : 'fail');
  // Small sets: pass is null (indicative); the checks still show each value against its written target.
  const verdict = (pass, checks, extra = {}) => ({ checks, pass: indicative ? null : pass, status: status(pass), ...extra });
  const empty = reason => ({ value: null, pass: null, status: 'n/a', reason });
  if (n === 0) {
    const reason = 'no website with a measured identity in this set';
    return { n, perSet, indicative, note, sites: [], excluded, repeats: null, D1: { ...thresholds.D1, ...empty(reason) }, D2: { ...thresholds.D2, ...empty(reason) }, D3: { ...thresholds.D3, ...empty(reason) }, D4: { ...thresholds.D4, ...empty(reason) }, D5: { ...thresholds.D5, ...empty(reason) } };
  }
  const check = (name, value, target, within) => ({ check: name, value, target, within });

  // D1 palettes: sites without ground or ink cannot be clustered; they are listed.
  const clusterable = sites.filter(site => site.paletteComplete);
  const palettes = clusterPalettes(clusterable, { deltaE: thresholds.D1.deltaE });
  const clusterSizes = palettes.clusters.map(cluster => cluster.size);
  const D1target = { minClusters: thresholds.D1.minClustersPer20, maxPerCluster: thresholds.D1.maxPerCluster };
  const D1value = { clusters: palettes.clusters.length, largestCluster: Math.max(0, ...clusterSizes), sites: clusterable.length, unclusterable: sites.filter(site => !site.paletteComplete).map(site => site.id) };
  const D1checks = [
    check(`distinct palette clusters (≥ ${D1target.minClusters} in ${perSet})`, D1value.clusters, D1target.minClusters, indicative ? null : D1value.clusters >= D1target.minClusters),
    check(`largest cluster (≤ ${D1target.maxPerCluster}, not scaled)`, D1value.largestCluster, D1target.maxPerCluster, D1value.largestCluster <= D1target.maxPerCluster),
  ];
  const D1 = {
    ...thresholds.D1, value: D1value, target: D1target,
    ...verdict(clusterable.length ? D1checks.every(entry => entry.within !== false) && D1value.clusters >= D1target.minClusters : null, D1checks, { model: targetModel(D1target.minClusters, clusterable.length, perSet) }),
    detail: palettes,
  };

  // D2 ground classes.
  const grounds = countBy(sites.map(site => site.groundClass ?? 'unknown'));
  const warmShare = round3((grounds['warm-light'] ?? 0) / n);
  const classesUsed = Object.keys(grounds).filter(key => key !== 'unknown').length;
  const D2target = { maxWarmLightShare: thresholds.D2.maxWarmLightShare, minClasses: thresholds.D2.minClasses };
  const D2checks = [
    check(`warm-light share (≤ ${D2target.maxWarmLightShare})`, warmShare, D2target.maxWarmLightShare, warmShare <= D2target.maxWarmLightShare),
    check(`ground classes used (≥ ${D2target.minClasses} in ${perSet})`, classesUsed, D2target.minClasses, indicative ? null : classesUsed >= D2target.minClasses),
  ];
  // A generator that just meets "≥ 4 classes" spreads evenly over exactly 4 of the 5 classes.
  const D2model = { target: D2target.minClasses, note: `uniform over ${D2target.minClasses} classes`, expectedDistinct: round3(expectedDistinct(D2target.minClasses, n)) };
  const D2 = {
    ...thresholds.D2, value: { warmLightShare: warmShare, classesUsed, distribution: grounds }, target: D2target,
    ...verdict(warmShare <= D2target.maxWarmLightShare && classesUsed >= D2target.minClasses, D2checks, { model: D2model }),
  };

  // D3 type pairings (rendered display family of h1, rendered text family of body copy).
  const pairings = countBy(sites.map(site => site.pairing));
  const D3target = { minPairings: thresholds.D3.minPer20, maxPerPairing: thresholds.D3.maxPerPairing };
  const largestPairing = Math.max(0, ...Object.values(pairings));
  const D3checks = [
    check(`distinct pairings (≥ ${D3target.minPairings} in ${perSet})`, Object.keys(pairings).length, D3target.minPairings, indicative ? null : Object.keys(pairings).length >= D3target.minPairings),
    check(`largest pairing (≤ ${D3target.maxPerPairing}, not scaled)`, largestPairing, D3target.maxPerPairing, largestPairing <= D3target.maxPerPairing),
  ];
  const D3 = {
    ...thresholds.D3, value: { pairings: Object.keys(pairings).length, largestPairing, distribution: pairings }, target: D3target,
    ...verdict(Object.keys(pairings).length >= D3target.minPairings && largestPairing <= D3target.maxPerPairing, D3checks, { model: targetModel(D3target.minPairings, n, perSet) }),
  };

  // D4 archetypes. 'other' (classifier best score < 0.5) is reported but is not
  // a named archetype, so it neither counts as one that "appears" nor towards
  // the 40% cap; it does count as one label in D5's entropy (conservative).
  const archetypes = countBy(sites.map(site => site.archetype));
  const named = thresholds.D4.named;
  const appearing = named.filter(name => archetypes[name]);
  const share = name => round3((archetypes[name] ?? 0) / n);
  const capped = Object.keys(archetypes).filter(name => name !== 'other');
  const largest = capped.reduce((best, name) => (share(name) > (best?.share ?? -1) ? { name, share: share(name) } : best), null);
  const D4target = { namedAppearing: named.length, maxShare: thresholds.D4.maxShare, maxCentredShare: thresholds.D4.maxCentredShare };
  const D4checks = [
    check(`named archetypes appearing (all ${named.length} in ${perSet})`, appearing.length, D4target.namedAppearing, indicative ? null : appearing.length >= D4target.namedAppearing),
    check(`largest archetype share (≤ ${D4target.maxShare})`, largest?.share ?? 0, D4target.maxShare, (largest?.share ?? 0) <= D4target.maxShare),
    check(`centred-stack share (≤ ${D4target.maxCentredShare})`, share('centred-stack'), D4target.maxCentredShare, share('centred-stack') <= D4target.maxCentredShare),
  ];
  const D4 = {
    ...thresholds.D4, value: { namedAppearing: appearing.length, missing: named.filter(name => !archetypes[name]), largest, centredShare: share('centred-stack'), otherShare: share('other'), distribution: archetypes }, target: D4target,
    ...verdict(D4checks.every(entry => entry.within !== false) && appearing.length >= D4target.namedAppearing, D4checks, { model: { target: named.length, note: `uniform over the ${named.length} named archetypes`, expectedDistinct: round3(expectedDistinct(named.length, n)) } }),
  };

  // D5 mean normalised entropy of the D1, D3 and D4 label distributions,
  // each normalised by ln(min(n, K)) (header). Ground classes: extra, not in the index.
  const entropies = {
    D1: clusterable.length ? round3(normalisedEntropy(clusterable.map(site => palettes.labelOf[site.id]))) : null,
    D3: round3(normalisedEntropy(sites.map(site => site.pairing))),
    D4: round3(normalisedEntropy(sites.map(site => site.archetype), ARCHETYPE_LABELS.length)),
  };
  const parts = Object.values(entropies).filter(Number.isFinite);
  const index = parts.length ? round3(parts.reduce((sum, value) => sum + value, 0) / parts.length) : null;
  const D5 = {
    ...thresholds.D5, value: { index, entropies, groundClassEntropy: round3(normalisedEntropy(sites.map(site => site.groundClass ?? 'unknown'), GROUND_CLASSES.length)), normalisers: { D1: `ln(min(n, n)) = ln ${clusterable.length}`, D3: `ln ${n}`, D4: `ln(min(${n}, ${ARCHETYPE_LABELS.length}))`, groundClasses: `ln(min(${n}, ${GROUND_CLASSES.length}))` } }, target: { min: thresholds.D5.min },
    ...verdict(index === null ? null : index >= thresholds.D5.min, [check(`index (≥ ${thresholds.D5.min})`, index, thresholds.D5.min, index === null ? null : index >= thresholds.D5.min)]),
    note: 'Round-on-round rise is judged across sets, not here.',
  };

  // Repeats: the share of sites that share their palette cluster, their pairing, or both with another site.
  const clusterOf = palettes.labelOf;
  const repeatsPalette = clusterable.filter(site => palettes.clusters.find(cluster => cluster.members.includes(site.id)).size > 1);
  const repeatsPairing = sites.filter(site => pairings[site.pairing] > 1);
  const repeatsBoth = sites.filter(site => sites.some(other => other !== site && other.pairing === site.pairing && clusterOf[other.id] && clusterOf[other.id] === clusterOf[site.id]));
  const repeats = {
    palette: { share: round3(repeatsPalette.length / Math.max(1, clusterable.length)), sites: repeatsPalette.map(site => site.id), expected: D1.model?.expectedRepeatShare ?? null },
    pairing: { share: round3(repeatsPairing.length / n), sites: repeatsPairing.map(site => site.id), expected: D3.model?.expectedRepeatShare ?? null },
    paletteAndPairing: { share: round3(repeatsBoth.length / n), sites: repeatsBoth.map(site => site.id) },
  };

  const briefs = briefProvenance(sites);
  return {
    n, perSet, indicative, note, repeats, briefs,
    caveat: briefs.caveat ? `D1–D5 measure run-to-run similarity, not cross-brief diversity: ${briefs.caveat}. They show how alike repeated runs on the same brief look, not the spread a round of different briefs should show.` : null,
    sites: sites.map(site => ({ id: site.id, title: site.title, ...site.hex, groundClass: site.groundClass, pairing: site.pairing, archetype: site.archetype, palette: palettes.labelOf[site.id] ?? null })),
    excluded, D1, D2, D3, D4, D5,
  };
}

// ---------------------------------------------------------------------------
// Self-test: node scripts/eval/lib/diversity.mjs --selftest

function selftest() {
  let failures = 0;
  for (const [lab1, lab2, expected] of CIEDE2000_TEST_PAIRS) {
    const got = ciede2000(lab1, lab2);
    const ok = Math.abs(got - expected) < 1e-4;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ΔE00 ${got.toFixed(4)} expected ${expected.toFixed(4)}  ${JSON.stringify(lab1)} ${JSON.stringify(lab2)}`);
  }
  // Clustering: a chain A~B~C where A and C are far apart must not become one
  // cluster under complete linkage.
  const site = (id, ground) => ({ id, hex: { ground, ink: '#111111', accent: '#c0392b' }, lab: { ground: hexToLab(ground), ink: hexToLab('#111111'), accent: hexToLab('#c0392b') } });
  const chain = [site('a', '#ffffff'), site('b', '#e6e6e6'), site('c', '#cccccc')];
  const ab = paletteDistance(chain[0], chain[1]).max, bc = paletteDistance(chain[1], chain[2]).max, ac = paletteDistance(chain[0], chain[2]).max;
  const clusters = clusterPalettes(chain).clusters.map(cluster => cluster.members.join('+'));
  const chainOk = ab <= 10 && bc <= 10 && ac > 10 && clusters.length === 2;
  if (!chainOk) failures++;
  console.log(`${chainOk ? 'ok  ' : 'FAIL'} complete linkage: ΔE ab ${ab.toFixed(2)}, bc ${bc.toFixed(2)}, ac ${ac.toFixed(2)} -> clusters ${clusters.join(' | ')}`);

  const expect = (ok, label) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); };
  // D1 ink by lightness: two near-black inks of different cast are one palette; a grey body ink is not.
  const palette = (id, ink) => ({ id, hex: { ground: '#f2efe6', ink, accent: '#b3311d' }, lab: { ground: hexToLab('#f2efe6'), ink: hexToLab(ink), accent: hexToLab('#b3311d') } });
  const nearBlack = paletteDistance(palette('p', '#131417'), palette('q', '#2b1d18'));
  expect(nearBlack.ink <= 10 && ciede2000(hexToLab('#131417'), hexToLab('#2b1d18')) > nearBlack.ink && clusterPalettes([palette('p', '#131417'), palette('q', '#2b1d18')]).clusters.length === 1,
    `ink by lightness: #131417 vs #2b1d18 lightness ΔE ${nearBlack.ink.toFixed(2)} (full ΔE00 ${ciede2000(hexToLab('#131417'), hexToLab('#2b1d18')).toFixed(2)}) -> one cluster`);
  expect(clusterPalettes([palette('p', '#111111'), palette('r', '#6a5145')]).clusters.length === 2, 'ink by lightness: #111111 vs #6a5145 stay two clusters');

  // D5 normalisation by ln(min(n, K)): the index does not depend on n for a closed set of K labels.
  const even8 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const e8 = normalisedEntropy(even8, 8), e16 = normalisedEntropy([...even8, ...even8], 8), e16open = normalisedEntropy([...even8, ...even8]);
  expect(Math.abs(e8 - 1) < 1e-9 && Math.abs(e16 - 1) < 1e-9 && e16open < 0.76, `entropy over K = 8: n 8 -> ${e8.toFixed(3)}, n 16 -> ${e16.toFixed(3)} (by ln n it would be ${e16open.toFixed(3)})`);
  expect(normalisedEntropy(['x', 'x', 'x']) === 0 && normalisedEntropy(['x']) === 0 && normalisedEntropy([]) === null, 'entropy edge cases (all same 0, one label 0, none null)');

  // Expected-distinct model: M fitted so 20 draws give the target on average.
  const d1 = targetModel(14, 11), d3 = targetModel(12, 11);
  expect(Math.abs(expectedDistinct(fitUniformPool(14, 20), 20) - 14) < 1e-6 && Math.abs(d1.pool - 25.27) < 0.05 && Math.abs(d1.expectedDistinct - 9.05) < 0.1, `model T 14: M ${d1.pool}, expected at 11 sites ${d1.expectedDistinct}, repeat share ${d1.expectedRepeatShare}`);
  expect(Math.abs(d3.pool - 17.17) < 0.05 && Math.abs(d3.expectedDistinct - 8.3) < 0.15, `model T 12: M ${d3.pool}, expected at 11 sites ${d3.expectedDistinct}`);

  // Small sets are indicative, caps are not scaled; 20 sites pass or fail.
  const item = (k, overrides = {}) => ({ itemId: `s${k}`, identity: { ground: ['#f2efe6', '#162026', '#f5f7fa', '#c04020', '#8a8f93'][k % 5], ink: '#111111', accent: ['#b3311d', '#1d4ed8', '#2f7d32', '#7b2cbf', '#d9a03a', '#0f766e', '#be185d'][k % 7], groundClass: ['warm-light', 'dark', 'cool-light', 'saturated', 'mid-tone'][k % 5], fonts: { display: `D${k % 6}`, text: `T${k % 4}` }, archetype: ['poster', 'photographic', 'index', 'product-stage', 'editorial-split', 'type-as-image'][k % 6], ...overrides } });
  const small = measureDiversity(Array.from({ length: 11 }, (_, k) => item(k)));
  expect(small.indicative && ['D1', 'D2', 'D3', 'D4', 'D5'].every(id => small[id].status === 'indicative' && small[id].pass === null), 'n = 11: D1–D5 indicative, pass null');
  expect(small.D1.target.maxPerCluster === 3 && small.D3.target.maxPerPairing === 3 && small.D1.checks[1].within !== null, 'n = 11: caps stay at 3 and are still checked');
  expect(small.D1.model.expectedDistinct > 8 && small.repeats.pairing.share >= 0 && small.repeats.pairing.expected > 0, `n = 11: model ${small.D1.model.expectedDistinct} palettes expected; repeats palette ${small.repeats.palette.share}, pairing ${small.repeats.pairing.share}, both ${small.repeats.paletteAndPairing.share}`);
  const full = measureDiversity(Array.from({ length: 20 }, (_, k) => item(k)));
  expect(!full.indicative && ['D1', 'D2', 'D3', 'D4', 'D5'].every(id => ['pass', 'fail'].includes(full[id].status)), `n = 20: pass/fail (${['D1', 'D2', 'D3', 'D4', 'D5'].map(id => `${id} ${full[id].status}`).join(', ')})`);

  // Brief provenance: re-runs of two briefs (one re-run with a lightly edited text, one with only a
  // group) are 2 distinct briefs and carry the run-to-run caveat; one brief per site carries none.
  const bakery = 'Frazierz Bakery, a family bakery in Chicago: cakes, cookies and pies baked fresh every morning; order online for pickup.';
  const dental = 'Monee Dental, a family dental practice in Monee, Illinois: cleanings, fillings, implants and emergency visits; book online.';
  const run = (k, brief, extra = {}) => ({ ...item(k), brief, ...extra });
  const monee = { item: { briefGroup: 'Monee Dental' } };
  const redesign = [run(0, bakery), run(1, bakery), run(2, bakery.replace('Chicago', 'Chicago, Illinois')), run(3, dental, monee), run(4, dental, monee), run(5, null, monee)];
  const same = measureDiversity(redesign);
  expect(same.briefs.distinct === 2 && same.briefs.sites === 6 && same.briefs.unknown === 0 && /run-to-run similarity, not cross-brief diversity/.test(same.caveat ?? ''), `6 runs of 2 briefs: ${same.briefs.distinct} distinct (${same.briefs.groups.map(group => `${group.brief} ${group.sites.length}`).join(', ')}), caveat ${Boolean(same.caveat)}`);
  const spread = measureDiversity(Array.from({ length: 6 }, (_, k) => ({ ...item(k), brief: `Brief ${k}: ${['a bakery', 'a dental practice', 'a climbing gym', 'a law firm', 'a ceramics studio', 'a seed round'][k]} with its own customers, offer and place.` })));
  expect(spread.briefs.distinct === 6 && spread.caveat === null, `6 sites from 6 briefs: ${spread.briefs.distinct} distinct, no caveat`);
  const unknown = measureDiversity(Array.from({ length: 3 }, (_, k) => item(k)));
  expect(unknown.briefs.unknown === 3 && unknown.briefs.distinct === 0 && unknown.caveat === null, 'sites without any brief are counted as unknown, never as distinct briefs');
  if (failures) process.exitCode = 1;
}

if (process.argv.includes('--selftest') && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) selftest();

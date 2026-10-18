// Small, dependency-free statistics for win rates and summaries.

/** Deterministic PRNG (mulberry32) so bootstrap intervals are reproducible. */
export function rng(seed = 20261018) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wilson score interval for k successes out of n (ties may be counted as 0.5). */
export function wilson(k, n, z = 1.959964) {
  if (n === 0) return { low: 0, high: 1, point: null };
  const p = k / n;
  const denominator = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half), point: p };
}

/**
 * Percentile bootstrap CI of the mean of per-item scores (1 win, 0.5 tie, 0 loss),
 * resampling items (briefs), which is the unit that is actually independent.
 */
export function bootstrapMean(scores, { resamples = 10_000, seed = 20261018, alpha = 0.05 } = {}) {
  const n = scores.length;
  if (!n) return { low: null, high: null, point: null, n: 0 };
  const random = rng(seed);
  const means = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += scores[Math.floor(random() * n)];
    means[r] = sum / n;
  }
  means.sort();
  const at = q => means[Math.min(resamples - 1, Math.max(0, Math.floor(q * resamples)))];
  return { low: at(alpha / 2), high: at(1 - alpha / 2), point: scores.reduce((a, b) => a + b, 0) / n, n };
}

export function median(values) {
  const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Normalised Shannon entropy of a category distribution: 0 = all the same,
 * 1 = as spread as possible. The maximum entropy of n labels drawn from K
 * possible categories is ln(min(n, K)), so that is the normaliser: without K
 * (an open set of categories, such as palettes or type pairings) it is ln n;
 * with a closed set (8 archetype labels, 5 ground classes) it stops the index
 * from falling just because a set has more sites than there are categories.
 */
export function normalisedEntropy(labels, categories = Infinity) {
  const n = labels.length;
  if (n <= 1) return n === 1 ? 0 : null;
  const counts = new Map();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) { const p = count / n; entropy -= p * Math.log(p); }
  const reachable = Math.min(n, categories);
  return reachable <= 1 ? 0 : entropy / Math.log(reachable);
}

/** Expected number of distinct labels in n independent draws from M equally likely labels: M(1 − (1 − 1/M)^n). */
export function expectedDistinct(pool, n) {
  return pool * (1 - (1 - 1 / pool) ** n);
}

/**
 * The pool size M for which n draws give `target` distinct labels on average
 * (expectedDistinct(M, n) = target), by bisection. Needs 0 < target < n.
 */
export function fitUniformPool(target, n) {
  if (!(target > 0 && target < n)) return null;
  let low = target;
  let high = 1e6;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (expectedDistinct(mid, n) < target) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

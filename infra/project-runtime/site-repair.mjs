/** Bounded repair controller for site-verifier failures. No AI wiring: the caller supplies `repair`.
 *
 * buildRepairRequest() turns a verification report into a focused request that names only the failed checks
 * (route, viewports, expected, observed). repairUntilVerified() alternates repair and a recheck of only the
 * affected checks, keeps the previous usable version when a candidate is not better, never accepts a repair that
 * returns an existing version (nothing is overwritten), stops at the attempt or time limit, and never reports a
 * check it did not run on the current version as passed: checks carried over from an earlier version are
 * `not_checked` with the earlier outcome attached. */
import {CHECKS} from './site-verifier.mjs';

export const MAX_ATTEMPTS = 5;
const order = check => { const index = CHECKS.indexOf(check); return index < 0 ? CHECKS.length : index; };
const baseOf = id => id.replace(/#\d+$/, '');

/** The focused request: failed results only, grouped by check and route (viewports listed together). */
export function buildRepairRequest(report, {maxIssues = 12} = {}) {
  const failed = (report?.results ?? []).filter(result => result.status === 'failed');
  const groups = new Map();
  for (const result of failed) {
    const key = `${result.check}|${result.route ?? ''}|${result.id.match(/#\d+$/)?.[0] ?? ''}`;
    const group = groups.get(key) ?? {check: result.check, route: result.route, viewports: [], ids: [], expected: result.expected, observed: [], reason: result.reason ?? null};
    if (result.viewport && !group.viewports.includes(result.viewport)) group.viewports.push(result.viewport);
    group.ids.push(result.id);
    const line = `${result.viewport ? `${result.viewport}: ` : ''}${result.observed ?? ''}`;
    if (!group.observed.some(item => item.endsWith(result.observed ?? ''))) group.observed.push(line);
    groups.set(key, group);
  }
  const sorted = [...groups.values()].sort((a, b) => order(a.check) - order(b.check) || String(a.route).localeCompare(String(b.route)));
  const issues = sorted.slice(0, maxIssues);
  const omitted = sorted.slice(maxIssues);
  const identity = report?.identity ?? {};
  const lines = issues.map((issue, index) => `${index + 1}. ${issue.check} on ${issue.route ?? 'the site'}${issue.viewports.length ? ` at ${issue.viewports.join(', ')}` : ''}\n   Expected: ${issue.expected}\n   Observed: ${issue.observed.join(' | ')}${issue.reason ? `\n   Problem: ${issue.reason}` : ''}`);
  const prompt = issues.length ? [
    `Fix only these problems, found by the automated website check of ${identity.artifactId ?? 'this project'} version ${identity.version ?? '?'}. Change nothing else: keep the design, copy and structure, and keep every other page working.`,
    ...lines,
    ...(omitted.length ? [`(${omitted.length} further problem(s) will be sent after these are fixed.)`] : []),
  ].join('\n') : '';
  return {
    identity, issues, prompt,
    affected: issues.flatMap(issue => issue.ids),
    omitted: omitted.flatMap(issue => issue.ids),
    unverified: (report?.results ?? []).filter(result => result.status === 'not_checked').map(result => result.id),
  };
}

/** The candidate's report: rechecked results for the affected ids; everything else carried as not_checked. */
export function mergeRecheck(previous, recheck, affected, {version, previousVersion}) {
  const wanted = new Set(affected), seen = new Set();
  const fresh = (recheck?.results ?? []).filter(result => wanted.has(result.id) || wanted.has(baseOf(result.id)));
  const results = [];
  for (const result of previous.results) {
    if (wanted.has(result.id)) {
      const again = fresh.find(item => item.id === result.id);
      results.push(again ?? {...result, status: 'not_checked', reason: 'the recheck produced no result for this check', previous: {status: result.status, version: previousVersion}, steps: [], evidence: {screenshot: null, log: []}});
      seen.add(result.id);
      continue;
    }
    results.push({...result, status: 'not_checked', reason: `not rechecked on version ${version}; it was ${result.status} on version ${previousVersion}`, previous: {status: result.status, version: previousVersion, reason: result.reason}});
  }
  for (const result of fresh) if (!seen.has(result.id) && !results.some(item => item.id === result.id)) results.push(result);
  const summary = {passed: 0, failed: 0, not_checked: 0};
  for (const result of results) summary[result.status]++;
  return {...(recheck ?? previous), identity: {...previous.identity, ...(recheck?.identity ?? {}), version}, results, summary, recheckOf: affected, carriedFrom: previousVersion};
}

const timed = (promise, ms) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error('REPAIR_BUDGET'), {code: 'REPAIR_BUDGET'})), Math.max(0, ms)); })]).finally(() => clearTimeout(timer));
};
const versionLabel = version => (version && typeof version === 'object' ? (version.id ?? version.version ?? null) : version);
const versionKey = version => JSON.stringify(versionLabel(version) ?? version);

/**
 * verify(version, {only, remainingMs}) → report (only: result ids to recheck; undefined = everything).
 * repair(request, {version, attempt, remainingMs}) → {version} with a NEW version (never the current one).
 * Returns {status, version, previousVersion, report, attempts, stoppedBy}. status: verified | repaired | improved | unchanged.
 */
export async function repairUntilVerified({initial, verify, repair, attempts = 2, budget = {}, fullRecheck = false, now = Date.now}) {
  if (typeof verify !== 'function' || typeof repair !== 'function' || !initial || initial.version === undefined) throw Error('REPAIR_INPUT_INVALID');
  const limit = Math.max(0, Math.min(MAX_ATTEMPTS, Number.isInteger(attempts) ? attempts : 2));
  const deadline = now() + Math.max(0, budget.timeMs ?? 600_000);
  const remaining = () => deadline - now();
  const seen = new Set([versionKey(initial.version)]);
  const log = [];
  let current = {version: initial.version, report: initial.report ?? null};
  let stoppedBy = null, accepted = 0;
  try {
    if (!current.report) current.report = await timed(verify(current.version, {only: undefined, remainingMs: remaining()}), remaining());
    for (let attempt = 1; ; attempt++) {
      const failures = current.report.results.filter(result => result.status === 'failed');
      if (!failures.length) { stoppedBy = 'passed'; break; }
      if (attempt > limit) { stoppedBy = 'attempts'; break; }
      if (remaining() <= 0) { stoppedBy = 'budget'; break; }
      const request = buildRepairRequest(current.report);
      const entry = {attempt, request: {affected: request.affected, issues: request.issues.length, omitted: request.omitted.length}, candidate: null, accepted: false, reason: null, recheck: null};
      log.push(entry);
      const result = await timed(Promise.resolve(repair(request, {version: current.version, attempt, remainingMs: remaining()})), remaining());
      const candidate = result?.version;
      if (candidate === undefined || candidate === null || seen.has(versionKey(candidate))) { entry.reason = 'the repair returned no new version (the current version is kept; nothing is overwritten)'; continue; }
      seen.add(versionKey(candidate));
      entry.candidate = candidate;
      if (remaining() <= 0) { entry.reason = 'no time left to recheck the candidate'; stoppedBy = 'budget'; break; }
      const recheck = await timed(verify(candidate, {only: request.affected, remainingMs: remaining()}), remaining());
      const merged = mergeRecheck(current.report, recheck, request.affected, {version: versionLabel(candidate), previousVersion: versionLabel(current.version)});
      const rechecked = merged.results.filter(item => request.affected.includes(item.id));
      const fixed = rechecked.filter(item => item.status === 'passed').length, still = rechecked.filter(item => item.status === 'failed').length;
      entry.recheck = {passed: fixed, failed: still, not_checked: rechecked.length - fixed - still};
      // Every rechecked check was failing before, so a candidate that fixes at least one of them is better on the
      // rechecked set. Regressions elsewhere are only visible with fullRecheck (the carried checks stay not_checked).
      if (fixed > 0) {
        entry.accepted = true; accepted++;
        current = {version: candidate, report: merged};
      } else entry.reason = `the candidate fixed ${fixed} of ${request.affected.length} affected check(s); the previous version is kept`;
    }
    if (fullRecheck && accepted && remaining() > 0) current.report = await timed(verify(current.version, {only: undefined, remainingMs: remaining()}), remaining());
  } catch (error) {
    if (error.code !== 'REPAIR_BUDGET') throw error;
    stoppedBy = 'budget';
  }
  const report = current.report;
  const failed = report ? report.results.filter(result => result.status === 'failed').length : null;
  // Complete: every result in the report was produced on the reported version (nothing carried from an earlier one).
  const complete = !!report && !report.results.some(result => result.previous);
  const status = report && failed === 0 && complete ? 'verified' : accepted && failed === 0 ? 'repaired' : accepted ? 'improved' : 'unchanged';
  return {status, version: current.version, previousVersion: initial.version, report, attempts: log, stoppedBy};
}

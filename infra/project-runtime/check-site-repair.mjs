/** Offline checks for the bounded site-repair controller and its request builder. verify() and repair() are
 * fakes over an in-memory "site" (a set of defects); no browser, provider or network is used. */
import assert from 'node:assert/strict';
import {buildRepairRequest, mergeRecheck, repairUntilVerified, MAX_ATTEMPTS} from './site-repair.mjs';

let groups = 0;
const check = async (name, fn) => { await fn(); groups++; console.log(`PASS ${name}`); };

// All checks a fake site can report, as result ids; a version is {id, defects:Set<id>}.
const ALL = ['route-load:/:390x844', 'overflow:/:360x740', 'overflow:/:390x844', 'navigation:/:1440x900', 'mobile-menu-escape:/:390x844', 'form-submit:/:1440x900#0', 'external-links:/:1440x900'];
const checkOf = id => id.split(':')[0];
const result = (id, status, observed = '') => ({id, check: checkOf(id), route: id.split(':')[1] ?? null, viewport: id.split(':')[2]?.replace(/#\d+$/, '') ?? null, steps: [], expected: `expected ${checkOf(id)}`, observed, evidence: {screenshot: null, log: []}, status, ...(status === 'not_checked' ? {reason: 'listed only'} : {})});
function fakeVerify(calls) {
  return async (version, {only} = {}) => {
    calls.push({version: version.id, only: only ? [...only] : null});
    const ids = only ? ALL.filter(id => only.includes(id)) : ALL;
    return {identity: {artifactId: 'a1', version: version.id}, results: ids.map(id => id.startsWith('external-links') ? result(id, 'not_checked') : result(id, version.defects.has(id) ? 'failed' : 'passed', version.defects.has(id) ? `defect ${id}` : 'ok'))};
  };
}
const fixOne = calls => async (request, {version}) => { calls.push(request); const defects = new Set(version.defects); defects.delete(request.affected[0]); return {version: {id: version.id + 1, defects}}; };
const fixAll = calls => async (request, {version}) => { calls.push(request); const defects = new Set(version.defects); for (const id of request.affected) defects.delete(id); return {version: {id: version.id + 1, defects}}; };

await check('request names only failed checks, grouped by check and route with their viewports', async () => {
  const report = {identity: {artifactId: 'a1', version: 3}, results: [
    result('overflow:/:360x740', 'failed', 'the page scrolls 6 px sideways'), result('overflow:/:390x844', 'failed', 'the page scrolls 4 px sideways'),
    result('route-load:/:390x844', 'passed', 'fine'), result('external-links:/:1440x900', 'not_checked'), result('navigation:/:1440x900', 'failed', '#/journal is not a declared route'),
  ]};
  const request = buildRepairRequest(report);
  assert.deepEqual(request.issues.map(issue => [issue.check, issue.route, issue.viewports]), [['overflow', '/', ['360x740', '390x844']], ['navigation', '/', ['1440x900']]]);
  assert.deepEqual(request.affected, ['overflow:/:360x740', 'overflow:/:390x844', 'navigation:/:1440x900']);
  assert.deepEqual(request.unverified, ['external-links:/:1440x900']);
  assert.match(request.prompt, /version 3/);
  assert.match(request.prompt, /6 px sideways/);
  assert.match(request.prompt, /#\/journal is not a declared route/);
  assert.doesNotMatch(request.prompt, /fine|route-load|external-links/);
  assert.equal(buildRepairRequest({results: [result('overflow:/:360x740', 'passed')]}).prompt, '');
});

await check('request is bounded: issues beyond maxIssues are omitted and named as later work', async () => {
  const results = Array.from({length: 5}, (_, index) => result(`navigation:/p${index}:1440x900`, 'failed', `broken ${index}`));
  const request = buildRepairRequest({identity: {}, results}, {maxIssues: 2});
  assert.equal(request.issues.length, 2);
  assert.equal(request.omitted.length, 3);
  assert.match(request.prompt, /3 further problem/);
  assert.doesNotMatch(request.prompt, /broken 4/);
});

await check('merge: rechecked ids take the new result, every other check becomes not_checked with its earlier outcome', async () => {
  const previous = {identity: {artifactId: 'a1', version: 1}, results: [result('overflow:/:360x740', 'failed'), result('route-load:/:390x844', 'passed')]};
  const recheck = {identity: {artifactId: 'a1', version: 2}, results: [result('overflow:/:360x740', 'passed'), result('route-load:/:390x844', 'passed')]};
  const merged = mergeRecheck(previous, recheck, ['overflow:/:360x740'], {version: 2, previousVersion: 1});
  assert.equal(merged.results.find(item => item.id === 'overflow:/:360x740').status, 'passed');
  const carried = merged.results.find(item => item.id === 'route-load:/:390x844');
  assert.equal(carried.status, 'not_checked', 'a pass the recheck was not asked for is never taken');
  assert.deepEqual(carried.previous, {status: 'passed', version: 1, reason: undefined});
  assert.deepEqual(merged.summary, {passed: 1, failed: 0, not_checked: 1});
  const missing = mergeRecheck(previous, {results: []}, ['overflow:/:360x740'], {version: 2, previousVersion: 1});
  assert.equal(missing.results.find(item => item.id === 'overflow:/:360x740').status, 'not_checked');
});

await check('loop: repairs within the attempt limit, rechecks only affected checks, keeps the initial version untouched', async () => {
  const verifies = [], repairs = [];
  const initial = {version: {id: 1, defects: new Set(['overflow:/:360x740', 'navigation:/:1440x900'])}};
  const outcome = await repairUntilVerified({initial, verify: fakeVerify(verifies), repair: fixOne(repairs), attempts: 2});
  assert.equal(outcome.status, 'repaired');
  assert.equal(outcome.stoppedBy, 'passed');
  assert.equal(outcome.version.id, 3);
  assert.equal(outcome.previousVersion, initial.version);
  assert.deepEqual([...initial.version.defects].sort(), ['navigation:/:1440x900', 'overflow:/:360x740'], 'the initial version is never modified');
  assert.deepEqual(verifies.map(call => call.only), [null, ['overflow:/:360x740', 'navigation:/:1440x900'], ['navigation:/:1440x900']]);
  assert.equal(repairs.length, 2);
  assert.deepEqual(repairs[1].affected, ['navigation:/:1440x900'], 'the second request names only what is still failing');
  // Only navigation was rechecked on version 3; overflow passed on version 2 and is carried, not claimed for 3.
  assert.deepEqual(outcome.report.results.filter(item => item.status === 'passed').map(item => item.id), ['navigation:/:1440x900']);
  assert.deepEqual(outcome.report.results.find(item => item.id === 'overflow:/:360x740').previous, {status: 'passed', version: 2, reason: undefined});
  assert.ok(outcome.report.results.filter(item => item.status === 'not_checked').every(item => item.previous || item.id.startsWith('external-links')));
  assert.equal(outcome.report.results.find(item => item.id === 'route-load:/:390x844').status, 'not_checked', 'never rechecked, so never reported passed');
});

await check('loop: fullRecheck turns a repaired candidate into a complete verified report', async () => {
  const verifies = [];
  const outcome = await repairUntilVerified({initial: {version: {id: 1, defects: new Set(['overflow:/:360x740'])}}, verify: fakeVerify(verifies), repair: fixAll([]), fullRecheck: true});
  assert.equal(outcome.status, 'verified');
  assert.equal(verifies.at(-1).only, null);
  assert.ok(outcome.report.results.every(item => !item.previous));
});

await check('loop: stops at the attempt limit, keeps the best usable version, clamps attempts to the hard maximum', async () => {
  const verifies = [], repairs = [];
  const many = new Set(ALL.filter(id => !id.startsWith('external')));
  const outcome = await repairUntilVerified({initial: {version: {id: 1, defects: many}}, verify: fakeVerify(verifies), repair: fixOne(repairs), attempts: 2});
  assert.equal(outcome.stoppedBy, 'attempts');
  assert.equal(outcome.status, 'improved');
  assert.equal(repairs.length, 2);
  assert.equal(outcome.version.id, 3);
  const unbounded = [];
  const capped = await repairUntilVerified({initial: {version: {id: 1, defects: many}}, verify: fakeVerify([]), repair: async (request, {version}) => { unbounded.push(1); return {version: {id: version.id + 1, defects: version.defects}}; }, attempts: 999});
  assert.equal(unbounded.length, MAX_ATTEMPTS);
  assert.equal(capped.status, 'unchanged');
  assert.equal(capped.version.id, 1, 'candidates that fix nothing are never accepted');
});

await check('loop: a repair that returns the current or an earlier version is refused (nothing is overwritten)', async () => {
  const initial = {version: {id: 1, defects: new Set(['overflow:/:360x740'])}};
  const verifies = [];
  const outcome = await repairUntilVerified({initial, verify: fakeVerify(verifies), repair: async (request, {version}) => ({version}), attempts: 2});
  assert.equal(outcome.status, 'unchanged');
  assert.equal(outcome.version, initial.version);
  assert.equal(verifies.length, 1, 'a refused candidate is never verified');
  assert.match(outcome.attempts[0].reason, /no new version/);
  const none = await repairUntilVerified({initial, verify: fakeVerify([]), repair: async () => null, attempts: 1});
  assert.equal(none.status, 'unchanged');
});

await check('loop: the time budget bounds the loop, including a repair that never returns', async () => {
  let clock = 0;
  const slow = await repairUntilVerified({initial: {version: {id: 1, defects: new Set(['overflow:/:360x740', 'navigation:/:1440x900'])}}, verify: fakeVerify([]), repair: async (request, {version}) => { clock += 60_000; return {version: {id: version.id + 1, defects: new Set([...version.defects].slice(1))}}; }, attempts: 5, budget: {timeMs: 50_000}, now: () => clock});
  assert.equal(slow.stoppedBy, 'budget');
  assert.equal(slow.version.id, 1, 'a candidate without time for its recheck is not accepted');
  const started = Date.now();
  const hung = await repairUntilVerified({initial: {version: {id: 1, defects: new Set(['overflow:/:360x740'])}}, verify: fakeVerify([]), repair: () => new Promise(() => {}), budget: {timeMs: 300}});
  assert.equal(hung.stoppedBy, 'budget');
  assert.equal(hung.status, 'unchanged');
  assert.ok(Date.now() - started < 3000);
});

await check('loop: an already passing site is verified without any repair', async () => {
  const repairs = [];
  const outcome = await repairUntilVerified({initial: {version: {id: 1, defects: new Set()}}, verify: fakeVerify([]), repair: fixOne(repairs)});
  assert.equal(outcome.status, 'verified');
  assert.equal(repairs.length, 0);
  await assert.rejects(repairUntilVerified({initial: {}, verify: fakeVerify([]), repair: fixOne([])}), /REPAIR_INPUT_INVALID/);
});

console.log(`${groups} site-repair groups passed.`);

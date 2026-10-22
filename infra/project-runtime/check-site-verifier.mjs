/** Offline checks for the site verifier's pure rules and the isolated enquiry sink contract. No browser is
 * launched (the one verifySite() call is refused before launch, or runs only the byte-level version check). */
import assert from 'node:assert/strict';
import {rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Budget, BudgetExhausted, CHECKS, classifyLink, decideForm, decidePrimary, planUnits, siteDigest, verifySite, DEFAULT_VIEWPORTS} from './site-verifier.mjs';
import {VERIFIER_ORIGIN, enquiryContract, isolatedChromiumEnv, ISOLATED_CHROMIUM_ARGS} from './isolated-chromium.mjs';

let groups = 0;
const check = async (name, fn) => { await fn(); groups++; console.log(`PASS ${name}`); };
const routes = [{path: '/'}, {path: '/menu'}];
const origin = VERIFIER_ORIGIN;

await check('links: hash routes, anchors, paths, files, external and contact links are classified without fetching', async () => {
  const at = href => classifyLink(href, {origin, routes, files: ['/menu.pdf']});
  assert.deepEqual(at('#/menu'), {kind: 'route', path: '/menu', declared: true, anchor: null});
  assert.deepEqual(at('#/menu#starters'), {kind: 'route', path: '/menu', declared: true, anchor: 'starters'});
  assert.deepEqual(at('#/journal'), {kind: 'route', path: '/journal', declared: false, anchor: null});
  assert.equal(at('#').kind, 'route'); assert.equal(at('#/').path, '/'); assert.equal(at('/').path, '/');
  assert.deepEqual(at('#visit'), {kind: 'anchor', anchor: 'visit', home: false});
  assert.deepEqual(at('/#visit'), {kind: 'anchor', anchor: 'visit', home: true});
  assert.deepEqual(at('/menu'), {kind: 'path', path: '/menu', declared: true, anchor: null});
  assert.equal(at('/story').declared, false);
  assert.deepEqual(at('/menu.pdf'), {kind: 'file', path: '/menu.pdf'});
  assert.deepEqual(at('https://maps.example.com/x'), {kind: 'external', host: 'maps.example.com'});
  assert.deepEqual(at('tel:+441234'), {kind: 'contact', scheme: 'tel'});
  assert.equal(at('MAILTO:a@b.c').scheme, 'mailto');
  assert.equal(at('javascript:void(0)').kind, 'script');
  assert.equal(at('').kind, 'empty');
  assert.equal(at(`${origin}/#/menu`).kind, 'route');
});

await check('forms: exactly one accepted POST with a visible status passes; every dishonest or doubled outcome fails', async () => {
  const ok = {status: 200, response: {accepted: true}};
  assert.equal(decideForm({posts: [ok], message: 'Thanks, sent'}).status, 'passed');
  assert.match(decideForm({posts: [ok], message: ''}).reason, /confirmation/);
  assert.equal(decideForm({posts: [ok, ok], message: 'Thanks'}).status, 'failed');
  assert.equal(decideForm({posts: [{status: 400, response: {error: {message: 'Check your name, email and message.'}}}], message: 'Error'}).status, 'failed');
  assert.equal(decideForm({posts: [], message: 'Enquiries are not available in this preview, nothing was sent'}).status, 'passed');
  assert.equal(decideForm({posts: [], message: 'Thank you, we will be in touch'}).status, 'failed', 'claims success without sending');
  assert.equal(decideForm({posts: [], message: ''}).status, 'failed');
  assert.equal(decideForm({posts: [], invalidAfterFill: ['phone']}).status, 'not_checked', 'a site rejecting the fictional values is not a site failure');
  assert.equal(decideForm({posts: [], violations: [{kind: 'off-origin', url: 'https://collector.example/'}], message: 'Not sent'}).status, 'failed');
  assert.equal(decideForm({posts: [{status: 415}], navigatedTo: `${origin}/_mb/enquiries`}).status, 'failed');
  assert.equal(decideForm({mailto: true}).status, 'not_checked');
});

await check('primary action: no effect fails, background mutation never counts as an effect, links are judged by target', async () => {
  const none = {mutations: 0, urlChanged: false, url: '', dy: 0, newForm: false, dialog: false, focusMoved: null, anchorTarget: false, waitedMs: 1000};
  assert.equal(decidePrimary({link: null, effect: none}).status, 'failed');
  assert.equal(decidePrimary({link: null, effect: {...none, mutations: 4}}).status, 'passed');
  assert.equal(decidePrimary({link: null, effect: {...none, mutations: 4}, baselineMutations: 3}).status, 'failed', 'a page that mutates on its own cannot prove the click did something');
  assert.equal(decidePrimary({link: {kind: 'anchor', anchor: 'book'}, effect: {...none, urlChanged: true, dy: 600, anchorTarget: true}}).status, 'passed');
  assert.equal(decidePrimary({link: {kind: 'route', path: '/x', declared: false}, effect: {...none, urlChanged: true}}).status, 'failed');
  assert.equal(decidePrimary({link: null, effect: {...none, dy: 400}, violations: [{url: 'https://x.example/'}]}).status, 'failed');
});

await check('digest covers the document and every file byte, independent of file order', async () => {
  const file = (p, body) => ({path: p, contentType: 'text/plain', body: Buffer.from(body)});
  const a = {indexHtml: '<p>a</p>', files: [file('/a.js', '1'), file('/b.css', '2')]};
  assert.equal(siteDigest(a), siteDigest({...a, files: [...a.files].reverse()}));
  assert.notEqual(siteDigest(a), siteDigest({...a, indexHtml: '<p>b</p>'}));
  assert.notEqual(siteDigest(a), siteDigest({...a, files: [file('/a.js', '1'), file('/b.css', '3')]}));
  assert.match(siteDigest(a), /^sha256:[0-9a-f]{64}$/);
});

await check('budget: steps and time are bounded and validated', async () => {
  let clock = 0;
  const budget = new Budget({timeMs: 5000, maxSteps: 2}, () => clock);
  budget.step(); budget.step();
  assert.throws(() => budget.step(), error => error instanceof BudgetExhausted && error.kind === 'steps');
  const timed = new Budget({timeMs: 5000, maxSteps: 10}, () => clock);
  clock = 6000;
  assert.throws(() => timed.step(), error => error.kind === 'time');
  assert.throws(() => new Budget({timeMs: 10, maxSteps: 1}), /TIME_LIMIT/);
  assert.throws(() => new Budget({timeMs: 5000, maxSteps: 0}), /STEP_LIMIT/);
});

await check('plan: every check is planned, menus only below 768 px, fixed bars only on phones, no duplicate units', async () => {
  const units = planUnits(routes, DEFAULT_VIEWPORTS);
  assert.deepEqual([...new Set(units.flatMap(unit => unit.checks))].sort(), [...CHECKS].sort());
  assert.ok(units.filter(unit => unit.kind === 'menu').every(unit => unit.viewport.width < 768));
  assert.ok(units.filter(unit => unit.checks.includes('fixed-bars')).every(unit => unit.viewport.width < 600));
  const keys = units.map(unit => `${unit.kind}|${unit.route}|${unit.viewport ? unit.viewport.width : ''}`);
  assert.equal(new Set(keys).size, keys.length);
  const single = planUnits(routes, [{width: 390, height: 844}]);
  const singleKeys = single.map(unit => `${unit.kind}|${unit.route}|${unit.viewport ? unit.viewport.width : ''}`);
  assert.equal(new Set(singleKeys).size, singleKeys.length, 'phone and desktop collapse into one unit when they are the same viewport');
});

await check('enquiry sink answers with the customer-site Worker contract and never accepts a malformed enquiry', async () => {
  const headers = {origin, 'content-type': 'application/json'};
  const body = value => Buffer.from(JSON.stringify(value));
  const good = {requestId: '0b0a3d2c-1f2e-4a5b-8c6d-7e8f9a0b1c2d', name: 'Verifier Test', email: 'verifier@example.invalid', message: 'Automated check'};
  assert.deepEqual(enquiryContract({origin, headers, body: body(good)}), {status: 200, json: {accepted: true}});
  assert.equal(enquiryContract({origin, headers: {...headers, origin: 'https://evil.example'}, body: body(good)}).status, 403);
  assert.equal(enquiryContract({origin, headers: {...headers, 'content-type': 'application/x-www-form-urlencoded'}, body: Buffer.from('a=b')}).status, 415);
  assert.equal(enquiryContract({origin, headers, body: body({...good, phone: '1'})}).status, 400);
  assert.equal(enquiryContract({origin, headers, body: body({...good, _website: 'bot'})}).status, 400);
  assert.equal(enquiryContract({origin, headers, body: body({...good, requestId: 'x'})}).status, 400);
  assert.equal(enquiryContract({origin, headers, body: Buffer.alloc(10_001, 32)}).status, 413);
});

await check('hardened launch keeps the renderer flags and passes no application environment', async () => {
  for (const flag of ['--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND', '--renderer-process-limit=1', '--disable-quic']) assert.ok(ISOLATED_CHROMIUM_ARGS.includes(flag), flag);
  const env = isolatedChromiumEnv({PATH: '/bin', SUPABASE_SERVICE_ROLE_KEY: 'secret', ANTHROPIC_API_KEY: 'secret', TEMP: '/tmp'});
  assert.deepEqual(Object.keys(env).sort(), ['PATH', 'TEMP']);
});

await check('evidence never goes under outputs/, and a digest-only run needs no browser', async () => {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const site = {indexHtml: '<!doctype html>', files: []};
  await assert.rejects(verifySite({identity: {artifactId: 'a'}, site, evidenceDir: path.join(repo, 'outputs', 'verify'), launch: () => { throw Error('must not launch'); }}), /EVIDENCE_DIR_REFUSED/);
  const launch = () => { throw Error('must not launch'); };
  const evidenceDir = path.join(tmpdir(), `makeborne-site-verify-check-${process.pid}`);
  const mismatch = await verifySite({identity: {artifactId: 'a', version: 1, publicationDigest: `sha256:${'0'.repeat(64)}`}, site, only: ['version'], launch, evidenceDir});
  assert.deepEqual(mismatch.results.map(result => [result.id, result.status]), [['version', 'failed']]);
  const match = await verifySite({identity: {artifactId: 'a', version: 1, publicationDigest: siteDigest(site)}, site, only: ['version'], launch, evidenceDir});
  rmSync(evidenceDir, {recursive: true, force: true});
  assert.deepEqual(match.results.map(result => [result.id, result.status]), [['version', 'passed']]);
  await assert.rejects(verifySite({identity: {artifactId: 'a'}, site, routes: [{path: '/../x'}], launch}), /ROUTE_INVALID/);
});

console.log(`${groups} site-verifier groups passed.`);

/* eslint-disable @typescript-eslint/no-require-imports -- Mounted LiveBuilder and CreationHome in Chromium with real IndexedDB (audit M09): every file shows ready/local-only/unsupported/too-large/failed before Send, the request binds exactly the listed files, duplicates go once, Retry re-reads the same stored copy, and 320/375px do not overflow. All APIs are routed; no network beyond 127.0.0.1, no AI calls.
 * Run: node scripts/check-attachment-readiness-browser.cjs [--baseline=<git rev>]  (SHOTS_DIR=<dir> saves screenshots)
 * --baseline bundles every src/ file from that revision instead, to show the audited behaviour it lacks. */
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), { execFileSync } = require('node:child_process');
const { build } = require('esbuild'), { chromium } = require('playwright'), { createServer } = require('node:http');

const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice('--baseline='.length) ?? null;
const shots = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
const ids = { account: '11111111-1111-4111-8111-111111111111', workspace: '22222222-2222-4222-8222-222222222222', artifact: '33333333-3333-4333-8333-333333333333', operation: '44444444-4444-4444-8444-444444444444' };

const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import LiveBuilder from'./src/components/live-builder';import CreationHome from'./src/components/creation-home';import * as storage from'./src/lib/attachments';
const ids=${JSON.stringify(ids)};const owner='account:'+ids.account;window.ids=ids;window.sources=storage;window.context=storage.projectAttachmentKey(ids.account+':'+ids.workspace+':'+ids.artifact);
window.makeFile=spec=>{if(spec.png){const bytes=new Uint8Array(spec.png);bytes.set([137,80,78,71,13,10,26,10]);return new File([bytes],spec.name,{type:'image/png'});}return new File([spec.text],spec.name,{type:spec.type||''});};
window.seedProject=specs=>storage.addAttachments(owner,window.context,specs.map(window.makeFile));
window.stored=async()=>(await storage.readAttachments(owner,window.context)).map(file=>file.name);
window.homeStored=async()=>(await storage.readAttachments('device','home')).map(file=>file.name);
window.seedHomeDraft=async specs=>{const requestId=crypto.randomUUID(),nonce=crypto.randomUUID();await storage.addAttachments('device','home',specs.map(window.makeFile));await storage.saveCreationDraft('device',requestId,nonce,{brief:'Build from my source',requestId});const draft=await storage.claimCreationDraft(requestId,nonce,ids.account);await storage.copyAttachments(draft.attachmentOwner,'draft:'+requestId,window.context);await storage.finishAttachmentHandoff(draft.attachmentOwner,requestId);};
window.mountBuilder=(options={})=>createRoot(document.getElementById('root')).render(<LiveBuilder accountId={ids.account} workspaceId={ids.workspace} artifactId={ids.artifact} version={1} history={[]} baseFiles={{}} baseAssets={[]} defaultEffort="light" autoStart={options.auto?'Build from my source':null} autoStartMode="create" kind="book" onLive={()=>{}} onSaved={()=>{}}/>);
window.mountHome=()=>createRoot(document.getElementById('root')).render(<CreationHome initialEmail={null} accountsEnabled={false}/>);`;
const mocks = {
  'use-plan-mode': `import{useMemo}from'react';export function usePlanMode(){return useMemo(()=>({active:null,restored:null,operation:null,checking:false,recoveryNotice:'',ready:true,hasPrevious:false,recoverablePlan:null,edit:()=>{},markBuilt:()=>{},refreshOperation:async()=>null,recoverPlan:async()=>null,run:async()=>{throw new Error('No planning in this fixture')}}),[])}`,
  'plan-card': `export default function PlanCard(){return null}`,
  'design-capture': `export async function captureDesign(){throw new Error('No visual review in this fixture')}`,
  'cloud-api': `export async function readCloudImage(){throw new Error('Unexpected image request')}`,
  'next/link': `import React from'react';export default function Link({href,children,prefetch,...rest}){return <a href={typeof href==='string'?href:'#'} {...rest}>{children}</a>}`,
  'next/image': `import React from'react';export default function Image({src,alt,width,height,priority,...rest}){return <img src={src} alt={alt} width={width} height={height} {...rest}/>}`,
  'next/navigation': `export function useRouter(){return{push:url=>{window.pushed=url},replace:()=>{},refresh:()=>{},prefetch:()=>{}}}export function usePathname(){return'/'}export function useSearchParams(){return new URLSearchParams()}`,
  'use-creation-account': `export function useCreationAccount(){return{ready:true,error:'',accountId:null,workspace:null,clients:[]}}`,
  'generation-permissions': `export function useGenerationConsent(){return{ready:true,enabled:false,consent:null}}export default function GenerationPermissions(){return null}`,
  'studio-account': `export default function StudioAccount(){return null}`,
  'template-gallery': `export default function TemplateGallery(){return null}`,
};
const mockFilter = /(?:^|[\\/])(use-plan-mode|plan-card|design-capture|cloud-api|use-creation-account|generation-permissions|studio-account|template-gallery)$|^next\/(link|image|navigation)$/;
const srcRoot = path.resolve('src');
function sourceText(file) {
  if (baseline && file.startsWith(srcRoot + path.sep)) {
    try { return execFileSync('git', ['show', `${baseline}:${path.relative(process.cwd(), file).split(path.sep).join('/')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { /* Not present at the baseline: use the working copy. */ }
  }
  return fs.readFileSync(file, 'utf8');
}

async function bundle() {
  const css = [];
  const output = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: process.cwd() }, write: false, bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env': '{}' },
    plugins: [{ name: 'fixture', setup(b) {
      b.onResolve({ filter: mockFilter }, args => ({ path: args.path.startsWith('next/') ? args.path : args.path.replace(/^.*[\\/]/, ''), namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: process.cwd() }));
      b.onResolve({ filter: /^@\// }, args => {
        const base = path.resolve('src', args.path.slice(2));
        return { path: args.path.endsWith('.css') ? base : fs.existsSync(base + '.tsx') ? base + '.tsx' : base + '.ts' };
      });
      b.onLoad({ filter: /\.css$/ }, args => { css.push(sourceText(args.path)); return { contents: '', loader: 'js' }; });
      b.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, args => ({ contents: sourceText(args.path), loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) }));
    } }] });
  // LiveBuilder's stylesheet is imported by its host (cloud-studio), so the fixture adds it.
  const globals = sourceText(path.resolve('src/app/globals.css')).replace(/@import[^;]+;/g, '') + sourceText(path.resolve('src/app/live-builder.css'));
  return { js: output.outputFiles[0].contents, html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globals}${css.join('\n')}</style><div id="root"></div><script src="/fixture.js"></script>` };
}

const states = page => page.locator('.attachment-chip').evaluateAll(chips => chips.map(chip => ({ name: chip.querySelector('.attachment-details strong')?.textContent, state: chip.dataset.state ?? null, text: chip.querySelector('.attachment-state')?.textContent ?? '' })));
const decoded = attachment => Buffer.from(attachment.data, 'base64').toString();
async function noOverflow(page, label) {
  const result = await page.evaluate(() => {
    const width = window.innerWidth, bad = [];
    for (const element of document.querySelectorAll('.attachment-section, .attachment-readiness, .attachment-chip, .attachment-state, .attachment-actions button, .attachment-remove')) {
      const box = element.getBoundingClientRect();
      if (box.width && (box.left < -0.5 || box.right > width + 0.5)) bad.push(`${element.className} ${Math.round(box.left)}..${Math.round(box.right)}`);
    }
    return { width, scroll: document.documentElement.scrollWidth, bad };
  });
  assert.equal(result.bad.length, 0, `${label}: attachment UI inside the viewport: ${result.bad.join('; ')}`);
  assert(result.scroll <= result.width, `${label}: no horizontal page scroll (${result.scroll} > ${result.width})`);
}

async function main() {
  const { js, html } = await bundle();
  const server = createServer((req, res) => { const script = req.url === '/fixture.js'; res.setHeader('Content-Type', script ? 'text/javascript' : 'text/html'); res.end(script ? js : html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const failures = [];
  async function scenario(name, run, viewport = { width: 1100, height: 900 }) {
    const context = await browser.newContext({ viewport }), page = await context.newPage(), builds = [], errors = [];
    page.setDefaultTimeout(baseline ? 6000 : 15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    let count = 0, operation = { id: ids.operation, revision: 1, kind: 'build', effort: 'light', authorizedCredits: 20, chargedCredits: 0, reservedCredits: 0, remainingCredits: 20, maximumAdditionalCredits: 20, status: 'active', pendingKind: null, lastVersion: 1, canContinue: false, recoverable: false, expiresAt: '2030-01-01T00:00:00Z' };
    await page.route('**/api/credits', route => route.fulfill({ json: { available: 500, unlimited: false } }));
    builds.questions = [];
    await page.route('**/api/build/questions', route => { builds.questions.push(route.request().postDataJSON()); return route.fulfill({ json: { questions: [] } }); });
    await page.route('**/api/build/operations**', route => route.fulfill({ json: { operation, result: null, recovery: null } }));
    await page.route('**/api/build', async route => {
      builds.push(route.request().postDataJSON()); count++;
      operation = { ...operation, lastVersion: count + 1, chargedCredits: count, remainingCredits: 19 };
      const events = [{ type: 'operation', operation }, { type: 'done', version: count + 1, summary: 'Saved fixture', changed: false, finished: true, charged: 1, operation }];
      await route.fulfill({ headers: { 'Content-Type': 'text/event-stream' }, body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') });
    });
    try {
      await page.goto(base); await page.waitForFunction(() => window.mountBuilder);
      await run(page, builds);
      assert.deepEqual(errors, [], 'no page errors');
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(name);
      console.log(`FAIL ${name}: ${String(error.message).split('\n')[0]}`);
    } finally { await context.close(); }
  }
  const send = async (page, text) => {
    const box = page.getByRole('textbox', { name: 'Message the builder' });
    await box.fill(text); await page.getByRole('button', { name: 'Send', exact: true }).click();
  };
  const settled = page => page.waitForFunction(() => document.querySelector('.lb-turn.lb-assistant[data-state="done"], .lb-turn.lb-assistant[data-state="error"]'));
  const mixed = [{ name: 'brief.txt', text: 'Use exactly 123 customers.', type: 'text/plain' }, { name: 'table.csv', text: 'a,b\n1,2', type: 'text/csv' },
    { name: 'huge.png', png: 3_000_001 }, { name: 'broken.pdf', text: 'not really a pdf', type: 'application/pdf' },
    { name: 'brief.txt', text: 'Use exactly 123 customers.', type: 'text/plain' }, { name: 'notes.md', text: '# Notes\nKeep the 456 figure.' }];
  try {
    await scenario('each file has one stated AI state before Send, and Send binds exactly "Will be read"', async (page, builds) => {
      await page.evaluate(async specs => { await window.seedProject(specs); window.mountBuilder(); }, mixed);
      const summary = page.locator('.attachment-readiness');
      await summary.getByText('Will be read: brief.txt, notes.md', { exact: true }).waitFor();
      assert.equal(await summary.getAttribute('role'), 'status');
      assert.equal(await summary.getAttribute('aria-live'), 'polite');
      assert.equal(await summary.locator('.attachment-skipped').innerText(), 'Not sent: table.csv (type AI can’t read), huge.png (over the limit), broken.pdf (couldn’t be read), brief.txt (not sent)');
      const shown = await states(page);
      assert.deepEqual(shown.map(item => item.state), ['ready', 'unsupported', 'too-large', 'failed', 'local-only', 'ready']);
      assert.match(shown[0].text, /^Will be read by AI\./);
      assert.match(shown[1].text, /^AI can’t read this type\. CSV spreadsheets can’t be read by AI\. AI reads PNG, JPEG, WebP, GIF, PDF, TXT and Markdown\./);
      assert.match(shown[2].text, /^Over the AI limit\. This file is 3,000,001 bytes\. .*3 MB \(3,000,000 bytes\), so it is 1 byte over\. It isn’t trimmed or sent/);
      assert.match(shown[3].text, /^Couldn’t be read\. Its contents aren’t a valid PDF file/);
      assert.match(shown[4].text, /^Saved · not sent\. Same name, size and contents as another brief\.txt/);
      assert(await page.getByRole('button', { name: 'Retry reading broken.pdf' }).isVisible(), 'failed files offer Retry');
      if (shots) await page.screenshot({ path: path.join(shots, 'builder-states-1100.png'), fullPage: true });
      await send(page, 'Build from my sources');
      await page.locator('.lb-notice').filter({ hasText: 'before generation' }).waitFor();
      assert.equal(builds.length, 0, 'unreadable files stop generation until explicitly resolved');
      assert.equal(builds.questions.length, 0, 'no tailored-question provider request before the source decision');
      for (const name of ['table.csv', 'huge.png', 'broken.pdf']) {
        await page.getByRole('button', { name: `Leave ${name} out of this request (the saved file is kept)`, exact: true }).click();
      }
      await send(page, 'Build from my sources'); await settled(page);
      assert.equal(builds.length, 1, 'explicitly excluded files do not block the readable selection');
      assert.deepEqual(builds[0].attachments.map(file => file.name), ['brief.txt', 'notes.md'], 'the request binds exactly the listed files, duplicate once');
      assert.equal(decoded(builds[0].attachments[0]), 'Use exactly 123 customers.');
      await page.locator('.lb-user', { hasText: '📎 brief.txt, notes.md' }).waitFor();
      assert.equal((await page.evaluate(() => window.stored())).length, 6, 'nothing stored was deleted by sending');
    });
    await scenario('leave out keeps the stored file; delete removes it; the combined limit admits the next file', async (page, builds) => {
      await page.evaluate(async () => { await window.seedProject([{ name: 'brief.txt', text: 'Brief text', type: 'text/plain' }, { name: 'notes.md', text: 'Notes' }, { name: 'big.png', png: 2_000_000 }, { name: 'extra.png', png: 1_500_000 }]); window.mountBuilder(); });
      await page.getByText('Will be read: brief.txt, notes.md, big.png', { exact: true }).waitFor();
      let shown = await states(page);
      assert.equal(shown[3].state, 'too-large');
      assert.match(shown[3].text, /would bring this request to 3,500,015 bytes\. AI files are limited to 3 MB \(3,000,000 bytes\) combined: 500,015 bytes over/);
      await page.getByRole('button', { name: 'Leave big.png out of this request (the saved file is kept)' }).click();
      await page.getByText('Will be read: brief.txt, notes.md, extra.png', { exact: true }).waitFor();
      shown = await states(page);
      assert.deepEqual(shown.map(item => item.state), ['ready', 'ready', 'local-only', 'ready']);
      assert.match(shown[2].text, /Left out of this request\. The file stays saved on this device/);
      await page.getByRole('button', { name: 'Include big.png in this request' }).click();
      await page.getByText('Will be read: brief.txt, notes.md, big.png', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Leave big.png out of this request (the saved file is kept)' }).click();
      await page.getByRole('button', { name: 'Delete notes.md from this project on this device' }).click();
      await page.getByText('Will be read: brief.txt, extra.png', { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.stored()), ['brief.txt', 'big.png', 'extra.png'], 'delete removed only notes.md; the left-out file stays stored');
      await send(page, 'Use the remaining files'); await settled(page);
      assert.deepEqual(builds[0].attachments.map(file => file.name), ['brief.txt', 'extra.png']);
    });
    await scenario('a read error blocks Send until Retry re-reads the same stored copy', async (page, builds) => {
      await page.evaluate(async () => {
        const original = Blob.prototype.arrayBuffer; let failed = false;
        Blob.prototype.arrayBuffer = function() { if (this.size === 77 && !failed) { failed = true; return Promise.reject(new DOMException('Fixture read failure', 'NotReadableError')); } return original.call(this); };
        await window.seedProject([{ name: 'flaky.txt', text: 'x'.repeat(77), type: 'text/plain' }, { name: 'ok.txt', text: 'fine', type: 'text/plain' }]); window.mountBuilder();
      });
      await page.getByText('Retry or leave out flaky.txt before sending.', { exact: true }).waitFor();
      assert.equal((await states(page))[0].state, 'failed');
      await send(page, 'Try with the flaky file');
      await page.locator('.lb-notice').filter({ hasText: 'Resolve flaky.txt before generation' }).waitFor();
      assert.equal(builds.length, 0, 'nothing is sent while an unread file is unresolved');
      assert.equal(await page.getByRole('textbox', { name: 'Message the builder' }).inputValue(), 'Try with the flaky file');
      await page.getByRole('button', { name: 'Retry reading flaky.txt' }).click();
      await page.getByText('Will be read: flaky.txt, ok.txt', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Send', exact: true }).click(); await settled(page);
      assert.deepEqual(builds[0].attachments.map(file => file.name), ['flaky.txt', 'ok.txt']);
      assert.equal(decoded(builds[0].attachments[0]), 'x'.repeat(77), 'the retried bytes are the same stored copy');
    });
    await scenario('a home request with an unreadable file stops before any AI call until explicitly resolved', async (page, builds) => {
      await page.evaluate(async () => { await window.seedHomeDraft([{ name: 'brief.zip', text: 'PK\u0003\u0004', type: 'application/zip' }, { name: 'brief.txt', text: 'Use exactly 123 customers.', type: 'text/plain' }]); window.mountBuilder({ auto: true }); });
      await page.waitForFunction(() => document.querySelector('.lb-turn.lb-assistant[data-state="done"]') || document.querySelector('.lb-notice'));
      const refused = await page.locator('.lb-notice').allInnerTexts();
      assert.equal(builds.length, 0, 'home handoff does not silently omit the unreadable file');
      assert.equal(builds.questions.length, 0, 'home handoff also blocks tailored questions');
      assert.match(refused.join(' '), /Resolve brief.zip before generation/);
      assert.equal(await page.getByRole('textbox', { name: 'Message the builder' }).inputValue(), 'Build from my source');
      assert.deepEqual((await states(page)).map(item => item.state), ['unsupported', 'ready']);
      await page.getByRole('button', { name: 'Leave brief.zip out of this request (the saved file is kept)' }).click();
      assert.equal(builds.length, 0, 'resolving the source never automatically resends the prompt');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await settled(page);
      assert.deepEqual(builds[0].attachments.map(file => file.name), ['brief.txt']);
    });
    await scenario('home composer states what will be read and that removal deletes the saved copy', async page => {
      await page.evaluate(() => window.mountHome());
      await page.locator('input[type=file][aria-label="Choose files to attach"]').setInputFiles([
        { name: 'brief.txt', mimeType: 'text/plain', buffer: Buffer.from('Use exactly 123 customers.') },
        { name: 'deck.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from('PK\u0003\u0004deck') },
        { name: 'scan.png', mimeType: 'image/png', buffer: Buffer.from('not an image') }]);
      await page.getByText('When your project builds · Will be read: brief.txt', { exact: true }).waitFor();
      await page.getByText('Not sent: deck.pptx (type AI can’t read), scan.png (couldn’t be read)', { exact: true }).waitFor();
      assert.match((await states(page))[1].text, /PowerPoint presentations can’t be read by AI/);
      await page.getByRole('button', { name: 'Remove deck.pptx and delete its saved copy from this device' }).click();
      await page.locator('.attachment-chip', { hasText: 'deck.pptx' }).waitFor({ state: 'detached' });
      assert.deepEqual(await page.evaluate(() => window.homeStored()), ['brief.txt', 'scan.png']);
    });
    const long = 'quarterly-board-review-with-a-very-long-descriptive-filename-for-phones';
    for (const width of [320, 375]) {
      await scenario(`builder at ${width}px: every state fits without horizontal overflow`, async page => {
        await page.evaluate(async specs => { await window.seedProject(specs); window.mountBuilder(); }, [...mixed, { name: `${long}.docx`, text: 'PK\u0003\u0004', type: '' }]);
        await page.getByText('Will be read: brief.txt, notes.md', { exact: true }).waitFor();
        await noOverflow(page, `builder ${width}`);
        if (shots) await page.screenshot({ path: path.join(shots, `builder-${width}.png`), fullPage: true });
      }, { width, height: 900 });
      await scenario(`home at ${width}px: states fit without horizontal overflow`, async page => {
        await page.evaluate(() => window.mountHome());
        await page.locator('input[type=file][aria-label="Choose files to attach"]').setInputFiles([
          { name: `${long}.txt`, mimeType: 'text/plain', buffer: Buffer.from('Use exactly 123 customers.') },
          { name: `${long}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK\u0003\u0004sheet') }]);
        await page.getByText(`When your project builds · Will be read: ${long}.txt`, { exact: true }).waitFor();
        await noOverflow(page, `home ${width}`);
        if (shots) await page.locator('.mk-composer').screenshot({ path: path.join(shots, `home-${width}.png`) });
      }, { width, height: 900 });
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  console.log(`\n${baseline ? `baseline ${baseline}: ` : ''}${failures.length ? `${failures.length} scenario(s) failed` : 'all scenarios passed'}.`);
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });

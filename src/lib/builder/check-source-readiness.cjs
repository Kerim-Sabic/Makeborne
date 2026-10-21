/* eslint-disable @typescript-eslint/no-require-imports -- Offline pre-Send readiness and client/server parity checks (audit M09). No network, no providers. */
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), assert = require('node:assert/strict'), Module = require('node:module');
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name.startsWith('@/')) return load.call(this, path.resolve(process.cwd(), 'src', name.slice(2)), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const server = require('./attachments.ts');
const { BuilderAttachmentsSchema, prepareBuilderAttachments, builderSourceMediaType, BUILDER_ATTACHMENT_LIMITS } = server;
const { analyzeSource, decideSources, classifySources, sourceIntentIssue, SOURCE_STATE_LABELS } = require('./source-readiness.ts');

let serial = 0;
const source = (name, content, type = '', id = `file-${++serial}`) => { const bytes = Buffer.from(content); return { id, name, type, owner: 'account:fixture', blob: new Blob([bytes]), size: bytes.length, previewType: null }; };
const bytesOf = async file => new Uint8Array(await file.blob.arrayBuffer());
const wire = (name, mediaType, bytes) => ({ name, mediaType, data: Buffer.from(bytes).toString('base64') });
const png = size => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(size - 8)]);
const jpeg = Buffer.from([255, 216, 255, 224, 0, 16]);
const MEDIA = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/markdown'];

/** Parity: whatever the classifier calls ready, the browser preparation and the route schema accept;
 * whatever it refuses, both refuse in the form the browser would send. */
async function assertParity(files, report) {
  const prepared = await prepareBuilderAttachments(report.ready);
  assert(BuilderAttachmentsSchema.safeParse(prepared).success, 'route schema accepts the ready set');
  assert.deepEqual(prepared.map(file => file.name), report.ready.map(file => file.name));
  assert.deepEqual(prepared.map(file => file.mediaType), report.entries.filter(entry => entry.state === 'ready').map(entry => entry.mediaType), 'client and server agree on media types');
  for (const entry of report.entries) {
    if (entry.state === 'ready' || entry.state === 'local-only') continue;
    if (entry.state === 'too-large' && /AI reads up to|combined/.test(entry.reason)) {
      await assert.rejects(prepareBuilderAttachments([...report.ready, entry.file]), `${entry.file.name}: adding it is refused by preparation`);
      assert(!BuilderAttachmentsSchema.safeParse([...prepared, wire(entry.file.name, entry.mediaType, await bytesOf(entry.file))]).success, `${entry.file.name}: adding it is refused by the route`);
      continue;
    }
    await assert.rejects(prepareBuilderAttachments([entry.file]), `${entry.file.name}: preparation refuses ${entry.state}`);
    const bytes = await bytesOf(entry.file);
    const declared = builderSourceMediaType(bytes, entry.file.name, entry.file.type) ?? (MEDIA.includes(entry.file.type) ? entry.file.type : null);
    if (declared) assert(!BuilderAttachmentsSchema.safeParse([wire(entry.file.name, declared, bytes)]).success, `${entry.file.name}: route refuses it as ${declared}`);
    else for (const type of [entry.file.type || 'application/octet-stream']) assert(!BuilderAttachmentsSchema.safeParse([wire(entry.file.name, type, bytes)]).success, `${entry.file.name}: route refuses ${type}`);
  }
}
const stateOf = (report, name) => report.entries.find(entry => entry.file.name === name);
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

async function main() {
  await check('readable types are ready and bound in order, mirroring server media detection', async () => {
    const files = [source('brief.txt', 'Use exactly 123 customers.', 'text/plain'), source('notes.md', '# Notes'), source('logo.png', png(64), 'image/png'),
      source('design.pdf', '%PDF-1.4\nfixture', 'application/pdf'), source('renamed.png', jpeg, 'image/png')];
    const report = await classifySources(files);
    assert.deepEqual(report.entries.map(entry => entry.state), ['ready', 'ready', 'ready', 'ready', 'ready']);
    assert.equal(stateOf(report, 'renamed.png').mediaType, 'image/jpeg', 'real bytes win over the name, exactly as the server does');
    assert.equal(report.readSummary, 'Will be read: brief.txt, notes.md, logo.png, design.pdf, renamed.png');
    assert.equal(report.skippedSummary, '');
    assert.equal(sourceIntentIssue(report), null);
    await assertParity(files, report);
  });
  await check('Office, CSV, SVG, JSON and archives are unsupported, naming the type and what AI can read', async () => {
    const files = [source('table.csv', 'a,b\n1,2', 'text/csv'), source('sheet.xlsx', 'PK\x03\x04sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      source('brief.docx', 'PK\x03\x04doc'), source('deck.pptx', 'PK\x03\x04deck'), source('vector.svg', '<svg/>', 'image/svg+xml'), source('data.json', '{}', 'application/json'), source('bundle.zip', 'PK\x03\x04')];
    const report = await classifySources(files);
    assert(report.entries.every(entry => entry.state === 'unsupported' && entry.label === SOURCE_STATE_LABELS.unsupported));
    assert.match(stateOf(report, 'table.csv').reason, /^CSV spreadsheets can’t be read by AI\. AI reads PNG, JPEG, WebP, GIF, PDF, TXT and Markdown\./);
    assert.match(stateOf(report, 'sheet.xlsx').reason, /^Excel spreadsheets/);
    assert.match(stateOf(report, 'brief.docx').reason, /^Word documents/);
    assert.match(stateOf(report, 'deck.pptx').reason, /^PowerPoint presentations/);
    assert.equal(report.ready.length, 0);
    assert.match(sourceIntentIssue(report), /before generation/);
    assert.equal(sourceIntentIssue(await classifySources(files, new Set(files.map(file => file.id)))), null, 'explicit exclusions permit proceeding');
    assert.equal(report.readSummary, 'No files will be read by AI with this request.');
    assert.match(report.skippedSummary, /^Not sent: table\.csv \(type AI can’t read\), sheet\.xlsx/);
    await assertParity(files, report);
  });
  await check('damaged, mis-encoded, binary and empty files have explicit reasons and require a decision before generation', async () => {
    const files = [source('broken.pdf', 'not really a pdf', 'application/pdf'), source('fake.png', 'plain words', 'image/png'), source('latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9])),
      source('binary.txt', '\x00\x01binary'), source('empty.txt', ''), source('ok.txt', 'still read')];
    const report = await classifySources(files);
    assert.deepEqual(report.entries.map(entry => entry.state), ['failed', 'failed', 'failed', 'failed', 'failed', 'ready']);
    assert.match(stateOf(report, 'broken.pdf').reason, /valid PDF file/);
    assert.match(stateOf(report, 'latin1.txt').reason, /UTF-8/);
    assert.match(stateOf(report, 'empty.txt').reason, /empty/);
    assert.equal(report.blocking.length, 0, 'blocking tracks retryable storage failures separately from deterministic content failures');
    assert.match(sourceIntentIssue(report), /before generation/, 'the intent gate blocks unresolved deterministic failures too');
    await assertParity(files, report);
  });
  await check('limits are reported with the amount over; text is never trimmed', async () => {
    const files = [source('at-limit.txt', 'a'.repeat(BUILDER_ATTACHMENT_LIMITS.textCharacters)), source('long.txt', 'a'.repeat(BUILDER_ATTACHMENT_LIMITS.textCharacters + 1)), source('huge.png', png(BUILDER_ATTACHMENT_LIMITS.fileBytes + 1), 'image/png')];
    const report = await classifySources(files);
    assert.equal(stateOf(report, 'at-limit.txt').state, 'ready');
    assert.equal(stateOf(report, 'long.txt').state, 'too-large');
    assert.match(stateOf(report, 'long.txt').reason, /^200,001 characters\. Text files can contain up to 200,000 characters, so this is 1 character over\. It isn’t trimmed or sent/);
    assert.equal(stateOf(report, 'huge.png').state, 'too-large');
    assert.match(stateOf(report, 'huge.png').reason, /^This file is 3,000,001 bytes\. Each AI source file can be up to 3 MB \(3,000,000 bytes\), so it is 1 byte over/);
    assert.deepEqual(report.ready.map(file => file.name), ['at-limit.txt']);
    await assertParity(files, report);
  });
  await check('combined and count limits keep earlier files and flag the one that would exceed', async () => {
    const combined = [source('a.png', png(1_500_001), 'image/png'), source('b.png', png(1_500_000), 'image/png'), source('c.txt', 'small')];
    const first = await classifySources(combined);
    assert.deepEqual(first.entries.map(entry => entry.state), ['ready', 'too-large', 'ready']);
    assert.match(stateOf(first, 'b.png').reason, /^Adding this file \(1,500,000 bytes\) would bring this request to 3,000,001 bytes\. AI files are limited to 3 MB \(3,000,000 bytes\) combined: 1 byte over/);
    await assertParity(combined, first);
    const exact = [source('x.png', png(1_500_000), 'image/png'), source('y.png', png(1_500_000), 'image/png')];
    const fits = await classifySources(exact);
    assert.deepEqual(fits.entries.map(entry => entry.state), ['ready', 'ready'], 'exactly 3,000,000 bytes combined is allowed');
    await assertParity(exact, fits);
    const many = Array.from({ length: 7 }, (_, index) => source(`${index}.txt`, `file ${index}`));
    const counted = await classifySources(many);
    assert.deepEqual(counted.entries.map(entry => entry.state), ['ready', 'ready', 'ready', 'ready', 'ready', 'too-large', 'too-large']);
    assert.match(stateOf(counted, '5.txt').reason, /AI reads up to 5 files per request/);
    await assertParity(many, counted);
    const leftOut = await classifySources(many, new Set([many[0].id]));
    assert.deepEqual(leftOut.entries.map(entry => entry.state), ['local-only', 'ready', 'ready', 'ready', 'ready', 'ready', 'too-large'], 'leaving one out admits the next file');
    await assertParity(many, leftOut);
  });
  await check('duplicates (same name, size and hash) are sent once; same-name different content is explained', async () => {
    const files = [source('brief.txt', 'Version A'), source('brief.txt', 'Version A'), source('brief.txt', 'Version B'), source('copy.txt', 'Version A')];
    const report = await classifySources(files);
    assert.deepEqual(report.entries.map(entry => entry.state), ['ready', 'local-only', 'ready', 'ready']);
    assert.equal(report.entries[1].duplicateOf, files[0].id);
    assert.match(report.entries[1].reason, /AI reads it once/);
    assert.match(report.entries[2].reason, /contents differ, so both are read/);
    assert.deepEqual(report.ready, [files[0], files[2], files[3]]);
    await assertParity(files, report);
  });
  await check('left-out files are local-only, unread and unsent', async () => {
    let reads = 0;
    const file = source('private.txt', 'keep local'), original = file.blob.arrayBuffer.bind(file.blob);
    file.blob.arrayBuffer = () => { reads++; return original(); };
    const report = await classifySources([file], new Set([file.id]));
    assert.equal(report.entries[0].state, 'local-only');
    assert.equal(report.entries[0].excluded, true);
    assert.equal(reads, 0, 'a left-out file is not even read');
    assert.equal(report.readSummary, 'No files will be read by AI with this request.');
    assert.equal(report.skippedSummary, 'Not sent: private.txt (not sent)');
  });
  await check('a read error blocks until Retry re-reads the same immutable stored copy', async () => {
    const file = source('flaky.png', png(32), 'image/png'), original = file.blob.arrayBuffer.bind(file.blob);
    let attempts = 0;
    file.blob.arrayBuffer = () => { attempts++; return attempts === 1 ? Promise.reject(new DOMException('NotReadableError', 'NotReadableError')) : original(); };
    const cache = new Map();
    const failed = await classifySources([file], new Set(), cache);
    assert.equal(failed.entries[0].state, 'failed');
    assert.equal(failed.blocking.length, 1);
    assert.equal(failed.ready.length, 0);
    const cached = await classifySources([file], new Set(), cache);
    assert.equal(attempts, 1, 'no silent re-read: the shown result stands until Retry');
    assert.equal(cached.entries[0].state, 'failed');
    cache.delete(file.id); // Retry
    const retried = await classifySources([file], new Set(), cache);
    assert.equal(attempts, 2);
    assert.equal(retried.entries[0].state, 'ready');
    assert.equal(retried.ready[0], file, 'the bound source is the same stored record');
    await assertParity([file], retried);
  });
  await check('decisions are pure and pending analyses report checking', async () => {
    const files = [source('a.txt', 'a'), source('b.txt', 'b')];
    const one = new Map([[files[0].id, await analyzeSource(files[0])]]);
    const pending = decideSources(files, one);
    assert.deepEqual(pending.entries.map(entry => entry.state), ['ready', 'checking']);
    assert.equal(pending.checking, true);
    assert.equal(pending.readSummary, 'Checking which files AI can read…');
  });
  await check('the classifier shares the server constants and byte rules (no second copy)', async () => {
    const text = fs.readFileSync(path.join(__dirname, 'source-readiness.ts'), 'utf8');
    assert(!/3_?000_?000|200_?000|count:\s*5/.test(text), 'limits come from BUILDER_ATTACHMENT_LIMITS');
    assert(/checkBuilderSourceBytes\(/.test(text) && /builderSourceMediaType\(/.test(text));
    const shared = fs.readFileSync(path.join(__dirname, 'attachments.ts'), 'utf8');
    assert(/const mediaType = builderSourceMediaType\(bytes, file\.name, file\.type\)/.test(shared), 'preparation uses the same media detection');
    assert(/validateBytes = checkBuilderSourceBytes/.test(shared), 'the route schema uses the same byte check');
  });
  console.log(`\n${passed} source readiness checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });

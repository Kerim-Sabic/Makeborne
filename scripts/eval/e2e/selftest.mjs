// Self-test of the e2e harness itself: no app, no database, no provider.
//   node scripts/eval/e2e/selftest.mjs                 all checks (exit 1 on a failure)
//   node scripts/eval/e2e/selftest.mjs --serve <mode>  keep one fake app on 127.0.0.1:3210
//                                                      (modes below) to watch the suite refuse it
// 1. identity.mjs against fake apps on ephemeral loopback ports: the suite's own
//    server passes; builder off but a key present, a whitespace-only key (chat on,
//    capabilities blind to it), builder on and a cloud-built client are refused;
//    no probe carries a cookie, Authorization or Origin, every POST is an empty
//    text/plain body to a chat-gated route, and a refused server gets no POST.
// 2. cleanup.mjs staleReason()/staleLedgers() in a temp root with injected PIDs and
//    start times, plus the real OS start-time read for this process.
// 3. server.mjs envTextKeys() against run.mjs parseEnvText() on dotenv edge cases.
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { API as ISOLATED_SUPABASE_URL } from '../lib/stack.mjs';
import { checkServerIdentity, CHAT_GATED } from './identity.mjs';

// Fake apps. key: what ANTHROPIC_API_KEY holds; chat: what chatEnabled() would answer.
export const MODES = Object.freeze({
  suite: { builder: false, key: '', chat: false, supabase: ISOLATED_SUPABASE_URL },
  'chat-on': { builder: false, key: 'set', chat: true, supabase: ISOLATED_SUPABASE_URL },
  'whitespace-key': { builder: false, key: ' ', chat: true, supabase: ISOLATED_SUPABASE_URL },
  'builder-on': { builder: true, key: 'set', chat: true, supabase: ISOLATED_SUPABASE_URL },
  cloud: { builder: false, key: '', chat: false, supabase: 'https://abcdefghijklmnopqrst.supabase.co' },
});

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

/** A fake Makeborne app that answers the identity probes the way the real routes do for `mode`. */
export function startFakeApp(mode, { port = 0 } = {}) {
  const config = MODES[mode];
  if (!config) throw new Error(`Unknown mode "${mode}": ${Object.keys(MODES).join(', ')}`);
  const requests = [];
  const server = http.createServer((req, res) => {
    let length = 0;
    req.on('data', chunk => { length += chunk.length; });
    req.on('end', () => {
      const { pathname } = new URL(req.url, 'http://fake');
      requests.push({ method: req.method, pathname, cookie: Boolean(req.headers.cookie), authorization: Boolean(req.headers.authorization),
        origin: req.headers.origin ?? null, contentType: req.headers['content-type'] ?? null, bodyBytes: length });
      if (req.method === 'GET' && pathname === '/login') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(`<!doctype html><html><head><script src="/_next/static/chunks/app.js" async=""></script></head><body><h1>Sign in</h1></body></html>`);
      }
      if (req.method === 'GET' && pathname === '/_next/static/chunks/app.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        return res.end(`function getSupabaseConfig() { const url = ("TURBOPACK compile-time value", "${config.supabase}"); return { url }; }`);
      }
      if (req.method === 'GET' && pathname === '/api/build') return json(res, 200, { available: config.builder && Boolean(config.key) });
      if (req.method === 'GET' && pathname === '/api/capabilities') {
        // src/lib/capabilities/snapshot.ts: configured = cloud configured && key.trim() && server credential.
        return json(res, 200, { schemaVersion: 2, aiGeneration: { configured: Boolean(config.key.trim()), available: false },
          cloudWorkspace: { available: true, configured: true }, publicPublishing: { available: null, configured: true } });
      }
      const gated = CHAT_GATED.find(item => item.route === pathname);
      if (gated) {
        if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
        // The real order: sameOrigin(), chatEnabled(), then boundedJson()'s content-type check.
        if (!config.chat) return json(res, 503, { error: { code: gated.code, message: 'not connected' } });
        if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return json(res, 415, { error: { code: 'CONTENT_TYPE', message: 'Send JSON content.' } });
        return json(res, 400, { error: { code: 'WOULD_HAVE_CONTINUED', message: 'a JSON body reached the route' } });
      }
      res.writeHead(404); res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise(done => server.close(done)) }));
  });
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${condition || !detail ? '' : `: ${detail}`}`);
}

async function identityChecks() {
  const expectations = {
    suite: { ok: true, posts: CHAT_GATED.length },
    'chat-on': { ok: false, problem: /holds an Anthropic key/, posts: 0 },
    'whitespace-key': { ok: false, problem: /POST \/api\/chat must answer 503 CHAT_UNAVAILABLE.*got 415 CONTENT_TYPE/, posts: CHAT_GATED.length },
    'builder-on': { ok: false, problem: /GET \/api\/build must answer/, posts: 0 },
    cloud: { ok: false, problem: /built for Supabase|cloud Supabase project URL/, posts: 0 },
  };
  for (const [mode, expected] of Object.entries(expectations)) {
    const fake = await startFakeApp(mode);
    try {
      const result = await checkServerIdentity(fake.origin, { timeoutMs: 10_000 });
      const posts = fake.requests.filter(item => item.method === 'POST');
      check(`identity ${mode}: ${expected.ok ? 'accepted' : 'refused'}`, result.ok === expected.ok, result.problems.join(' | '));
      if (expected.problem) check(`identity ${mode}: reason names the cause`, result.problems.some(problem => expected.problem.test(problem)), result.problems.join(' | '));
      check(`identity ${mode}: ${expected.posts} availability POST(s)`, posts.length === expected.posts, `${posts.length} sent`);
      check(`identity ${mode}: no cookie, Authorization or Origin on any probe`, fake.requests.every(item => !item.cookie && !item.authorization && item.origin === null));
      check(`identity ${mode}: every POST is an empty text/plain body to a chat-gated route`,
        posts.every(item => item.contentType === 'text/plain' && item.bodyBytes === 0 && CHAT_GATED.some(gated => gated.route === item.pathname)));
      if (mode === 'suite') check('identity suite: facts list the three gated routes as unavailable', result.facts.chatGated.length === CHAT_GATED.length && result.facts.chatGated.every(item => item.unavailable));
    } finally {
      await fake.close();
    }
  }
}

async function ledgerChecks() {
  const { STALE_IDLE_MS, START_TOLERANCE_MS, staleLedgers, staleReason, processStartMs, pidAlive, record } = await import('./cleanup.mjs');
  const root = mkdtempSync(path.join(os.tmpdir(), 'makeborne-e2e-selftest-'));
  try {
    const now = Date.now();
    const runnerStart = now - 600_000;
    const livePids = new Set([101, 102, 103, 104, 105, 106]);
    const starts = new Map([[101, runnerStart + 40], [102, now - 30_000], [103, null], [104, null], [105, runnerStart], [106, runnerStart]]);
    const cases = [
      // name, pid, startedAt recorded, idle ms, extra lines, expected stale?
      ['live runner, same start', 101, runnerStart, 60_000, [], false],
      ['PID reused (start differs)', 102, runnerStart, 60_000, [], true],
      ['start unreadable, recent', 103, runnerStart, 60_000, [], false],
      ['start unreadable, idle > 2 h', 104, runnerStart, STALE_IDLE_MS + 60_000, [], true],
      ['legacy run line (no startedAt), recent', 105, null, 60_000, [], false],
      ['legacy run line (no startedAt), idle > 2 h', 106, null, STALE_IDLE_MS + 60_000, [], true],
      ['runner gone', 999, runnerStart, 60_000, [], true],
      ['run ended', 101, runnerStart, 60_000, [{ kind: 'run-end' }], true],
      ['nothing pending', 999, runnerStart, STALE_IDLE_MS + 60_000, [{ kind: 'done', ref: 'project:p1' }], false],
    ];
    for (const [index, [, pid, startedAt, idle, extra]] of cases.entries()) {
      const file = path.join(root, `run-${index}`, 'created.jsonl');
      mkdirSync(path.dirname(file), { recursive: true });
      record({ kind: 'run', stamp: `run-${index}`, pid, ...(startedAt === null ? {} : { startedAt: new Date(startedAt).toISOString() }), origin: 'http://127.0.0.1:3210', workspaceId: 'w' }, file);
      record({ kind: 'project', projectId: 'p1', artifactId: 'a1', step: 'brief' }, file);
      for (const line of extra) record(line, file);
      const mtime = new Date(now - idle);
      utimesSync(file, mtime, mtime);
    }
    const noRun = path.join(root, 'no-run', 'created.jsonl');
    mkdirSync(path.dirname(noRun), { recursive: true });
    record({ kind: 'comment', commentId: 'c1' }, noRun);
    utimesSync(noRun, new Date(now - STALE_IDLE_MS - 60_000), new Date(now - STALE_IDLE_MS - 60_000));
    let startReads = 0;
    const stale = staleLedgers({ root, current: 'none', now, isAlive: pid => livePids.has(pid), startOf: pid => { startReads++; return starts.get(pid) ?? null; } });
    const staleStamps = new Map(stale.map(item => [item.stamp, item.reason]));
    for (const [index, [name, , , , , expected]] of cases.entries()) {
      check(`ledger ${name}: ${expected ? 'stale' : 'kept'}`, staleStamps.has(`run-${index}`) === expected, staleStamps.get(`run-${index}`) ?? 'not stale');
    }
    check('ledger without a run line, idle > 2 h: stale', staleStamps.has('no-run'));
    check('ledger PID reuse is named in the reason', /now belongs to a process started/.test(staleStamps.get('run-1') ?? ''));
    check('start time is read only for live, recent runs with startedAt', startReads === 3, `${startReads} reads`);
    check('staleReason: the idle rule wins over a live PID', staleReason({ run: { pid: 1, startedAt: new Date(now).toISOString() }, ended: false, idleMs: STALE_IDLE_MS + 1 }, { isAlive: () => true, startOf: () => now }) !== null);
    // The real OS read for this very process (PowerShell Get-Process on Windows, ps elsewhere).
    const recorded = Date.now() - process.uptime() * 1000;
    const live = processStartMs(process.pid);
    check(`processStartMs(own pid) within ${START_TOLERANCE_MS} ms of Node's start`, live !== null && Math.abs(live - recorded) <= START_TOLERANCE_MS, live === null ? 'unreadable' : `${Math.round(live - recorded)} ms apart`);
    check('processStartMs(no such pid) is null', processStartMs(2_147_483_644) === null);
    check('pidAlive(own pid) and not a bogus pid', pidAlive(process.pid) && !pidAlive(2_147_483_644) && !pidAlive(0));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function envChecks() {
  const { envTextKeys, e2eEnv } = await import('./server.mjs');
  let parseEnvText = null;
  try { ({ parseEnvText } = await import('../run.mjs')); } catch (error) { check('run.mjs importable for the parity check', false, error.message.split('\n')[0]); }
  const corpus = [
    'PLAIN=1\nexport EXPORTED=2\nCOLON: 3\n',
    '1DIGIT=a\n.DOT=b\n-DASH=c\nmixed.name-1=d\n',
    '﻿BOM_FIRST=1\r\nCRLF=2\rCR_ONLY=3\n',
    'SPLIT\n=value\nSPACED   =   x\n  INDENTED=y\n\texport\tTABBED=z\n',
    'MULTI="line one\nINNER_LOOKS_LIKE_KEY=no\nline three"\nAFTER=1\n',
    "SINGLE='a\nINNER2=b'\nBACKTICK=`c\nINNER3: d`\n",
    'COLON_NO_SPACE:value\n# COMMENTED=1\nEMPTY=\nHASH=a#b # trailing\n',
    'NO_EQUALS\n=only\n==\nexport=1\nexport export=2\n',
  ];
  for (const [index, text] of corpus.entries()) {
    const mine = new Set(envTextKeys(text));
    if (parseEnvText) {
      const theirs = new Set(parseEnvText(text).names);
      const missing = [...theirs].filter(name => !mine.has(name)), extra = [...mine].filter(name => !theirs.has(name));
      check(`env parity with run.mjs parseEnvText, sample ${index + 1}`, !missing.length && !extra.length, `missing ${missing.join(',') || '-'}, extra ${extra.join(',') || '-'}`);
    }
  }
  const names = new Set(corpus.flatMap(text => envTextKeys(text)));
  for (const name of ['1DIGIT', '.DOT', '-DASH', 'mixed.name-1', 'EXPORTED', 'COLON', 'SPLIT', 'TABBED', 'CRLF', 'CR_ONLY', 'MULTI', 'AFTER', 'INNER_LOOKS_LIKE_KEY', 'COLON_NO_SPACE', 'EMPTY']) {
    check(`env key found: ${name}`, names.has(name));
  }
  check('env BOM before the first key is not part of its name', names.has('BOM_FIRST'));
  check('env commented line is not a key', !names.has('COMMENTED') && !names.has('# COMMENTED'));
  // Values are compared, never printed.
  const env = e2eEnv({ PATH: 'keep', ANTHROPIC_API_KEY: 'x', '1DIGIT': 'x', '.DOT': 'x', '-DASH': 'x' }, { fileKeys: ['1DIGIT', '.DOT', '-DASH'] });
  check('e2eEnv blanks file keys with digit/dot/dash names and keeps PATH', env['1DIGIT'] === '' && env['.DOT'] === '' && env['-DASH'] === '' && env.ANTHROPIC_API_KEY === '' && env.PATH === 'keep');
}

async function main() {
  const { values } = parseArgs({ options: { serve: { type: 'string' }, port: { type: 'string', default: '3210' } } });
  if (values.serve) {
    const fake = await startFakeApp(values.serve, { port: Number(values.port) });
    console.log(`[selftest] fake "${values.serve}" app on ${fake.origin} (${JSON.stringify(MODES[values.serve])}); Ctrl+C to stop`);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => fake.close().then(() => process.exit(0)));
    return;
  }
  await identityChecks();
  await ledgerChecks();
  await envChecks();
  const failed = results.filter(item => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

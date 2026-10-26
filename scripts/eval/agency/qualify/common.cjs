/* eslint-disable @typescript-eslint/no-require-imports -- Paid agency qualification harness: loads the app's own TypeScript modules so the real code paths, the real spend gate and the real provider are measured. */
'use strict';
/*
 * Shared plumbing for the owner-approved paid agency qualification
 * (ledger scope "agency-qualification-20261024"). Nothing here is used by the app.
 *
 * Safety rules enforced in code:
 * - Database: only the isolated release-auth stack (API 127.0.0.1:55435, DB 127.0.0.1:55438).
 * - Network: an allowlist wraps fetch (Anthropic, OpenAI, the isolated API, local fixture servers).
 * - Money: every paid step reserves its worst-case bound in the shared budget ledger under the
 *   scope AND inside its per-test cap first (scoped budget.mjs, EVAL_BUDGET_MODULE), then enables
 *   the stack's live provider limits at (today's use + that bound), runs through the app's own
 *   RunSpend -> makeborne_ai_operation_provider_begin -> open_provider_call gate, disables the
 *   limits again (read back), and settles the ledger with the gate's own settled records.
 * - Keys: read from the primary checkout's .env.local into this process only; never printed.
 * - Qualification settings exist only in this process (injected registries), never in code defaults.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID, createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const PRIMARY = process.env.MAKEBORNE_PRIMARY_CHECKOUT || (/[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO) ? path.resolve(REPO, '..', '..', '..') : REPO);
const STACK_DIR = path.join(PRIMARY, 'work', 'release-auth-stack');
const SCOPE = 'agency-qualification-20261024';
const API = 'http://127.0.0.1:55435';
const ACTOR_FIXTURE = path.join(STACK_DIR, 'quality-fixture.json');

/** Per-test caps (owner approval, 24 Oct 2026). Kinds are this harness's ledger kinds. */
const TESTS = Object.freeze({
  ingest: { kind: 'agency-qual-ingest', caps: { anthropic: 2 } },
  data: { kind: 'agency-qual-data', caps: { anthropic: 3 } },
  research: { kind: 'agency-qual-research', caps: { anthropic: 4.5 } },
  review: { kind: 'agency-qual-review', caps: { anthropic: 5 } },
  image: { kind: 'agency-qual-image', caps: { openai: 6.5, anthropic: 0.5 } },
});

class CapStop extends Error { constructor(message) { super(message); this.code = 'TEST_CAP_REACHED'; } }

// ---------------------------------------------------------------------------
// Environment (test process only)
// ---------------------------------------------------------------------------
function readEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function stack() {
  const status = JSON.parse(fs.readFileSync(path.join(STACK_DIR, 'status.json'), 'utf8'));
  const db = new URL(status.DB_URL);
  if (status.API_URL !== API || db.hostname !== '127.0.0.1' || db.port !== '55438' || db.pathname !== '/postgres') throw new Error('Refusing: the stack is not the isolated release-auth stack.');
  if (!String(status.SECRET_KEY).startsWith('sb_secret_') || !String(status.PUBLISHABLE_KEY).startsWith('sb_publishable_')) throw new Error('Unexpected stack key format.');
  return { api: status.API_URL, dbUrl: status.DB_URL, secret: status.SECRET_KEY, publishable: status.PUBLISHABLE_KEY };
}

let configured = null;
/** Sets the test-process env (flags, isolated stack, provider keys) before any app module loads. */
function configure({ flags = {} } = {}) {
  if (configured) return configured;
  const s = stack();
  const keys = readEnvFile(path.join(PRIMARY, '.env.local'));
  if (!keys.ANTHROPIC_API_KEY || !keys.OPENAI_API_KEY) throw new Error('Provider keys missing from the primary checkout .env.local.');
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: s.api, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: s.publishable, SUPABASE_SECRET_KEY: s.secret,
    ANTHROPIC_API_KEY: keys.ANTHROPIC_API_KEY, OPENAI_API_KEY: keys.OPENAI_API_KEY,
    // Both agency switches: the master switch and the kinds this qualification exercises (task.ts enabledAgencyKinds).
    MAKEBORNE_AGENCY_TASKS: 'on', MAKEBORNE_AGENCY_TASK_KINDS: 'research,data_report,image_edit,independent_review', NODE_ENV: process.env.NODE_ENV || 'test',
    ...flags,
  });
  for (const name of ['MAKEBORNE_AI_COST_USD_PER_CREDIT', 'MAKEBORNE_USD_PER_CREDIT', 'MAKEBORNE_BUILDER_FALLBACK_MODELS']) delete process.env[name];
  guardNetwork();
  installLoader();
  const fixture = JSON.parse(fs.readFileSync(ACTOR_FIXTURE, 'utf8'));
  if (!/@example\.invalid$/.test(fixture.email)) throw new Error('Fixture account must be a local example.invalid address.');
  configured = { stack: s, actor: fixture.userId, workspaceId: fixture.workspaceId };
  return configured;
}

// Network allowlist: providers, the isolated API, loopback fixture servers. Anything else throws.
const allowedHosts = new Set(['api.anthropic.com', 'api.openai.com']);
const loopbackPorts = new Set(['55435']);
function allowLoopbackPort(port) { loopbackPorts.add(String(port)); }
let networkGuarded = false;
const networkLog = [];
function guardNetwork() {
  if (networkGuarded) return;
  networkGuarded = true;
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const ok = allowedHosts.has(url.hostname) || (url.hostname === '127.0.0.1' && loopbackPorts.has(url.port));
    networkLog.push({ host: url.hostname, port: url.port, ok });
    if (!ok) throw new Error(`Network access refused by the qualification harness: ${url.hostname}:${url.port}`);
    return real(input, init);
  };
}

// TypeScript loader for src/ (same approach as scripts/eval/lib/app-modules.cjs).
let loaderInstalled = false;
function installLoader() {
  if (loaderInstalled) return;
  loaderInstalled = true;
  const ts = require(path.join(REPO, 'node_modules', 'typescript'));
  const load = Module._load;
  Module._load = function patched(name, parent, isMain) {
    if (name === 'server-only') return {};
    if (name === 'next/headers') return { headers: async () => new Headers(), cookies: async () => ({ getAll: () => [], set() {} }) };
    return load.call(this, name, parent, isMain);
  };
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function patchedResolve(request, parent, ...rest) {
    if (typeof request === 'string' && request.startsWith('@/')) request = path.join(REPO, 'src', request.slice(2));
    return resolve.call(this, request, parent, ...rest);
  };
  const compile = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
  require.extensions['.ts'] = compile;
  require.extensions['.tsx'] = compile;
}
const app = relative => { installLoader(); return require(path.join(REPO, relative)); };

// ---------------------------------------------------------------------------
// Qualification settings (injected; the committed AGENCY_SETTINGS stay unqualified)
// ---------------------------------------------------------------------------
/** The committed "standard" profile with only qualifiedKinds (and the per-test turn/output limits) changed. */
function testSetting(kind, { maxTurns = 3, maxOutputTokens = 8000 } = {}) {
  const { AGENCY_SETTINGS } = app('src/lib/agency/task.ts');
  const base = AGENCY_SETTINGS.find(item => item.profile === 'standard');
  return Object.freeze([Object.freeze({ ...base, maxTurns, maxOutputTokens, qualifiedKinds: Object.freeze([kind]),
    evidence: `TEST ONLY (qualification run ${SCOPE}); not a committed default.` })]);
}

// ---------------------------------------------------------------------------
// Budget ledger (scoped allowances)
// ---------------------------------------------------------------------------
let budgetModule = null;
async function budget() {
  if (budgetModule) return budgetModule;
  const file = process.env.EVAL_BUDGET_MODULE;
  if (!file) throw new Error('Set EVAL_BUDGET_MODULE to a budget.mjs with scoped allowances (reserveScoped/scopeSummary) whose outputs/eval resolves to the primary checkout.');
  budgetModule = await import(pathToFileURL(path.resolve(file)).href);
  if (typeof budgetModule.reserveScoped !== 'function' || typeof budgetModule.scopeSummary !== 'function') throw new Error('That budget module has no scoped allowances.');
  const summary = budgetModule.scopeSummary(SCOPE);
  if (summary.scope !== SCOPE || summary.providerCapsUsd?.anthropic !== 15 || summary.providerCapsUsd?.openai !== 6.5) throw new Error('Unexpected scope allowance; refusing.');
  return budgetModule;
}
const micro = usd => Math.round(usd * 1e6);
function testCommitted(b, test, provider) {
  return b.ledgerEntries({ kind: TESTS[test].kind }).filter(entry => entry.scope === SCOPE && (entry.provider ?? 'anthropic') === provider)
    .reduce((sum, entry) => sum + (entry.status === 'settled' ? entry.actualMicrousd : entry.boundMicrousd), 0);
}
async function testSpend(test) {
  const b = await budget();
  return Object.fromEntries(Object.keys(TESTS[test].caps).map(provider => [provider, testCommitted(b, test, provider) / 1e6]));
}
/** Throws CapStop when one more call of this bound would not fit the per-test cap. */
async function assertFits(test, provider, boundUsd) {
  const b = await budget();
  const cap = TESTS[test].caps[provider];
  if (typeof cap !== 'number') throw new CapStop(`${test} has no ${provider} allowance`);
  const committed = testCommitted(b, test, provider);
  if (!(committed + micro(boundUsd) <= micro(cap))) throw new CapStop(`${test} ${provider} cap $${cap}: $${(committed / 1e6).toFixed(4)} committed + $${boundUsd.toFixed(4)} bound would exceed it`);
  if (!b.fitsScoped(SCOPE, boundUsd, provider)) throw new CapStop(`scope ${SCOPE} ${provider} allowance would be exceeded`);
}

// ---------------------------------------------------------------------------
// Isolated database: provider limits, gate records, fixtures
// ---------------------------------------------------------------------------
let pgClient = null;
async function db() {
  if (pgClient) return pgClient;
  const pg = require(path.join(REPO, 'node_modules', 'pg'));
  pgClient = new pg.Client({ connectionString: stack().dbUrl, application_name: 'makeborne-agency-qualification', connectionTimeoutMillis: 5000 });
  await pgClient.connect();
  return pgClient;
}
async function sql(text, args = []) { return (await (await db()).query(text, args)).rows; }
async function closeDb() { if (pgClient) { await pgClient.end().catch(() => undefined); pgClient = null; } }

let runCommitted = 0;
const LIMIT_SCOPES = ['global', 'anthropic', 'openai'];
async function limitsState() {
  return sql('select scope, enabled, emergency_stop, daily_limit_microusd::text l, note from makeborne_private.live_provider_limits where scope = any($1) order by scope', [LIMIT_SCOPES]);
}
/** Enabled: limit = (today's spend + reservations) + bound for global and the provider. Disabled: every scope off (read back). */
async function setLimits({ enabled, provider, boundUsd = 0, bounds = null, note }) {
  if (enabled) {
    const perProvider = bounds ?? { [provider]: boundUsd };
    const before = await limitsState();
    if (before.some(row => row.enabled)) throw new Error(`Provider limits are already enabled by someone else (${before.filter(row => row.enabled).map(row => row.scope).join(', ')}); refusing to share the stack.`);
    if (before.some(row => row.emergency_stop)) throw new Error(`A provider emergency stop is set (${before.filter(row => row.emergency_stop).map(row => row.scope).join(', ')}).`);
    const now = new Date();
    const toMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
    if (toMidnight < 15 * 60_000) throw new Error('Within 15 minutes of 00:00 UTC (daily limits reset); wait.');
    const scopes = { global: Object.values(perProvider).reduce((sum, value) => sum + value, 0), ...perProvider };
    for (const [scope, bound] of Object.entries(scopes)) {
      const [day] = await sql("select coalesce(sum(spent_microusd + reserved_microusd), 0)::text used from makeborne_private.live_provider_days where scope = $1 and day = (now() at time zone 'utc')::date", [scope]);
      const limit = Number(day.used) + micro(bound);
      await sql('select makeborne_private.set_live_provider_limit($1, true, $2, false, $3)', [scope, limit, note]);
    }
    const back = await limitsState();
    if (!Object.keys(scopes).every(scope => back.find(row => row.scope === scope)?.enabled)) throw new Error('Provider limits did not read back enabled.');
    return back;
  }
  for (const scope of LIMIT_SCOPES) await sql('select makeborne_private.set_live_provider_limit($1, false, 0, false, $2)', [scope, note]);
  const back = await limitsState();
  if (back.some(row => row.enabled)) throw new Error(`Provider limits did not read back DISABLED: ${JSON.stringify(back)}`);
  return back;
}

/** The gate's own records for one step: every live_provider_calls row of this actor created in the window. */
async function gateRows(actor, sinceIso) {
  return sql(`select id::text, run_reference, provider, model, bound_microusd::text bound, actual_microusd::text actual, partial_microusd::text partial, charged_microusd::text charged,
      status, overrun, created_at, resolved_at, detail from makeborne_private.live_provider_calls where user_id = $1 and created_at >= $2 order by created_at`, [actor, sinceIso]);
}
function gateTotals(rows) {
  let confirmed = 0, uncertain = 0;
  for (const row of rows) {
    if (row.status === 'settled' || row.status === 'reconciled') confirmed += Number(row.actual ?? 0);
    else { confirmed += Number(row.partial ?? 0); uncertain += Math.max(0, Number(row.bound) - Number(row.partial ?? 0)); }
  }
  return { calls: rows.length, confirmedMicrousd: confirmed, uncertainMicrousd: uncertain, totalMicrousd: confirmed + uncertain,
    statuses: [...new Set(rows.map(row => row.status))], overrun: rows.some(row => row.overrun) };
}

/**
 * One paid step: per-test cap, ledger reservation, provider limits on, the step, limits off,
 * gate records, ledger settlement. Returns { value, error, gate, rows, reservationId }.
 */
async function paidStep(ctx, { test, provider = 'anthropic', boundUsd, bounds = null, ref, note }, fn) {
  const b = await budget();
  const perProvider = bounds ?? { [provider]: boundUsd };
  // Optional cap for this invocation (QUAL_RUN_CAP_USD): what it has settled plus this step's bound must fit.
  const runCap = Number(process.env.QUAL_RUN_CAP_USD) || null;
  const stepBound = Object.values(perProvider).reduce((sum, value) => sum + micro(value), 0);
  if (runCap && !(runCommitted + stepBound <= micro(runCap))) throw new CapStop(`run cap ${runCap}: ${(runCommitted / 1e6).toFixed(4)} settled + ${(stepBound / 1e6).toFixed(4)} bound would exceed it`);
  for (const [name, bound] of Object.entries(perProvider)) await assertFits(test, name, bound);
  const reservations = {};
  for (const [name, bound] of Object.entries(perProvider)) reservations[name] = await b.reserveScoped({ scope: SCOPE, kind: TESTS[test].kind, ref, boundUsd: bound, note: note ?? null, provider: name });
  const [{ now: since }] = await sql('select (clock_timestamp() - interval \'1 second\') as now');
  let value, error = null, limitsOff = null;
  try {
    await setLimits({ enabled: true, bounds: perProvider, note: `Agency qualification ${test} ${ref}: on for one step` });
    value = await fn();
  } catch (caught) { error = caught; }
  finally {
    try { limitsOff = await setLimits({ enabled: false, note: `Agency qualification ${test} ${ref}: off after the step` }); }
    catch (caught) { error = error ?? caught; console.error(`LIMITS: ${caught.message}`); }
  }
  // Give a late finish a moment to land, then read the gate.
  let rows = await gateRows(ctx.actor, since);
  if (rows.some(row => row.status === 'open')) { await new Promise(resolve => setTimeout(resolve, 3000)); rows = await gateRows(ctx.actor, since); }
  const gate = gateTotals(rows);
  const ledger = {}, byProvider = {};
  for (const [name, reservationId] of Object.entries(reservations)) {
    const own = rows.filter(row => row.provider === name);
    const totals = gateTotals(own);
    byProvider[name] = totals;
    const settled = await b.settle(reservationId, { actualUsd: totals.totalMicrousd / 1e6, detail: { gateCalls: totals.calls, confirmedMicrousd: totals.confirmedMicrousd, uncertainMicrousd: totals.uncertainMicrousd, statuses: totals.statuses, overrun: totals.overrun, callIds: own.map(row => row.id).slice(0, 12) } });
    ledger[name] = { status: settled.status, actualMicrousd: settled.actualMicrousd, boundMicrousd: settled.boundMicrousd, overrun: settled.overrun ?? false };
  }
  runCommitted += gate.totalMicrousd;
  const foreign = rows.filter(row => !reservations[row.provider]);
  if (foreign.length) console.error(`WARNING: ${foreign.length} gate row(s) for providers without a reservation in this step`);
  const single = Object.keys(reservations).length === 1 ? ledger[Object.keys(reservations)[0]] : ledger;
  return { value, error, gate, byProvider, rows, reservations, ledger: single, limitsOff };
}

// ---------------------------------------------------------------------------
// Instrumented provider clients (usage + latency per provider attempt; the app's budgeting is unchanged)
// ---------------------------------------------------------------------------
function anthropicClient(log, timeout = 120_000) {
  const Anthropic = require(path.join(REPO, 'node_modules', '@anthropic-ai', 'sdk')).default;
  const client = new Anthropic({ maxRetries: 0, timeout });
  return { beta: { messages: {
    countTokens: (params, options) => client.beta.messages.countTokens(params, options),
    stream(params, options) {
      const started = Date.now();
      const stream = client.beta.messages.stream(params, options);
      const original = stream.finalMessage.bind(stream);
      stream.finalMessage = async () => {
        try {
          const message = await original();
          log.push({ provider: 'anthropic', model: message.model, maxTokens: params.max_tokens, usage: message.usage, stop: message.stop_reason, ms: Date.now() - started,
            toolUses: message.content.filter(block => block.type === 'tool_use').map(block => block.name) });
          return message;
        } catch (error) { log.push({ provider: 'anthropic', error: String(error?.status ?? error?.message ?? error).slice(0, 200), ms: Date.now() - started }); throw error; }
      };
      return stream;
    },
  } } };
}
/** Records each turn's tool calls (names + submitted result) around a ModelPort. */
function observedPort(port, turns) {
  return async request => {
    const turn = await port(request);
    turns.push({ stopReason: turn.stopReason, tools: turn.content.filter(block => block.type === 'tool_use').map(block => ({ name: block.name, input: block.input })),
      text: turn.content.filter(block => block.type === 'text').map(block => block.text).join('\n').slice(0, 4000) });
    return turn;
  };
}

// ---------------------------------------------------------------------------
// Fixture rows on the isolated stack (all titled "Agency qualification 2026-10-24 …")
// ---------------------------------------------------------------------------
const LABEL = 'Agency qualification 2026-10-24';
async function ensureClient(workspaceId, name, { company = name, website = null } = {}) {
  const existing = await sql('select id from public.clients where workspace_id = $1 and name = $2 and notes = $3', [workspaceId, name, LABEL]);
  if (existing[0]) return existing[0].id;
  const [row] = await sql('insert into public.clients (workspace_id, name, company, website, notes) values ($1, $2, $3, $4, $5) returning id', [workspaceId, name, company, website, LABEL]);
  return row.id;
}
/** A project + artifact + version 1 (content given). Returns ids and the version row id. */
async function createArtifact(workspaceId, { title, kind, projectKind = kind === 'presentation' ? 'presentation' : kind, clientId = null, content, actor }) {
  const [project] = await sql('insert into public.projects (workspace_id, client_id, title, kind, brief) values ($1, $2, $3, $4, $5) returning id', [workspaceId, clientId, `${LABEL}: ${title}`.slice(0, 200), projectKind, 'Qualification fixture (generated in the harness).']);
  const [artifact] = await sql('insert into public.artifacts (workspace_id, project_id, kind, title, current_version) values ($1, $2, $3, $4, 0) returning id', [workspaceId, project.id, kind, `${LABEL}: ${title}`.slice(0, 200)]);
  const version = await addVersion(workspaceId, artifact.id, 1, content, actor);
  return { projectId: project.id, artifactId: artifact.id, versionId: version.id, version: 1 };
}
async function addVersion(workspaceId, artifactId, number, content, actor) {
  const [version] = await sql(`insert into public.artifact_versions (workspace_id, artifact_id, version_number, content, style_snapshot, change_summary, created_by)
    values ($1, $2, $3, $4::jsonb, '{}'::jsonb, $5, $6) returning id`, [workspaceId, artifactId, number, JSON.stringify(content), `${LABEL} fixture v${number}`, actor]);
  await sql('update public.artifacts set current_version = $2 where id = $1', [artifactId, number]);
  return version;
}
async function addAsset(workspaceId, projectId, { bytes, contentType, name }) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const ext = (name.split('.').pop() || 'bin').toLowerCase();
  const [row] = await sql(`insert into public.assets (workspace_id, project_id, object_path, content_type, sha256, provenance) values ($1, $2, $3, $4, $5, $6::jsonb) returning id`,
    [workspaceId, projectId, `${workspaceId}/${projectId}/sources/${sha256}.${ext}`, contentType, sha256, JSON.stringify({ kind: 'qualification_fixture', name, label: LABEL })]);
  return { assetId: row.id, sha256 };
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
const RESULTS = path.join(PRIMARY, 'outputs', 'eval', 'agency-qualification', '20261024');
function resultsDir(test) { const dir = path.join(RESULTS, test); fs.mkdirSync(dir, { recursive: true }); return dir; }
function appendJsonl(test, row) { fs.appendFileSync(path.join(resultsDir(test), 'results.jsonl'), `${JSON.stringify(row)}\n`); }
function writeJson(test, name, value) { fs.writeFileSync(path.join(resultsDir(test), name), `${JSON.stringify(value, null, 2)}\n`); }
const usd = microusd => Math.round(Number(microusd)) / 1e6;
const sha = value => createHash('sha256').update(value).digest('hex');

module.exports = {
  REPO, PRIMARY, SCOPE, TESTS, CapStop, configure, app, testSetting, budget, testSpend, assertFits, paidStep, setLimits, limitsState, gateRows, gateTotals,
  anthropicClient, observedPort, sql, closeDb, ensureClient, createArtifact, addVersion, addAsset, appendJsonl, writeJson, resultsDir, usd, sha, randomUUID,
  allowLoopbackPort, networkLog, LABEL,
};

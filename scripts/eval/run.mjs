#!/usr/bin/env node
// Budgeted generation runner for the golden set (scripts/eval/README.md).
//
//   node scripts/eval/run.mjs                      dry run: preflight + budget plan, no paid calls
//   node scripts/eval/run.mjs --fixtures [--include-redesign]
//                                                  export existing generated projects (read-only)
//   node scripts/eval/run.mjs --live --approval "<who/when>" [--only <briefId>] [--max <n>] [--images] [--rerun] [--plan]
//                                                  websites run in Create mode (the studio default); --plan runs Plan mode first
//                                                  generate through the app's own routes (PAID)
//   node scripts/eval/run.mjs --selftest-live      live-path safety checks with fakes (free)
//   --image-models a,b (with --images): the server's ordered image allowlist (MAKEBORNE_IMAGE_MODELS) when .env.local names no model
//   --enhance (with --live, websites in Create mode): the studio's enhanced-brief step first: POST /api/build/enhance
//     (its own eval reservation, kind runner-enhancer, at the 1-credit hold; settled from the provider-call ledger by the
//     durable action's Idempotency-Key), then the build with { brief: { mode: "enhanced", text } }, as the studio's Start building does.
//   --route <class>=<model>[,...] (with --live): the server runs with MAKEBORNE_MODEL_ROUTING=on and MAKEBORNE_ROUTE_<CLASS>=<model>
//     (src/lib/ai/model-routing.ts); without it routing is explicitly off. --scope <scope>: every reservation is booked inside that
//     owner-approved scoped allowance of the shared ledger (lib/budget.mjs reserveScoped) instead of the design cap.
//
// The live path drives the same HTTP routes, in the same order, with the same
// bodies as the studio (src/components/live-builder.tsx): plan -> approved
// build -> up to MAX_CONTINUATIONS continuations -> AUTO_REVIEW_ROUNDS review
// rounds whose screenshots are captured with the studio's own captureDesign().
// It refuses to start unless the preflight is green, EVAL_SPEND_APPROVED=yes
// is set, an approval text is given, port 3211 is free and no selected brief
// already has a runner ledger entry (--rerun overrides that); every brief
// reserves its worst-case bound in lib/budget.mjs before its first paid call,
// opens the provider limits for that bound only, closes them after the brief,
// and is settled only once the server has finished its runs. Ctrl+C, SIGTERM,
// SIGBREAK, SIGHUP and crashes run the same cleanup once; a watchdog covers a
// hard kill. Nothing is retried.
import path from 'node:path';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, createWriteStream, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { REPO, RUNS, BRIEFS_DIR, ensureDir, isLintable, writeJson, rel, stamp } from './lib/paths.mjs';
import { isolatedStack, qualityFixture, assertLocalOrigin, API, DB_PORT } from './lib/stack.mjs';
import { CapReached, DuplicateReservation, TEST_ROOT_ENV, capUsd as designCapUsd, ensureLedger, fits as designFits, fitsScoped, isTestBudget, ledgerEntries, reserve as designReserve, reserveScoped, scopeSummary, settle, summary as designSummary } from './lib/budget.mjs';
import { readSse, lastOperation } from './lib/sse.mjs';
import { captureForReview, describeCapture, saveShots, selfTest as captureSelfTest } from './lib/capture-review.mjs';
import { exportFixtures, exportRedesigns, withReadOnly } from './lib/fixtures.mjs';

// EVAL_BUDGET_SCOPE: book this run against a recorded scoped allowance (a capApprovals record with `scope` and
// `allowance`, see lib/budget.mjs recordScopedAllowance) instead of the design cap. Every reservation then carries
// the scope and must fit that allowance and the ledger-wide caps; an unrecorded scope refuses before any paid call.
const BUDGET_SCOPE = process.env.EVAL_BUDGET_SCOPE?.trim() || null;
const reserve = BUDGET_SCOPE ? args => reserveScoped({ provider: 'anthropic', ...args, scope: BUDGET_SCOPE }) : designReserve;
const fits = BUDGET_SCOPE ? bound => fitsScoped(BUDGET_SCOPE, bound) : designFits;
const budgetSummary = BUDGET_SCOPE ? () => { const scoped = scopeSummary(BUDGET_SCOPE); return { ...scoped, capUsd: scoped.allowanceUsd }; } : designSummary;
const capUsd = BUDGET_SCOPE ? () => budgetSummary().capUsd : designCapUsd;

const require = createRequire(import.meta.url);
const { loadApp } = require('./lib/app-modules.cjs');

/** The golden set's frozen effort; --effort high runs a comparison round at High (its own bound from BUILDER_EFFORT). */
export const DEFAULT_EFFORT = 'medium';
export const EFFORTS = Object.freeze(['medium', 'high']);
export let EFFORT = DEFAULT_EFFORT;
export function setEffort(value) {
  if (!EFFORTS.includes(value)) throw new Error(`--effort must be one of ${EFFORTS.join(', ')}`);
  EFFORT = value;
}
/** next dev bundler: Turbopack (Next's default) or webpack (needed in worktrees whose node_modules is a junction). */
let BUNDLER = 'turbopack';
/** --image-models: the ordered image allowlist for this run's server (MAKEBORNE_IMAGE_MODELS), when .env.local names none. */
let IMAGE_MODELS = '';
/** --route: per-class model routes for this run's server ({ 'new-site': 'claude-sonnet-5-5' }); null = routing off. */
let ROUTES = null;
/** --scope: the scoped allowance every reservation is booked in; null = the design cap. */
let SCOPE = null;
const routeEnv = () => ROUTES ? { MAKEBORNE_MODEL_ROUTING: 'on', ...Object.fromEntries(Object.entries(ROUTES).map(([taskClass, model]) => [`MAKEBORNE_ROUTE_${taskClass.toUpperCase().replace(/-/g, '_')}`, model])) } : { MAKEBORNE_MODEL_ROUTING: 'off' };
/**
 * The .env.local the runner reads ANTHROPIC_API_KEY / OPENAI_API_KEY / MAKEBORNE_IMAGE_MODEL from
 * (only into its own server process). A git worktree has none of its own: EVAL_ENV_LOCAL names the
 * primary checkout's file instead of copying keys into the worktree. Values are never printed or stored.
 */
export function envLocalFile(env = process.env) {
  const raw = env.EVAL_ENV_LOCAL?.trim();
  if (!raw) return path.join(REPO, '.env.local');
  if (!path.isAbsolute(raw) || path.basename(raw) !== '.env.local') throw new Error('EVAL_ENV_LOCAL must be an absolute path to a file named .env.local');
  return raw;
}
export const NEXT_PORT = 3211;
const ORIGIN = `http://127.0.0.1:${NEXT_PORT}`;
const ENV_FILES_NEXT_LOADS = ['.env', '.env.local', '.env.development', '.env.development.local'];
const STAGE_TIMEOUT_MS = 360_000; // route maxDuration is 300 s
const REQUEST_TIMEOUT_MS = 120_000; // session.fetch default (create project/artifact, plan PUT)
const CAPTURE_TIMEOUT_MS = 180_000; // captureForReview's page timeout, per review capture
const SETUP_MARGIN_MS = 120_000; // ledger lock wait (60 s) + provider-limit writes
const MAX_MIDNIGHT_WAIT_MS = 2 * 3_600_000;
const CONTINUE_PREFIX = 'Continue the previous request and complete everything that is still missing, then check the project and call finish. The previous request was:\n';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const usd = microusd => Math.round(Number(microusd)) / 1e6;
const money = value => (value === null || value === undefined ? 'n/a' : `$${Number(value).toFixed(2)}`);

// ===========================================================================
// Briefs manifest
// ===========================================================================

/** Read scripts/eval/briefs/index.json and verify every brief file's SHA-256. */
/** Which frozen set the runner uses: the golden set, or the short-prompt set (scripts/eval/briefs-short) with --briefs short. */
let BRIEF_SET_DIR = BRIEFS_DIR;
export function loadBriefs() {
  const file = path.join(BRIEF_SET_DIR, 'index.json');
  if (!existsSync(file)) {
    return { ok: false, present: false, message: `No brief manifest at ${rel(file)} yet (written by the briefs builder); the budget plan cannot be computed.`, items: [] };
  }
  const raw = readFileSync(file);
  const index = JSON.parse(raw.toString('utf8'));
  const order = Array.isArray(index.order) ? index.order : Object.keys(index.sha256 ?? {});
  const items = [], problems = [];
  for (const [position, id] of order.entries()) {
    const briefFile = path.join(BRIEF_SET_DIR, `${id}.json`);
    if (!existsSync(briefFile)) { problems.push(`${id}: file missing`); continue; }
    const bytes = readFileSync(briefFile);
    const actual = sha256(bytes);
    const expected = index.sha256?.[id] ?? null;
    if (actual !== expected) problems.push(`${id}: sha256 ${expected ? 'mismatch' : 'not recorded'} (file ${actual.slice(0, 12)}…)`);
    const brief = JSON.parse(bytes.toString('utf8'));
    if (brief.id !== id) problems.push(`${id}: file id is ${brief.id}`);
    if (!['website', 'presentation', 'book'].includes(brief.format)) problems.push(`${id}: unknown format ${brief.format}`);
    if (typeof brief.brief !== 'string' || !brief.brief.trim()) problems.push(`${id}: empty brief`);
    items.push({ id, priority: brief.order ?? position + 1, kind: brief.format, title: brief.title, direction: brief.direction, shared: Boolean(brief.shared),
      sha256: actual, hashOk: actual === expected, chars: brief.brief?.length ?? 0, file: briefFile, brief: brief.brief, simulatedAnswers: brief.simulatedAnswers ?? null });
  }
  items.sort((a, b) => a.priority - b.priority);
  if (index.count !== undefined && index.count !== order.length) problems.push(`index count ${index.count} != ${order.length} ids in order`);
  if (index.effort && index.effort !== DEFAULT_EFFORT) problems.push(`index effort ${index.effort} != runner effort ${EFFORT}`);
  return { ok: problems.length === 0 && items.length > 0, present: true, file: rel(file), indexSha256: sha256(raw), frozenAt: index.frozenAt ?? null,
    count: items.length, byKind: countBy(items, item => item.kind), problems, items };
}

function countBy(list, key) {
  const counts = {};
  for (const item of list) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

// ===========================================================================
// Pricing, read from the app's code
// ===========================================================================

/**
 * Worst-case provider dollars per brief, from the code that enforces them:
 * - build/continuations/review share ONE operation whose cumulative cap is
 *   BUILDER_EFFORT[effort].ceilingCredits (ai_operation_begin grants
 *   least(stage_cap, authorized - charged - reserved); provider_begin refuses
 *   any call that would take the operation above authorized * rate);
 * - the plan is a separate operation capped at PLAN_CEILING_CREDITS;
 * - rate = aiCostUsdPerCredit() (the runner pins it in the server env).
 */
export function pricingFromCode() {
  const pricing = loadApp('src/lib/builder/pricing.ts');
  const { PLAN_CEILING_CREDITS } = loadApp('src/lib/builder/plan.ts');
  const policy = loadApp('src/lib/builder/review-policy.ts');
  const rate = pricing.aiCostUsdPerCredit({});
  const build = pricing.BUILDER_EFFORT[EFFORT].ceilingCredits;
  const review = policy.reviewCreditCeiling(build);
  const migration = readFileSync(path.join(REPO, 'supabase', 'migrations', '20261013150000_cumulative_ai_operations.sql'), 'utf8');
  const cumulative = migration.includes('n:=least(p_stage_cap,o.authorized_credits-o.charged_credits-o.reserved_credits)')
    && migration.includes('used+p_bound>o.authorized_credits*o.rate_microusd');
  // If the SQL evidence ever changes, fall back to counting the review stage on top.
  // Create mode (the studio default) runs no plan; --plan adds the separate plan operation.
  const createCredits = build + (cumulative ? 0 : review);
  const websiteCredits = createCredits + PLAN_CEILING_CREDITS;
  const liveBuilder = readFileSync(path.join(REPO, 'src', 'components', 'live-builder.tsx'), 'utf8');
  const maxContinuations = Number(/const MAX_CONTINUATIONS = (\d+);/.exec(liveBuilder)?.[1] ?? 2);
  const agent = readFileSync(path.join(REPO, 'src', 'lib', 'builder', 'agent.ts'), 'utf8');
  return {
    effort: EFFORT, costPerCreditUsd: rate, costPerCreditDefaultUsd: pricing.DEFAULT_AI_COST_USD_PER_CREDIT,
    buildCeilingCredits: build, planCeilingCredits: PLAN_CEILING_CREDITS, reviewStageCeilingCredits: review,
    autoReviewRounds: policy.AUTO_REVIEW_ROUNDS[EFFORT], maxContinuations, cumulativeOperationCap: cumulative,
    websiteBoundUsd: round2(createCredits * rate), websitePlanBoundUsd: round2(websiteCredits * rate), documentBoundUsd: round2(build * rate),
    builderModelDefault: /MAKEBORNE_BUILDER_MODEL \|\| "([^"]+)"/.exec(agent)?.[1] ?? null,
    note: cumulative
      ? `Website in Create mode (the studio default) = one build operation (${build} cr, shared by continuations and the review stage in SQL) = ${round2(createCredits * rate)}; with --plan add the plan operation (${PLAN_CEILING_CREDITS} cr) = ${round2(websiteCredits * rate)}.`
      : 'Cumulative operation cap not found in the migration: review counted on top (conservative).',
  };
}
const round2 = value => Math.round(value * 100) / 100;
const boundFor = (kind, pricing, withPlan = false) => (kind === 'website' ? (withPlan ? pricing.websitePlanBoundUsd ?? pricing.websiteBoundUsd : pricing.websiteBoundUsd) : pricing.documentBoundUsd);

// ===========================================================================
// Migration audit (which supabase/migrations files are applied on 55438)
// ===========================================================================

/** Split SQL into statements, keeping dollar-quoted bodies and strings intact. */
export function splitStatements(sql) {
  const statements = [];
  let current = '', index = 0;
  const closeQuote = (start, quote) => {
    let at = start + 1;
    while (at < sql.length) {
      if (sql[at] === quote) { if (sql[at + 1] === quote) { at += 2; continue; } return at + 1; }
      at++;
    }
    return sql.length;
  };
  while (index < sql.length) {
    const char = sql[index], next = sql[index + 1];
    if (char === '-' && next === '-') { const end = sql.indexOf('\n', index); index = end < 0 ? sql.length : end; continue; }
    if (char === '/' && next === '*') {
      let depth = 1; index += 2;
      while (index < sql.length && depth) {
        if (sql.startsWith('/*', index)) { depth++; index += 2; } else if (sql.startsWith('*/', index)) { depth--; index += 2; } else index++;
      }
      current += ' '; continue;
    }
    if (char === "'" || char === '"') { const end = closeQuote(index, char); current += sql.slice(index, end); index = end; continue; }
    if (char === '$') {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index, index + 80))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, index + tag.length);
        const stop = end < 0 ? sql.length : end + tag.length;
        current += sql.slice(index, stop); index = stop; continue;
      }
    }
    if (char === ';') { if (current.trim()) statements.push(current.trim()); current = ''; index++; continue; }
    current += char; index++;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const ID = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)`;
const QID = String.raw`${ID}(?:\s*\.\s*${ID})?`;
const unquote = name => name.replace(/"/g, '');
function qualified(text) {
  const parts = text.split('.').map(part => unquote(part.trim()));
  return parts.length === 2 ? { schema: parts[0], name: parts[1] } : { schema: 'public', name: parts[0] };
}
const normalizeBody = body => body.replace(/\s+/g, ' ').trim();

/**
 * Objects one statement creates, replaces, drops or grants on. Function bodies
 * are kept so the audit can tell a later definition from an earlier one.
 */
function statementOps(statement) {
  const head = statement
    .replace(/\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/g, ' $$ ')
    .replace(/'(?:[^']|'')*'/g, "''").toLowerCase().replace(/\s+/g, ' ').trim();
  const ops = [];
  let match;
  const relation = (schemaName, op) => ops.push({ type: 'rel', key: `rel:${schemaName.schema}.${schemaName.name}`, target: schemaName, op });
  if ((match = new RegExp(`^create schema (?:if not exists )?(${ID})`).exec(head))) ops.push({ type: 'sch', key: `sch:${unquote(match[1])}`, target: { name: unquote(match[1]) }, op: 'create' });
  else if ((match = new RegExp(`^create (?:(?:global |local )?(?:temp|temporary|unlogged) )?table (?:if not exists )?(${QID})`).exec(head))) relation(qualified(match[1]), 'create');
  else if ((match = new RegExp(`^create (?:or replace )?(?:materialized )?view (?:if not exists )?(${QID})`).exec(head))) relation(qualified(match[1]), 'create');
  else if ((match = new RegExp(`^create (?:unique )?index (?:concurrently )?(?:if not exists )?(${ID}) on (?:only )?(${QID})`).exec(head))) {
    const table = qualified(match[2]);
    relation({ schema: table.schema, name: unquote(match[1]) }, 'create');
  } else if ((match = new RegExp(`^create (?:or replace )?(?:constraint )?trigger (${ID}) .*? on (${QID})`).exec(head))) {
    const table = qualified(match[2]);
    ops.push({ type: 'trg', key: `trg:${table.schema}.${table.name}.${unquote(match[1])}`, target: { ...table, child: unquote(match[1]) }, op: 'create' });
  } else if ((match = new RegExp(`^create policy (${ID}) on (${QID})`).exec(head))) {
    const table = qualified(match[2]);
    ops.push({ type: 'pol', key: `pol:${table.schema}.${table.name}.${unquote(match[1])}`, target: { ...table, child: unquote(match[1]) }, op: 'create' });
  } else if ((match = new RegExp(`^create type (${QID})`).exec(head))) {
    const type = qualified(match[1]);
    ops.push({ type: 'typ', key: `typ:${type.schema}.${type.name}`, target: type, op: 'create' });
  } else if ((match = new RegExp(`^create (?:or replace )?function (${QID})\\s*\\(`).exec(head))) {
    const fn = qualified(match[1]);
    const body = /\bas\s+(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)([\s\S]*?)\1/i.exec(statement)?.[2];
    ops.push({ type: 'fn', key: `fn:${fn.schema}.${fn.name}`, target: fn, op: 'create', body: body === undefined ? null : normalizeBody(body) });
  } else if ((match = new RegExp(`^alter table (?:if exists )?(?:only )?(${QID}) (.*)$`).exec(head))) {
    const table = qualified(match[1]), rest = match[2];
    for (const column of rest.matchAll(new RegExp(`\\badd column (?:if not exists )?(${ID})`, 'g'))) ops.push({ type: 'col', key: `col:${table.schema}.${table.name}.${unquote(column[1])}`, target: { ...table, child: unquote(column[1]) }, op: 'create' });
    for (const column of rest.matchAll(new RegExp(`\\bdrop column (?:if exists )?(${ID})`, 'g'))) ops.push({ type: 'col', key: `col:${table.schema}.${table.name}.${unquote(column[1])}`, target: { ...table, child: unquote(column[1]) }, op: 'drop' });
    for (const constraint of rest.matchAll(new RegExp(`\\badd constraint (${ID})`, 'g'))) ops.push({ type: 'con', key: `con:${table.schema}.${table.name}.${unquote(constraint[1])}`, target: { ...table, child: unquote(constraint[1]) }, op: 'create' });
    for (const constraint of rest.matchAll(new RegExp(`\\bdrop constraint (?:if exists )?(${ID})`, 'g'))) ops.push({ type: 'con', key: `con:${table.schema}.${table.name}.${unquote(constraint[1])}`, target: { ...table, child: unquote(constraint[1]) }, op: 'drop' });
    const renamed = new RegExp(`^rename to (${ID})`).exec(rest);
    if (renamed) { relation(table, 'drop'); relation({ schema: table.schema, name: unquote(renamed[1]) }, 'create'); }
    const column = new RegExp(`^rename (?:column )?(${ID}) to (${ID})`).exec(rest);
    if (column && !renamed) {
      ops.push({ type: 'col', key: `col:${table.schema}.${table.name}.${unquote(column[1])}`, target: { ...table, child: unquote(column[1]) }, op: 'drop' });
      ops.push({ type: 'col', key: `col:${table.schema}.${table.name}.${unquote(column[2])}`, target: { ...table, child: unquote(column[2]) }, op: 'create' });
    }
  } else if ((match = new RegExp(`^alter function (${QID})\\s*\\([^)]*\\) (rename to|set schema) (${ID})`).exec(head))) {
    const fn = qualified(match[1]);
    ops.push({ type: 'fn', key: `fn:${fn.schema}.${fn.name}`, target: fn, op: 'drop' });
    const moved = match[2] === 'rename to' ? { schema: fn.schema, name: unquote(match[3]) } : { schema: unquote(match[3]), name: fn.name };
    ops.push({ type: 'fn', key: `fn:${moved.schema}.${moved.name}`, target: moved, op: 'create', body: null });
  } else if ((match = new RegExp(`^drop (table|view|materialized view|index|type|function|schema) (?:if exists )?(${QID})`).exec(head))) {
    const target = qualified(match[2]);
    const type = { table: 'rel', view: 'rel', 'materialized view': 'rel', index: 'rel', type: 'typ', function: 'fn', schema: 'sch' }[match[1]];
    ops.push({ type, key: type === 'sch' ? `sch:${target.name}` : `${type}:${target.schema}.${target.name}`, target, op: 'drop' });
  } else if ((match = new RegExp(`^drop (trigger|policy) (?:if exists )?(${ID}) on (${QID})`).exec(head))) {
    const table = qualified(match[3]), type = match[1] === 'trigger' ? 'trg' : 'pol';
    ops.push({ type, key: `${type}:${table.schema}.${table.name}.${unquote(match[2])}`, target: { ...table, child: unquote(match[2]) }, op: 'drop' });
  } else if ((match = new RegExp(`^(grant|revoke) (.+?) on function (${QID})\\s*\\(([^)]*)\\) (to|from) (.+)$`).exec(head))) {
    if (/\b(all|execute)\b/.test(match[2])) {
      const fn = qualified(match[3]);
      const signature = `${fn.schema}.${fn.name}(${match[4].trim()})`;
      for (const role of match[6].split(',').map(entry => entry.trim().replace(/ cascade$| restrict$/, ''))) {
        if (!role || role === 'public') continue;
        ops.push({ type: 'fnpriv', key: `fnpriv:${signature}:${role}`, fnKey: `fn:${fn.schema}.${fn.name}`, target: { signature, role }, op: match[1] === 'grant' ? 'grant' : 'revoke' });
      }
    }
  }
  return ops;
}

/** Load the catalog once and answer every check in memory (fast and error-free). */
async function catalogSnapshot(client) {
  const query = async sql => (await client.query(sql)).rows;
  const user = "n.nspname not in ('pg_catalog','information_schema','pg_toast') and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast_temp%'";
  // One client runs one query at a time (pg deprecates overlapping queries).
  const results = [];
  for (const sql of [
    'select nspname from pg_namespace',
    `select n.nspname s, c.relname r from pg_class c join pg_namespace n on n.oid = c.relnamespace where ${user}`,
    `select n.nspname s, c.relname r, a.attname a from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where ${user} and a.attnum > 0 and not a.attisdropped and c.relkind in ('r','p','v','m','f')`,
    `select n.nspname s, c.relname r, k.conname x from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace where ${user}`,
    `select n.nspname s, c.relname r, t.tgname x from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and ${user}`,
    `select n.nspname s, c.relname r, p.polname x from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace where ${user}`,
    `select n.nspname s, t.typname r from pg_type t join pg_namespace n on n.oid = t.typnamespace where ${user}`,
    `select n.nspname s, p.proname r, p.prosrc b from pg_proc p join pg_namespace n on n.oid = p.pronamespace where ${user}`,
  ]) results.push(await query(sql));
  const [schemas, relations, columns, constraints, triggers, policies, types, functions] = results;
  const set = (rows, key) => new Set(rows.map(key));
  const bodies = new Map();
  for (const row of functions) {
    const key = `${row.s}.${row.r}`;
    if (!bodies.has(key)) bodies.set(key, []);
    bodies.get(key).push(normalizeBody(row.b ?? ''));
  }
  return {
    schemas: set(schemas, row => row.nspname), relations: set(relations, row => `${row.s}.${row.r}`),
    columns: set(columns, row => `${row.s}.${row.r}.${row.a}`), constraints: set(constraints, row => `${row.s}.${row.r}.${row.x}`),
    triggers: set(triggers, row => `${row.s}.${row.r}.${row.x}`), policies: set(policies, row => `${row.s}.${row.r}.${row.x}`),
    types: set(types, row => `${row.s}.${row.r}`), bodies,
    hasFunction: (schema, name) => bodies.has(`${schema}.${name}`),
  };
}

/** Function-privilege checks need the server; each runs in its own savepoint. */
async function functionPrivilege(client, signature, role) {
  await client.query('savepoint eval_privilege');
  try {
    const { rows: [row] } = await client.query(`select case when to_regprocedure($1) is null then null
      when not exists (select 1 from pg_roles where rolname = $2) then null
      else has_function_privilege($2, to_regprocedure($1), 'EXECUTE') end as allowed`, [signature, role]);
    await client.query('release savepoint eval_privilege');
    return row.allowed;
  } catch {
    await client.query('rollback to savepoint eval_privilege');
    return null;
  }
}

/**
 * Decide, per migration file, whether the database holds what it creates.
 * A check only counts when it is evidence for THIS file: an object an earlier
 * file already created proves nothing (only its new body does), and a check is
 * skipped when a LATER file drops (or, for a body, redefines) the object.
 * Grants and revokes are used only for files that create nothing; revokes
 * first, because a grant to a role that PUBLIC already covers always passes.
 * Verdicts: applied | missing | partial (an older revision of the file, or a
 * half-applied one: review before re-running) | unverifiable.
 */
export async function auditMigrations(client) {
  const dir = path.join(REPO, 'supabase', 'migrations');
  const files = readdirSync(dir).filter(name => name.endsWith('.sql')).sort();
  const timeline = new Map();
  const perFile = files.map((file, fileIndex) => {
    const ops = [];
    for (const [statementIndex, statement] of splitStatements(readFileSync(path.join(dir, file), 'utf8')).entries()) {
      for (const op of statementOps(statement)) ops.push({ ...op, at: fileIndex * 100_000 + statementIndex });
    }
    for (const op of ops) {
      if (!timeline.has(op.key)) timeline.set(op.key, []);
      timeline.get(op.key).push(op);
    }
    return { file, ops };
  });
  const later = (key, at, predicate) => (timeline.get(key) ?? []).some(op => op.at > at && predicate(op));
  // Some later migrations patch a function in place inside a DO block:
  //   select pg_get_functiondef('schema.fn(args)'::regprocedure) into definition;
  //   execute replace(definition, 'old', 'new');
  // (20261013180000 raises save_site_v2's manifest limit this way.) The static
  // parser cannot see that, so the newest file body is compared after applying them.
  const rewrites = new Map();
  files.forEach((file, fileIndex) => {
    const text = readFileSync(path.join(dir, file), 'utf8');
    const pattern = /pg_get_functiondef\('([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\([^']*\)'::regprocedure\)[\s\S]{0,600}?replace\(\s*definition\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*\)/gi;
    for (const match of text.matchAll(pattern)) {
      const key = `${match[1]}.${match[2]}`;
      if (!rewrites.has(key)) rewrites.set(key, []);
      rewrites.get(key).push({ fileIndex, file, from: match[3].replace(/''/g, "'"), to: match[4].replace(/''/g, "'") });
    }
  });
  const patchedBody = (op, fileIndex) => (rewrites.get(`${op.target.schema}.${op.target.name}`) ?? [])
    .filter(rewrite => rewrite.fileIndex > fileIndex)
    .reduce((body, rewrite) => body.split(rewrite.from).join(rewrite.to), op.body);
  // Existence is no evidence when an earlier file already created the object,
  // or when this file drops and re-creates it (`drop constraint x; add constraint x`).
  const fileOf = at => Math.floor(at / 100_000);
  const inherited = op => {
    const previous = (timeline.get(op.key) ?? []).filter(other => other.at < op.at).at(-1);
    return previous?.op === 'create' || (previous?.op === 'drop' && fileOf(previous.at) === fileOf(op.at));
  };
  const catalog = await catalogSnapshot(client);
  const has = op => {
    const { schema, name, child } = op.target;
    switch (op.type) {
      case 'sch': return catalog.schemas.has(name);
      case 'rel': return catalog.relations.has(`${schema}.${name}`);
      case 'col': return catalog.columns.has(`${schema}.${name}.${child}`);
      case 'con': return catalog.constraints.has(`${schema}.${name}.${child}`);
      case 'trg': return catalog.triggers.has(`${schema}.${name}.${child}`);
      case 'pol': return catalog.policies.has(`${schema}.${name}.${child}`);
      case 'typ': return catalog.types.has(`${schema}.${name}`);
      case 'fn': return catalog.hasFunction(schema, name);
      default: return null;
    }
  };
  const results = [];
  for (const { file, ops } of perFile) {
    const strong = [], weak = [];
    let superseded = 0, inheritedObjects = 0;
    for (const op of ops) {
      if (op.op === 'create') {
        if (later(op.key, op.at, other => other.op === 'drop')) { superseded++; continue; }
        if (inherited(op)) inheritedObjects++;
        else strong.push({ what: `${op.type} ${op.key.slice(op.type.length + 1)}`, ok: has(op) });
        // The newest definition of a function must match the database body exactly.
        if (op.type === 'fn' && op.body && !later(op.key, op.at, () => true)) {
          // rpc_definer_boundary (20261017080000) moves some public bodies into makeborne_rpc unchanged.
          const candidates = [...(catalog.bodies.get(`${op.target.schema}.${op.target.name}`) ?? []), ...(catalog.bodies.get(`makeborne_rpc.${op.target.name}`) ?? [])];
          const patched = patchedBody(op, fileOf(op.at));
          strong.push({ what: `fn-body ${op.target.schema}.${op.target.name}${patched !== op.body ? ' (with later in-place rewrite)' : ''}`, ok: candidates.includes(op.body) || candidates.includes(patched) });
        }
      } else if (op.type === 'fnpriv') {
        if (later(op.key, op.at, () => true) || later(op.fnKey, op.at, other => other.op === 'drop')) { superseded++; continue; }
        const allowed = await functionPrivilege(client, op.target.signature, op.target.role);
        if (allowed === null) continue;
        weak.push({ what: `${op.op} execute ${op.target.signature} ${op.op === 'grant' ? 'to' : 'from'} ${op.target.role}`, ok: allowed === (op.op === 'grant'), revoke: op.op === 'revoke' });
      }
    }
    const revokes = weak.filter(check => check.revoke);
    const checks = strong.length ? strong : revokes.length ? revokes : weak;
    const passed = checks.filter(check => check.ok).length;
    const verdict = !checks.length ? 'unverifiable' : passed === checks.length ? 'applied' : passed === 0 ? 'missing' : 'partial';
    results.push({ file, verdict, basis: strong.length ? 'objects' : weak.length ? 'privileges' : 'none', checks: checks.length, passed, superseded, inherited: inheritedObjects,
      failing: checks.filter(check => !check.ok).slice(0, 6).map(check => check.what), passing: verdict === 'partial' ? checks.filter(check => check.ok).slice(0, 6).map(check => check.what) : undefined });
  }
  const pick = verdict => results.filter(entry => entry.verdict === verdict).map(entry => entry.file);
  return {
    total: results.length, applied: pick('applied').length, missing: pick('missing'), partial: pick('partial'), unverifiable: pick('unverifiable'),
    notApplied: results.filter(entry => entry.verdict === 'missing' || entry.verdict === 'partial').map(entry => entry.file),
    method: 'Parsed each migration (statements, dollar-quoted bodies) and checked the catalog for every object it creates; function bodies are compared with pg_proc.prosrc for each function\'s newest definition; checks superseded by a later drop or redefinition are skipped; grant/revoke-only migrations are checked with has_function_privilege. No supabase_migrations table exists on this stack.',
    files: results,
  };
}

// ===========================================================================
// Database preflight on the isolated stack (read-only)
// ===========================================================================

/** Objects /api/build, /api/build/plan, the cloud create routes and the runner itself use. */
const REQUIRED = Object.freeze({
  functions: ['public.makeborne_ai_operation_create', 'public.makeborne_ai_operation_read', 'public.makeborne_ai_operation_begin',
    'public.makeborne_ai_operation_provider_begin', 'public.makeborne_ai_operation_finish', 'public.makeborne_ai_operation_recover',
    'public.makeborne_provider_spend_status', 'public.makeborne_cloud_schema_version', 'public.makeborne_create_record',
    'public.makeborne_creation_access', 'makeborne_private.set_live_provider_limit', 'makeborne_private.open_provider_call',
    'makeborne_private.has_unlimited_credits'],
  tables: ['makeborne_private.ai_operations', 'makeborne_private.ai_operation_runs', 'makeborne_private.live_provider_limits',
    'makeborne_private.live_provider_days', 'makeborne_private.live_provider_calls', 'public.artifact_plans', 'public.artifacts',
    'public.artifact_versions', 'public.projects', 'public.assets'],
  // Read through MISSING_TABLE fallbacks in the app: absence degrades, it does not fail.
  optionalTables: ['public.brand_kits'],
});

/** Source files on the generation path whose RPC and table names must exist in the database. */
const BUILD_PATH_SOURCES = ['src/app/api/build', 'src/lib/builder', 'src/lib/ai', 'src/lib/credits', 'src/lib/cloud/server.ts', 'src/lib/billing/access.ts',
  'src/lib/brand/server.ts', 'src/lib/documents/export-server.ts', 'src/app/api/cloud/workspaces/[workspaceId]/projects',
  'src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/document-export', 'src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/assets'];

function sourceFiles(entry) {
  const absolute = path.join(REPO, entry);
  if (!existsSync(absolute)) return [];
  if (/\.(ts|tsx)$/.test(entry)) return [absolute];
  return readdirSync(absolute, { recursive: true }).map(name => path.join(absolute, String(name))).filter(file => /\.(ts|tsx)$/.test(file) && !/check-|\.test\./.test(path.basename(file)));
}

function appReferences() {
  const rpcs = new Map(), tables = new Map();
  for (const file of BUILD_PATH_SOURCES.flatMap(sourceFiles)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:rpc|call)\(\s*["'`](makeborne_[a-z0-9_]+)["'`]/g)) rpcs.set(match[1], rel(file));
    for (const match of text.matchAll(/(?<!storage)\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g)) tables.set(match[1], rel(file));
  }
  return { rpcs, tables };
}

export async function databasePreflight({ fixture }) {
  const report = { ok: false, reachable: false };
  try {
    await withReadOnly('release-auth', async client => {
      report.reachable = true;
      const catalog = await catalogSnapshot(client);
      const present = name => { const [schema, object] = name.split('.'); return catalog.hasFunction(schema, object); };
      const table = name => catalog.relations.has(name);
      report.required = {
        missingFunctions: REQUIRED.functions.filter(name => !present(name)),
        missingTables: REQUIRED.tables.filter(name => !table(name)),
        missingOptionalTables: REQUIRED.optionalTables.filter(name => !table(name)),
      };
      const references = appReferences();
      report.appReferences = {
        scanned: BUILD_PATH_SOURCES,
        rpcs: references.rpcs.size, tables: references.tables.size,
        missingRpcs: [...references.rpcs].filter(([name]) => !present(`public.${name}`)).map(([name, file]) => `${name} (${file})`),
        missingTables: [...references.tables].filter(([name]) => !table(`public.${name}`)).map(([name, file]) => `${name} (${file})`),
      };
      report.migrations = await auditMigrations(client);

      const optional = async (sql, args = []) => {
        await client.query('savepoint eval_optional');
        try { const result = await client.query(sql, args); await client.query('release savepoint eval_optional'); return result.rows; }
        catch (error) { await client.query('rollback to savepoint eval_optional'); return { error: error.message }; }
      };
      const expected = loadApp('src/lib/cloud/config.ts').CLOUD_SCHEMA_VERSION;
      const version = await optional('select public.makeborne_cloud_schema_version() v');
      report.cloudSchema = { expected, actual: Array.isArray(version) ? version[0]?.v ?? null : null, error: version.error ?? null };
      report.cloudSchema.ok = report.cloudSchema.actual === expected;

      const limits = await optional('select scope, enabled, emergency_stop, daily_limit_microusd::text limit_microusd, note, updated_at from makeborne_private.live_provider_limits order by scope');
      const today = await optional("select scope, reserved_microusd::text reserved, spent_microusd::text spent from makeborne_private.live_provider_days where day = (now() at time zone 'utc')::date order by scope");
      const calls = await optional(`select count(*) filter (where status = 'open')::int open, count(*) filter (where status = 'uncertain')::int uncertain,
        min(created_at) filter (where status = 'uncertain') oldest_uncertain from makeborne_private.live_provider_calls`);
      report.providerLimits = Array.isArray(limits) ? limits.map(row => ({ scope: row.scope, enabled: row.enabled, emergencyStop: row.emergency_stop, dailyLimitUsd: usd(row.limit_microusd), note: row.note, updatedAt: row.updated_at })) : limits;
      report.providerToday = Array.isArray(today) ? today.map(row => ({ scope: row.scope, reservedUsd: usd(row.reserved), spentUsd: usd(row.spent) })) : today;
      // An open call is in flight right now (someone else is generating); uncertain ones are old unsettled records.
      report.providerCalls = Array.isArray(calls) ? { open: calls[0].open, uncertain: calls[0].uncertain, oldestUncertain: calls[0].oldest_uncertain } : calls;

      const user = await optional(`select u.email_confirmed_at is not null confirmed, coalesce(u.is_anonymous, false) anonymous,
          p.is_admin, p.unlimited_credits, case when w.owner_id = u.id then 'owner' else m.role end as role
        from auth.users u
        left join makeborne_private.account_privileges p on p.user_id = u.id
        left join public.workspaces w on w.id = $2
        left join public.workspace_members m on m.user_id = u.id and m.workspace_id = $2
        where u.id = $1`, [fixture.userId, fixture.workspaceId]);
      const unlimited = await optional('select makeborne_private.has_unlimited_credits($1) v', [fixture.userId]);
      const row = Array.isArray(user) ? user[0] : null;
      report.fixtureUser = row ? { exists: true, emailConfirmed: row.confirmed, anonymous: row.anonymous, isAdmin: row.is_admin === true,
        unlimitedCredits: row.unlimited_credits === true, workspaceRole: row.role ?? null,
        hasUnlimitedCreditsRpc: Array.isArray(unlimited) ? unlimited[0].v : `unavailable (${String(unlimited.error).slice(0, 80)})` } : { exists: false, error: user.error ?? 'fixture user not found' };
      const evalProjects = await optional("select count(*)::int n from public.projects where workspace_id = $1 and title like '[eval %'", [fixture.workspaceId]);
      report.earlierEvalProjects = Array.isArray(evalProjects) ? evalProjects[0].n : null;
    });
  } catch (error) {
    report.error = String(error.message).slice(0, 300);
  }
  const user = report.fixtureUser ?? {};
  report.blockers = [
    ...(!report.reachable ? [`Isolated database 127.0.0.1:${DB_PORT} unreachable: ${report.error}`] : []),
    ...(report.required?.missingFunctions.length ? [`Missing functions the build path calls: ${report.required.missingFunctions.join(', ')}`] : []),
    ...(report.required?.missingTables.length ? [`Missing tables the build path uses: ${report.required.missingTables.join(', ')}`] : []),
    ...(report.appReferences?.missingRpcs.length ? [`Build-path code calls RPCs absent from the database: ${report.appReferences.missingRpcs.join(', ')}`] : []),
    ...(report.migrations?.notApplied.length ? [`${report.migrations.notApplied.length} migration file(s) not (fully) applied`] : []),
    ...(report.cloudSchema && !report.cloudSchema.ok ? [`Cloud schema version is ${report.cloudSchema.actual}, the app expects ${report.cloudSchema.expected}`] : []),
    ...(Array.isArray(report.providerLimits) && report.providerLimits.some(limit => limit.emergencyStop) ? ['A provider emergency stop is set (live_provider_limits.emergency_stop)'] : []),
    ...(Array.isArray(report.providerLimits) && report.providerLimits.some(limit => limit.enabled) ? ['Provider limits are already enabled by someone else; the runner only enables them itself'] : []),
    ...(report.providerCalls?.open > 0 ? [`${report.providerCalls.open} provider call(s) are open (in flight) in the ledger`] : []),
    ...(report.reachable && !(user.exists && user.emailConfirmed && user.isAdmin && user.unlimitedCredits && user.workspaceRole) ? ['Fixture user is not a confirmed admin with unlimited credits and workspace membership'] : []),
  ];
  report.ok = report.reachable && report.blockers.length === 0;
  return report;
}

// ===========================================================================
// Keys (presence only) and the local machine
// ===========================================================================

/**
 * Parse an env file the way Next does (@next/env bundles dotenv 16 and uses its
 * LINE expression): `KEY=value`, `KEY: value`, `export KEY=value`, quoted and
 * multi-line values, `#` comments. `names` additionally holds every
 * `NAME=`/`NAME:` at a line start, so the server env blanks a superset of what
 * Next would load (blanking an extra name is harmless). Values stay in memory.
 */
export function parseEnvText(text) {
  const line = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;
  const lines = String(text).replace(/\r\n?/gm, '\n');
  const values = new Map();
  let match;
  while ((match = line.exec(lines)) !== null) {
    let value = (match[2] || '').trim();
    const quote = value[0];
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, '$2');
    if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    values.set(match[1], value);
  }
  const names = new Set(values.keys());
  for (const row of lines.split('\n')) {
    const name = /^\s*(?:export\s+)?([\w.-]+)\s*[=:]/.exec(row)?.[1];
    if (name) names.add(name);
  }
  return { values, names: [...names] };
}

const readEnvFile = file => (existsSync(file) ? readFileSync(file, 'utf8') : null);

/** Names with non-empty values in an env file. Values are never returned. */
function envPresence(file, read = readEnvFile) {
  const text = read(file);
  if (text === null) return null;
  return Object.fromEntries([...parseEnvText(text).values].map(([name, value]) => [name, value.length > 0]));
}

/** Read one value from .env.local for the child env only (never logged or stored). */
function envValue(name, read = readEnvFile) {
  return parseEnvText(read(envLocalFile()) ?? '').values.get(name) ?? '';
}

export function keyPresence() {
  const local = envPresence(envLocalFile());
  const keys = local ? {
    ANTHROPIC_API_KEY: Boolean(local.ANTHROPIC_API_KEY), OPENAI_API_KEY: Boolean(local.OPENAI_API_KEY), MAKEBORNE_IMAGE_MODEL: Boolean(local.MAKEBORNE_IMAGE_MODEL),
    MAKEBORNE_BUILDER_MODEL: Boolean(local.MAKEBORNE_BUILDER_MODEL), MAKEBORNE_AI_COST_USD_PER_CREDIT: Boolean(local.MAKEBORNE_AI_COST_USD_PER_CREDIT),
  } : null;
  // Next loads these files itself; the runner blanks every key they define in the server env.
  const nextLoaded = ENV_FILES_NEXT_LOADS.filter(name => existsSync(path.join(REPO, name)));
  return { file: '.env.local', exists: Boolean(local), keys, imagesPossible: Boolean(keys?.OPENAI_API_KEY && (keys?.MAKEBORNE_IMAGE_MODEL || IMAGE_MODELS)), envFilesNextLoads: nextLoaded,
    shellOverrides: { EVAL_SPEND_APPROVED: process.env.EVAL_SPEND_APPROVED === 'yes', EVAL_CAP_USD: process.env.EVAL_CAP_USD ?? null } };
}

function portFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/** True when something accepts connections on the port (IPv4 or IPv6 loopback). */
function portAnswers(port, host) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** A port is usable only when nothing listens on it at all (bind test + connect tests). */
export async function portInUse(port) {
  return !(await portFree(port)) || (await portAnswers(port, '127.0.0.1')) || (await portAnswers(port, '::1'));
}

// ===========================================================================
// Preflight + budget plan
// ===========================================================================

function budgetPlan(briefs, pricing) {
  let ledger;
  try { ledger = budgetSummary(); } catch (error) { return { error: error.message }; }
  let cumulative = 0;
  const order = briefs.items.map(item => {
    const bound = boundFor(item.kind, pricing);
    cumulative = round2(cumulative + bound);
    return { id: item.id, priority: item.priority, kind: item.kind, direction: item.direction, boundUsd: bound, cumulativeUsd: cumulative, fits: cumulative <= ledger.remainingUsd + 1e-9 };
  });
  const fitting = order.filter(item => item.fits);
  return { ledger, capUsd: ledger.capUsd, remainingUsd: ledger.remainingUsd, briefs: order.length, fitting: fitting.length,
    fittingBoundUsd: fitting.at(-1)?.cumulativeUsd ?? 0, allBoundUsd: cumulative, firstNotFitting: order.find(item => !item.fits)?.id ?? null, order };
}

export async function preflight({ outDir, withSelfTest = true } = {}) {
  const report = { startedAt: new Date().toISOString() };
  try { const stack = isolatedStack(); report.stack = { ok: true, apiUrl: stack.apiUrl, db: `127.0.0.1:${DB_PORT}` }; }
  catch (error) { report.stack = { ok: false, error: error.message }; }
  let fixture = null;
  try { fixture = qualityFixture(); report.fixture = { ok: true, email: fixture.email, workspaceId: fixture.workspaceId, passwordPresent: Boolean(fixture.password) }; }
  catch (error) { report.fixture = { ok: false, error: error.message }; }
  try { report.briefs = loadBriefs(); } catch (error) { report.briefs = { ok: false, present: true, problems: [error.message], items: [] }; }
  try { report.pricing = pricingFromCode(); } catch (error) { report.pricing = { error: error.message }; }
  report.database = report.stack.ok && fixture ? await databasePreflight({ fixture }) : { ok: false, blockers: ['Stack or fixture unavailable'] };
  report.keys = keyPresence();
  report.machine = { nextPortFree: await portFree(NEXT_PORT), nextPort: NEXT_PORT, node: process.version };
  report.budget = report.pricing.error ? { error: 'pricing unavailable' } : budgetPlan(report.briefs, report.pricing);
  if (withSelfTest) report.captureSelfTest = await captureSelfTest({ outDir: outDir ? path.join(outDir, 'capture-self-test') : undefined });

  const blockers = [];
  if (!report.stack.ok) blockers.push(`Stack guard: ${report.stack.error}`);
  if (!report.fixture.ok) blockers.push(`Fixture account: ${report.fixture.error}`);
  if (!report.briefs.ok) blockers.push(report.briefs.present ? `Brief manifest: ${report.briefs.problems.join('; ')}` : report.briefs.message);
  if (report.pricing.error) blockers.push(`Pricing could not be read from code: ${report.pricing.error}`);
  blockers.push(...(report.database.blockers ?? []));
  if (!report.keys.keys?.ANTHROPIC_API_KEY) blockers.push('ANTHROPIC_API_KEY is not present in .env.local');
  if (!report.machine.nextPortFree) blockers.push(`Port ${NEXT_PORT} is in use (the runner starts its own Next dev server there)`);
  if (report.budget.error) blockers.push(`Budget ledger: ${report.budget.error}`);
  else if (!report.budget.fitting) blockers.push(`No brief fits the remaining cap (${money(report.budget.remainingUsd)})`);
  if (withSelfTest && !report.captureSelfTest.ok) blockers.push(`Capture self-test failed: ${report.captureSelfTest.error ?? JSON.stringify(report.captureSelfTest.checks)}`);
  report.blockers = blockers;
  report.green = blockers.length === 0;
  report.neededToRunForReal = neededToRunForReal(report);
  report.finishedAt = new Date().toISOString();
  return report;
}

/** The exact, actionable list Kerim needs before `--live` can run. */
function neededToRunForReal(report) {
  const steps = [];
  const migrations = report.database.migrations;
  if (migrations?.notApplied.length) {
    steps.push({
      what: `Apply ${migrations.notApplied.length} migration file(s) to the ISOLATED release-auth stack only (DB 127.0.0.1:${DB_PORT}), in this order`,
      files: migrations.notApplied.map(file => `supabase/migrations/${file}`),
      partial: migrations.partial.length ? migrations.files.filter(entry => entry.verdict === 'partial').map(entry => ({ file: entry.file, failing: entry.failing })) : [],
      how: `psql is not on PATH; the stack's own container has it. From the repo root, for each file in order (stop at the first error):
         docker exec -i supabase_db_makeborne-release-auth psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/<file> > work/release-auth-stack/<file>.log
         (same .log convention as the files already applied). 'partial' files hold an older revision of the file; check their statements are re-runnable (create or replace / if not exists) first. Then re-run this dry run.`,
    });
  }
  const missing = [...(report.database.required?.missingFunctions ?? []), ...(report.database.required?.missingTables ?? [])];
  if (missing.length) steps.push({ what: 'After the migrations, these build-path objects must exist (the dry run re-checks them)', objects: missing });
  if (report.database.cloudSchema && !report.database.cloudSchema.ok) steps.push({ what: `Make makeborne_cloud_schema_version() return ${report.database.cloudSchema.expected} on the isolated stack` });
  if (!report.keys.keys?.ANTHROPIC_API_KEY) steps.push({ what: 'Add ANTHROPIC_API_KEY to .env.local (the runner reads it only into its own server process)' });
  steps.push({
    what: 'Approve the spend for this round explicitly',
    how: `EVAL_SPEND_APPROVED=yes node scripts/eval/run.mjs --live --approval "Kerim, <date>: approve up to ${money(report.budget.fittingBoundUsd)} of Anthropic spend"`,
    detail: `Uses the Anthropic key present in .env.local for paid calls (claude model default: ${report.pricing.builderModelDefault ?? 'see src/lib/builder/agent.ts'}). Remaining cap ${money(report.budget.remainingUsd)} of ${money(report.budget.capUsd)}: ${report.budget.fitting} of ${report.budget.briefs} briefs fit at their worst-case bound (website ${money(report.pricing.websiteBoundUsd)}, deck/book ${money(report.pricing.documentBoundUsd)}). Add --only <briefId> or --max <n> for a smaller first round.`,
  });
  steps.push({
    what: 'Images (optional)',
    how: report.keys.imagesPossible ? 'OPENAI_API_KEY and MAKEBORNE_IMAGE_MODEL are present: pass --images to enable image generation (spend stays inside each operation cap).'
      : 'Images stay OFF (as in all fixtures). To include them, add OPENAI_API_KEY and MAKEBORNE_IMAGE_MODEL to .env.local, then pass --images.',
  });
  steps.push({ what: 'Provider limits: nothing to do', how: 'After a brief\'s reservation succeeds, the runner enables global+anthropic limits at (today\'s spend, read then) + that brief\'s bound, and disables them again at the end of every brief and on Ctrl+C/termination (plus a watchdog if the runner is killed), each time with a read-back that must show them disabled. If an emergency_stop is set, clear it yourself first; the runner never clears it.' });
  if (!report.machine.nextPortFree) steps.push({ what: `Free port ${NEXT_PORT} and stop any other \`next dev\` on this checkout` });
  return steps;
}

function printPreflight(report, runDir) {
  const line = (label, value) => console.log(`  ${label.padEnd(26)} ${value}`);
  const db = report.database;
  console.log('\nMakeborne eval runner: dry run (no paid calls)\n');
  line('Stack guard', report.stack.ok ? `ok (${report.stack.apiUrl}, DB ${report.stack.db})` : `FAIL ${report.stack.error}`);
  line('Fixture account', report.fixture.ok ? `ok (password present: ${report.fixture.passwordPresent})` : `FAIL ${report.fixture.error}`);
  line('Briefs', report.briefs.present ? `${report.briefs.count} briefs, hashes ${report.briefs.problems.length ? `PROBLEMS: ${report.briefs.problems.join('; ')}` : 'all verified'} ${JSON.stringify(report.briefs.byKind ?? {})}` : report.briefs.message);
  if (db.migrations) {
    line('Migrations (55438)', `${db.migrations.applied}/${db.migrations.total} applied; missing ${db.migrations.missing.length}, partial ${db.migrations.partial.length}, unverifiable ${db.migrations.unverifiable.length}`);
    for (const entry of db.migrations.files.filter(item => item.verdict === 'missing' || item.verdict === 'partial')) {
      console.log(`      ${entry.verdict.padEnd(8)} ${entry.file} (${entry.passed}/${entry.checks} checks)`);
    }
    for (const file of db.migrations.unverifiable) console.log(`      unverifiable: ${file}`);
  }
  if (db.required) line('Build-path objects', db.required.missingFunctions.length + db.required.missingTables.length ? `MISSING ${[...db.required.missingFunctions, ...db.required.missingTables].join(', ')}` : 'all present');
  if (db.appReferences) line('Code references (build)', `${db.appReferences.rpcs} RPCs, ${db.appReferences.tables} tables; missing RPCs: ${db.appReferences.missingRpcs.length ? db.appReferences.missingRpcs.join(', ') : 'none'}; missing tables: ${db.appReferences.missingTables.length ? db.appReferences.missingTables.join(', ') : 'none'}`);
  if (db.cloudSchema) line('Cloud schema version', db.cloudSchema.ok ? `ok (${db.cloudSchema.actual})` : `MISMATCH ${db.cloudSchema.actual} != ${db.cloudSchema.expected}`);
  if (Array.isArray(db.providerLimits)) line('Provider limits', db.providerLimits.map(limit => `${limit.scope}:${limit.enabled ? 'on' : 'off'}${limit.emergencyStop ? '+STOP' : ''} ${money(limit.dailyLimitUsd)}`).join(', '));
  if (db.providerCalls && !db.providerCalls.error) line('Provider ledger', `${db.providerCalls.open} open, ${db.providerCalls.uncertain} uncertain (oldest ${db.providerCalls.oldestUncertain ? new Date(db.providerCalls.oldestUncertain).toISOString().slice(0, 10) : 'n/a'}; informational)`);
  if (db.fixtureUser) line('Fixture user', db.fixtureUser.exists ? `admin ${db.fixtureUser.isAdmin}, unlimited ${db.fixtureUser.unlimitedCredits}, role ${db.fixtureUser.workspaceRole}, confirmed ${db.fixtureUser.emailConfirmed}` : `FAIL ${db.fixtureUser.error}`);
  const keys = report.keys.keys ?? {};
  line('Keys (.env.local)', `ANTHROPIC_API_KEY ${keys.ANTHROPIC_API_KEY ? 'present' : 'ABSENT'}, OPENAI_API_KEY ${keys.OPENAI_API_KEY ? 'present' : 'absent'}, MAKEBORNE_IMAGE_MODEL ${keys.MAKEBORNE_IMAGE_MODEL ? 'present' : 'absent'} (images ${report.keys.imagesPossible ? 'possible' : 'off'})`);
  if (!report.pricing.error) line('Bounds (from code)', `website ${money(report.pricing.websiteBoundUsd)} in Create mode (build ${report.pricing.buildCeilingCredits} cr shared with continuations+review; ${money(report.pricing.websitePlanBoundUsd)} with --plan, plan ${report.pricing.planCeilingCredits} cr), deck/book ${money(report.pricing.documentBoundUsd)} at $${report.pricing.costPerCreditUsd}/credit`);
  if (!report.budget.error) line('Budget', `cap ${money(report.budget.capUsd)}, committed ${money(report.budget.ledger.committedUsd)}, remaining ${money(report.budget.remainingUsd)}: ${report.budget.fitting}/${report.budget.briefs} briefs fit (bound ${money(report.budget.fittingBoundUsd)} of ${money(report.budget.allBoundUsd)}); first over cap: ${report.budget.firstNotFitting ?? 'none'}`);
  if (report.captureSelfTest) {
    const test = report.captureSelfTest;
    line('Capture self-test', test.ok ? `ok: ${test.capture.screenshots.length} tiles (${countBy(test.capture.screenshots, shot => shot.viewport).desktop ?? 0} desktop, ${countBy(test.capture.screenshots, shot => shot.viewport).mobile ?? 0} mobile), reviewCoverageIssue null, ReviewInputSchema valid, ${Math.round(test.checks.requestBytes / 1024)} KiB request, ${test.captureMs} ms` : `FAIL ${test.error ?? JSON.stringify(test.checks)}`);
  }
  line(`Port ${NEXT_PORT}`, report.machine.nextPortFree ? 'free' : 'IN USE');
  console.log(`\n  Live run: ${report.green ? 'READY (still needs --live, --approval and EVAL_SPEND_APPROVED=yes)' : 'BLOCKED'}`);
  for (const blocker of report.blockers) console.log(`    - ${blocker}`);
  console.log('\n  Needed to run for real:');
  for (const [index, step] of report.neededToRunForReal.entries()) {
    console.log(`    ${index + 1}. ${step.what}`);
    for (const file of step.files ?? []) console.log(`         ${file}`);
    for (const entry of step.partial ?? []) console.log(`         partial ${entry.file}: missing ${entry.failing.join(', ')}`);
    if (step.objects) console.log(`         ${step.objects.join(', ')}`);
    if (step.how) console.log(`         ${step.how}`);
    if (step.detail) console.log(`         ${step.detail}`);
  }
  if (runDir) console.log(`\n  Report: ${rel(path.join(runDir, 'run.json'))}\n`);
}

// ===========================================================================
// Live mode: server, limits, session
// ===========================================================================

const OS_ENV_KEYS = Object.freeze(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'WINDIR', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'HOME']);

/** Server env: nothing inherited from .env files or the shell except OS basics. */
export function serverEnv(stack, { images, rate }, { read = readEnvFile, value = envValue } = {}) {
  const env = {};
  for (const key of OS_ENV_KEYS) if (process.env[key]) env[key] = process.env[key];
  // Next loads .env* itself but never overrides a key that is already set
  // (even to ''): blank every name those files define, whatever the syntax.
  for (const file of ENV_FILES_NEXT_LOADS) {
    const text = read(path.join(REPO, file));
    if (text !== null) for (const name of parseEnvText(text).names) if (!OS_ENV_KEYS.includes(name)) env[name] = '';
  }
  return Object.assign(env, {
    NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
    ANTHROPIC_API_KEY: value('ANTHROPIC_API_KEY', read),
    OPENAI_API_KEY: images ? value('OPENAI_API_KEY', read) : '', MAKEBORNE_IMAGE_MODEL: images ? value('MAKEBORNE_IMAGE_MODEL', read) : '', MAKEBORNE_IMAGE_MODELS: images ? IMAGE_MODELS : '',
    MAKEBORNE_BUILDER_FALLBACK_MODELS: '', MAKEBORNE_AI_COST_USD_PER_CREDIT: String(rate),
    MAKEBORNE_CLOUD_ENABLED: 'true', MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED: 'true', MAKEBORNE_LIVE_BUILDER_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: stack.publishableKey, SUPABASE_SECRET_KEY: stack.secretKey,
    MAKEBORNE_HOSTING_NAMESPACE: 'local', MAKEBORNE_PUBLICATION_ASSET_BROKER_ENABLED: 'false',
    MAKEBORNE_BUILDER_MODEL: '', ...routeEnv(),
  });
}

function startNext(stack, options, logFile) {
  const log = createWriteStream(logFile, { flags: 'a' });
  const child = spawn(process.execPath, [path.join(REPO, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', ...(BUNDLER === 'webpack' ? ['--webpack'] : []), '--hostname', '127.0.0.1', '--port', String(NEXT_PORT)],
    { cwd: REPO, env: serverEnv(stack, options), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  // Two sources share one file: end it only once both pipes are closed (no write after end),
  // so next-dev.log is complete on disk before the final secret scan reads it.
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  log.on('error', () => undefined);
  child.logFlushed = new Promise(resolve => {
    log.once('close', resolve);
    child.once('close', () => log.end());
  });
  return child;
}

const TASKKILL = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'taskkill.exe');

/** Kill the server process TREE (next dev spawns workers that hold the key too). */
function stopNext(child) {
  if (!child?.pid) return { stopped: false, reason: 'not started' };
  if (child.exitCode !== null || child.signalCode !== null) return { stopped: true, reason: `already exited (${child.exitCode ?? child.signalCode})` };
  if (process.platform === 'win32') {
    const result = spawnSync(TASKKILL, ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return { stopped: result.status === 0, reason: `taskkill /T /F exit ${result.status}` };
  }
  child.kill('SIGKILL');
  return { stopped: true, reason: 'SIGKILL' };
}

async function waitForBuilder(child) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next dev exited with ${child.exitCode} (port ${NEXT_PORT} taken, or a startup error: see next-dev.log)`);
    try {
      const response = await fetch(`${ORIGIN}/api/build`, { signal: AbortSignal.timeout(60_000) });
      if (response.ok) {
        const body = await response.json();
        // Provider limits are enabled per brief after this, so a configured builder may still report paused here.
        if ((body.configured ?? body.available) === true) return;
        throw new Error('The builder reports configured:false (check the server env)');
      }
    } catch (error) {
      if (/configured:false/.test(error.message)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('next dev did not become ready within 5 minutes');
}

// ---------------------------------------------------------------------------
// Server identity: the server on 3211 must be OUR child, built against the
// isolated stack. .env.local points NEXT_PUBLIC_SUPABASE_URL at a cloud
// project, so a stray dev server would answer /api/build with configured:true
// while spending through cloud (and our read-only ledger would read $0).
// ---------------------------------------------------------------------------

export class ServerIdentityError extends Error {
  constructor(message, detail) { super(message); this.code = 'EVAL_SERVER_IDENTITY'; this.detail = detail; }
}
/** A cloud Supabase host (`<ref>.supabase.co`), not supabase.com documentation links. */
const CLOUD_SUPABASE_HOST = /[a-z0-9-]+\.supabase\.co(?![a-z0-9-])/i;
/** src/lib/supabase/config.ts getSupabaseConfig() as Turbopack (or webpack) inlines it. */
const INLINED_CONFIG_URL = /function getSupabaseConfig\(\)\s*\{\s*const url = (?:\(\s*"TURBOPACK compile-time value",\s*)?("(?:[^"\\]|\\.)*"|undefined|void 0)/g;
const COMPILE_TIME_VALUE = /"TURBOPACK compile-time value",\s*("(?:[^"\\]|\\.)*")/g;
/** webpack dev (--bundler webpack; Turbopack cannot follow this checkout's node_modules junction) ships each module as an
 * eval() string, so the same source appears with its quotes and newlines escaped once or twice. Unescaping only reveals
 * the module text; the check itself (the exact isolated URL inlined in getSupabaseConfig) is unchanged. */
const unescapeOnce = text => text.replace(/\\(["'\\nrt])/g, (match, character) => (character === 'n' ? '\n' : character === 'r' ? '\r' : character === 't' ? '\t' : character));

/**
 * Prove the server is the runner's own child built for the isolated stack:
 * the child is alive, and the client chunks /login loads inline exactly
 * `expectedApi` as NEXT_PUBLIC_SUPABASE_URL, with no cloud host among the
 * compile-time values. Throws ServerIdentityError otherwise.
 */
export async function verifyServerIdentity({ child, expectedApi, origin = ORIGIN, fetchImpl = fetch, maxChunks = 150 }) {
  if (!child?.pid || child.exitCode !== null || (child.signalCode ?? null) !== null) throw new ServerIdentityError(`The runner's own next dev process is not running (exit ${child?.exitCode ?? 'n/a'})`);
  const base = assertLocalOrigin(origin);
  const get = async pathname => {
    const response = await fetchImpl(`${base}${pathname}`, { redirect: 'manual', signal: AbortSignal.timeout(180_000) });
    return { status: response.status, text: response.status === 200 ? await response.text() : '' };
  };
  const page = await get('/login');
  if (page.status !== 200) throw new ServerIdentityError(`GET /login answered ${page.status}; cannot verify the server`);
  const problems = [];
  if (CLOUD_SUPABASE_HOST.test(page.text)) problems.push('the /login HTML names a cloud Supabase host');
  const chunks = [...new Set([...page.text.matchAll(/(?:\/_next\/)?static\/chunks\/[^"'\\\s<>()]+?\.js/g)].map(match => (match[0].startsWith('/') ? match[0] : `/_next/${match[0]}`)))];
  if (!chunks.length) problems.push('/login references no client chunks');
  const configured = new Set();
  let compileTimeValues = 0, fetched = 0;
  for (const chunk of chunks.slice(0, maxChunks)) {
    const { status, text } = await get(chunk);
    if (status !== 200) continue;
    fetched++;
    const once = unescapeOnce(text), twice = unescapeOnce(once);
    for (const variant of new Set([text, once, twice])) for (const match of variant.matchAll(INLINED_CONFIG_URL)) configured.add(match[1].startsWith('"') ? JSON.parse(match[1]) : null);
    for (const match of text.matchAll(COMPILE_TIME_VALUE)) {
      compileTimeValues++;
      if (CLOUD_SUPABASE_HOST.test(JSON.parse(match[1]))) problems.push(`${chunk} inlines a cloud Supabase host`);
    }
  }
  if (!configured.size) problems.push(`getSupabaseConfig() was not found in the ${fetched} chunk(s) /login loads, so the inlined Supabase URL cannot be checked`);
  for (const value of configured) {
    if (value !== expectedApi) problems.push(`the client is built with NEXT_PUBLIC_SUPABASE_URL ${value === null ? '(unset)' : CLOUD_SUPABASE_HOST.test(value) ? 'set to a cloud project' : JSON.stringify(value)}, not ${expectedApi}`);
  }
  if (problems.length) throw new ServerIdentityError(`The server on ${base} is not the runner's isolated server: ${[...new Set(problems)].slice(0, 4).join('; ')}`, { chunks: chunks.length, fetched });
  return { ok: true, chunks: chunks.length, fetched, compileTimeValues, supabaseUrl: [...configured][0] };
}

// ---------------------------------------------------------------------------
// Provider limits on the isolated stack (the only writes the runner makes
// outside the app). Enabled per brief at (today's spend now) + that brief's
// bound, disabled after every brief; each change is read back and checked.
// ---------------------------------------------------------------------------

export const LIMIT_SCOPES = Object.freeze(['global', 'anthropic', 'openai']);
const MUST_BE_OFF = ['global', 'anthropic'];

export class LimitsError extends Error {
  constructor(message, detail) { super(message); this.code = 'EVAL_PROVIDER_LIMITS'; this.detail = detail; }
}

function limitsClient() {
  return new pg.Client({ connectionString: isolatedStack().dbUrl, connectionTimeoutMillis: 5000, query_timeout: 15_000, application_name: 'makeborne-eval-limits' });
}

/**
 * enabled: limit = (spent + reserved today, read now) + boundUsd for each scope.
 * disabled: limit 0, and the read-back must show global, anthropic and every
 * listed scope disabled. Throws LimitsError when the read-back disagrees.
 * guard (enabling only): called immediately before every enabling write; it
 * throws once the run is stopping, so no scope is enabled after cleanup began.
 */
export async function setProviderLimits({ enabled, boundUsd = 0, scopes, note, guard = null, client: injected = null }) {
  const bound = enabled ? Math.round(boundUsd * 1e6) : 0;
  if (enabled && !(Number.isSafeInteger(bound) && bound > 0)) throw new LimitsError('Enabling provider limits needs a positive per-brief bound');
  if (enabled) guard?.();
  const client = injected ?? limitsClient();
  if (!injected) await client.connect();
  try {
    const rows = [];
    for (const scope of scopes) {
      const { rows: [day] } = await client.query("select coalesce(sum(spent_microusd + reserved_microusd), 0)::text used from makeborne_private.live_provider_days where scope = $1 and day = (now() at time zone 'utc')::date", [scope]);
      const used = Number(day?.used ?? 0);
      if (!Number.isSafeInteger(used) || used < 0) throw new LimitsError(`Unreadable provider spend for ${scope}`);
      const limit = enabled ? used + bound : 0;
      if (enabled) guard?.();
      await client.query('select makeborne_private.set_live_provider_limit($1, $2, $3, false, $4)', [scope, enabled, limit, note]);
      rows.push({ scope, enabled, limitMicrousd: limit, limitUsd: usd(limit), usedTodayUsd: usd(used), boundUsd: usd(bound) });
    }
    const { rows: back } = await client.query('select scope, enabled, emergency_stop, daily_limit_microusd::text l from makeborne_private.live_provider_limits order by scope');
    const readback = back.map(row => ({ scope: row.scope, enabled: row.enabled, emergencyStop: row.emergency_stop, limitUsd: usd(row.l), limitMicrousd: Number(row.l) }));
    const byScope = new Map(readback.map(row => [row.scope, row]));
    const problems = [];
    if (enabled) {
      for (const row of rows) {
        const seen = byScope.get(row.scope);
        if (!seen || seen.enabled !== true || seen.limitMicrousd !== row.limitMicrousd) problems.push(`${row.scope} reads back ${seen ? `${seen.enabled ? 'on' : 'off'} at ${seen.limitUsd}` : 'missing'}, expected on at ${row.limitUsd}`);
      }
    } else {
      for (const scope of new Set([...MUST_BE_OFF, ...scopes])) {
        const seen = byScope.get(scope);
        if (!seen ? MUST_BE_OFF.includes(scope) : seen.enabled !== false) problems.push(`${scope} reads back ${seen ? 'ENABLED' : 'missing'}`);
      }
    }
    if (problems.length) throw new LimitsError(`Provider limit read-back mismatch after ${enabled ? 'enabling' : 'DISABLING'}: ${problems.join('; ')}`, { set: rows, readback });
    return { set: rows, readback: readback.map(row => ({ scope: row.scope, enabled: row.enabled, emergencyStop: row.emergencyStop, limitUsd: row.limitUsd })) };
  } finally {
    if (!injected) await client.end().catch(() => undefined);
  }
}

/**
 * Longest a brief can keep its provider limits enabled, from the timeouts in
 * this file: every SSE stage it may POST (website: plan + build +
 * maxContinuations continuations + autoReviewRounds reviews; deck/book: build
 * + continuations) at STAGE_TIMEOUT_MS, the plain requests (create project,
 * create artifact, website plan PUT) at REQUEST_TIMEOUT_MS, every review
 * capture plus the final one at CAPTURE_TIMEOUT_MS, and SETUP_MARGIN_MS.
 */
export function briefWorstCaseMs(kind, pricing) {
  const website = kind === 'website';
  const reviews = website ? Number(pricing.autoReviewRounds) : 0;
  const continuations = Number(pricing.maxContinuations);
  if (!Number.isInteger(reviews) || reviews < 0 || !Number.isInteger(continuations) || continuations < 0) throw new Error('briefWorstCaseMs needs integer autoReviewRounds and maxContinuations');
  const stages = (website ? 1 : 0) + 1 + continuations + reviews;
  const requests = 2 + (website ? 1 : 0);
  const captures = reviews ? reviews + 1 : 0;
  return stages * STAGE_TIMEOUT_MS + requests * REQUEST_TIMEOUT_MS + captures * CAPTURE_TIMEOUT_MS + SETUP_MARGIN_MS;
}

/**
 * Daily limits reset at 00:00 UTC, so a brief that straddles midnight would get
 * a fresh day's allowance on top of (yesterday's spend + bound). A brief whose
 * worst-case duration could reach 00:00 UTC waits until 30 s after it instead.
 */
export class MidnightRefusal extends Error {
  constructor(message) { super(message); this.code = 'EVAL_MIDNIGHT_WAIT'; }
}

export function midnightWaitMs(now, worstCaseMs) {
  if (!Number.isFinite(now) || !Number.isFinite(worstCaseMs) || worstCaseMs <= 0) throw new Error('midnightWaitMs needs a time and a positive worst-case duration');
  const date = new Date(now);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return now + worstCaseMs >= next ? next - now + 30_000 : 0;
}

// ---------------------------------------------------------------------------
// Settlement: the server keeps a run going after the client disconnects
// (website-run.ts), so a brief is settled only once its operations have no
// active run and no open provider call.
// ---------------------------------------------------------------------------

/** Read-only: active runs and open provider calls of this brief's operations. */
export async function operationState(userId, actionKeys) {
  return withReadOnly('release-auth', async client => {
    const { rows: [row] } = await client.query(`
      select count(distinct o.id)::int operations,
             count(distinct r.id) filter (where r.status = 'active')::int active_runs,
             count(distinct c.id) filter (where c.status = 'open')::int open_calls
        from makeborne_private.ai_operations o
        left join makeborne_private.ai_operation_runs r on r.operation_id = o.id
        left join makeborne_private.live_provider_calls c on c.run_reference = 'operation:' || r.id
       where o.actor = $1 and o.action_key = any($2::uuid[])`, [userId, actionKeys]);
    return { operations: row.operations, activeRuns: row.active_runs, openCalls: row.open_calls };
  });
}

/**
 * Poll until quiet on `quietPolls` consecutive reads (and at least minWaitMs), or
 * time out. shouldStop() ends the wait early as not quiet (the run is stopping).
 */
export async function waitForQuiet({ userId, actionKeys, timeoutMs = 330_000, pollMs = 3000, quietPolls = 2, minWaitMs = 0, shouldStop = () => false,
  query = operationState, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const started = now();
  let quiet = 0, polls = 0, last = null;
  for (;;) {
    if (shouldStop()) return { quiet: false, stoppedEarly: true, waitedMs: now() - started, polls, last };
    try { last = await query(userId, actionKeys); } catch (error) { last = { error: String(error.message).slice(0, 200) }; }
    polls++;
    quiet = !last.error && last.activeRuns === 0 && last.openCalls === 0 ? quiet + 1 : 0;
    const waited = now() - started;
    if (quiet >= quietPolls && waited >= minWaitMs) return { quiet: true, waitedMs: waited, polls, last };
    if (waited >= timeoutMs) return { quiet: false, waitedMs: waited, polls, last };
    await sleep(pollMs);
  }
}

/**
 * Settle one brief's reservation with the measured provider cost, but only
 * after the server is quiet; otherwise (or when anything is unreadable or
 * still open) it stays `unknown` at the full bound.
 */
export async function settleBrief({ reservationId, userId, actionKeys, abnormal, shouldStop = () => false, deps = {} }) {
  const { wait = waitForQuiet, measure = ledgerFor, settleFn = settle } = deps;
  const quiet = actionKeys.length ? await wait({ userId, actionKeys, minWaitMs: abnormal ? 15_000 : 0, shouldStop }) : { quiet: true, waitedMs: 0, polls: 0, last: null };
  const detail = { quiet: quiet.quiet, waitedMs: quiet.waitedMs, polls: quiet.polls, last: quiet.last };
  if (!quiet.quiet) {
    await settleFn(reservationId, { unknown: true, detail: { ...detail, reason: quiet.stoppedEarly ? 'run stopping: not waited for the server' : 'server still running (or unreadable) after the wait' } });
    return { status: 'unknown', ...detail };
  }
  const ledger = await measure(userId, actionKeys);
  if (ledger.open > 0) {
    await settleFn(reservationId, { unknown: true, detail: { ...detail, reason: `${ledger.open} provider call(s) still open or uncertain`, calls: ledger.calls.length } });
    return { status: 'unknown', calls: ledger.calls, ...detail };
  }
  const actualUsd = usd(ledger.actualMicrousd);
  await settleFn(reservationId, { actualUsd, detail: { ...detail, calls: ledger.calls.length } });
  return { status: 'settled', actualUsd, calls: ledger.calls, ...detail };
}

// ---------------------------------------------------------------------------
// Secrets: nothing the runner holds in memory may land in the run folder.
// ---------------------------------------------------------------------------

export const SECRET_PATTERNS = Object.freeze([
  ['Supabase secret key (sb_secret_)', /sb_secret_[A-Za-z0-9_-]{8,}/],
  ['Anthropic key (sk-ant-)', /sk-ant-[A-Za-z0-9_-]{8,}/],
  ['client review token URL (/review/<token>)', /\/review\/[A-Za-z0-9_-]{40,}/],
  // Supabase session access tokens (and any other JWT): header.payload.signature, base64url.
  ['JWT (eyJ… three-part token, e.g. a Supabase session)', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  // @supabase/ssr cookies sb-<ref>-auth-token[.N][-code-verifier] with a value: cookie header, JSON key or a {name, value} cookie object.
  ['Supabase auth cookie (sb-…-auth-token)', /sb-[A-Za-z0-9-]+-auth-token[A-Za-z0-9.-]*(?:\s*=\s*|"\s*:\s*"|"\s*,\s*"value"\s*:\s*")["']?[A-Za-z0-9+/=_.%-]{16,}/],
  ['Authorization: Bearer token', /(?:authorization["']?\s*[:=]\s*["']?)?\bbearer\s+[A-Za-z0-9._~+/-]{16,}/i],
]);

/**
 * Scan every file under `dir` for the literal secrets (by name; values are
 * never returned or printed) and the secret patterns. Compressed formats
 * (.pptx, compressed PDF streams) are scanned as bytes only.
 */
export function scanForSecrets(dir, literals = []) {
  const secrets = literals.filter(item => typeof item.value === 'string' && item.value.length >= 6)
    .map(item => ({ name: item.name, needles: [...new Set([item.value, JSON.stringify(item.value).slice(1, -1)])].map(text => Buffer.from(text, 'utf8')) }));
  const hits = [];
  let files = 0, bytes = 0;
  const walk = folder => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.isFile()) continue;
      const buffer = readFileSync(file);
      files++; bytes += buffer.length;
      const text = buffer.toString('latin1');
      for (const secret of secrets) if (secret.needles.some(needle => buffer.includes(needle))) hits.push({ file: rel(file), secret: secret.name });
      for (const [name, pattern] of SECRET_PATTERNS) if (pattern.test(text)) hits.push({ file: rel(file), secret: name });
    }
  };
  if (existsSync(dir)) walk(dir);
  return { ok: hits.length === 0, files, bytes, hits };
}

// ---------------------------------------------------------------------------
// Watchdog: a detached helper that, if the runner dies without its cleanup
// (taskkill /F, a crash), kills the server tree, disables the provider limits
// and then scans the run folder for secrets (secret-scan-watchdog.json; names
// only). It learns the runner is gone when its stdin pipe closes without a
// "done" line. (A tree kill of the runner, taskkill /T, also kills it.) The
// literal secrets for that scan arrive over the same private stdin pipe, never
// through its environment or command line.
// ---------------------------------------------------------------------------

const WATCHDOG_SOURCE = String.raw`'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const env = process.env;
const log = line => { try { fs.appendFileSync(env.EVAL_WATCHDOG_LOG, new Date().toISOString() + ' ' + line + '\n'); } catch { /* best effort */ } };
let done = false, acting = false, serverPid = null, buffer = '', secrets = [];
log('watchdog started for runner pid ' + env.EVAL_WATCHDOG_PARENT);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
    const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
    if (line === 'done') { done = true; log('runner finished its own cleanup; watchdog exits'); process.exit(0); }
    const match = /^server (\d+)$/.exec(line);
    if (match) { serverPid = Number(match[1]); log('watching server pid ' + serverPid); }
    const held = /^secrets ([A-Za-z0-9+/=]+)$/.exec(line);
    if (held) {
      try {
        secrets = JSON.parse(Buffer.from(held[1], 'base64').toString('utf8')).filter(item => item && typeof item.value === 'string' && item.value.length >= 6)
          .map(item => ({ name: String(item.name), needles: [...new Set([item.value, JSON.stringify(item.value).slice(1, -1)])].map(text => Buffer.from(text, 'utf8')) }));
        log('holding ' + secrets.length + ' secret(s) for the final scan: ' + secrets.map(secret => secret.name).join(', '));
      } catch (error) { log('secrets line unreadable: ' + String(error && error.message).slice(0, 120)); }
    }
  }
});
const scan = () => {
  const dir = env.EVAL_WATCHDOG_RUNDIR;
  if (!dir) return;
  try {
    const patterns = JSON.parse(env.EVAL_WATCHDOG_PATTERNS || '[]').map(item => ({ name: item.name, re: new RegExp(item.source, item.flags) }));
    const hits = [];
    let files = 0;
    const walk = folder => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) { walk(file); continue; }
        if (!entry.isFile()) continue;
        const bytes = fs.readFileSync(file);
        files++;
        const text = bytes.toString('latin1');
        const name = path.relative(dir, file).split(path.sep).join('/');
        for (const secret of secrets) if (secret.needles.some(needle => bytes.includes(needle))) hits.push({ file: name, secret: secret.name });
        for (const pattern of patterns) if (pattern.re.test(text)) hits.push({ file: name, secret: pattern.name });
      }
    };
    walk(dir);
    fs.writeFileSync(path.join(dir, 'secret-scan-watchdog.json'), JSON.stringify({ by: 'watchdog', at: new Date().toISOString(), ok: hits.length === 0, files, literals: secrets.length, hits }, null, 2) + '\n');
    log('secret scan: ' + (hits.length ? hits.length + ' hit(s), values not printed: ' + hits.map(hit => hit.file + ' [' + hit.secret + ']').join(', ') + '. Delete or redact those files before sharing outputs/.' : 'clean (' + files + ' files)'));
  } catch (error) { log('SECRET SCAN FAILED: ' + String(error && error.message).slice(0, 200)); }
};
const finish = code => { scan(); process.exit(code); };
const act = async () => {
  if (done || acting) return;
  acting = true;
  log('runner ended without cleanup: stopping the server and disabling provider limits');
  if (serverPid) {
    if (process.platform === 'win32') { const result = spawnSync(env.EVAL_WATCHDOG_TASKKILL, ['/PID', String(serverPid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); log('taskkill server tree exit ' + result.status); }
    else { try { process.kill(serverPid, 'SIGKILL'); log('server killed'); } catch (error) { log('server kill: ' + error.code); } }
  }
  if (env.EVAL_WATCHDOG_DRY === '1') { log('dry run: would disable provider limits ' + env.EVAL_WATCHDOG_SCOPES); finish(0); return; }
  let client;
  try {
    const pg = require(env.EVAL_WATCHDOG_PG);
    client = new pg.Client({ connectionString: env.EVAL_WATCHDOG_DB, connectionTimeoutMillis: 5000, query_timeout: 15000, application_name: 'makeborne-eval-watchdog' });
    await client.connect();
    for (const scope of env.EVAL_WATCHDOG_SCOPES.split(',')) await client.query('select makeborne_private.set_live_provider_limit($1, false, 0, false, $2)', [scope, 'Eval watchdog: runner ended without cleanup']);
    const { rows } = await client.query('select scope, enabled from makeborne_private.live_provider_limits order by scope');
    log('provider limits after: ' + rows.map(row => row.scope + ':' + (row.enabled ? 'ENABLED' : 'off')).join(', '));
    await client.end();
  } catch (error) {
    log('DISABLING PROVIDER LIMITS FAILED: ' + String(error && error.message).slice(0, 200));
    finish(1);
    return;
  }
  finish(0);
};
process.stdin.on('end', act);
process.stdin.on('close', act);
process.stdin.on('error', act);
`;

/** SECRET_PATTERNS as data for the watchdog (one definition for both scans). */
const serializedPatterns = () => JSON.stringify(SECRET_PATTERNS.map(([name, pattern]) => ({ name, source: pattern.source, flags: pattern.flags })));

export function startWatchdog({ logFile, dbUrl = null, scopes = LIMIT_SCOPES, dry = false, runDir = null }) {
  const env = { EVAL_WATCHDOG_LOG: logFile, EVAL_WATCHDOG_PARENT: String(process.pid), EVAL_WATCHDOG_TASKKILL: TASKKILL, EVAL_WATCHDOG_SCOPES: scopes.join(','),
    EVAL_WATCHDOG_DRY: dry ? '1' : '0', EVAL_WATCHDOG_PG: require.resolve('pg'), EVAL_WATCHDOG_PATTERNS: serializedPatterns(),
    ...(runDir ? { EVAL_WATCHDOG_RUNDIR: runDir } : {}), ...(dbUrl ? { EVAL_WATCHDOG_DB: dbUrl } : {}) };
  for (const key of ['SystemRoot', 'PATH', 'Path', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  const child = spawn(process.execPath, ['-e', WATCHDOG_SOURCE], { detached: true, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'], env });
  child.unref();
  child.stdin.on('error', () => undefined);
  return {
    pid: child.pid, child,
    watchServer(pid) { if (pid && child.stdin.writable) child.stdin.write(`server ${pid}\n`); },
    /** Literal secrets for the watchdog's own final scan: over the stdin pipe only (values never logged). */
    watchSecrets(list) {
      const held = list.filter(item => typeof item?.value === 'string' && item.value.length >= 6).map(item => ({ name: item.name, value: item.value }));
      if (held.length && child.stdin.writable) child.stdin.write(`secrets ${Buffer.from(JSON.stringify(held), 'utf8').toString('base64')}\n`);
    },
    done() { if (child.stdin.writable) child.stdin.end('done\n'); },
  };
}

// ---------------------------------------------------------------------------
// One cleanup for every way a live run ends (normal end, error, Ctrl+C,
// SIGTERM/SIGBREAK/SIGHUP, uncaught exception), run exactly once.
// ---------------------------------------------------------------------------

export const LIVE_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']);

/** The run is stopping (a signal, an error or its normal end): nothing new may reserve or enable limits. */
export class RunStopping extends Error {
  constructor(message) { super(message); this.code = 'EVAL_RUN_STOPPING'; }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Resolves true when `promise` settles within `ms`, false on timeout (never rejects). */
const settlesWithin = (promise, ms) => {
  let timer;
  return Promise.race([Promise.resolve(promise).then(() => true, () => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); })]).finally(() => clearTimeout(timer));
};

/**
 * deps: disableLimits(note) -> {readback}, stopServer(server), settleUnknown(id, detail),
 * closeBrowser(browser), portInUse(), flushLogs(), writeRun(result), scan(dir, secrets),
 * writeScan(scan), exit(code), log.
 *
 * Order of a stop: `stopping` is set first (synchronously), so runBrief and the
 * runLive loop refuse to reserve or to enable limits from then on; cleanup()
 * waits for an enable already in flight (it re-checks `stopping` before every
 * write), disables the limits with a read-back, stops the server, keeps open
 * reservations at their bound. finish() then waits for the main flow (whose
 * runBrief disables its limits again and settles its own reservation), writes
 * run.json, runs the secret scan as the very last step, and only then stands
 * the watchdog down (if the limits are verifiably off and the main flow ended).
 */
export function createLiveControl({ runDir, runId, deps, enableWaitMs = 30_000, mainWaitMs = 120_000 }) {
  const control = {
    server: null, browser: null, watchdog: null, open: new Set(), secrets: [], signal: null, handlers: new Map(),
    stopping: null, cleaning: null, finishing: null, main: null, limitsInFlight: null,
    /** Throws RunStopping once cleanup has begun. */
    assertRunning(where) { if (control.stopping) throw new RunStopping(`${where}: the run is stopping (${control.stopping})`); },
    /** Enable limits through `enable(guard)`; refused once stopping, and cleanup waits for it before disabling. */
    async enableLimits(enable) {
      control.assertRunning('before enabling provider limits');
      const pending = enable(() => control.assertRunning('enabling provider limits'));
      const tracked = Promise.resolve(pending).then(() => undefined, () => undefined);
      control.limitsInFlight = tracked;
      try { return await pending; } finally { if (control.limitsInFlight === tracked) control.limitsInFlight = null; }
    },
    /** The main flow (runLive's brief loop); finish() waits for it before the scan and the watchdog stand-down. */
    track(main) { control.main = Promise.resolve(main).then(() => undefined, () => undefined); return main; },
    cleanup(reason) {
      control.stopping ??= reason;
      control.cleaning ??= (async () => {
        const result = { reason, at: new Date().toISOString() };
        // 0. An enable already in flight re-checks `stopping` before each write; let it end first.
        if (control.limitsInFlight) result.waitedForEnable = await settlesWithin(control.limitsInFlight, enableWaitMs);
        // 1. No new provider call can start once the limits are off.
        try { result.limitsOff = await deps.disableLimits(`Eval ${runId}: cleanup (${reason})`); }
        catch (error) { result.limitsOff = { error: `DISABLING PROVIDER LIMITS FAILED: ${error.message}. Disable them by hand now.` }; deps.log(`\n!! ${result.limitsOff.error}`); }
        // 2. The server (and its workers) hold the Anthropic key.
        try { result.server = deps.stopServer(control.server); } catch (error) { result.server = { stopped: false, reason: error.message }; }
        // 3. Anything still reserved stays counted at its full bound.
        result.settledUnknown = [];
        for (const id of [...control.open]) {
          try { await deps.settleUnknown(id, { reason: `run ended (${reason}) before the brief was settled` }); result.settledUnknown.push(id); }
          catch (error) { result.settleErrors = [...(result.settleErrors ?? []), String(error.message).slice(0, 200)]; }
          control.open.delete(id);
        }
        if (control.browser) await settlesWithin(deps.closeBrowser(control.browser), 10_000);
        if (control.server) {
          let busy = true;
          for (let attempt = 0; attempt < 10 && busy; attempt++) { busy = await deps.portInUse(); if (busy) await delay(500); }
          result.server = { ...result.server, portFree: !busy };
          if (busy) deps.log(`\n!! Port ${NEXT_PORT} is still listening after the server was stopped: check for a leftover next dev process.`);
        }
        return result;
      })();
      return control.cleaning;
    },
    finish(reason) {
      control.stopping ??= reason;
      control.finishing ??= (async () => {
        const result = await control.cleanup(reason);
        // 4. The main flow ends quickly once stopping (its stage requests fail on the stopped
        //    server, runBrief disables its limits and settles); it is not waited for forever.
        result.mainFinished = control.main ? await settlesWithin(control.main, mainWaitMs) : true;
        if (!result.mainFinished) deps.log(`\n!! The main flow did not end within ${Math.round(mainWaitMs / 1000)} s; the watchdog stays armed.`);
        // 4b. An enable still in flight when cleanup disabled (waitedForEnable false), or a brief whose
        //     own disable failed, can leave a scope switched on after step 1. Disable once more, now
        //     that the main flow is over, and require the read-back before the watchdog may stand down.
        try { result.limitsFinal = await deps.disableLimits(`Eval ${runId}: final check (${reason})`); }
        catch (error) { result.limitsFinal = { error: `FINAL DISABLE FAILED: ${error.message}. Disable them by hand now.` }; deps.log(`\n!! ${result.limitsFinal.error}`); }
        if (deps.flushLogs) await settlesWithin(deps.flushLogs(), 10_000);
        // 5. run.json, then the secret scan as the very last step over every file of the run.
        try { deps.writeRun(result); } catch (error) { deps.log(`!! run.json not written: ${error.message}`); }
        try { result.secretScan = deps.scan(runDir, control.secrets); } catch (error) { result.secretScan = { ok: false, error: error.message, files: 0, hits: [] }; }
        try { deps.writeScan?.(result.secretScan); } catch (error) { deps.log(`!! secret-scan.json not written: ${error.message}`); }
        if (!result.secretScan.ok) deps.log(`\n!! Secret material found in the run folder (values not printed): ${result.secretScan.error ?? result.secretScan.hits.map(hit => `${hit.file} [${hit.secret}]`).join(', ')}. Delete or redact those files before sharing outputs/.`);
        // 6. The watchdog stands down only after all of that, with the limits verifiably off.
        if (control.watchdog) {
          if (!result.limitsOff?.error && !result.limitsFinal?.error && result.mainFinished) { control.watchdog.done(); result.watchdog = 'stood down'; }
          else { result.watchdog = 'armed'; deps.log('   The watchdog stays armed: it disables the limits again (and scans the run folder) when this process exits.'); }
        }
        result.exitCode = result.limitsOff?.error || result.limitsFinal?.error || !result.secretScan.ok || result.server?.portFree === false || !result.mainFinished ? 1 : 0;
        return result;
      })();
      return control.finishing;
    },
    onSignal(signal, error) {
      control.stopping ??= signal;
      if (error) deps.log(`\n!! ${signal}: ${String(error?.stack ?? error).split('\n').slice(0, 3).join(' | ')}`);
      if (control.signal) { deps.log(`(${signal}: cleanup is already running)`); return; }
      control.signal = signal;
      deps.log(`\n!! ${signal}: stopping the live run (provider limits off, server stopped, open reservations kept at their bound)…`);
      control.finish(signal).then(result => deps.exit(result.exitCode || (signal === 'SIGINT' ? 130 : 1)), () => deps.exit(1));
    },
    install(target = process) {
      for (const signal of LIVE_SIGNALS) control.handlers.set(signal, () => control.onSignal(signal));
      control.handlers.set('uncaughtException', error => control.onSignal('uncaughtException', error));
      control.handlers.set('unhandledRejection', error => control.onSignal('unhandledRejection', error));
      for (const [event, handler] of control.handlers) target.on(event, handler);
    },
    uninstall(target = process) {
      for (const [event, handler] of control.handlers) target.off(event, handler);
      control.handlers.clear();
    },
  };
  return control;
}

/** A signed-in studio session: Playwright for the login and cookie jar, Node fetch for streaming. */
async function signIn(browser, fixture) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(180_000);
  await page.goto(`${ORIGIN}/login`);
  await page.locator('#account-email').fill(fixture.email);
  await page.locator('#account-password').fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 120_000 });
  await page.close();
  let refreshedAt = 0;
  const session = {
    context, userId: fixture.userId, workspaceId: fixture.workspaceId,
    /** A cheap authenticated GET through the app so an expiring session is refreshed into the jar. */
    async refresh(force = false) {
      if (!force && Date.now() - refreshedAt < 60_000) return;
      await context.request.get(`${ORIGIN}/api/credits`, { headers: { 'X-Makeborne-Account': fixture.userId } });
      refreshedAt = Date.now();
    },
    async fetch(pathname, { method = 'GET', body, idempotent = false, idempotencyKey = null, timeoutMs = 120_000 } = {}) {
      await session.refresh();
      const cookies = await context.cookies(ORIGIN);
      const response = await fetch(`${ORIGIN}${pathname}`, {
        method, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        headers: { Origin: ORIGIN, Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), 'X-Makeborne-Account': fixture.userId,
          ...(body ? { 'Content-Type': 'application/json' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : idempotent ? { 'Idempotency-Key': randomUUID() } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      // Keep any rotated auth cookie in the shared jar.
      const updates = response.headers.getSetCookie?.() ?? [];
      if (updates.length) {
        await context.addCookies(updates.map(header => {
          const [pair, ...attributes] = header.split(';');
          const at = pair.indexOf('=');
          const maxAge = attributes.map(item => /^\s*max-age=(-?\d+)/i.exec(item)?.[1]).find(Boolean);
          return { name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim(), url: ORIGIN, ...(maxAge ? { expires: Math.floor(Date.now() / 1000) + Number(maxAge) } : {}) };
        })).catch(() => undefined);
      }
      return response;
    },
  };
  await session.refresh(true);
  return session;
}

// ===========================================================================
// Live mode: one brief
// ===========================================================================

/** Events as stored in events.jsonl: big payloads truncated, documents summarised. */
function compactEvent(stage, event) {
  const copy = { stage, ...event };
  if (copy.type === 'document' && copy.document) {
    copy.document = { title: copy.document.title, kind: copy.document.kind, slides: copy.document.slides?.length, chapters: copy.document.chapters?.length, chars: JSON.stringify(copy.document).length };
  }
  for (const [key, value] of Object.entries(copy)) if (typeof value === 'string' && value.length > 2048) copy[key] = `${value.slice(0, 2048)}…[${value.length} chars]`;
  return copy;
}

/** Request bodies without screenshots, for requests.json. */
function compactRequest(body) {
  if (!body?.review) return body;
  return { ...body, review: { round: body.review.round, ...describeCapture(body.review) } };
}

export class Item {
  constructor(runDir, brief, runId) {
    this.dir = ensureDir(path.join(runDir, brief.id));
    this.brief = brief; this.runId = runId;
    this.stageIndex = 0; this.requests = []; this.terminals = {}; this.actionKeys = []; this.credits = {};
    this.status = { ok: false, stage: 'start', code: null, message: null };
    ensureDir(path.join(this.dir, 'events'));
  }

  /** POST one SSE stage and store raw + parsed events. Never retried. */
  async stage(session, name, pathname, body) {
    this.beforeStage?.(name); // throws RunStopping once the run is stopping: no new paid stage
    const index = ++this.stageIndex;
    const started = Date.now();
    const record = { stage: name, method: 'POST', path: pathname, body: compactRequest(body), startedAt: new Date().toISOString() };
    this.requests.push(record);
    this.status.stage = name;
    console.log(`    ${name} …`);
    let response;
    try { response = await session.fetch(pathname, { method: 'POST', body, timeoutMs: STAGE_TIMEOUT_MS }); }
    catch (error) { return this.#finishStage(name, record, started, { type: 'error', code: 'REQUEST_FAILED', message: error.message, preStream: true }, []); }
    record.status = response.status;
    if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
      const text = await response.text().catch(() => '');
      writeFileSync(path.join(this.dir, 'events', `${index}-${name}.error.json`), text);
      let payload = null;
      try { payload = JSON.parse(text); } catch { /* not JSON */ }
      return this.#finishStage(name, record, started, { type: 'error', code: payload?.error?.code ?? `HTTP_${response.status}`, message: payload?.error?.message ?? text.slice(0, 300), status: response.status, preStream: true, operation: payload?.operation ?? null }, []);
    }
    const sseFile = path.join(this.dir, 'events', `${index}-${name}.sse`);
    writeFileSync(sseFile, '');
    const eventsFile = path.join(this.dir, 'events.jsonl');
    let files = 0;
    const result = await readSse(response, {
      onText: part => appendFileSync(sseFile, part),
      onEvent: event => {
        appendFileSync(eventsFile, JSON.stringify(compactEvent(name, event)) + '\n');
        if (event.type === 'file' || event.type === 'item') files++;
      },
    });
    const terminal = result.terminal ?? { type: 'error', code: result.streamError ? 'STREAM_FAILED' : 'STREAM_CLOSED', message: result.streamError ?? 'The stream closed before a done or error event' };
    const touched = new Set(result.events.filter(event => event.type === 'file' || event.type === 'delete').map(event => event.path)).size;
    console.log(`    ${name}: ${terminal.type}${terminal.code ? ` ${terminal.code}` : ''}${terminal.version !== undefined ? ` v${terminal.version}` : ''}, ${files} writes, charged ${terminal.charged ?? 'n/a'} cr, ${Math.round((Date.now() - started) / 1000)} s`);
    return this.#finishStage(name, record, started, terminal, result.events, { touched, operation: lastOperation(result.events) });
  }

  #finishStage(name, record, started, terminal, events, extra = {}) {
    record.ms = Date.now() - started;
    if (terminal.preStream) console.log(`    ${name}: refused before streaming: ${terminal.code} ${String(terminal.message ?? '').slice(0, 160)}`);
    record.terminal = { type: terminal.type, code: terminal.code ?? null };
    this.terminals[name] = terminal;
    if (typeof terminal.charged === 'number') this.credits[name] = terminal.charged;
    if (terminal.type === 'error' && !this.status.code) { this.status.code = terminal.code ?? 'ERROR'; this.status.message = String(terminal.message ?? '').slice(0, 500); }
    // The studio's RunResult (live-builder.tsx stream()): only a done event yields one.
    const result = terminal.type === 'done' ? { version: Number(terminal.version), changed: terminal.changed !== false, finished: terminal.finished !== false,
      touched: extra.touched ?? 0, operation: extra.operation ?? terminal.operation ?? null } : null;
    return { terminal, events, result, plan: events.find(event => event.type === 'plan') ?? null };
  }

  save() {
    writeJson(path.join(this.dir, 'requests.json'), this.requests);
    writeJson(path.join(this.dir, 'terminal.json'), this.terminals);
    writeJson(path.join(this.dir, 'status.json'), this.status);
  }
}

async function savedVersion(artifactId, versionNumber) {
  return withReadOnly('release-auth', async client => {
    const { rows: [artifact] } = await client.query('select current_version from public.artifacts where id = $1', [artifactId]);
    const number = versionNumber ?? artifact?.current_version;
    const { rows: [row] } = await client.query(`select id, version_number, parent_version_id, content, style_snapshot, asset_manifest, change_summary, created_by, created_at
      from public.artifact_versions where artifact_id = $1 and version_number = $2`, [artifactId, number]);
    return { currentVersion: artifact?.current_version ?? null, row: row ?? null };
  });
}

/** Provider ledger rows of this brief's operations (plan + build), read-only. */
async function ledgerFor(userId, actionKeys) {
  if (!actionKeys.length) return { calls: [], actualMicrousd: 0, open: 0 };
  return withReadOnly('release-auth', async client => {
    const { rows } = await client.query(`
      select c.id, o.kind operation_kind, o.action_key, r.kind run_kind, c.provider, c.model, c.status, c.overrun,
             c.bound_microusd::text bound, c.actual_microusd::text actual, c.charged_microusd::text charged, c.partial_microusd::text partial, c.created_at
        from makeborne_private.ai_operations o
        join makeborne_private.ai_operation_runs r on r.operation_id = o.id
        join makeborne_private.live_provider_calls c on c.run_reference = 'operation:' || r.id
       where o.actor = $1 and o.action_key = any($2::uuid[])
       order by c.created_at`, [userId, actionKeys]);
    const calls = rows.map(row => ({ id: row.id, operationKind: row.operation_kind, runKind: row.run_kind, provider: row.provider, model: row.model, status: row.status, overrun: row.overrun,
      boundUsd: usd(row.bound), actualUsd: row.actual === null ? null : usd(row.actual), chargedUsd: row.charged === null ? null : usd(row.charged), partialUsd: usd(row.partial), createdAt: row.created_at }));
    // Unknown or open calls keep their full bound (same rule as the budget ledger).
    const actualMicrousd = rows.reduce((sum, row) => sum + Number(row.charged ?? row.bound), 0);
    return { calls, actualMicrousd, open: rows.filter(row => row.status === 'open' || row.status === 'uncertain').length };
  });
}

async function assetData(session, workspaceId, artifactId, assets, variant) {
  const list = [];
  for (const asset of assets) {
    const response = await session.fetch(`/api/cloud/workspaces/${workspaceId}/artifacts/${artifactId}/assets/${asset.id}?variant=${variant}`);
    if (!response.ok) { list.push({ ...asset, error: `HTTP ${response.status}` }); continue; }
    list.push({ ...asset, bytes: Buffer.from(await response.arrayBuffer()), mediaType: 'image/webp' });
  }
  return list;
}

/** The enhanced-brief call's provider dollars, from the provider-call ledger by its durable action's hold reference (read-only). */
async function enhancerLedger(actionKey) {
  return withReadOnly('release-auth', async client => {
    const { rows } = await client.query(`select c.status, c.bound_microusd::text bound, c.charged_microusd::text charged from makeborne_private.live_provider_calls c
      join makeborne_private.brief_enhancements e on e.reference = c.run_reference where e.action_key = $1`, [actionKey]);
    return { calls: rows.length, open: rows.filter(row => row.status === 'open' || row.status === 'uncertain').length, actualMicrousd: rows.reduce((sum, row) => sum + Number(row.charged ?? row.bound), 0) };
  });
}

async function runBrief({ session, browser, brief, runDir, runId, pricing, images, rerun, withPlan = false, enhance = false, answers = false, control, deps = {} }) {
  // deps: injected fakes for the self-test; the defaults are the real functions.
  const { reserveFn = SCOPE ? args => reserveScoped({ ...args, scope: SCOPE }) : reserve, setLimits = setProviderLimits, settleBriefFn = settleBrief, settleFn = settle, save = saveOutputs, midnight = midnightWaitMs, now = Date.now, sleep = delay } = deps;
  const kind = brief.kind;
  const boundUsd = boundFor(kind, pricing, withPlan);
  // The studio's enhanced-brief step (first website build in Create mode): its own 1-credit hold.
  // ...only for short briefs, as the studio decides (detailed briefs build from the client's words and answers).
  const enhancedModule = enhance ? loadApp('src/lib/builder/enhanced-brief.ts') : null;
  // (detailed briefs get the free analysis instead of the enhancement; the route decides from `original`).
  const enhancerBoundUsd = enhance && kind === 'website' && !withPlan ? round2(enhancedModule.ENHANCER_CREDITS * pricing.costPerCreditUsd) : 0;
  const scopes = images ? ['global', 'anthropic', 'openai'] : ['global', 'anthropic'];
  control.assertRunning(`${brief.id}: before the midnight check`);
  // The whole brief (until its limits are disabled again) must fit before 00:00 UTC.
  const worstCaseMs = briefWorstCaseMs(kind, pricing);
  const pause = midnight(now(), worstCaseMs);
  if (pause > MAX_MIDNIGHT_WAIT_MS) throw new MidnightRefusal(`${brief.id} could run ${Math.round(worstCaseMs / 60_000)} min, past 00:00 UTC, and waiting for midnight would take ${Math.round(pause / 60_000)} min (over ${MAX_MIDNIGHT_WAIT_MS / 3_600_000} h); start the run after 00:00 UTC`);
  if (pause) {
    console.log(`    waiting ${Math.round(pause / 1000)} s for 00:00 UTC: ${brief.id} could run ${Math.round(worstCaseMs / 60_000)} min and daily provider limits reset at midnight`);
    // In 1 s steps, so a stop during the wait is noticed at once.
    for (const until = now() + pause; now() < until;) { control.assertRunning(`${brief.id}: waiting for 00:00 UTC`); await sleep(Math.min(1000, until - now())); }
  }
  // Reserve the worst case before anything is written or paid; CapReached stops
  // the run here, DuplicateReservation refuses a brief that already ran.
  control.assertRunning(`${brief.id}: before reserving`);
  const reservationId = await reserveFn({ kind: 'runner', ref: brief.id, boundUsd, note: `${runId} ${kind} ${EFFORT}${kind === 'website' ? (withPlan ? ' plan' : ' create') : ''}`, unique: !rerun });
  control.open.add(reservationId);
  const item = new Item(runDir, brief, runId);
  const itemJson = { id: brief.id, kind, title: brief.title, direction: brief.direction, briefId: brief.id, brief: brief.brief, briefSha256: brief.sha256,
    origin: { type: 'live', stack: `release-auth:${DB_PORT}`, workspaceId: session.workspaceId, projectId: null, artifactId: null, version: null, path: null },
    generation: { effort: EFFORT, styleId: 'automatic', mode: kind === 'website' ? (withPlan ? 'plan' : 'create') : 'create', plan: kind === 'website' ? (withPlan ? 'approved as proposed' : 'none (Create mode, the studio default)') : 'none (documents have no plan mode)', reviewRounds: kind === 'website' ? pricing.autoReviewRounds : 0,
      briefQuestions: 'skipped (as "Skip questions"; the studio would make a separate small AI call)', images: images ? 'on' : 'off', routing: ROUTES ? { on: true, routes: ROUTES } : { on: false }, ...(SCOPE ? { scope: SCOPE } : {}) } };
  const cost = { boundUsd, reservationId, actualUsd: null, calls: [], credits: item.credits, operations: [] };
  item.beforeStage = name => control.assertRunning(`${brief.id}: before ${name}`);
  let limitsFailure = null;
  try {
    // A stop that arrived while the reservation was pending: never enable limits for it.
    control.assertRunning(`${brief.id}: after the reservation`);
    writeJson(path.join(item.dir, 'item.json'), itemJson);
    copyFileSync(brief.file, path.join(item.dir, 'brief.json'));
    // Today's spend is read now, after the reservation: the limit allows this brief's bound and no more.
    // enableLimits refuses once the run is stopping and the guard re-checks before every scope write.
    const limits = await control.enableLimits(guard => setLimits({ enabled: true, boundUsd: round2(boundUsd + enhancerBoundUsd), scopes, note: `Eval ${runId}: ${brief.id} (bound ${money(boundUsd)})`, guard }));
    cost.limits = limits.set;

    // Project and artifact, exactly as the studio's create routes take them.
    const title = `[eval ${runId}] ${brief.title}`.slice(0, 160);
    const projectResponse = await session.fetch(`/api/cloud/workspaces/${session.workspaceId}/projects`, { method: 'POST', idempotent: true, body: { title, kind, styleId: 'automatic', brief: brief.brief } });
    const project = await projectResponse.json().catch(() => null);
    item.requests.push({ stage: 'create-project', method: 'POST', path: '/api/cloud/workspaces/:ws/projects', body: { title, kind, styleId: 'automatic', brief: '(item.json brief)' }, status: projectResponse.status });
    if (projectResponse.status !== 201) throw Object.assign(new Error(`create project: ${project?.error?.message ?? projectResponse.status}`), { code: project?.error?.code ?? 'CREATE_FAILED' });
    const artifactResponse = await session.fetch(`/api/cloud/workspaces/${session.workspaceId}/projects/${project.project.id}/artifacts`, { method: 'POST', idempotent: true, body: { title, kind } });
    const artifact = await artifactResponse.json().catch(() => null);
    item.requests.push({ stage: 'create-artifact', method: 'POST', path: '/api/cloud/workspaces/:ws/projects/:project/artifacts', body: { title, kind }, status: artifactResponse.status });
    if (artifactResponse.status !== 201) throw Object.assign(new Error(`create artifact: ${artifact?.error?.message ?? artifactResponse.status}`), { code: artifact?.error?.code ?? 'CREATE_FAILED' });
    const artifactId = artifact.artifact.id;
    Object.assign(itemJson.origin, { projectId: project.project.id, artifactId });
    writeJson(path.join(item.dir, 'item.json'), itemJson);
    const base = { workspaceId: session.workspaceId, artifactId };
    // The studio's first message is the brief, capped like cloud-studio.tsx does.
    // --answers: the studio's one-click design questions for this brief, answered as the frozen brief's
    // simulatedAnswers say (only questions the app asks; skips and "you choose" set nothing).
    let design = null, asked = [];
    let full = brief.brief.trim();
    if (answers && kind === 'website' && brief.simulatedAnswers) {
      const questions = loadApp('src/lib/builder/brief-questions.ts');
      const list = questions.briefQuestions('website', brief.brief);
      const chosen = Object.fromEntries(list.map(question => { const value = brief.simulatedAnswers[question.id]; return [question.id, Array.isArray(value) ? { options: value } : typeof value === 'string' ? { option: value } : {}]; }));
      asked = list.map(question => question.id);
      full = questions.briefWithAnswers(brief.brief, list, chosen);
      design = questions.designAnswers(list, chosen);
      itemJson.generation.briefQuestions = `on-device design questions answered from simulatedAnswers: ${asked.join(', ')}`;
    }
    const message = full.length > 8000 ? `${full.slice(0, 7400).replace(/\s+\S*$/, '')}…\n\n(The full brief is in the project details.)` : full;

    let approvedBrief = null;
    if (enhancerBoundUsd) {
      const enhancerReservation = await reserveFn({ kind: 'runner-enhancer', ref: brief.id, boundUsd: enhancerBoundUsd, note: `${runId} brief enhancer`, unique: !rerun });
      control.open.add(enhancerReservation);
      // The studio's explicit "Improve my brief first" choice: one durable action per Idempotency-Key.
      const enhanceKey = randomUUID();
      const response = await session.fetch('/api/build/enhance', { method: 'POST', idempotencyKey: enhanceKey, body: { ...base, brief: message, original: brief.brief.trim().slice(0, 8000), ...(design && Object.keys(design).length ? { design } : {}) } });
      const value = await response.json().catch(() => null);
      item.requests.push({ stage: 'enhance', method: 'POST', path: '/api/build/enhance', status: response.status });
      const usable = response.ok && typeof value?.text === 'string' && value?.action?.status === 'completed';
      writeJson(path.join(item.dir, 'enhanced.json'), { status: response.status, enhanced: value?.enhanced ?? null, text: value?.text ?? null, charged: value?.charged ?? null, providerMicrousd: value?.providerMicrousd ?? null, error: usable ? null : value?.error ?? null });
      // Settled from the provider-call ledger; a failed enhancement names no reference, so its full bound stays counted.
      const ledger = usable ? await enhancerLedger(enhanceKey).catch(() => null) : null;
      await settleFn(enhancerReservation, ledger && !ledger.open && ledger.calls ? { actualUsd: usd(ledger.actualMicrousd), detail: { calls: ledger.calls } } : { unknown: true, detail: { status: response.status, reason: usable ? 'ledger unreadable or open' : 'enhancement failed (fail open)' } });
      control.open.delete(enhancerReservation);
      cost.enhancer = { boundUsd: enhancerBoundUsd, reservationId: enhancerReservation, status: response.status, usable, actualUsd: ledger && !ledger.open ? usd(ledger.actualMicrousd) : null, charged: value?.charged ?? null };
      if (usable) approvedBrief = { mode: value.mode === 'analyze' ? 'analysis' : 'enhanced', text: value.text };
      itemJson.generation.enhancer = cost.enhancer; writeJson(path.join(item.dir, 'item.json'), itemJson);
    }

    let approvedPlan = null, planRevision = null;
    // Create mode (the studio composer's default) sends the brief straight to the builder;
    // --plan runs Plan mode first and builds the plan as proposed.
    if (kind === 'website' && withPlan) {
      const planKey = randomUUID();
      item.actionKeys.push(planKey); cost.operations.push({ kind: 'plan', actionKey: planKey });
      const planned = await item.stage(session, 'plan', '/api/build/plan', { ...base, expectedVersion: 0, expectedRevision: 0, message, effort: EFFORT, attachments: [], approvedMaximum: pricing.planCeilingCredits,
        operation: { actionKey: planKey, stepKey: randomUUID() } });
      if (!planned.result || !planned.plan?.stored?.plan) throw Object.assign(new Error(planned.terminal.message ?? 'No plan was produced'), { code: planned.terminal.code ?? 'PLAN_MISSING', stage: 'plan' });
      approvedPlan = planned.plan.stored.plan; planRevision = planned.plan.stored.revision;
      writeJson(path.join(item.dir, 'plan.json'), { stored: planned.plan.stored, estimate: planned.plan.estimate, recommended: planned.plan.recommended, persisted: planned.plan.persisted });
    }

    // Build (the approved plan for websites), then continuations exactly like live-builder.tsx.
    const buildKey = randomUUID();
    item.actionKeys.push(buildKey); cost.operations.push({ kind: 'build', actionKey: buildKey });
    const built = await item.stage(session, 'build', '/api/build', { ...base, expectedVersion: 0,
      message: approvedPlan ? `Build the approved plan: ${approvedPlan.title}` : message, effort: EFFORT,
      // A new request names the maximum the studio showed (the effort ceiling), as live-builder.tsx sends it.
      approvedMaximum: pricing.buildCeilingCredits,
      operation: { actionKey: buildKey, stepKey: randomUUID() }, attachments: [], ...(approvedPlan ? { plan: approvedPlan } : {}), ...(approvedBrief ? { brief: approvedBrief } : {}), ...(!approvedPlan && design && Object.keys(design).length ? { design } : {}) });
    let result = built.result;
    if (result && approvedPlan) {
      // planner.markBuilt(): mark the plan built after the first saved build (free).
      const marked = await session.fetch('/api/build/plan', { method: 'PUT', body: { ...base, plan: approvedPlan, expectedRevision: planRevision, status: 'built' } });
      item.requests.push({ stage: 'plan-built', method: 'PUT', path: '/api/build/plan', status: marked.status });
    }
    let touched = result?.touched ?? 0;
    for (let attempt = 0; attempt < pricing.maxContinuations && result?.changed && !result.finished && result.operation && result.operation.remainingCredits > 0; attempt++) {
      const continued = await item.stage(session, `continuation-${attempt + 1}`, '/api/build', { ...base, expectedVersion: result.version, effort: EFFORT,
        operation: { id: result.operation.id, stepKey: randomUUID(), kind: 'continuation' }, attachments: [],
        message: `${CONTINUE_PREFIX}${message.slice(0, 6000)}` });
      if (!continued.result) break;
      touched += continued.result.touched;
      result = continued.result;
    }

    // Websites: the automatic review round(s) on the saved version's files.
    if (kind === 'website') {
      const { autoReviewRounds } = loadApp('src/lib/builder/review-policy.ts');
      const rounds = result?.changed ? autoReviewRounds(EFFORT, { firstBuild: true, filesTouched: touched }) : 0;
      for (let round = 1; round <= rounds && result?.changed && result.operation && result.operation.remainingCredits > 0; round++) {
        const capture = await captureVersion(session, browser, artifactId, result.version);
        writeJson(path.join(item.dir, `review-${round}-capture.json`), describeCapture(capture));
        await saveShots(capture, path.join(item.dir, `review-${round}-shots`));
        if (capture.coverageIssue) {
          // The studio stops here without a paid call ("No review credits were used").
          item.terminals[`review-${round}`] = { type: 'error', code: 'CAPTURE_INCOMPLETE', message: capture.coverageIssue, preStream: true };
          item.status.code ??= 'CAPTURE_INCOMPLETE';
          break;
        }
        const reviewed = await item.stage(session, `review-${round}`, '/api/build', { ...base, expectedVersion: result.version, message: 'Design review', effort: EFFORT, mode: 'review',
          operation: { id: result.operation.id, stepKey: randomUUID(), kind: 'review' }, review: { round, ...capture } });
        result = reviewed.result;
      }
      // The studio re-renders the final result without a model call; keep its diagnostics.
      if (rounds > 0 && result?.changed) {
        const final = await captureVersion(session, browser, artifactId, result.version).catch(error => ({ screenshots: [], viewports: [], errors: [], failures: [error.message] }));
        writeJson(path.join(item.dir, 'final-capture.json'), describeCapture(final));
      }
    }
    item.status.ok = Boolean(result) && !item.status.code;
    if (!result && !item.status.code) item.status.code = 'NO_RESULT';
  } catch (error) {
    item.status.ok = false;
    item.status.code ??= error.code ?? 'RUNNER_ERROR';
    item.status.message ??= String(error.message).slice(0, 500);
  } finally {
    // 1. Limits off after EVERY brief, verified by read-back (re-enabled for the next brief).
    try {
      cost.limitsOff = (await setLimits({ enabled: false, scopes: LIMIT_SCOPES, note: `Eval ${runId}: ${brief.id} finished` })).readback;
    } catch (error) {
      limitsFailure = error;
      cost.limitsOff = { error: `DISABLING PROVIDER LIMITS FAILED: ${error.message}` };
      console.error(`\n!! ${cost.limitsOff.error}. Disable them by hand now.`);
    }
    // 2. Settle only once the server has no active run and no open provider call
    //    (it keeps running after a broken stream); otherwise unknown at the bound.
    //    A stopping run does not wait for the server: unknown at the full bound
    //    (cleanup may already have settled it the same way; that error is ignored).
    try {
      if (control.stopping) {
        await settleFn(reservationId, { unknown: true, detail: { item: brief.id, reason: `run stopping (${control.stopping}) before the brief was settled` } }).catch(() => undefined);
        cost.settlement = { status: 'unknown', reason: `run stopping (${control.stopping})` };
      } else {
        const settled = await settleBriefFn({ reservationId, userId: session.userId, actionKeys: item.actionKeys, abnormal: !item.status.ok, shouldStop: () => Boolean(control.stopping) });
        Object.assign(cost, { settlement: { status: settled.status, waitedMs: settled.waitedMs, polls: settled.polls, last: settled.last }, calls: settled.calls ?? [], actualUsd: settled.actualUsd ?? null });
      }
    } catch (error) {
      cost.ledgerError = error.message;
      await settleFn(reservationId, { unknown: true, detail: { item: brief.id, error: error.message } }).catch(() => undefined);
    }
    control.open.delete(reservationId);
    writeJson(path.join(item.dir, 'cost.json'), cost);
    await save(session, item, itemJson).catch(error => { item.status.outputError = error.message; });
    item.save();
  }
  if (limitsFailure) throw limitsFailure;
  return { id: brief.id, kind, direction: brief.direction, status: item.status.ok ? 'ok' : item.status.code, costUsd: cost.actualUsd, boundUsd, settlement: cost.settlement?.status ?? 'unknown' };
}

async function captureVersion(session, browser, artifactId, versionNumber) {
  const { row } = await savedVersion(artifactId, versionNumber);
  const source = row?.content?.websiteSource;
  if (!source?.files?.length) return Object.assign({ screenshots: [], viewports: [], errors: [] }, { failures: ['saved version has no websiteSource'], coverageIssue: 'The page could not be captured.' });
  const assets = await assetData(session, session.workspaceId, artifactId, source.assets ?? [], 'preview');
  const urls = Object.fromEntries(assets.filter(asset => asset.bytes).map(asset => [`/${asset.path.replace(/^public\//, '')}`, `data:image/webp;base64,${asset.bytes.toString('base64')}`]));
  return captureForReview({ browser, origin: ORIGIN, files: source, assets: urls });
}

/**
 * Where an export asset may be written: inside <item>/assets/ and never with a
 * lintable extension (outputs/ is linted; same rule as lib/website.mjs writeBuild()).
 */
export function assetTarget(itemDir, assetPath) {
  const root = path.resolve(itemDir, 'assets');
  const file = path.resolve(root, String(assetPath ?? '').replace(/^public\//, ''));
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return { ok: false, reason: 'outside assets/' };
  if (isLintable(file)) return { ok: false, reason: 'lintable extension under outputs/' };
  return { ok: true, file };
}

/** The saved version (source.json | document.json), its metadata, exports and images. */
async function saveOutputs(session, item, itemJson) {
  const artifactId = itemJson.origin.artifactId;
  if (!artifactId) return;
  const { currentVersion, row } = await savedVersion(artifactId, null);
  itemJson.origin.version = currentVersion;
  writeJson(path.join(item.dir, 'item.json'), itemJson);
  if (!row) { writeJson(path.join(item.dir, 'version.json'), { versionNumber: currentVersion, saved: false }); return; }
  writeJson(path.join(item.dir, 'version.json'), { id: row.id, versionNumber: row.version_number, parentVersionId: row.parent_version_id, createdAt: row.created_at, createdBy: row.created_by,
    changeSummary: row.change_summary, contentSha256: sha256(JSON.stringify(row.content)), assetManifest: row.asset_manifest, saved: true });
  if (row.content?.websiteSource) {
    writeJson(path.join(item.dir, 'source.json'), row.content.websiteSource);
    const assets = await assetData(session, session.workspaceId, artifactId, row.content.websiteSource.assets ?? [], 'export');
    for (const asset of assets.filter(entry => entry.bytes)) {
      const target = assetTarget(item.dir, asset.path);
      if (!target.ok) { item.status.refusedAssets = [...(item.status.refusedAssets ?? []), `${String(asset.path).slice(0, 160)} (${target.reason})`]; continue; }
      ensureDir(path.dirname(target.file));
      writeFileSync(target.file, asset.bytes);
    }
  }
  if (row.content?.document) {
    writeJson(path.join(item.dir, 'document.json'), row.content.document);
    const exportsDir = ensureDir(path.join(item.dir, 'exports'));
    for (const format of row.content.document.kind === 'deck' ? ['pdf', 'pptx'] : ['pdf']) {
      const response = await session.fetch(`/api/cloud/workspaces/${session.workspaceId}/artifacts/${artifactId}/document-export?format=${format}&version=${row.version_number}`, { timeoutMs: 180_000 });
      if (response.ok) writeFileSync(path.join(exportsDir, `document.${format}`), Buffer.from(await response.arrayBuffer()));
      else item.status.exportErrors = { ...(item.status.exportErrors ?? {}), [format]: `HTTP ${response.status}` };
    }
  }
}

// ===========================================================================
// Live mode: the run
// ===========================================================================

/** Every reason to refuse --live before anything starts (no server, no reservation, no write). */
export async function liveRefusals({ report, approval, selected, images, rerun, env = process.env, entriesFor = ref => ledgerEntries({ kind: 'runner', ref }), portBusy = () => portInUse(NEXT_PORT), testBudget = isTestBudget }) {
  const refusals = [];
  if (!report.green) refusals.push('the preflight is not green');
  if (env.EVAL_SPEND_APPROVED !== 'yes') refusals.push('EVAL_SPEND_APPROVED=yes is not set');
  if (!approval || approval.trim().length < 5) refusals.push('--approval "<who/when>" is missing');
  if (images && !report.keys?.imagesPossible) refusals.push('--images needs OPENAI_API_KEY and MAKEBORNE_IMAGE_MODEL in .env.local');
  try { if (testBudget()) refusals.push(`${TEST_ROOT_ENV} is set: live runs only book against the real ledger`); }
  catch (error) { refusals.push(error.message); }
  if (!selected.length) refusals.push('no brief selected');
  try {
    const earlier = selected.map(brief => ({ id: brief.id, entries: entriesFor(brief.id) })).filter(entry => entry.entries.length);
    if (earlier.length && !rerun) refusals.push(`${earlier.length} brief(s) already have runner ledger entries (${earlier.slice(0, 6).map(entry => `${entry.id}: ${entry.entries.map(item => item.status).join('/')}`).join(', ')}${earlier.length > 6 ? ', …' : ''}); pass --rerun to generate them again`);
  } catch (error) {
    refusals.push(`budget ledger: ${error.message}`);
  }
  if (await portBusy()) refusals.push(`port ${NEXT_PORT} is already listening (another server would be used instead of the runner's own isolated one); stop it first`);
  return refusals;
}

/** Literal secrets the run holds in memory (values never printed); scanned for at the end. */
function heldSecrets({ stack, fixture, images }) {
  return [
    { name: 'fixture account password', value: fixture.password },
    { name: 'isolated stack secret key', value: stack.secretKey },
    { name: 'ANTHROPIC_API_KEY', value: envValue('ANTHROPIC_API_KEY') },
    ...(images ? [{ name: 'OPENAI_API_KEY', value: envValue('OPENAI_API_KEY') }] : []),
  ];
}

export async function runLive({ report, approval, only, max, images, rerun = false, plan = false, enhance = false, answers = false }) {
  let selected = report.briefs.items;
  if (only?.length) selected = selected.filter(brief => only.includes(brief.id));
  if (max) selected = selected.slice(0, max);
  const refusals = await liveRefusals({ report, approval, selected, images, rerun });
  if (refusals.length) {
    console.log(`\nRefusing --live: ${refusals.join('; ')}. Nothing was started and no paid call was made.`);
    return 2;
  }
  const stack = isolatedStack();
  const fixture = qualityFixture();
  assertLocalOrigin(ORIGIN);

  // The ledger file must exist before this run's folder does: the folder (and its
  // approval.json) is paid-work evidence, which would otherwise block the first reserve().
  await ensureLedger();
  const runId = `live-${stamp()}`;
  const runDir = ensureDir(path.join(RUNS, runId));
  const startedAt = new Date().toISOString();
  writeJson(path.join(runDir, 'approval.json'), { approval: approval.trim(), envApproved: true, at: startedAt, capUsd: capUsd(), remainingUsd: report.budget.remainingUsd, briefs: selected.map(brief => brief.id), images: Boolean(images), rerun: Boolean(rerun), websiteMode: plan ? 'plan' : 'create', routes: ROUTES, scope: SCOPE, ...(BUDGET_SCOPE ? { budgetScope: BUDGET_SCOPE } : {}) });
  const items = [];
  let stopped = null, fatal = null, identity = null;
  const control = createLiveControl({ runDir, runId, deps: {
    disableLimits: note => setProviderLimits({ enabled: false, scopes: LIMIT_SCOPES, note }),
    stopServer: stopNext,
    settleUnknown: (id, detail) => settle(id, { unknown: true, detail }),
    closeBrowser: browser => browser.close(),
    portInUse: () => portInUse(NEXT_PORT),
    flushLogs: () => control.server?.logFlushed ?? Promise.resolve(),
    writeRun: cleanup => writeJson(path.join(runDir, 'run.json'), runJson({ runId, startedAt, items, report, stopped, fatal: fatal?.message ?? null, identity, cleanup })),
    // The last step: every file of the run (run.json included) is on disk by now.
    scan: scanForSecrets,
    writeScan: scan => writeJson(path.join(runDir, 'secret-scan.json'), { ok: scan.ok, files: scan.files, hits: scan.hits, error: scan.error ?? null, note: 'Written after the scan, which covered every other file of this run (run.json included). Values are never recorded.' }),
    exit: code => process.exit(code),
    log: message => console.error(message),
  } });
  control.secrets = heldSecrets({ stack, fixture, images });
  control.install();
  console.log(`\nLive run ${runId}: ${selected.length} brief(s), effort ${EFFORT}, images ${images ? 'on' : 'off'}`);
  const stopReason = () => `stopped (${control.stopping})`;
  await control.track((async () => {
    try {
      control.watchdog = startWatchdog({ logFile: path.join(runDir, 'watchdog.log'), dbUrl: stack.dbUrl, runDir });
      control.watchdog.watchSecrets(control.secrets);
      control.assertRunning('before starting the server');
      control.server = startNext(stack, { images, rate: report.pricing.costPerCreditUsd }, path.join(runDir, 'next-dev.log'));
      control.watchdog.watchServer(control.server.pid);
      await waitForBuilder(control.server);
      identity = await verifyServerIdentity({ child: control.server, expectedApi: stack.apiUrl });
      console.log(`  server verified: pid ${control.server.pid}, client built for ${identity.supabaseUrl} (${identity.fetched} chunks checked)`);
      const { chromium } = await import('playwright');
      control.assertRunning('before starting the browser');
      control.browser = await chromium.launch({ headless: true });
      const session = await signIn(control.browser, fixture);
      for (const brief of selected) {
        if (control.stopping) { stopped = stopReason(); break; }
        // The server must still be ours (alive, isolated build) before every paid brief.
        identity = await verifyServerIdentity({ child: control.server, expectedApi: stack.apiUrl });
        const bound = boundFor(brief.kind, report.pricing, plan);
        if (!(SCOPE ? fitsScoped(SCOPE, bound) : fits(bound))) { stopped = `cap reached before ${brief.id} (bound ${money(bound)}, remaining ${money(SCOPE ? scopeSummary(SCOPE).remainingUsd : budgetSummary().remainingUsd)})`; break; }
        // Checked again right before the brief reserves (runBrief re-checks before reserving and before enabling limits).
        if (control.stopping) { stopped = stopReason(); break; }
        console.log(`\n  ${brief.id} (${brief.kind}, bound ${money(bound)})`);
        try { items.push(await runBrief({ session, browser: control.browser, brief, runDir, runId, pricing: report.pricing, images, rerun, withPlan: plan, enhance, answers, control })); }
        catch (error) {
          if (error instanceof CapReached) { stopped = error.message; break; }
          if (error instanceof DuplicateReservation) { stopped = `refused ${brief.id}: ${error.message} (pass --rerun)`; break; }
          if (error instanceof RunStopping) { stopped = error.message; break; }
          if (error instanceof MidnightRefusal) { stopped = error.message; break; }
          throw error;
        }
        writeJson(path.join(runDir, 'run.json'), runJson({ runId, startedAt, items, report, stopped, identity, partial: true }));
      }
    } catch (error) {
      if (error instanceof RunStopping) stopped ??= error.message;
      else { fatal = error; console.error(`\n!! Live run stopped: ${error.message}`); }
    }
  })());
  const cleanup = await control.finish(fatal ? 'error' : 'finished');
  control.uninstall();
  let after = null;
  try { after = budgetSummary(); } catch (error) { after = { error: error.message }; }
  console.log(`\n  ${items.length} item(s); ${stopped ? `stopped: ${stopped}; ` : ''}budget ${JSON.stringify(after)}`);
  console.log(`  provider limits after: ${cleanup.limitsOff?.error ?? cleanup.limitsOff?.readback?.map(row => `${row.scope}:${row.enabled ? 'ON' : 'off'}`).join(', ')}; server ${cleanup.server?.reason ?? 'n/a'}; secret scan ${cleanup.secretScan.ok ? `clean (${cleanup.secretScan.files} files)` : 'HITS (see secret-scan.json)'}; watchdog ${cleanup.watchdog ?? 'n/a'}`);
  console.log(`  Report: ${rel(path.join(runDir, 'run.json'))}`);
  return cleanup.exitCode || (fatal ? 1 : 0);
}

function runJson({ runId, startedAt, items, report, stopped = null, fatal = null, identity = null, cleanup = null, partial = false }) {
  let budget;
  try { budget = budgetSummary(); } catch (error) { budget = { error: error.message }; }
  return {
    runId, mode: 'live', startedAt, finishedAt: partial ? null : new Date().toISOString(), effort: EFFORT,
    stack: { api: API, db: `127.0.0.1:${DB_PORT}`, server: ORIGIN }, briefsSha256: report.briefs.indexSha256,
    items: items.map(item => ({ id: item.id, kind: item.kind, direction: item.direction, status: item.status, costUsd: item.costUsd, boundUsd: item.boundUsd, settlement: item.settlement })),
    stopped, fatal, serverIdentity: identity, providerLimitsAfter: cleanup?.limitsOff ?? null,
    cleanup: cleanup ? { reason: cleanup.reason, server: cleanup.server, settledUnknown: cleanup.settledUnknown, settleErrors: cleanup.settleErrors ?? [],
      waitedForEnable: cleanup.waitedForEnable ?? null, mainFinished: cleanup.mainFinished ?? null,
      // The scan runs after this file is written (it covers it): see secret-scan.json.
      secretScan: 'secret-scan.json' } : null,
    budget,
  };
}

// ===========================================================================
// Live-path self-test: injected fakes only (no DB writes, no server, no
// provider, no network; temp folders and local node processes only)
// ===========================================================================

/** A fake literal the watchdog self-test hands over the pipe and must find (never a real value). */
const WATCHDOG_SELFTEST_LITERAL = 'watchdog-selftest-literal-not-a-secret';

async function liveSelfTest() {
  const os = await import('node:os');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const base = mkdtempSync(path.join(os.tmpdir(), 'makeborne-run-selftest-'));
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok) }); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 400)}`}`); };
  const rejects = async (fn, predicate = () => true) => { try { await fn(); return false; } catch (error) { return predicate(error); } };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    // 10. env parser: every dotenv syntax is found, so every key is blanked in the child env.
    const envText = ['# comment', 'PLAIN=one', 'export EXPORTED=two', 'COLON: three', 'DOTTED.NAME=four', 'DASHED-NAME=five', 'QUOTED="six # not a comment"',
      "SINGLE='seven'", 'MULTI="line one', 'line two"', 'EMPTY=', '  INDENTED = eight', 'NOSPACECOLON:nine', 'ANTHROPIC_API_KEY: sk-ant-fake-for-selftest', 'TEMP=should-not-blank-os-temp'].join('\r\n');
    const parsed = parseEnvText(envText);
    const expectNames = ['PLAIN', 'EXPORTED', 'COLON', 'DOTTED.NAME', 'DASHED-NAME', 'QUOTED', 'SINGLE', 'MULTI', 'EMPTY', 'INDENTED', 'NOSPACECOLON', 'ANTHROPIC_API_KEY', 'TEMP'];
    check('env parser: KEY=, export KEY=, KEY: value, dotted/dashed, quoted, multi-line', expectNames.every(name => parsed.names.includes(name))
      && parsed.values.get('COLON') === 'three' && parsed.values.get('EXPORTED') === 'two' && parsed.values.get('QUOTED') === 'six # not a comment' && parsed.values.get('MULTI') === 'line one\nline two',
      { names: parsed.names });
    const fakeRead = file => (path.basename(file) === '.env.local' ? envText : path.basename(file) === '.env' ? 'OTHER_FILE_KEY: x\n' : null);
    const childEnv = serverEnv({ apiUrl: API, publishableKey: 'sb_publishable_selftest', secretKey: 'sb_secret_selftest' }, { images: false, rate: 0.03 }, { read: fakeRead });
    const deliberate = new Set(['ANTHROPIC_API_KEY']);
    check('server env blanks every .env* key except the deliberate ones', ['PLAIN', 'EXPORTED', 'COLON', 'DOTTED.NAME', 'DASHED-NAME', 'QUOTED', 'MULTI', 'NOSPACECOLON', 'OTHER_FILE_KEY'].every(name => childEnv[name] === '')
      && childEnv.ANTHROPIC_API_KEY === 'sk-ant-fake-for-selftest' && childEnv.NEXT_PUBLIC_SUPABASE_URL === API && (process.env.TEMP ? childEnv.TEMP === process.env.TEMP : true) && deliberate.size === 1,
      Object.fromEntries(Object.entries(childEnv).filter(([key]) => !OS_ENV_KEYS.includes(key)).map(([key, value]) => [key, value ? 'set' : ''])));

    // 9. asset writes refuse lintable extensions and paths outside assets/.
    const itemDir = ensureDir(path.join(base, 'item'));
    const assetCases = { 'public/images/a.webp': true, 'public/x.js': false, 'public/x.MJS': false, 'public/a/b.tsx': false, 'public/../../escape.webp': false, 'images/c.png': true };
    check('asset target guard: lintable and escaping paths refused', Object.entries(assetCases).every(([assetPath, ok]) => assetTarget(itemDir, assetPath).ok === ok),
      Object.fromEntries(Object.keys(assetCases).map(assetPath => [assetPath, assetTarget(itemDir, assetPath).reason ?? 'ok'])));

    // 6. server identity with a fake fetch and a fake child.
    const chunkFor = url => `__turbopack_context__.s([]);\nfunction getSupabaseConfig() {\n    const url = ("TURBOPACK compile-time value", ${JSON.stringify(url)});\n    const key = ("TURBOPACK compile-time value", "sb_publishable_x");\n}\n/* createClient('https://xyzcompany.supabase.co', 'your-publishable-key') realtime.supabase.com */`;
    const fakeServer = pages => async url => {
      const { pathname } = new URL(url);
      return pages[pathname] !== undefined ? { status: 200, text: async () => pages[pathname] } : { status: 404, text: async () => '' };
    };
    const html = '<!doctype html><script src="/_next/static/chunks/src_a._.js" async=""></script><script>self.__next_f.push([1,"2:I[\\"x\\",[\\"/_next/static/chunks/node_b._.js\\"],\\"default\\"]"])</script>';
    const alive = { pid: 1, exitCode: null, signalCode: null };
    const verify = (pages, child = alive) => verifyServerIdentity({ child, expectedApi: API, fetchImpl: fakeServer(pages) });
    const good = await verify({ '/login': html, '/_next/static/chunks/src_a._.js': 'var a = 1;', '/_next/static/chunks/node_b._.js': chunkFor(API) });
    check('identity: isolated build accepted (library doc strings ignored)', good.ok && good.supabaseUrl === API && good.fetched === 2, good);
    check('identity: cloud-built client refused', await rejects(() => verify({ '/login': html, '/_next/static/chunks/src_a._.js': chunkFor('https://abcdefghijklmnop.supabase.co') }), error => error.code === 'EVAL_SERVER_IDENTITY'));
    check('identity: config not found refused', await rejects(() => verify({ '/login': html, '/_next/static/chunks/src_a._.js': 'var a = 1;' }), error => error.code === 'EVAL_SERVER_IDENTITY'));
    check('identity: other local URL refused', await rejects(() => verify({ '/login': html, '/_next/static/chunks/src_a._.js': chunkFor('http://127.0.0.1:54321') })));
    check('identity: exited child refused', await rejects(() => verify({ '/login': html, '/_next/static/chunks/node_b._.js': chunkFor(API) }, { pid: 1, exitCode: 1, signalCode: null })));
    check('identity: /login not 200 refused', await rejects(() => verify({})));
    // webpack dev: the module is an eval() string (quotes and newlines escaped).
    const webpackChunkFor = url => `(self.webpackChunk=self.webpackChunk||[]).push([[1],{"./src/lib/supabase/config.ts":(m,e,r)=>{eval(${JSON.stringify(`function getSupabaseConfig() {\n    const url = ${JSON.stringify(url)};\n    const key = "sb_publishable_x";\n}\n/* createClient('https://xyzcompany.supabase.co') */`)});}}]);`;
    const webpackGood = await verify({ '/login': html, '/_next/static/chunks/node_b._.js': webpackChunkFor(API) });
    check('identity: webpack dev build (eval modules) accepted', webpackGood.ok && webpackGood.supabaseUrl === API, webpackGood);
    check('identity: webpack dev build for another URL refused', await rejects(() => verify({ '/login': html, '/_next/static/chunks/node_b._.js': webpackChunkFor('https://abcdefghijklmnop.supabase.co') }), error => error.code === 'EVAL_SERVER_IDENTITY'));

    // 4/5. provider limits with a fake pg client: enable = today's spend + bound; read-back checked.
    const fakeDb = ({ used = 12_420_000, stuckOn = [], delayMs = 0 } = {}) => {
      const limits = new Map([['anthropic', { enabled: false, l: 0 }], ['global', { enabled: false, l: 0 }], ['openai', { enabled: false, l: 0 }]]);
      const calls = [];
      return { calls, limits, enables: () => calls.filter(call => call.sql.includes('set_live_provider_limit') && call.args[1] === true).length, async query(sql, args = []) {
        calls.push({ sql: sql.slice(0, 120), args });
        if (delayMs) await sleep(delayMs);
        if (sql.includes('live_provider_days')) return { rows: [{ used: String(used) }] };
        // stuckOn: a scope whose DISABLE write silently does not take (the read-back must catch it).
        if (sql.includes('set_live_provider_limit')) { const [scope, enabled, limit] = args; if (enabled || !stuckOn.includes(scope)) limits.set(scope, { enabled, l: limit }); return { rows: [{}] }; }
        if (sql.includes('from makeborne_private.live_provider_limits')) return { rows: [...limits].sort().map(([scope, row]) => ({ scope, enabled: row.enabled, emergency_stop: false, l: String(row.l) })) };
        throw new Error(`unexpected SQL ${sql.slice(0, 60)}`);
      } };
    };
    const db = fakeDb();
    const on = await setProviderLimits({ enabled: true, boundUsd: 1.8, scopes: ['global', 'anthropic'], note: 'selftest enable', client: db });
    check('limits: enabled at today\'s spend + this brief\'s bound only', on.set.every(row => row.limitUsd === 14.22) && db.limits.get('anthropic').l === 14_220_000 && db.limits.get('openai').enabled === false && db.enables() === 2, on.set);
    const off = await setProviderLimits({ enabled: false, scopes: LIMIT_SCOPES, note: 'selftest disable', client: db });
    check('limits: disable reads back global+anthropic+openai off', off.readback.every(row => row.enabled === false));
    const stuck = fakeDb({ stuckOn: ['anthropic'] });
    await setProviderLimits({ enabled: true, boundUsd: 1.8, scopes: ['global', 'anthropic'], note: 'selftest enable', client: stuck });
    check('limits: a read-back still showing anthropic ENABLED fails loudly', await rejects(() => setProviderLimits({ enabled: false, scopes: LIMIT_SCOPES, note: 'selftest disable', client: stuck }), error => error.code === 'EVAL_PROVIDER_LIMITS' && /anthropic reads back ENABLED/.test(error.message)));
    check('limits: enabling without a bound refused', await rejects(() => setProviderLimits({ enabled: true, boundUsd: 0, scopes: ['global'], note: 'selftest', client: fakeDb() })));
    // Midnight: the brief's worst case comes from the stage timeouts (website: plan + build + 2 continuations + 1 review).
    const realPricing = { maxContinuations: 2, autoReviewRounds: 1 };
    const websiteWorst = briefWorstCaseMs('website', realPricing);
    const deckWorst = briefWorstCaseMs('presentation', realPricing);
    check('midnight: worst case = 5 website stages (3 deck stages) x 360 s + requests + captures + margin', websiteWorst === 5 * 360_000 + 3 * 120_000 + 2 * 180_000 + 120_000 && deckWorst === 3 * 360_000 + 2 * 120_000 + 120_000,
      { websiteMin: websiteWorst / 60_000, deckMin: deckWorst / 60_000 });
    const at = (hour, minute) => Date.UTC(2026, 9, 18, hour, minute);
    // website 44 min, deck 24 min: 23:20 web ends 00:04 (wait), 22:50 web ends 23:34 (go); 23:40 deck ends 00:04 (wait), 23:30 deck ends 23:54 (go).
    const waits = { '23:20 web': midnightWaitMs(at(23, 20), websiteWorst), '22:50 web': midnightWaitMs(at(22, 50), websiteWorst), '23:40 deck': midnightWaitMs(at(23, 40), deckWorst),
      '23:30 deck': midnightWaitMs(at(23, 30), deckWorst), '12:00 web': midnightWaitMs(at(12, 0), websiteWorst) };
    check('midnight: a brief whose worst case could cross 00:00 UTC waits until just after it; one that cannot, does not',
      waits['23:20 web'] === 40 * 60_000 + 30_000 && waits['22:50 web'] === 0 && waits['23:40 deck'] === 20 * 60_000 + 30_000 && waits['23:30 deck'] === 0 && waits['12:00 web'] === 0, waits);
    const longPricing = { maxContinuations: 30, autoReviewRounds: 1 }; // a hypothetical brief longer than 2 h
    const refusedLong = await (async () => {
      const ctl = createLiveControl({ runDir: base, runId: 'selftest-midnight', deps: {} });
      try { await runBrief({ session: null, browser: null, brief: { id: 'long', kind: 'website' }, runDir: base, runId: 'selftest', pricing: { ...longPricing, websiteBoundUsd: 1, documentBoundUsd: 1 }, images: false, rerun: false, control: ctl,
        deps: { now: () => at(22, 0), reserveFn: async () => { throw new Error('must not reserve'); } } }); return null; } catch (error) { return error; }
    })();
    check('midnight: a wait over 2 h refuses with a message before reserving', refusedLong instanceof MidnightRefusal && /over 2 h/.test(refusedLong.message), refusedLong?.message);
    {
      const fakeClock = { t: 0 };
      let stopAfter = 3;
      const early = await waitForQuiet({ userId: 'u', actionKeys: ['k'], shouldStop: () => --stopAfter < 0, query: async () => ({ activeRuns: 1, openCalls: 0 }), now: () => fakeClock.t, sleep: async ms => { fakeClock.t += ms; } });
      check('settle wait: a stopping run ends the wait early (not quiet)', !early.quiet && early.stoppedEarly && early.polls === 3, early);
    }

    // 3. settlement waits for the server: fake clock + fake read-only SQL.
    const clock = { t: 0 };
    const states = [{ activeRuns: 1, openCalls: 1 }, { activeRuns: 1, openCalls: 0 }, { activeRuns: 0, openCalls: 0 }, { activeRuns: 0, openCalls: 0 }];
    let poll = 0;
    const waitOk = await waitForQuiet({ userId: 'u', actionKeys: ['k'], query: async () => states[Math.min(poll++, states.length - 1)], now: () => clock.t, sleep: async ms => { clock.t += ms; } });
    check('settle wait: polls until no active run and no open call (2 quiet polls)', waitOk.quiet && waitOk.polls === 4, waitOk);
    clock.t = 0;
    const waitTimeout = await waitForQuiet({ userId: 'u', actionKeys: ['k'], query: async () => ({ activeRuns: 1, openCalls: 1 }), now: () => clock.t, sleep: async ms => { clock.t += ms; } });
    check('settle wait: times out after 330 s while the server still runs', !waitTimeout.quiet && waitTimeout.waitedMs >= 330_000 && waitTimeout.waitedMs < 340_000, waitTimeout);
    clock.t = 0;
    const waitErrors = await waitForQuiet({ userId: 'u', actionKeys: ['k'], query: async () => { throw new Error('db down'); }, now: () => clock.t, sleep: async ms => { clock.t += ms; } });
    check('settle wait: unreadable state never counts as quiet', !waitErrors.quiet);
    const settledWith = [];
    const fakeSettle = async (id, args) => { settledWith.push({ id, ...args }); };
    const measured = { calls: [{ id: 'c1' }, { id: 'c2' }], actualMicrousd: 1_234_567, open: 0 };
    const s1 = await settleBrief({ reservationId: 'r1', userId: 'u', actionKeys: ['k'], abnormal: true, deps: { wait: async options => ({ quiet: true, waitedMs: options.minWaitMs, polls: 5 }), measure: async () => measured, settleFn: fakeSettle } });
    check('settle: quiet server -> measured sum (abnormal stream waits >= 15 s)', s1.status === 'settled' && settledWith[0].actualUsd === 1.234567 && s1.waitedMs === 15_000, settledWith[0]);
    const s2 = await settleBrief({ reservationId: 'r2', userId: 'u', actionKeys: ['k'], abnormal: true, deps: { wait: async () => ({ quiet: false, waitedMs: 330_000, polls: 110 }), measure: async () => measured, settleFn: fakeSettle } });
    check('settle: still running after the wait -> unknown (full bound)', s2.status === 'unknown' && settledWith[1].unknown === true && settledWith[1].actualUsd === undefined);
    const s3 = await settleBrief({ reservationId: 'r3', userId: 'u', actionKeys: ['k'], abnormal: false, deps: { wait: async () => ({ quiet: true, waitedMs: 3000, polls: 2 }), measure: async () => ({ ...measured, open: 1 }), settleFn: fakeSettle } });
    check('settle: an open/uncertain call after the wait -> unknown', s3.status === 'unknown' && settledWith[2].unknown === true);

    // 8. secret scan: literal values and patterns, reported by name only.
    const scanDir = ensureDir(path.join(base, 'scan'));
    const fakeKey = `sk-ant-api03-${'x'.repeat(40)}`;
    const fakePassword = 'fixture-password-for-selftest';
    // Prose that names the same things without a value must stay clean.
    writeFileSync(path.join(scanDir, 'clean.json'), JSON.stringify({ hello: 'world', link: '/review/short', note: 'Send a Bearer token in the Authorization header; @supabase/ssr sets the cookie sb-127-auth-token', b64: 'eyJhbGci', header: 'Authorization: Bearer <token>' }));
    check('secret scan: clean folder passes (names without values are not hits)', scanForSecrets(scanDir, [{ name: 'fixture account password', value: fakePassword }]).ok, scanForSecrets(scanDir, []).hits);
    writeFileSync(path.join(scanDir, 'events.sse'), `data: {"note":"${fakePassword}"}\n\n`);
    ensureDir(path.join(scanDir, 'deep'));
    writeFileSync(path.join(scanDir, 'deep', 'next-dev.log'), `ANTHROPIC_API_KEY=${fakeKey}\nlink http://127.0.0.1:3211/review/${'A'.repeat(43)}\nSUPABASE_SECRET_KEY=sb_secret_${'y'.repeat(20)}\n`);
    // Session material: a JWT, sb- auth cookies (header and cookie-object forms) and an Authorization: Bearer header (all fake).
    const fakeJwt = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"selftest","role":"authenticated"}').toString('base64url')}.${'s'.repeat(43)}`;
    writeFileSync(path.join(scanDir, 'deep', 'session.json'), JSON.stringify({ access_token: fakeJwt }));
    writeFileSync(path.join(scanDir, 'deep', 'cookie.txt'), `Cookie: sb-127-auth-token=base64-${'z'.repeat(40)}\n`);
    writeFileSync(path.join(scanDir, 'deep', 'jar.json'), JSON.stringify([{ name: 'sb-127-auth-token.0', value: `base64-${'q'.repeat(30)}`, domain: '127.0.0.1' }]));
    writeFileSync(path.join(scanDir, 'deep', 'requests.json'), JSON.stringify({ headers: { authorization: `Bearer ${'t'.repeat(32)}` } }));
    const scan = scanForSecrets(scanDir, [{ name: 'fixture account password', value: fakePassword }, { name: 'ANTHROPIC_API_KEY', value: fakeKey }]);
    const scanText = JSON.stringify(scan);
    const hitNames = new Set(scan.hits.map(hit => hit.secret));
    check('secret scan: literal + sk-ant- + sb_secret_ + /review/ token found, values not reported', !scan.ok && ['fixture account password', 'ANTHROPIC_API_KEY', 'Anthropic key (sk-ant-)', 'Supabase secret key (sb_secret_)', 'client review token URL (/review/<token>)'].every(name => hitNames.has(name))
      && !scanText.includes(fakeKey) && !scanText.includes(fakePassword) && !scanText.includes('yyyyyyyy'), scan.hits);
    const sessionHits = scan.hits.filter(hit => /JWT|auth cookie|Bearer/.test(hit.secret)).map(hit => `${hit.file.split('/').pop()}:${hit.secret.split(' ')[0]}`).sort();
    check('secret scan: Supabase session JWT, sb- auth cookies and Authorization: Bearer found, values not reported', scan.hits.length === 9
      && JSON.stringify(sessionHits) === JSON.stringify(['cookie.txt:Supabase', 'jar.json:Supabase', 'requests.json:Authorization:', 'session.json:JWT'])
      && !scanText.includes(fakeJwt.split('.')[1]) && !scanText.includes('zzzzzzzz') && !scanText.includes('qqqqqqqq') && !scanText.includes('tttttttt'), scan.hits);

    // 4. cleanup runs once for any mix of signals and the normal end.
    const counts = { disable: 0, stop: 0, settle: 0, close: 0, scan: 0, write: 0, writeScan: 0, exit: [] };
    const events = await import('node:events');
    const target = new events.EventEmitter();
    const control = createLiveControl({ runDir: scanDir, runId: 'selftest', deps: {
      disableLimits: async () => { counts.disable++; await sleep(20); return { readback: [{ scope: 'global', enabled: false }, { scope: 'anthropic', enabled: false }] }; },
      stopServer: () => { counts.stop++; return { stopped: true, reason: 'fake' }; },
      settleUnknown: async () => { counts.settle++; },
      closeBrowser: async () => { counts.close++; },
      portInUse: async () => false,
      scan: () => { counts.scan++; return { ok: true, files: 0, hits: [] }; },
      writeRun: () => { counts.write++; },
      writeScan: () => { counts.writeScan++; },
      exit: code => counts.exit.push(code),
      log: () => undefined,
    } });
    control.server = { pid: 1 }; control.browser = {}; control.open.add('r-a'); control.open.add('r-b');
    let wd = 0; control.watchdog = { done: () => { wd++; } };
    control.install(target);
    target.emit('SIGINT'); target.emit('SIGTERM'); target.emit('SIGBREAK'); target.emit('SIGHUP'); target.emit('uncaughtException', new Error('boom'));
    const normal = await control.finish('finished');
    await sleep(50);
    control.uninstall(target);
    check('cleanup: signals + normal end -> limits off (cleanup + final check), server stopped, 2 reservations unknown, exactly once', counts.disable === 2 && counts.stop === 1 && counts.settle === 2 && counts.close === 1 && counts.scan === 1 && counts.write === 1 && counts.writeScan === 1 && wd === 1
      && counts.exit.length === 1 && counts.exit[0] === 130 && normal.settledUnknown.length === 2 && control.stopping === 'SIGINT' && target.listenerCount('SIGINT') === 0, { ...counts, wd });
    const failing = createLiveControl({ runDir: scanDir, runId: 'selftest', deps: {
      disableLimits: async () => { throw new Error('db down'); }, stopServer: () => ({ stopped: true }), settleUnknown: async () => undefined, closeBrowser: async () => undefined,
      portInUse: async () => false, scan: () => ({ ok: true, files: 0, hits: [] }), writeRun: () => undefined, exit: () => undefined, log: () => undefined } });
    let armed = true; failing.watchdog = { done: () => { armed = false; } };
    const failed = await failing.finish('finished');
    check('cleanup: failed limit disable -> exit 1 and the watchdog stays armed', failed.exitCode === 1 && armed && /DISABLING PROVIDER LIMITS FAILED/.test(failed.limitsOff.error));
    const hung = createLiveControl({ runDir: scanDir, runId: 'selftest', mainWaitMs: 100, deps: {
      disableLimits: async () => ({ readback: [] }), stopServer: () => ({ stopped: true }), settleUnknown: async () => undefined, closeBrowser: async () => undefined,
      portInUse: async () => false, scan: () => ({ ok: true, files: 0, hits: [] }), writeRun: () => undefined, exit: () => undefined, log: () => undefined } });
    let hungArmed = true; hung.watchdog = { done: () => { hungArmed = false; } };
    hung.track(new Promise(() => undefined));
    const hungResult = await hung.finish('SIGINT');
    check('cleanup: a main flow that does not end in time -> exit 1 and the watchdog stays armed', hungResult.exitCode === 1 && hungResult.mainFinished === false && hungArmed);

    // 7. refusals: duplicates (unless --rerun), test ledger, busy port, no approval.
    const greenReport = { green: true, keys: { imagesPossible: false } };
    const briefs = [{ id: 'w01' }, { id: 'w02' }];
    const entries = ref => (ref === 'w01' ? [{ status: 'settled' }] : []);
    const base7 = { report: greenReport, approval: 'Kerim, selftest', selected: briefs, images: false, env: { EVAL_SPEND_APPROVED: 'yes' }, entriesFor: entries, portBusy: async () => false, testBudget: () => false };
    check('refusal: brief with a runner ledger entry refused without --rerun', (await liveRefusals({ ...base7, rerun: false })).some(text => text.includes('w01: settled')));
    check('refusal: --rerun allows it', (await liveRefusals({ ...base7, rerun: true })).length === 0);
    check('refusal: busy port 3211 refused before spawn', (await liveRefusals({ ...base7, rerun: true, portBusy: async () => true })).some(text => text.includes(`port ${NEXT_PORT}`)));
    check('refusal: test ledger refused', (await liveRefusals({ ...base7, rerun: true, testBudget: () => true })).some(text => text.includes(TEST_ROOT_ENV)));
    check('refusal: invalid ledger refused', (await liveRefusals({ ...base7, entriesFor: () => { throw new Error('ledger invalid'); } })).some(text => text.includes('ledger invalid')));
    check('refusal: no approval / env refused', (await liveRefusals({ ...base7, approval: undefined, env: {}, rerun: true })).length === 2);

    // 3/4/5/7. runBrief orchestration with a fake session, budget, limits and settlement:
    // reserve -> limits on (bound only) -> stages -> limits off -> wait+settle -> save.
    const briefFile = path.join(base, 'brief.json');
    writeFileSync(briefFile, '{}');
    const deck = { id: 'd01-selftest', kind: 'presentation', title: 'Selftest deck', direction: 'x', brief: 'Make a short deck.', sha256: 'x', file: briefFile };
    const fakePricing = { websiteBoundUsd: 1.8, documentBoundUsd: 1.5, maxContinuations: 2, autoReviewRounds: 1 };
    const sse = events => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const orchestrate = async ({ buildEvents, limitsOffFails = false }) => {
      const order = [];
      const session = { userId: 'u', workspaceId: 'w', async fetch(pathname, { method = 'GET' } = {}) {
        order.push(`${method} ${pathname.replace(/\/(workspaces|projects)\/[^/]+(?=\/)/g, '/$1/:id')}`);
        if (pathname.endsWith('/projects')) return new Response(JSON.stringify({ project: { id: 'p1' } }), { status: 201 });
        if (pathname.endsWith('/artifacts')) return new Response(JSON.stringify({ artifact: { id: 'a1' } }), { status: 201 });
        if (pathname === '/api/build') return sse(buildEvents);
        return new Response('{}', { status: 404 });
      } };
      const fakeControl = createLiveControl({ runDir: base, runId: 'selftest', deps: {} });
      let openDuringStages = null;
      const deps = {
        midnight: () => 0,
        reserveFn: async args => { order.push(`reserve ${args.kind} ${args.ref} $${args.boundUsd} unique=${args.unique}`); return 'res-1'; },
        setLimits: async args => {
          order.push(`limits ${args.enabled ? `on $${args.boundUsd} ${args.scopes.join('+')}` : `off ${args.scopes.join('+')}`}`);
          if (args.enabled) openDuringStages = fakeControl.open.has('res-1');
          if (!args.enabled && limitsOffFails) throw new LimitsError('anthropic reads back ENABLED');
          return { set: [], readback: [] };
        },
        settleBriefFn: async args => { order.push(`settle abnormal=${args.abnormal} keys=${args.actionKeys.length}`); return { status: 'settled', actualUsd: 0.42, calls: [], waitedMs: 0, polls: 2 }; },
        settleFn: async () => { order.push('settle-unknown'); },
        save: async () => { order.push('save'); },
      };
      const runDirTest = ensureDir(path.join(base, `run-${Math.random().toString(16).slice(2)}`));
      let result = null, thrown = null;
      try { result = await runBrief({ session, browser: null, brief: deck, runDir: runDirTest, runId: 'selftest', pricing: fakePricing, images: false, rerun: false, control: fakeControl, deps }); }
      catch (error) { thrown = error; }
      return { order, result, thrown, openDuringStages, openAfter: fakeControl.open.size };
    };
    const happy = await orchestrate({ buildEvents: [{ type: 'file', path: 'x' }, { type: 'done', version: 1, changed: true, finished: true, charged: 10 }] });
    const expected = ['reserve runner d01-selftest $1.5 unique=true', 'limits on $1.5 global+anthropic', 'POST /api/cloud/workspaces/:id/projects', 'POST /api/cloud/workspaces/:id/projects/:id/artifacts',
      'POST /api/build', 'limits off global+anthropic+openai', 'settle abnormal=false keys=1', 'save'];
    check('runBrief: reserve -> limits on at the bound -> stages -> limits off -> settle -> save', JSON.stringify(happy.order) === JSON.stringify(expected) && happy.result?.status === 'ok' && happy.openDuringStages === true && happy.openAfter === 0, happy.order);
    const broken = await orchestrate({ buildEvents: [{ type: 'file', path: 'x' }] });
    check('runBrief: a stream that closes early -> abnormal settle (waits for the server), status STREAM_CLOSED', broken.order.includes('settle abnormal=true keys=1') && broken.result?.status === 'STREAM_CLOSED'
      && broken.order.indexOf('limits off global+anthropic+openai') < broken.order.indexOf('settle abnormal=true keys=1'), broken.order);
    const stuckOff = await orchestrate({ buildEvents: [{ type: 'done', version: 1, changed: true, finished: true }], limitsOffFails: true });
    check('runBrief: limits that do not read back off -> settled first, then the run stops loudly', stuckOff.thrown?.code === 'EVAL_PROVIDER_LIMITS' && stuckOff.order.includes('settle abnormal=false keys=1') && stuckOff.order.includes('save'), { order: stuckOff.order, thrown: stuckOff.thrown?.message });

    // 2. Ctrl+C race: the signal arrives while a brief waits on its reservation (e.g. the ledger
    // lock). Once cleanup began the brief must never enable limits; cleanup's read-back shows them
    // off; the watchdog stands down only after the main flow (and its brief-level disable) ended;
    // run.json is written before the secret scan, which is the last step.
    const raceDir = ensureDir(path.join(base, 'race'));
    const raceDb = fakeDb();
    const raceEvents = [];
    const raceTarget = new events.EventEmitter();
    let releaseReservation;
    const reservationGate = new Promise(resolve => { releaseReservation = resolve; });
    const raceControl = createLiveControl({ runDir: raceDir, runId: 'selftest-race', mainWaitMs: 10_000, deps: {
      disableLimits: async note => { const result = await setProviderLimits({ enabled: false, scopes: LIMIT_SCOPES, note, client: raceDb }); raceEvents.push('cleanup: limits off'); return result; },
      stopServer: () => { raceEvents.push('cleanup: server stopped'); return { stopped: true, reason: 'fake' }; },
      settleUnknown: async id => { raceEvents.push(`cleanup: settle ${id}`); },
      closeBrowser: async () => undefined, portInUse: async () => false,
      writeRun: () => raceEvents.push('run.json'),
      scan: () => { raceEvents.push('scan'); return { ok: true, files: 0, hits: [] }; },
      writeScan: () => raceEvents.push('secret-scan.json'),
      exit: code => raceEvents.push(`exit ${code}`),
      log: () => undefined,
    } });
    raceControl.server = { pid: 1 };
    raceControl.watchdog = { done: () => raceEvents.push('watchdog stood down') };
    raceControl.install(raceTarget);
    const raceSession = { userId: 'u', workspaceId: 'w', async fetch() { raceEvents.push('HTTP request'); return new Response('{}', { status: 500 }); } };
    raceControl.track((async () => {
      try {
        const done = await runBrief({ session: raceSession, browser: null, brief: deck, runDir: raceDir, runId: 'selftest-race', pricing: fakePricing, images: false, rerun: false, control: raceControl, deps: {
          midnight: () => 0,
          reserveFn: async () => { raceEvents.push('brief: waiting for its reservation'); await reservationGate; raceEvents.push('brief: reservation granted'); return 'res-race'; },
          setLimits: async args => { const result = await setProviderLimits({ ...args, client: raceDb }); raceEvents.push(`brief: limits ${args.enabled ? 'ON' : 'off'}`); return result; },
          settleBriefFn: async () => { raceEvents.push('brief: waited for the server'); return { status: 'settled', actualUsd: 0 }; },
          settleFn: async (id, args) => { raceEvents.push(`brief: settle ${id} ${args.unknown ? 'unknown' : args.actualUsd}`); },
          save: async () => { raceEvents.push('brief: save'); },
        } });
        raceEvents.push(`brief: returned ${done.status}`);
      } catch (error) { raceEvents.push(`brief: threw ${error.code ?? error.message}`); }
      raceEvents.push('main flow ended');
    })());
    await sleep(30);
    raceTarget.emit('SIGINT');
    await sleep(80);
    releaseReservation();
    const raceResult = await raceControl.finishing;
    await sleep(30);
    raceControl.uninstall(raceTarget);
    const at2 = text => raceEvents.indexOf(text);
    check('Ctrl+C while a brief waits on its reservation -> limits never re-enabled, read-back disabled, reservation kept at its bound', raceDb.enables() === 0 && [...raceDb.limits.values()].every(row => !row.enabled)
      && raceResult.limitsOff.readback.every(row => row.enabled === false) && !raceEvents.includes('brief: limits ON') && !raceEvents.includes('HTTP request')
      && raceEvents.includes('brief: settle res-race unknown') && !raceEvents.includes('brief: waited for the server') && at2('cleanup: limits off') < at2('brief: reservation granted'), raceEvents);
    check('...watchdog stands down only after the main flow and its brief-level disable; run.json, then the scan, last', at2('brief: limits off') > -1 && at2('brief: limits off') < at2('main flow ended')
      && at2('main flow ended') < at2('run.json') && at2('run.json') < at2('scan') && at2('scan') < at2('secret-scan.json') && at2('secret-scan.json') < at2('watchdog stood down')
      && at2('watchdog stood down') < at2('exit 130') && raceEvents.filter(text => text.startsWith('exit')).length === 1, raceEvents);

    // ...and a signal that lands while the limits are being enabled: the guard refuses the next
    // scope write, cleanup waits for that enable to end, then disables (final state off).
    const slowDb = fakeDb({ delayMs: 100 });
    const slowControl = createLiveControl({ runDir: base, runId: 'selftest-enable', deps: {
      disableLimits: note => setProviderLimits({ enabled: false, scopes: LIMIT_SCOPES, note, client: slowDb }),
      stopServer: () => ({ stopped: true }), settleUnknown: async () => undefined, closeBrowser: async () => undefined, portInUse: async () => false,
      writeRun: () => undefined, scan: () => ({ ok: true, files: 0, hits: [] }), exit: () => undefined, log: () => undefined } });
    const enabling = slowControl.enableLimits(guard => setProviderLimits({ enabled: true, boundUsd: 1.5, scopes: ['global', 'anthropic'], note: 'selftest enable', guard, client: slowDb }))
      .then(() => 'enabled', error => error.code);
    await sleep(220); // global is enabled (its write started at ~100 ms); anthropic's write would start at ~300 ms
    const slowCleanup = await slowControl.cleanup('SIGINT');
    const slowOutcome = await enabling;
    const lastEnable = slowDb.calls.findLastIndex(call => call.sql.includes('set_live_provider_limit') && call.args[1] === true);
    const firstDisable = slowDb.calls.findIndex(call => call.sql.includes('set_live_provider_limit') && call.args[1] === false);
    check('Ctrl+C while limits are being enabled -> no scope enabled after the stop, cleanup waits for the enable, final read-back off', slowOutcome === 'EVAL_RUN_STOPPING' && slowDb.enables() === 1
      && slowCleanup.waitedForEnable === true && lastEnable < firstDisable && slowCleanup.limitsOff.readback.every(row => row.enabled === false) && [...slowDb.limits.values()].every(row => !row.enabled),
      { slowOutcome, enables: slowDb.enables(), waited: slowCleanup.waitedForEnable, lastEnable, firstDisable });
    check('...and nothing can enable limits after the stop', await rejects(() => slowControl.enableLimits(() => { throw new Error('must not be called'); }), error => error.code === 'EVAL_RUN_STOPPING'));

    // 4. watchdog: a hard-killed runner (taskkill /F, no cleanup) still gets its server killed.
    const dummy = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
    const alivePid = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
    const waitFor = async (predicate, ms) => { const until = Date.now() + ms; while (Date.now() < until) { if (await predicate()) return true; await sleep(200); } return predicate(); };
    const fakeServerProc = dummy();
    const wdLog = path.join(base, 'watchdog-kill.log');
    // The run folder the killed runner leaves behind: a leaked key pattern and the literal the runner handed over its pipe.
    const wdRunDir = ensureDir(path.join(base, 'watchdog-run'));
    ensureDir(path.join(wdRunDir, 'w01'));
    writeFileSync(path.join(wdRunDir, 'w01', 'next-dev.log'), `boot ANTHROPIC_API_KEY=${fakeKey}\n`);
    writeFileSync(path.join(wdRunDir, 'w01', 'events.jsonl'), `${JSON.stringify({ note: WATCHDOG_SELFTEST_LITERAL })}\n`);
    writeFileSync(path.join(wdRunDir, 'clean.json'), '{"ok":true}\n');
    const parent = spawn(process.execPath, [fileURLToPath(import.meta.url), '--selftest-watchdog-parent', String(fakeServerProc.pid), wdLog, wdRunDir], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const ready = await new Promise(resolve => { let out = ''; parent.stdout.on('data', chunk => { out += chunk; if (out.includes('ready')) resolve(true); }); setTimeout(() => resolve(false), 15_000); });
    if (process.platform === 'win32') spawnSync(TASKKILL, ['/PID', String(parent.pid), '/F'], { stdio: 'ignore', windowsHide: true }); else parent.kill('SIGKILL');
    const killed = ready && await waitFor(() => !alivePid(fakeServerProc.pid), 15_000);
    const wdScanFile = path.join(wdRunDir, 'secret-scan-watchdog.json');
    await waitFor(() => existsSync(wdScanFile) && existsSync(wdLog) && /secret scan/.test(readFileSync(wdLog, 'utf8')), 15_000);
    const logText = existsSync(wdLog) ? readFileSync(wdLog, 'utf8') : '';
    check('watchdog: runner hard-killed -> server tree killed, limits disable attempted (dry)', killed && /ended without cleanup/.test(logText) && /dry run: would disable provider limits global,anthropic,openai/.test(logText), { ready, killed, log: logText.split('\n').slice(-4) });
    const wdScanText = existsSync(wdScanFile) ? readFileSync(wdScanFile, 'utf8') : '';
    const wdScan = wdScanText ? JSON.parse(wdScanText) : null;
    check('watchdog: ...then scans the run folder (patterns + literals from its pipe), names only', wdScan?.ok === false && wdScan.literals === 1
      && wdScan.hits.some(hit => hit.file === 'w01/next-dev.log' && hit.secret === 'Anthropic key (sk-ant-)') && wdScan.hits.some(hit => hit.file === 'w01/events.jsonl' && hit.secret === 'fixture account password')
      && !wdScan.hits.some(hit => hit.file === 'clean.json') && !wdScanText.includes(fakeKey) && !wdScanText.includes(WATCHDOG_SELFTEST_LITERAL) && !logText.includes(fakeKey) && !logText.includes(WATCHDOG_SELFTEST_LITERAL),
      { hits: wdScan?.hits, log: logText.split('\n').slice(-3) });
    if (alivePid(fakeServerProc.pid)) fakeServerProc.kill();
    const calmServer = dummy();
    const calmLog = path.join(base, 'watchdog-done.log');
    const calmRunDir = ensureDir(path.join(base, 'watchdog-calm-run'));
    const calm = startWatchdog({ logFile: calmLog, dry: true, runDir: calmRunDir });
    calm.watchServer(calmServer.pid);
    await sleep(500);
    calm.done();
    await waitFor(() => existsSync(calmLog) && /watchdog exits/.test(readFileSync(calmLog, 'utf8')), 10_000);
    await sleep(500);
    check('watchdog: "done" after a clean cleanup -> stands down, server untouched, no second scan', alivePid(calmServer.pid) && /watchdog exits/.test(readFileSync(calmLog, 'utf8')) && !/ended without cleanup/.test(readFileSync(calmLog, 'utf8'))
      && !existsSync(path.join(calmRunDir, 'secret-scan-watchdog.json')));
    calmServer.kill();
    // Non-dry watchdog against a loopback port nothing listens on: proves pg loads in the
    // detached helper and a failed disable is logged loudly (no database is reached).
    const closedPort = await new Promise(resolve => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
    const pgLog = path.join(base, 'watchdog-pg.log');
    const refusedDatabase = new URL(`postgresql://127.0.0.1:${closedPort}/postgres`);
    refusedDatabase.username = 'invalid-test-user';
    refusedDatabase.password = 'invalid-test-password'; // Deliberately invalid closed-port fixture.
    const pgWatch = startWatchdog({ logFile: pgLog, dbUrl: refusedDatabase.href });
    await sleep(300);
    pgWatch.child.stdin.end();
    await waitFor(() => existsSync(pgLog) && /DISABLING PROVIDER LIMITS FAILED/.test(readFileSync(pgLog, 'utf8')), 15_000);
    const pgText = existsSync(pgLog) ? readFileSync(pgLog, 'utf8') : '';
    check('watchdog: real pg path loads and a failed disable is logged (closed loopback port)', /DISABLING PROVIDER LIMITS FAILED: .*(ECONNREFUSED|connect)/i.test(pgText), pgText.split('\n').slice(-3));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  const failed = checks.filter(item => !item.ok);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'}: ${checks.length - failed.length}/${checks.length} live-path checks (fakes only)`);
  return failed.length ? 1 : 0;
}

// ===========================================================================
// CLI
// ===========================================================================

function cli(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    fixtures: { type: 'boolean' }, 'include-redesign': { type: 'boolean' }, live: { type: 'boolean' }, approval: { type: 'string' }, rerun: { type: 'boolean' },
    only: { type: 'string', multiple: true }, max: { type: 'string' }, effort: { type: 'string' }, bundler: { type: 'string' }, images: { type: 'boolean' }, 'image-models': { type: 'string' }, plan: { type: 'boolean' }, enhance: { type: 'boolean' }, route: { type: 'string' }, scope: { type: 'string' }, briefs: { type: 'string' }, answers: { type: 'boolean' }, 'skip-self-test': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    'selftest-live': { type: 'boolean' }, 'selftest-watchdog-parent': { type: 'boolean' },
  }, strict: true });
  const max = values.max === undefined ? null : Number(values.max);
  if (max !== null && !(Number.isInteger(max) && max > 0)) throw new Error('--max must be a positive integer');
  return { ...values, positionals, only: values.only?.flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean), max };
}

async function main() {
  // Document exporters read fonts relative to process.cwd(); the server runs from here too.
  process.chdir(REPO);
  const options = cli(process.argv.slice(2));
  if (options.effort !== undefined) setEffort(options.effort);
  if (options.briefs !== undefined) {
    if (!['golden', 'short'].includes(options.briefs)) throw new Error('--briefs must be golden or short');
    if (options.briefs === 'short') BRIEF_SET_DIR = path.join(path.dirname(BRIEFS_DIR), 'briefs-short');
  }
  if (options.bundler !== undefined) {
    if (!['turbopack', 'webpack'].includes(options.bundler)) throw new Error('--bundler must be turbopack or webpack');
    BUNDLER = options.bundler;
  }
  if (options['image-models'] !== undefined) {
    if (!/^[a-z0-9.-]+(?:,[a-z0-9.-]+)*$/.test(options['image-models'])) throw new Error('--image-models takes a comma-separated list of model ids');
    IMAGE_MODELS = options['image-models'];
  }
  if (options.route !== undefined) {
    if (!/^[a-z-]+=[a-z0-9.-]+(?:,[a-z-]+=[a-z0-9.-]+)*$/.test(options.route)) throw new Error('--route takes <class>=<model>[,<class>=<model>...]');
    ROUTES = Object.fromEntries(options.route.split(',').map(item => item.split('=')));
  }
  if (options.scope !== undefined) {
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(options.scope)) throw new Error('--scope must be a scoped allowance name');
    SCOPE = options.scope;
  }
  if (options.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).join('\n')); return 0; }
  if (options['selftest-live']) { console.log('run.mjs live-path self-test (fakes only: no DB writes, no server, no provider)'); return liveSelfTest(); }
  if (options['selftest-watchdog-parent']) {
    // Test helper: arm a DRY watchdog for a dummy server, then wait to be hard-killed.
    const [serverPid, logFile, runDir] = options.positionals;
    const watchdog = startWatchdog({ logFile, dry: true, runDir: runDir ?? null });
    watchdog.watchServer(Number(serverPid));
    watchdog.watchSecrets([{ name: 'fixture account password', value: WATCHDOG_SELFTEST_LITERAL }]);
    setTimeout(() => console.log('ready'), 300);
    await new Promise(() => undefined);
  }

  if (options.fixtures) {
    console.log('\nExporting fixtures (read-only SQL, offline exports, no paid calls)');
    const { run, runDir } = await exportFixtures();
    console.log(`  ${run.counts.exported}/${run.counts.total} exported: ${['website', 'presentation', 'book'].map(kind => `${run.counts[kind] ?? 0} ${kind}`).join(', ')}; export failures: ${run.exportFailures.length ? run.exportFailures.join(', ') : 'none'}; not exported (listed in run.json): ${run.notExported.length}`);
    console.log(`  ${rel(runDir)}`);
    let failed = run.items.filter(item => item.status !== 'exported').length;
    if (options['include-redesign']) {
      console.log('\nExporting redesign fixtures (files on disk)');
      const redesign = await exportRedesigns();
      console.log(`  ${redesign.run.counts.exported}/${redesign.run.counts.total} exported`);
      console.log(`  ${rel(redesign.runDir)}`);
      failed += redesign.run.items.filter(item => item.status !== 'exported').length;
    }
    return failed ? 1 : 0;
  }

  const runId = `dry-${stamp()}`;
  const runDir = ensureDir(path.join(RUNS, runId));
  const report = await preflight({ outDir: runDir, withSelfTest: !options['skip-self-test'] });
  writeJson(path.join(runDir, 'run.json'), {
    runId, mode: 'dry', startedAt: report.startedAt, finishedAt: report.finishedAt, effort: EFFORT,
    stack: { api: API, db: `127.0.0.1:${DB_PORT}`, server: ORIGIN }, briefsSha256: report.briefs.indexSha256 ?? null,
    items: (report.budget.order ?? []).map(item => ({ id: item.id, kind: item.kind, status: item.fits ? 'planned' : 'over-cap', costUsd: null, boundUsd: item.boundUsd })),
    budget: report.budget.ledger ?? null,
    live: { green: report.green, blockers: report.blockers }, neededToRunForReal: report.neededToRunForReal,
    // Brief texts stay in their frozen files; the report names them by id, hash and path.
    preflight: { ...report, briefs: { ...report.briefs, items: report.briefs.items.map(item => ({ id: item.id, priority: item.priority, kind: item.kind, title: item.title,
      direction: item.direction, shared: item.shared, sha256: item.sha256, hashOk: item.hashOk, chars: item.chars, file: rel(item.file) })) } },
  });
  printPreflight(report, runDir);
  if (options.live) return runLive({ report, approval: options.approval, only: options.only, max: options.max, images: options.images, rerun: options.rerun, plan: options.plan, enhance: options.enhance, answers: options.answers });
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }, error => { console.error(error); process.exitCode = 1; });
}

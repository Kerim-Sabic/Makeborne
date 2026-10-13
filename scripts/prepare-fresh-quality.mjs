// Read-only local preflight. This script cannot enable limits or call providers.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';

const report = { schemaVersion: 1, observedAt: new Date().toISOString(), paidCalls: 0, readyToSpend: false };
const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
const present = values => Object.fromEntries(keys.map(key => [key, Boolean(values[key]?.trim())]));
function envValues(file) {
  const values = {};
  if (!existsSync(file)) return values;
  for (const match of readFileSync(file, 'utf8').matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/gm)) {
    let value = match[2].trim();
    if (value.startsWith('"') || value.startsWith("'")) value = value.slice(1, value.lastIndexOf(value[0]));
    else value = value.split(/\s+#/)[0];
    values[match[1]] = value;
  }
  return values;
}
const localEnv = envValues('.env.local');
report.credentialPresenceOnly = { process: present(process.env), localEnv: present(localEnv), builderTestEnv: present(envValues('.env.builder-test.local')) };
report.proposedConfiguration = { model: 'claude-opus-5-5', fallbackModels: [], internalUsdPerCredit: 0.03, images: false };
report.roundLedger = JSON.parse(readFileSync('docs/release-review/api-budget-round-20261013.json', 'utf8'));
report.sourceSha256 = Object.fromEntries([
  'src/app/api/build/route.ts', 'src/lib/builder/docs-run.ts', 'src/lib/builder/docs-agent.ts',
  'src/lib/builder/docs-prompt.ts', 'src/lib/builder/docs-style.ts', 'src/lib/builder/agent.ts',
  'src/lib/builder/prompt.ts', 'src/lib/builder/pricing.ts', 'src/lib/builder/operation-server.ts',
  'src/lib/ai/anthropic-call.ts', 'src/lib/ai/prices.ts', 'src/lib/ai/run-spend.ts',
  'src/lib/documents/editor.ts', 'src/lib/documents/schema.ts', 'src/lib/documents/book-markup.ts',
  'src/lib/documents/render-book.ts', 'src/lib/documents/slide-scene.ts', 'src/lib/documents/pptx.ts',
  'src/lib/documents/cover-composition.ts', 'src/lib/documents/export-server.ts',
].map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
let db;
try {
  const status = JSON.parse(readFileSync('work/fresh-quality-stack/status.json', 'utf8').replace(/^\uFEFF/, ''));
  const url = new URL(status.DB_URL);
  if (status.API_URL !== 'http://127.0.0.1:55465' || url.hostname !== '127.0.0.1' || url.port !== '55468') throw new Error('LOCAL_ENDPOINT_REQUIRED');
  db = new pg.Client({ connectionString: status.DB_URL, connectionTimeoutMillis: 3000, query_timeout: 3000 });
  await db.connect();
  await db.query('begin read only');
  const calls = (await db.query('select id, provider, model, status, bound_microusd::text, actual_microusd::text, partial_microusd::text, charged_microusd::text, overrun from makeborne_private.live_provider_calls order by id')).rows;
  const days = (await db.query('select scope, sum(spent_microusd)::text spent_microusd, sum(reserved_microusd)::text reserved_microusd from makeborne_private.live_provider_days group by scope order by scope')).rows;
  const limits = (await db.query('select scope, enabled, emergency_stop, daily_limit_microusd::text from makeborne_private.live_provider_limits order by scope')).rows;
  await db.query('rollback');
  const accounted = calls.reduce((sum, call) => sum + BigInt(call.charged_microusd ?? call.bound_microusd), 0n);
  const global = days.find(day => day.scope === 'global');
  const aggregate = BigInt(global?.spent_microusd ?? '0') + BigInt(global?.reserved_microusd ?? '0');
  report.localLedger = { readOnly: true, calls, days, limits, accountedMicrousd: String(accounted), reconciles: accounted === aggregate };
} catch {
  // Error objects/connection strings can contain credentials. Never serialize them.
  report.localLedger = { readOnly: true, available: false, reason: 'LOCAL_LEDGER_READ_FAILED' };
} finally { if (db) await db.end().catch(() => {}); }
report.blockers = [
  'Root must reserve an exact package in the shared round ledger before paid calls.',
  'Old local-quality-server uses the previous round; use a separately reviewed isolated launcher with a package cap and deadline.',
  'Old qualify-products lacks the required operation envelope and reuses fixtures; prepare fresh project IDs and fresh evidence paths.',
  'Pin source hashes after Claude finishes document work; compare again immediately before generation and export.',
  'OpenAI credential absent: image generation is excluded and remains unqualified.',
];
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

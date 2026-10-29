// Exact-target staging cutover. Dry-run unless the complete reviewed list is supplied.
// Authentication comes from the owner's existing local management session, never Git.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const STAGING = 'xzwikrunwpurxnxgkznh';
const EXPECTED = [
  '20261027020420_launch_waitlist.sql',
  '20261028100000_purchase_confirmations.sql',
  '20261028213151_transactional_mail_delivery_fencing.sql',
];
const argv = process.argv.slice(2);
assert(argv.length === 0 || argv[0] === '--apply' || (argv.length === 1 && argv[0] === '--verify'), 'Dry-run, --verify or --apply with the exact reviewed files only');
const apply = argv[0] === '--apply';
const verify = argv[0] === '--verify';
if (apply) assert.deepEqual(argv.slice(1), EXPECTED);
const token = fs.readFileSync(path.join(os.homedir(), '.supabase/access-token'), 'utf8').trim();
assert(token && !token.includes('[SENSITIVE]'), 'Local management session required');
const out = 'work/launch-prep';
fs.mkdirSync(out, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = file => execFileSync('git', ['show', `HEAD:${file}`], { maxBuffer: 16 * 1024 * 1024 });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
async function api(suffix, init = {}) {
  // This helper deliberately has no production target argument.
  const response = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/${suffix}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, redirect: 'error',
  });
  if (!response.ok) throw new Error(`Staging management request failed: HTTP ${response.status}`);
  return response.json();
}
const query = (sql, readOnly = true) => api('database/query', {
  method: 'POST', body: JSON.stringify({ query: sql, read_only: readOnly }),
});
const baseline = JSON.parse(blob('docs/release-review/production-baseline.json')).rows[0].baseline.versions;
const inventory = JSON.parse(blob('docs/release-review/candidate-inventory.json')).migrations.order;
// Earlier GitHub qualification changed staging only. Verify those exact historical
// sources; do not import them into production or silently discard their tracker rows.
const extras = JSON.parse(fs.readFileSync('docs/release-review/staging-historical-github-migrations-20261028.json', 'utf8'));
assert.equal(extras.length, 6);
for (const extra of extras) {
  const bytes = execFileSync('git', ['show', `${extra.sourceCommit}:${extra.file}`]);
  assert.equal(sha(bytes), extra.canonicalSha, 'Historical source hash mismatch');
  assert(extra.matches && (extra.sha256 === sha(bytes) || extra.sha256 === sha(bytes.toString('utf8').replace(/\r?\n/g, '\r\n'))));
}
const files = fs.readdirSync('supabase/migrations').filter(f => /^\d{14}_.+\.sql$/.test(f)).sort();
const committed = new Map(files.map(file => [file.slice(0, 14), { file, bytes: blob(`supabase/migrations/${file}`) }]));
const applied = await query('select version,sha256 from makeborne_release_test.applied order by version');
const covered = new Set(baseline);
const normalized = [];
for (const row of applied) {
  const entry = committed.get(row.version);
  if (!entry) {
    const extra = extras.find(x => x.version === row.version);
    assert(extra && extra.sha256 === row.sha256, `Unrecognized staging migration ${row.version}`);
    continue;
  }
  assert(entry, `Unrecognized staging migration ${row.version}`);
  const canonical = sha(entry.bytes);
  if (row.sha256 !== canonical) {
    const lf = entry.bytes.toString('utf8').replace(/\r\n/g, '\n');
    const lineEndingOnly = row.sha256 === sha(lf) || row.sha256 === sha(lf.replace(/\n/g, '\r\n'));
    // Permit only the exact raw/canonical pair frozen in the historical inventory.
    // Never rewrite an applied hash, or accept arbitrary whitespace-normalized changes.
    const historical = inventory.find(x => x.file === entry.file);
    assert(lineEndingOnly || (historical?.rawSha256 === row.sha256 && historical.sha256 === canonical),
      `Applied migration differs from committed candidate: ${entry.file}`);
    normalized.push(entry.file);
  }
  covered.add(row.version);
}
const pending = [...committed.entries()].filter(([version]) => !covered.has(version)).map(([, x]) => ({ file: x.file, sha256: sha(x.bytes) }));
assert.deepEqual(pending.map(x => x.file), verify || pending.length === 0 ? [] : EXPECTED, 'Pending migrations differ from this reviewed release');
if (apply) assert.deepEqual(pending.map(x => x.file), EXPECTED, 'Already applied; use --verify without reapplying');
const before = verify ? JSON.parse(fs.readFileSync(`${out}/staging-security-before.private.json`, 'utf8')) : await api('advisors/security');
if (!verify) fs.writeFileSync(`${out}/staging-security-before.private.json`, JSON.stringify(before));
const lints = before.lints ?? [];
assert.equal(lints.filter(x => x.level === 'ERROR').length, 0, 'Existing staging security error: stop');
const report = { target: STAGING, head, productionTouched: false, dryRun: !apply,
  verifiedApplied: applied.length, historicalBytePair: normalized, pending, applied: [],
  before: { warnings: lints.filter(x => x.level === 'WARN').length, errors: 0 } };
const reportPath = `${out}/${verify ? 'staging-verification' : 'staging-preparation'}.json`;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (apply || verify) {
  assert.equal(report.before.warnings, 11, 'Staging baseline changed: review before applying');
  const overlay = JSON.parse(fs.readFileSync(`${out}/staging-overlay-rehearsal.json`, 'utf8'));
  assert(overlay.passed && overlay.changedInputs.length === 0, 'Staging overlay rehearsal required');
  assert(overlay.consumedInputs.every(x => sha(fs.readFileSync(x.file)) === x.sha256), 'Rehearsed SQL input changed; repeat qualification');
  for (const entry of pending) {
    const sql = committed.get(entry.file.slice(0, 14)).bytes.toString('utf8');
    assert.equal(fs.readFileSync(`supabase/migrations/${entry.file}`, 'utf8').replace(/\r\n/g, '\n'), sql.replace(/\r\n/g, '\n'), 'Working SQL differs from the committed candidate');
    assert(/\bbegin;/.test(sql) && /\bcommit;\s*$/i.test(sql), 'Expected explicit migration transaction');
    // Record history before COMMIT in the SAME transaction. A failed SQL or tracker
    // write cannot leave the schema applied without its immutable hash.
    const tracked = sql.replace(/\bcommit;\s*$/i,
      `insert into makeborne_release_test.applied(version,sha256) values ('${entry.file.slice(0, 14)}','${entry.sha256}');\ncommit;`);
    await query(tracked, false);
    report.applied.push(entry);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Applied to staging: ${entry.file}`);
  }
  const after = await api('advisors/security');
  fs.writeFileSync(`${out}/staging-security-after.private.json`, JSON.stringify(after));
  const identity = x => JSON.stringify([x.name, x.level, x.metadata ?? null, x.detail ?? null]);
  const previous = new Set(lints.map(identity));
  const newLints = (after.lints ?? []).filter(x => !previous.has(identity(x)));
  const privateTables = ['launch_waitlist', 'purchase_confirmations', 'transactional_mail', 'withdrawal_requests'];
  // INFO about deny-all RLS on an unexposed service-RPC-only table is expected,
  // not a reason to add an unsafe browser policy. Verify that boundary directly.
  const permittedInfo = x => x.level === 'INFO' && x.name === 'rls_enabled_no_policy'
    && x.metadata?.schema === 'makeborne_private' && privateTables.includes(x.metadata?.name);
  const actionable = newLints.filter(x => !permittedInfo(x));
  const privileges = await query(`select c.relname,c.relrowsecurity,
    has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
    has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_access,
    has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') as service_table_access
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='makeborne_private' and c.relname in ('launch_waitlist','purchase_confirmations','transactional_mail','withdrawal_requests') order by c.relname`);
  assert.equal(privileges.length, 4);
  assert(privileges.every(x => x.relrowsecurity && !x.anon_access && !x.authenticated_access && !x.service_table_access), 'Private mail table ACL boundary failed');
  const rest = await api('postgrest');
  assert(!String(rest.db_schema).split(',').some(x => ['makeborne_private','makeborne_rpc'].includes(x.trim())), 'Private RPC/data schema exposed');
  report.after = { warnings: (after.lints ?? []).filter(x => x.level === 'WARN').length,
    errors: (after.lints ?? []).filter(x => x.level === 'ERROR').length,
    newActionableFindings: actionable.length, expectedPrivateTableInfo: newLints.filter(permittedInfo).length,
    privateTableAclVerified: true, privateSchemasNotExposed: true };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  assert.equal(actionable.length, 0, 'New staging security finding: stop');
  console.log(JSON.stringify({ after: report.after, productionTouched: false }));
}

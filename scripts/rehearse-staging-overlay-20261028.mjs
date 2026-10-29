// Reproduce the staging-only historical GitHub overlay without changing staging.
// Uses immutable Git sources + the existing disposable, network-isolated rehearsal.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const prefix = process.argv[2];
assert(/^makeborne_candidate_[0-9]{8}$/.test(prefix ?? ''), 'Pass the disposable rehearsal prefix');
const out = 'work/launch-prep';
fs.mkdirSync(out, { recursive: true });
const extras = JSON.parse(fs.readFileSync('docs/release-review/staging-historical-github-migrations-20261028.json', 'utf8'));
for (const entry of extras) {
  const bytes = execFileSync('git', ['show', `${entry.sourceCommit}:${entry.file}`]);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.canonicalSha);
  assert(!fs.existsSync(entry.file), 'Historical overlay now overlaps the candidate; review the manifest');
  fs.writeFileSync(`${out}/${entry.file.split('/').at(-1)}`, bytes);
}
fs.writeFileSync(`${out}/staging-extra-migrations.json`, JSON.stringify(extras, null, 2));
let source = fs.readFileSync('scripts/rehearse-candidate.mjs', 'utf8').replace(/\r\n/g, '\n');
function replace(before, after) { assert(source.includes(before), 'Rehearsal implementation changed: review the adapter'); source = source.replace(before, after); }
replace('const migrations = readdirSync', 'const extraStageMigrations = JSON.parse(readFileSync(join(root, "work/launch-prep/staging-extra-migrations.json"), "utf8"));\nconst migrations = readdirSync');
replace('.sort();\nconst outOfOrder', '.concat(extraStageMigrations.map(x=>x.file.split("/").at(-1))).sort();\nconst outOfOrder');
replace('const migrationText = file => read(`supabase/migrations/${file}`);', 'const migrationText = file => read(extraStageMigrations.some(x=>x.file.endsWith("/"+file)) ? "work/launch-prep/"+file : "supabase/migrations/"+file);');
replace('const finalMigrations = readdirSync(join(root, "supabase", "migrations")).filter(file => file.endsWith(".sql") && !productionVersions.has(file.slice(0, 14))).sort();', 'const finalMigrations = readdirSync(join(root, "supabase", "migrations")).filter(file => file.endsWith(".sql") && !productionVersions.has(file.slice(0, 14))).concat(extraStageMigrations.map(x=>x.file.split("/").at(-1))).sort();');
source = source.replaceAll('join(root, "docs", "release-review", "candidate-rehearsal.json")', 'join(root, "work", "launch-prep", "staging-overlay-rehearsal.json")');
const generated = `${out}/rehearse-staging-overlay.mjs`;
fs.writeFileSync(generated, source);
const result = spawnSync(process.execPath, [generated, prefix], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;

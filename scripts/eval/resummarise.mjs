// Rebuild summary.json / summary.md / diversity.json of a measured set from its
// stored per-item metrics.json, without measuring again. Use it after a change to
// the summary or diversity code only (instrument changes need a new measurement).
// The measurement's own provenance (code, harness hash, tools) is kept; the
// rebuild is recorded next to it.
//
//   node scripts/eval/resummarise.mjs outputs/eval/measure/<setId>
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, rel } from './lib/paths.mjs';
import { measureDiversity } from './lib/diversity.mjs';
import { buildSummary, writeSummary, harnessProvenance } from './lib/summary.mjs';

export async function resummarise(measureDir) {
  const dir = path.resolve(measureDir);
  const previousFile = path.join(dir, 'summary.json');
  if (!existsSync(previousFile)) throw new Error(`No summary.json in ${rel(dir)}: measure the set first`);
  const previous = readJson(previousFile);
  const records = readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(path.join(dir, entry.name, 'metrics.json')))
    .map(entry => readJson(path.join(dir, entry.name, 'metrics.json')));
  const expected = previous.counts?.total;
  if (Number.isFinite(expected) && records.length !== expected) throw new Error(`Found ${records.length} metrics.json files, the summary lists ${expected}: refusing to rebuild a partial set`);
  const sites = records.filter(record => record.kind === 'website');
  const diversity = sites.length ? measureDiversity(sites) : null;
  if (diversity) writeJson(path.join(dir, 'diversity.json'), diversity);
  const now = await harnessProvenance();
  const summary = buildSummary({
    setId: previous.setId, set: previous.set, items: records, diversity,
    run: {
      startedAt: previous.startedAt, finishedAt: previous.finishedAt, wallMs: previous.wallMs, missing: previous.missingItems ?? [],
      provenance: { ...previous.provenance, resummarised: { at: new Date().toISOString(), harness: now.harness ?? now, note: 'summary rebuilt from stored metrics.json; instruments not re-run' } },
      options: previous.options,
    },
  });
  return writeSummary(dir, summary);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target) { console.error('usage: node scripts/eval/resummarise.mjs <measureDir>'); process.exit(2); }
  resummarise(target).then(files => console.log(`rebuilt ${rel(files.md)}`), error => { console.error(error.message); process.exitCode = 1; });
}

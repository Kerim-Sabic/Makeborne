// Applies reviewed candidate migrations to the STAGING Supabase project only.
// Dry run by default. Usage:
//   node scripts/apply-staging-migrations.mjs                 (report pending, change nothing)
//   node scripts/apply-staging-migrations.mjs --apply <file>  (apply exactly the named pending files, in order)
// Staging history is `makeborne_release_test.applied` (staging was built by direct SQL, so it has no
// supabase_migrations table). Production is refused by reference, not by convention.
import fs from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";

const STAGING_REF = "xzwikrunwpurxnxgkznh", PRODUCTION_REF = "rklojnmmsmhwnkbzuidp";
const root = "work/release-auth-stack/";
const json = file => JSON.parse(fs.readFileSync(root + file, "utf8").replace(/^﻿/, ""));
const project = json("cloud-create-result.json"), config = json("cloud-staging.json");
assert.equal(project.ref, STAGING_REF, "Credentials are not for the staging project");
assert.notEqual(project.ref, PRODUCTION_REF);
assert.equal(config.productionRef, PRODUCTION_REF, "Staging config must name production so it can be refused");

const sha = file => createHash("sha256").update(fs.readFileSync("supabase/migrations/" + file)).digest("hex");
const requested = process.argv.includes("--apply") ? process.argv.slice(process.argv.indexOf("--apply") + 1) : null;
const production = new Set(JSON.parse(fs.readFileSync("docs/release-review/production-baseline.json", "utf8")).rows[0].baseline.versions);
const candidate = fs.readdirSync("supabase/migrations").filter(f => f.endsWith(".sql") && !production.has(f.slice(0, 14))).sort();

const db = new pg.Client({ host: `db.${STAGING_REF}.supabase.co`, user: "postgres", password: config.password, database: "postgres",
  ssl: { rejectUnauthorized: true, ca: fs.readFileSync(root + "supabase-ca.crt", "utf8") }, connectionTimeoutMillis: 10000 });
await db.connect();
const report = { target: STAGING_REF, productionTouched: false, startedAt: new Date().toISOString(), dryRun: !requested, verifiedApplied: 0, pending: [], applied: [] };
try {
  const applied = new Map((await db.query("select version, sha256 from makeborne_release_test.applied")).rows.map(r => [r.version, r.sha256]));
  for (const [version, hash] of applied) {
    const file = candidate.find(f => f.startsWith(version + "_"));
    assert(file, `Staging has ${version}, which is not a candidate migration`);
    assert.equal(sha(file), hash, `${file} changed after it was applied to staging: rebuild staging from baseline`);
    report.verifiedApplied++;
  }
  report.pending = candidate.filter(f => !applied.has(f.slice(0, 14))).map(file => ({ file, sha256: sha(file) }));
  // Pending files must follow everything already applied, or staging would diverge from the production order.
  const last = [...applied.keys()].sort().at(-1);
  for (const p of report.pending) assert(p.file.slice(0, 14) > last, `${p.file} is older than staging's last migration ${last}`);
  if (requested) {
    assert.deepEqual(requested, report.pending.map(p => p.file), "--apply must list exactly the pending files, in order");
    for (const { file, sha256 } of report.pending) {
      // Each migration manages its own transaction; the history row is written only after it commits.
      await db.query(fs.readFileSync("supabase/migrations/" + file, "utf8"));
      await db.query("insert into makeborne_release_test.applied(version, sha256) values ($1, $2)", [file.slice(0, 14), sha256]);
      report.applied.push({ file, sha256, at: new Date().toISOString() });
      console.log(`Applied ${file}`);
    }
  }
  const limits = (await db.query("select scope from makeborne_private.live_provider_limits where enabled")).rows;
  assert.equal(limits.length, 0, "A provider spend limit is enabled on staging");
  report.totalApplied = (await db.query("select count(*)::int n from makeborne_release_test.applied")).rows[0].n;
  console.log(`${report.dryRun ? "DRY RUN" : "DONE"}: ${report.verifiedApplied} verified, pending ${report.pending.map(p => p.file).join(", ") || "none"}`);
} catch (error) {
  report.error = error.message; console.error(error.message); process.exitCode = 1;
} finally {
  await db.end();
  if (!report.dryRun) fs.writeFileSync("docs/release-review/staging-migrations-20261013.json", JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2) + "\n");
}

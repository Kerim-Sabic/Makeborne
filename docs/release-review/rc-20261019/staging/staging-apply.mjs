// Applies the candidate's ONE new migration to the STAGING Supabase project (xzwikrunwpurxnxgkznh).
// Run from the LF snapshot of the frozen candidate (git -c core.autocrlf=false archive a6e70c6).
// Dry run by default; `--apply` applies. Production is refused by reference.
//
// History check: staging's makeborne_release_test.applied recorded some files with CRLF hashes and
// others with LF hashes (Windows checkouts). Each recorded row must equal the candidate file's sha256
// after LF or after CRLF normalisation; any other difference (a real content change) fails.
// A read-only custom-format backup is taken before applying. Outputs go to work/rc-stack/staging/
// (ignored); nothing secret is printed.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";

const REF = "xzwikrunwpurxnxgkznh", PRODUCTION_REF = "rklojnmmsmhwnkbzuidp", EXPECTED_PENDING = ["20261019090000_app_observability.sql"];
const apply = process.argv.includes("--apply");
const out = path.resolve("../staging"); fs.mkdirSync(out, { recursive: true });
// The 2026-10-17 operator folder in the main checkout (endpoint and CA used for the last staging apply).
const repairDir = "C:/Users/kerim/Documents/Codex/2026-10-03/referenced-chatgpt-conversation-this-is-an/work/makeborne-app/work/release-studio-parity-repair-20261017";
const config = JSON.parse(fs.readFileSync("work/release-auth-stack/cloud-staging.json", "utf8").replace(/^﻿/, ""));
assert.equal(config.productionRef, PRODUCTION_REF, "staging config must name production so it can be refused");
const endpoint = JSON.parse(fs.readFileSync(path.join(repairDir, "staging-endpoint.json"), "utf8"));
assert.equal(endpoint.ref, REF); assert.equal(endpoint.user, `postgres.${REF}`); assert.notEqual(endpoint.ref, PRODUCTION_REF);
const ca = path.join(repairDir, "trusted-ca.crt");
const sha = buffer => createHash("sha256").update(buffer).digest("hex");
const lf = text => text.replace(/\r\n/g, "\n"), crlf = text => lf(text).replace(/\n/g, "\r\n");
const inventory = new Map(JSON.parse(fs.readFileSync("docs/release-review/candidate-inventory-20261014-r4.json", "utf8")).release.migrations.all.map(m => [m.file, m]));
const production = new Set(JSON.parse(fs.readFileSync("docs/release-review/production-baseline.json", "utf8")).rows[0].baseline.versions);
const candidate = fs.readdirSync("supabase/migrations").filter(f => f.endsWith(".sql") && !production.has(f.slice(0, 14))).sort();
const report = { ref: REF, productionTouched: false, candidateCommit: "a6e70c6f577aa5bf7654e72cd8d85b9977bd247e", dryRun: !apply, startedAt: new Date().toISOString(), verified: { lf: 0, crlf: 0 }, pending: [], applied: [] };

if (apply) {
  // Read-only backup first (same image and method as the 2026-10-17 staging backup).
  const backup = "staging-before-a6e70c6.dump";
  fs.copyFileSync(ca, path.join(out, "trusted-ca.crt"));
  const env = { ...process.env, PGHOST: endpoint.host, PGPORT: "5432", PGUSER: endpoint.user, PGPASSWORD: config.password, PGDATABASE: "postgres", PGSSLMODE: "verify-full", PGSSLROOTCERT: "/backup/trusted-ca.crt", PGOPTIONS: "-c default_transaction_read_only=on -c lock_timeout=10000", MSYS_NO_PATHCONV: "1" };
  const args = ["run", "--rm", "--mount", `type=bind,source=${out},target=/backup`];
  for (const key of ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE", "PGSSLROOTCERT", "PGOPTIONS"]) args.push("-e", key);
  args.push("--entrypoint", "pg_dump", "public.ecr.aws/supabase/postgres:17.11.0.002", "--format=custom", `--file=/backup/${backup}`);
  const dump = spawnSync("docker", args, { env, encoding: "utf8", timeout: 300000, maxBuffer: 8e6 });
  fs.writeFileSync(path.join(out, "staging-backup.private.log"), `${dump.stdout ?? ""}\n${dump.stderr ?? ""}`);
  assert.equal(dump.status, 0, "staging backup failed (see staging-backup.private.log)");
  const bytes = fs.readFileSync(path.join(out, backup));
  const listing = spawnSync("docker", ["run", "--rm", "--network=none", "--mount", `type=bind,source=${out},target=/backup,readonly`, "--entrypoint", "pg_restore", "public.ecr.aws/supabase/postgres:17.11.0.002", "--list", `/backup/${backup}`], { encoding: "utf8", timeout: 60000, maxBuffer: 8e6, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  assert.equal(listing.status, 0, "backup listing failed");
  report.backup = { file: backup, bytes: bytes.length, sha256: sha(bytes), entries: listing.stdout.split("\n").filter(line => /^\d+;/.test(line)).length };
}

const db = new pg.Client({ host: endpoint.host, port: 5432, user: endpoint.user, password: config.password, database: "postgres", ssl: { rejectUnauthorized: true, ca: fs.readFileSync(ca, "utf8") }, connectionTimeoutMillis: 15000 });
await db.connect();
try {
  assert(db.connection.stream.authorized, "TLS not verified");
  const applied = (await db.query("select version, sha256 from makeborne_release_test.applied order by version")).rows;
  for (const row of applied) {
    const file = candidate.find(f => f.startsWith(row.version + "_"));
    assert(file, `staging has ${row.version}, which is not a candidate migration`);
    const text = fs.readFileSync(`supabase/migrations/${file}`, "utf8");
    if (sha(lf(text)) === row.sha256) report.verified.lf++;
    else if (sha(crlf(text)) === row.sha256) report.verified.crlf++;
    // Mixed line endings: the 2026-10-14 release inventory recorded both the raw bytes and the normalised hash.
    else if (inventory.get(file)?.rawSha256 === row.sha256 && inventory.get(file)?.sha256 === sha(lf(text))) { report.verified.inventoryRaw = (report.verified.inventoryRaw ?? 0) + 1; }
    else assert.fail(`${file}: content differs from what staging applied (not only line endings)`);
  }
  report.pending = candidate.filter(f => !applied.some(row => f.startsWith(row.version + "_")));
  assert.deepEqual(report.pending, EXPECTED_PENDING, "pending staging migrations are not exactly the candidate's new migration");
  const limits = (await db.query("select scope from makeborne_private.live_provider_limits where enabled")).rows;
  assert.equal(limits.length, 0, "a provider spending limit is enabled on staging");
  if (apply) {
    for (const file of report.pending) {
      const text = lf(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
      const hasTx = /^begin;\s*$/mi.test(text) && /\ncommit;\s*$/i.test(text);
      const body = hasTx ? text.replace(/^begin;\s*\n/mi, "").replace(/\ncommit;\s*$/i, "\n") : text;
      await db.query("begin");
      try {
        await db.query(body);
        await db.query("insert into makeborne_release_test.applied(version, sha256) values ($1, $2)", [file.slice(0, 14), sha(text)]);
        await db.query("commit");
      } catch (error) { await db.query("rollback"); throw error; }
      report.applied.push({ file, sha256: sha(text), at: new Date().toISOString() });
    }
    report.totalTracked = (await db.query("select count(*)::int n from makeborne_release_test.applied")).rows[0].n;
  }
  report.passed = true;
} catch (error) {
  report.error = error.message; process.exitCode = 1;
} finally {
  await db.end();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, apply ? "staging-apply.json" : "staging-dry-run.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

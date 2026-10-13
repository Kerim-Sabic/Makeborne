// Freezes the release candidate: base commit, every changed or new source file
// with its SHA-256, the pending migration order and one aggregate hash.
// Read-only apart from writing docs/release-review/candidate-inventory.json.
// Usage: node scripts/freeze-candidate-inventory.mjs [--check]
//   --check  recompute against the saved base commit (committed or not) and fail on any difference.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const OUT = "docs/release-review/candidate-inventory.json";
// Evidence, generated outputs and scratch directories are not release source.
// Agent coordination notes (status, handoff) change constantly and are not release source either.
const EXCLUDED = [/^docs\/release-review\//, /^outputs\//, /^work\//, /(^|\/)\.env(?!\.example$)/, /^docs\/(PROJECT_STATUS|AGENT_HANDOFF)\.md$/];

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const sha256 = data => createHash("sha256").update(data).digest("hex");
// Hash text with LF line endings so Windows and Linux checkouts agree.
const hashFile = path => {
  const bytes = readFileSync(path);
  return sha256(bytes.includes(0) ? bytes : Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n")));
};
const NUL = String.fromCharCode(0);

const check = process.argv.includes("--check");
const saved = check ? JSON.parse(readFileSync(OUT, "utf8")) : null;
// Compare against the base commit, so the same list results before and after the owner commits.
const base = saved?.baseCommit ?? git("rev-parse", "HEAD").trim();
const branch = git("rev-parse", "--abbrev-ref", "HEAD").trim();
const changed = [];
const diff = git("diff", "--name-status", "--no-renames", "-z", base).split(NUL).filter(Boolean);
for (let i = 0; i < diff.length; i += 2) changed.push([diff[i] === "A" ? "added" : diff[i] === "D" ? "deleted" : "modified", diff[i + 1]]);
for (const path of git("ls-files", "--others", "--exclude-standard", "-z").split(NUL).filter(Boolean)) changed.push(["added", path]);
const files = [], deleted = [];
for (const [status, path] of changed) {
  if (EXCLUDED.some(pattern => pattern.test(path))) continue;
  if (status === "deleted" || !existsSync(path)) { deleted.push(path); continue; }
  files.push({ path, status, sha256: hashFile(path) });
}
files.sort((a, b) => a.path.localeCompare(b.path));
deleted.sort();

const production = JSON.parse(readFileSync("docs/release-review/production-baseline.json", "utf8")).rows[0].baseline.versions;
const last = [...production].sort().at(-1);
const migrations = readdirSync("supabase/migrations").filter(name => name.endsWith(".sql") && !production.includes(name.slice(0, 14))).sort()
  .map(name => ({ file: name, outOfOrder: name.slice(0, 14) < last, sha256: hashFile(`supabase/migrations/${name}`),
    // Raw bytes, as applied and as recorded by scripts/rehearse-candidate.mjs.
    rawSha256: sha256(readFileSync(`supabase/migrations/${name}`)) }));
const aggregate = sha256([`base ${base}`, ...files.map(f => `${f.sha256}  ${f.path}`), ...deleted.map(p => `deleted  ${p}`)].join("\n"));

if (check) {
  const differing = [...new Set([...saved.files, ...files].map(f => f.path))]
    .filter(path => saved.files.find(f => f.path === path)?.sha256 !== files.find(f => f.path === path)?.sha256);
  if (saved.aggregateSha256 !== aggregate) {
    console.error(`MISMATCH against base ${base}; files differing: ${differing.join(", ") || "(deletions only)"}`);
    process.exit(1);
  }
  console.log(`PASS candidate matches ${OUT} (${aggregate})`);
} else {
  const inventory = {
    frozenAt: new Date().toISOString(), branch, baseCommit: base, committed: false,
    note: "Uncommitted candidate. The owner commits and tags it; that tree must reproduce this aggregate (run with --check).",
    aggregateSha256: aggregate, packageLockSha256: hashFile("package-lock.json"), node: process.version,
    excluded: EXCLUDED.map(String),
    counts: { added: files.filter(f => f.status === "added").length, modified: files.filter(f => f.status === "modified").length, deleted: deleted.length },
    productionLastMigration: last,
    migrations: { count: migrations.length, apply: "npx supabase db push --include-all", order: migrations },
    // Where this candidate was verified (staging only); production is unchanged.
    stagingDeployment: existsSync("docs/release-review/staging-deployment-20261013.json")
      ? (({ app, database, worker, auth }) => ({ app: { deployment: app.deployment, url: app.url }, database: { ref: database.ref, migrations: database.migrations }, worker: { name: worker.name, version: worker.version, appOrigin: worker.appOrigin, sources: worker.workerSourceSha256 }, auth: auth.siteUrl }))(JSON.parse(readFileSync("docs/release-review/staging-deployment-20261013.json", "utf8")))
      : null,
    files, deleted,
  };
  writeFileSync(OUT, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(`Froze ${files.length} files, ${deleted.length} deletions, ${migrations.length} migrations: ${aggregate}`);
}

// Complete release-source inventory; no network calls or environment values read.
// node scripts/freeze-candidate-inventory.mjs --output work/<run>/inventory.json
// node scripts/freeze-candidate-inventory.mjs --check --output work/<run>/inventory.json
// Add --commit <sha> to --check to verify the actual committed tree as well.
// Existing output is immutable: choose a new output path to preserve history.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const EXCLUDED = [/^docs\/release-review\//, /^outputs\//, /^work\//,
  /(^|\/)\.env(?!\.example$)/, /(^|\/)\.dev\.vars/, /(^|\/)\.vercel\//,
  /^docs\/(PROJECT_STATUS|AGENT_HANDOFF)\.md$/];
const INPUTS = ["docs/release-review/production-baseline.json", "docs/release-review/production-schema.sql",
  "docs/release-review/staging-platform-schema.sql"];
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--check") options.check = true;
  else if (["--output", "--commit"].includes(arg) && args[i + 1] && !args[i + 1].startsWith("--")) options[arg.slice(2)] = args[++i];
  else throw new Error(`Unsupported or incomplete argument: ${arg}`);
}
if (options.commit && !options.check) throw new Error("--commit requires --check");
const out = options.output ?? "docs/release-review/candidate-inventory.json";
if (!/^(?:work|docs\/release-review)\/(?!.*(?:^|\/)\.\.(?:\/|$)).+\.json$/.test(out) || out.includes("\\")) {
  throw new Error("Inventory output must be a relative .json path under work/ or docs/release-review/");
}
const git = (...argv) => execFileSync("git", argv, { maxBuffer: 128 * 1024 * 1024 });
const gitText = (...argv) => git(...argv).toString("utf8");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
// Canonical source hashes use LF, matching text normalized by Git attributes.
// Raw hashes additionally bind the migration/rehearsal bytes actually executed.
const canonical = bytes => bytes.includes(0) ? bytes : Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));
const hashFile = path => sha256(canonical(readFileSync(path)));
const permitted = path => !EXCLUDED.some(pattern => pattern.test(path));
const paths = [...new Set(gitText("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean))]
  .filter(permitted).filter(existsSync).sort();
const files = paths.map(path => ({ path, sha256: hashFile(path) }));
const sourceSha256 = sha256(JSON.stringify(files));
const production = JSON.parse(readFileSync(INPUTS[0], "utf8")).rows?.[0]?.baseline?.versions;
if (!Array.isArray(production) || !production.length || production.some(version => !/^\d{14}$/.test(version))) throw new Error("Malformed production migration baseline");
const versions = [...new Set(production)].sort();
const last = versions.at(-1);
const migrationRoot = "supabase/migrations/";
const allMigrations = files.filter(file => /^supabase\/migrations\/\d{14}_.+\.sql$/.test(file.path))
  .map(file => ({ file: file.path.slice(migrationRoot.length), sha256: file.sha256,
    rawSha256: sha256(readFileSync(file.path)), appliedInBaseline: versions.includes(file.path.slice(migrationRoot.length, migrationRoot.length + 14)) }));
if (new Set(allMigrations.map(migration => migration.file.slice(0, 14))).size !== allMigrations.length) throw new Error("Duplicate migration version");
const pending = allMigrations.filter(migration => !migration.appliedInBaseline)
  .map(migration => ({ ...migration, outOfOrder: migration.file.slice(0, 14) < last }));
const environmentNames = new Set();
for (const path of paths.filter(path => /\.(?:[cm]?[jt]sx?|toml|json)$/.test(path) || path === ".env.example")) {
  const text = readFileSync(path, "utf8");
  for (const match of text.matchAll(/\bprocess\.env\.([A-Z][A-Z0-9_]*)|\bprocess\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g)) environmentNames.add(match[1] ?? match[2]);
  if (path === ".env.example") for (const match of text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) environmentNames.add(match[1]);
}
// Release policy requirements; these do not assert readback or activation.
// Secret values, provider identities and origins are never copied here.
const configuration = {
  environmentVariableNames: [...environmentNames].sort(),
  namesAreNotPresenceOrQualificationProof: true,
  requiredSecretNamesByFeature: {
    cloud: ["SUPABASE_SECRET_KEY"], generation: ["ANTHROPIC_API_KEY"], images: ["OPENAI_API_KEY"],
    billing: ["WHOP_API_KEY", "WHOP_WEBHOOK_SECRET", "CRON_SECRET"],
    googleMail: ["MAKEBORNE_GOOGLE_MAIL_CLIENT_SECRET", "MAKEBORNE_MAIL_ENCRYPTION_KEY"],
    sourceBroker: ["MAKEBORNE_PUBLICATION_ASSET_BROKER_SECRET"], forms: ["MAKEBORNE_FORMS_SIGNING_SECRET"],
  },
  providerRequirements: { googleMailMode: "send_only", mailAutomationEnabled: false,
    hostingNamespace: "staging", productionOperationsAuthorized: false,
    stagingTestPolicy: { aiPackageCapUsd: 5, globalDailyMicrousd: 5_000_000, anthropicDailyMicrousd: 5_000_000,
      openaiEnabled: false, ledgerReservationRequiredBeforeCalls: true, webSearchQualified: false },
    providerDefaultsEnabled: false, modelSelectionRequiresVerifiedPriceAndSeparateQualification: true },
  remoteGuard: { allowedStagingDatabaseRef: "xzwikrunwpurxnxgkznh", forbiddenProductionDatabaseRef: "rklojnmmsmhwnkbzuidp" },
};
const release = { sourceSha256, files, excluded: EXCLUDED.map(String),
  packageLockSha256: hashFile("package-lock.json"), configuration,
  productionBaseline: { lastMigration: last, versions },
  rehearsalInputs: INPUTS.map(path => ({ path, sha256: hashFile(path), rawSha256: sha256(readFileSync(path)) })),
  migrations: { count: pending.length, allCount: allMigrations.length, all: allMigrations, order: pending,
    applyRequiresSeparateApproval: true, proposedApply: "npx supabase db push --include-all" } };
const aggregateSha256 = sha256(JSON.stringify(release));

if (options.check) {
  const saved = JSON.parse(readFileSync(out, "utf8"));
  if (saved.schemaVersion !== 2) throw new Error("Legacy inventory is incomplete; preserve it and freeze v2 to a new --output path");
  if (sha256(JSON.stringify(saved.release)) !== saved.aggregateSha256) throw new Error("Saved inventory payload does not match its aggregate");
  if (saved.aggregateSha256 !== aggregateSha256) throw new Error("Candidate mismatch: source, migrations, configuration or rehearsal inputs changed");
  if (options.commit) {
    const commit = gitText("rev-parse", "--verify", `${options.commit}^{commit}`).trim();
    const committed = gitText("ls-tree", "-r", "--name-only", "-z", commit).split("\0").filter(Boolean).filter(permitted).sort()
      .map(path => ({ path, sha256: sha256(canonical(git("show", `${commit}:${path}`))) }));
    if (sha256(JSON.stringify(committed)) !== sourceSha256) throw new Error("Committed release tree differs from frozen source");
    console.log(`PASS committed source ${commit} matches frozen source ${sourceSha256}`);
  }
  console.log(`PASS candidate matches ${out} (${aggregateSha256})`);
} else {
  if (existsSync(out)) throw new Error("Refusing to overwrite historical inventory; choose a fresh --output path");
  mkdirSync(dirname(out), { recursive: true });
  const inventory = { schemaVersion: 2, frozenAt: new Date().toISOString(),
    branch: gitText("rev-parse", "--abbrev-ref", "HEAD").trim(), baseCommit: gitText("rev-parse", "HEAD").trim(),
    node: process.version, note: "Complete intended release source. Verify --check and --check --commit <final-sha> after the authorized local commit. Policy requirements are not deployed settings.",
    aggregateSha256, release };
  writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`, { flag: "wx" });
  console.log(`Froze ${files.length} source files, ${pending.length} pending/${allMigrations.length} total migrations: ${aggregateSha256}`);
}

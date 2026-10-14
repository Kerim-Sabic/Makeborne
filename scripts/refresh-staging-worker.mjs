// Refreshes the STAGING customer-site Worker: a fresh short-lived Vercel OIDC token for the
// protected staging preview, then `wrangler deploy --env staging`. Never touches production.
// Usage: node scripts/refresh-staging-worker.mjs            (checks only)
//        node scripts/refresh-staging-worker.mjs --deploy   (rotate token, deploy staging Worker)
// The target preview is env.staging.vars.APP_ORIGIN in infra/customer-sites/wrangler.jsonc, so the
// tracked configuration always equals what was deployed. The token value is never printed or saved.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const STAGING_PROJECT = "prj_c9h8fuyEmVAT8F3NHFMvzFR1BnLc", SCOPE = "kerimsabic-6594s-projects";
const snapshot = path.resolve("work/cloud-staging-source-20261012");
const config = "infra/customer-sites/wrangler.jsonc";
assert.equal(JSON.parse(fs.readFileSync(snapshot + "/.vercel/project.json", "utf8")).projectId, STAGING_PROJECT, "Snapshot is not linked to the staging project");

// wrangler.jsonc allows comments; strip them before parsing.
const wrangler = JSON.parse(fs.readFileSync(config, "utf8").replace(/^\s*\/\/.*$/gm, ""));
const staging = wrangler.env.staging;
assert.equal(staging.name, "makeborne-site-host-staging");
assert.equal(staging.vars.SUPABASE_URL, "https://xzwikrunwpurxnxgkznh.supabase.co");
assert.match(staging.vars.APP_ORIGIN, /^https:\/\/makeborne-release-staging-[a-z0-9]+-kerimsabic-6594s-projects\.vercel\.app$/);
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: "utf8", shell: process.platform === "win32", timeout: 180000, ...options });

const report = { checkedAt: new Date().toISOString(), worker: staging.name, appOrigin: staging.vars.APP_ORIGIN, productionTouched: false };
if (process.argv.includes("--deploy")) {
  // 1. Fresh token from the staging project's preview environment (12-hour Vercel OIDC token).
  const envFile = path.join(snapshot, ".env.local");
  const pulled = run("npx", ["--no-install", "vercel", "env", "pull", ".env.local", "--environment", "preview", "--scope", SCOPE, "--yes"], { cwd: snapshot });
  assert.equal(pulled.status, 0, "vercel env pull failed for the staging project");
  const raw = fs.readFileSync(envFile, "utf8").match(/^VERCEL_OIDC_TOKEN=(.*)$/m)?.[1];
  assert(raw, "Staging environment returned no OIDC token");
  const token = raw.startsWith("\"") ? JSON.parse(raw) : raw;
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  assert.equal(claims.project_id, STAGING_PROJECT, "OIDC token belongs to another project");
  assert(claims.exp * 1000 > Date.now() + 3600_000, "OIDC token expires within an hour");
  // 2. Store it as a staging-only Worker secret (value via stdin, never argv), then deploy staging.
  const secret = run("npx", ["--no-install", "wrangler", "secret", "put", "STAGING_VERCEL_OIDC_TOKEN", "--config", config, "--env", "staging"], { input: token });
  assert.equal(secret.status, 0, "Could not store the staging Worker token");
  const deployed = run("npx", ["--no-install", "wrangler", "deploy", "--config", config, "--env", "staging"]);
  assert.equal(deployed.status, 0, "Staging Worker deploy failed:\n" + deployed.stderr.slice(-2000));
  report.version = deployed.stdout.match(/Current Version ID:\s*([0-9a-f-]{36})/)?.[1] ?? null;
  report.tokenExpiresAt = new Date(claims.exp * 1000).toISOString();
  report.deployedAt = new Date().toISOString();
}
const secrets = run("npx", ["--no-install", "wrangler", "secret", "list", "--config", config, "--env", "staging", "--format", "json"]);
assert.equal(secrets.status, 0, "Could not list staging Worker secrets");
report.secretNames = JSON.parse(secrets.stdout.slice(secrets.stdout.indexOf("["))).map(item => item.name).sort();
console.log(JSON.stringify(report, null, 2));
if (report.deployedAt) fs.writeFileSync("docs/release-review/staging-worker-refresh.json", JSON.stringify(report, null, 2) + "\n");

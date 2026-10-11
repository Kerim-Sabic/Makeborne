// Runs the standalone offline check harnesses (src/**/check-*.cjs).
// Harnesses that need a running server, a database, a browser, or opt-in
// MAKEBORNE_VERIFY_* environment are excluded below; run those by hand.
import {spawnSync} from "node:child_process";
import {readdirSync} from "node:fs";
import {join, relative, sep} from "node:path";

const root = process.cwd();
const timeoutMs = 120_000;

const excluded = new Map([
  // Smoke checks against a running local server (URL argument, fetch).
  ["src/lib/capabilities/check-runtime.cjs", "needs a running local server"],
  ["src/lib/server/check-pdf-layout.cjs", "needs a running local server and MAKEBORNE_VERIFY_EXPORT_HTTP"],
  // Interactive fixture: serves a preview and waits for a browser session.
  ["src/lib/projects/check-preview-forms.cjs", "interactive browser fixture"],
  // Fail closed once the reviewed qualification tariff window has passed.
  ["src/lib/generation/check-qualification.cjs", "time-boxed tariff window needs a pricing review"],
  ["src/lib/generation/check-repair-qualification.cjs", "time-boxed tariff window needs a pricing review"],
]);

function findChecks(dir) {
  const found = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findChecks(path));
    else if (/^check-.*\.cjs$/.test(entry.name)) found.push(relative(root, path).split(sep).join("/"));
  }
  return found;
}

const all = process.argv.includes("--all");
const filters = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("MAKEBORNE_VERIFY_")));
const checks = findChecks(join(root, "src")).sort()
  .filter((file) => all || !excluded.has(file))
  .filter((file) => filters.length === 0 || filters.some((filter) => file.includes(filter)));

const failures = [];
for (const file of checks) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [file], {cwd: root, env, encoding: "utf8", timeout: timeoutMs});
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status === 0) {
    console.log(`ok   ${file} (${seconds}s)`);
    continue;
  }
  const reason = result.error?.code === "ETIMEDOUT" ? `timed out after ${timeoutMs / 1000}s` : `exit ${result.status ?? result.signal}`;
  failures.push(file);
  console.log(`FAIL ${file} (${reason}, ${seconds}s)`);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-20).join("\n");
  if (output) console.log(output.replace(/^/gm, "     "));
}

if (!all) for (const [file, reason] of excluded) console.log(`skip ${file} (${reason})`);
console.log(`\n${checks.length - failures.length}/${checks.length} check harnesses passed.`);
if (failures.length) process.exitCode = 1;

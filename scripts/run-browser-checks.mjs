// Runs every mounted browser check in one or more Playwright engines and prints a check × engine matrix.
// Local only: each check routes its own API and makes no paid calls.
//   node scripts/run-browser-checks.mjs --engines chromium,firefox,webkit [--only name,name] [--jobs 3] [--logs dir]
// A cell is PASS, FAIL, or PASS* when the check passed but reported an engine-limited measurement it could not make
// in that engine (the check prints "SKIP … -only measurement"; the note is listed under the matrix).
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const option = (name, fallback) => {
  const inline = process.argv.find(arg => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const engines = option("engines", "chromium,firefox,webkit").split(",").map(value => value.trim()).filter(Boolean);
const only = option("only", "").split(",").map(value => value.trim().replace(/\.cjs$/, "")).filter(Boolean);
const jobs = Math.max(1, Number(option("jobs", "3")) || 3);
const logs = path.resolve(option("logs", path.join(tmpdir(), "makeborne-browser-checks")));
const timeoutMs = Number(option("timeout", String(10 * 60 * 1000)));
for (const engine of engines) if (!["chromium", "firefox", "webkit"].includes(engine)) throw new Error(`Unknown engine ${engine}`);

const checks = readdirSync(path.join(root, "scripts"))
  .filter(name => /^check-.*-browser\.cjs$/.test(name) || ["check-attachment-flow.cjs", "check-trusted-publication-flow.cjs"].includes(name))
  .map(name => name.replace(/\.cjs$/, ""))
  .filter(name => !only.length || only.includes(name))
  .sort();
mkdirSync(logs, { recursive: true });

function run(check, engine) {
  return new Promise(resolve => {
    const started = Date.now(), output = [];
    const child = spawn(process.execPath, [path.join("scripts", `${check}.cjs`), `--engine=${engine}`], { cwd: root, env: { ...process.env, PW_ENGINE: engine }, windowsHide: true });
    const timer = setTimeout(() => { output.push(`\nTIMEOUT after ${timeoutMs} ms`); child.kill(); }, timeoutMs);
    child.stdout.on("data", chunk => output.push(chunk.toString()));
    child.stderr.on("data", chunk => output.push(chunk.toString()));
    child.on("close", code => {
      clearTimeout(timer);
      const text = output.join("");
      writeFileSync(path.join(logs, `${engine}-${check}.log`), text);
      const skips = text.split(/\r?\n/).filter(line => /^SKIP .*-only measurement/.test(line));
      const failure = code === 0 ? "" : (text.split(/\r?\n/).find(line => /^FAIL|Error|assert/i.test(line)) ?? `exit ${code}`).slice(0, 160);
      resolve({ check, engine, code, seconds: Math.round((Date.now() - started) / 1000), skips, failure });
    });
  });
}

const queue = checks.flatMap(check => engines.map(engine => ({ check, engine })));
const results = [];
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  for (let next = queue.shift(); next; next = queue.shift()) {
    const result = await run(next.check, next.engine);
    results.push(result);
    console.log(`${result.code === 0 ? "PASS" : "FAIL"} ${result.engine.padEnd(8)} ${result.check} (${result.seconds} s)${result.failure ? ` :: ${result.failure}` : ""}`);
  }
}));

const cell = (check, engine) => {
  const result = results.find(item => item.check === check && item.engine === engine);
  return !result ? "-" : result.code !== 0 ? "FAIL" : result.skips.length ? "PASS*" : "PASS";
};
const width = Math.max(...checks.map(check => check.length));
console.log(`\n${"check".padEnd(width)}  ${engines.map(engine => engine.padEnd(8)).join(" ")}`);
for (const check of checks) console.log(`${check.padEnd(width)}  ${engines.map(engine => cell(check, engine).padEnd(8)).join(" ")}`);
const notes = results.filter(result => result.skips.length);
if (notes.length) {
  console.log("\n* engine-limited measurements not made:");
  for (const result of notes) for (const skip of result.skips) console.log(`  ${result.engine} ${result.check}: ${skip.replace(/^SKIP /, "")}`);
}
const failed = results.filter(result => result.code !== 0);
console.log(`\n${results.length - failed.length}/${results.length} check runs passed. Logs: ${logs}`);
process.exitCode = failed.length ? 1 : 0;

/* eslint-disable @typescript-eslint/no-require-imports -- Offline library card metadata checks. */
// M04: a card's date says what it measures. The account listing's date is the saved-source
// time, and that only stays true while nothing but a version save writes the artifact row:
// a chat, plan, preview, check or publication must not make a project look freshly saved.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict");
const context = { exports: {}, Date, Number };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve("./project-labels.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { savedSourceMeta, shortDate } = context.exports;
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
const format = iso => `<${iso.slice(0, 10)}>`;

check("a saved version is labelled as saved source, with its own time", () => {
  assert.deepEqual({ ...savedSourceMeta({ currentVersion: 3, createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-19T12:00:00.000Z" }, format) },
    { label: "Version 3 · saved <2026-10-19>", at: "2026-10-19T12:00:00.000Z" });
});
check("a project without a saved version says when it was created, not saved", () => {
  assert.deepEqual({ ...savedSourceMeta({ currentVersion: 0, createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-20T09:00:00.000Z" }, format) },
    { label: "New draft · created <2026-10-01>", at: "2026-10-01T09:00:00.000Z" });
});
check("an unreadable date is not shown as Invalid Date", () => {
  assert.equal(shortDate("not a date"), "date unknown");
  assert.match(shortDate(new Date().toISOString()), /\S/);
  assert.match(shortDate("2019-03-04T00:00:00.000Z"), /2019/, "older years are named");
});

// The guard behind the label: only version saves write public.artifacts.
const migrations = path.join(__dirname, "..", "..", "..", "supabase", "migrations");
const statements = fs.readdirSync(migrations).filter(name => name.endsWith(".sql")).flatMap(name =>
  [...fs.readFileSync(path.join(migrations, name), "utf8").matchAll(/update\s+public\.artifacts\b[^;]*;/gi)].map(match => ({ name, sql: match[0] })));
check("every SQL write to the artifact row is a version save (so updated_at is the saved-source time)", () => {
  assert.ok(statements.length >= 1, "the version-save statements are found");
  for (const { name, sql } of statements) {
    assert.match(sql, /set\s+current_version\s*=\s*p_expected_version\s*\+\s*1/i, `${name}: ${sql.slice(0, 120)}`);
    assert.match(sql, /title\s*=\s*p_content->>'title'/i, `${name}: the saved title follows the saved content`);
  }
});
check("the app never writes the artifact row directly", () => {
  const offenders = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(ts|tsx)$/.test(entry.name) && /from\(["']artifacts["']\)\s*\.(update|upsert)\(/.test(fs.readFileSync(file, "utf8"))) offenders.push(file);
  } };
  walk(path.join(__dirname, "..", ".."));
  assert.deepEqual(offenders, []);
});
check("account cards render the saved-source label with a machine-readable time", () => {
  const projects = fs.readFileSync("src/components/account-projects.tsx", "utf8");
  assert.match(projects, /meta = savedSourceMeta\(artifact, shortDate\)/);
  assert.match(projects, /<time dateTime=\{meta\.at\}>\{meta\.label\}<\/time>/);
  assert.doesNotMatch(projects, /"New draft"\}/, "no version-only label left");
});

console.log(`${count} project label checks passed.`);

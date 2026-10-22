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
check("library dates keep the time of day for today and yesterday, and say so", () => {
  const { libraryDate } = context.exports;
  const now = new Date(2026, 9, 21, 18, 0);
  assert.match(libraryDate(new Date(2026, 9, 21, 14, 34).toISOString(), now), /^today, .*34/);
  assert.match(libraryDate(new Date(2026, 9, 20, 9, 5).toISOString(), now), /^yesterday, .*05/);
  assert.doesNotMatch(libraryDate(new Date(2026, 9, 19, 9, 5).toISOString(), now), /today|yesterday|:/, "older dates are the day only");
  assert.match(libraryDate(new Date(2025, 2, 4).toISOString(), now), /2025/);
  assert.equal(libraryDate("nope", now), "date unknown");
  // Two projects saved the same day read differently.
  assert.notEqual(libraryDate(new Date(2026, 9, 21, 9, 12).toISOString(), now), libraryDate(new Date(2026, 9, 21, 16, 40).toISOString(), now));
});

check("grid cards say how long ago, in plain words, and what the time measures", () => {
  const { relativeTime, savedAgo } = context.exports;
  const now = new Date(2026, 9, 22, 18, 0, 0);
  const ago = ms => new Date(now.getTime() - ms).toISOString();
  const minute = 60_000, hour = 60 * minute;
  assert.equal(relativeTime(ago(0), now), "just now");
  assert.equal(relativeTime(ago(59_000), now), "just now");
  assert.equal(relativeTime(ago(minute), now), "1 minute ago");
  assert.equal(relativeTime(ago(3 * minute + 20_000), now), "3 minutes ago");
  assert.equal(relativeTime(ago(59 * minute), now), "59 minutes ago");
  assert.equal(relativeTime(ago(hour), now), "1 hour ago");
  assert.equal(relativeTime(ago(23 * hour + 59 * minute), now), "23 hours ago", "under a day stays in hours, even across midnight");
  assert.equal(relativeTime(new Date(2026, 9, 21, 9, 0).toISOString(), now), "yesterday");
  assert.equal(relativeTime(new Date(2026, 9, 19, 9, 0).toISOString(), now), "3 days ago");
  assert.equal(relativeTime(new Date(2026, 9, 16, 9, 0).toISOString(), now), "6 days ago");
  const week = relativeTime(new Date(2026, 9, 15, 9, 0).toISOString(), now);
  assert.match(week, /^on \S/); assert.doesNotMatch(week, /ago|2026/, "a week or more: the day itself, without this year");
  assert.match(relativeTime(new Date(2025, 2, 4).toISOString(), now), /^on .*2025/, "another year is named");
  assert.equal(relativeTime(new Date(now.getTime() + 2 * minute).toISOString(), now), "just now", "a little clock skew is not the future");
  assert.match(relativeTime(new Date(2026, 9, 30).toISOString(), now), /^on /, "a time well ahead of this clock is named by its day");
  assert.equal(relativeTime("nope", now), "at an unknown time");
  assert.deepEqual({ ...savedAgo({ currentVersion: 4, createdAt: ago(9 * hour), updatedAt: ago(5 * minute) }, now) }, { label: "Saved 5 minutes ago", at: ago(5 * minute) });
  assert.deepEqual({ ...savedAgo({ currentVersion: 0, createdAt: ago(2 * hour), updatedAt: ago(minute) }, now) }, { label: "Created 2 hours ago", at: ago(2 * hour) }, "no saved version: when it was created, never 'saved'");
  assert.equal(savedAgo({ currentVersion: 2, createdAt: "x", updatedAt: "x" }, now).label, "Saved at an unknown time");
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
  // Cards use libraryDate: the same label, with the time of day for today and yesterday (similar projects saved the same day stay distinguishable).
  assert.match(projects, /meta = savedSourceMeta\(artifact, libraryDate\)/);
  // Grid cards say how long ago ("Saved 5 minutes ago") with the full label as the tooltip; the list view shows the full label.
  assert.match(projects, /ago = savedAgo\(artifact, now\)/);
  assert.match(projects, /<time dateTime=\{meta\.at\} title=\{view === "list" \? undefined : meta\.label\}>\{view === "list" \? meta\.label : ago\.label\}<\/time>/);
  assert.doesNotMatch(projects, /"New draft"\}/, "no version-only label left");
});

console.log(`${count} project label checks passed.`);

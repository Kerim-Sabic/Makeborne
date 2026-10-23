/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the task contract (task-contract.ts): original words kept, prohibitions never become requests, facts never invented, scope and limits. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { buildTaskContract, contractConflicts, prohibitions, TASK_CONTRACT_VERSION } = require("./task-contract.ts");
let count = 0;
const check = (name, fn) => { fn(); count++; console.log(`PASS ${name}`); };
const ENHANCED = {
  business: "Saffron Table, a neighbourhood restaurant in Bristol", workingName: null, goal: "Visitors request a table", primaryAction: { label: "Request a table", kind: "book" },
  audience: "Local diners", sections: [{ name: "Menu", anchor: "menu", purpose: "Show the seasonal menu", include: [] }, { name: "Testimonials", anchor: "testimonials", purpose: "Social proof", include: [] }],
  tone: "quiet", toneWhy: "A calm dining room", imagery: { plan: "illustration", notes: "Plates", textInImage: null },
  factsGiven: ["Dinner Wed–Sat", "Located in Bristol"], factsMissing: [{ fact: "Street address", placeholder: "[Street address]", example: null }],
  constraints: ["Keep the menu short"], answersUsed: [], conflicts: [{ issue: "Two different opening days were given", resolution: "Use Wed–Sat, as stated last" }],
};
const base = { artifact: "website", objective: "create", revision: { expectedVersion: 3, sourceRevision: "rev-abc" }, limits: { capCredits: 40 } };

check("the client's own words are kept verbatim next to the reading", () => {
  const message = "Build a site for Saffron Table. Do not invent testimonials or awards.";
  const contract = buildTaskContract({ ...base, message, brief: { text: "Restaurant site, warm and calm." }, enhanced: ENHANCED });
  assert.equal(contract.version, TASK_CONTRACT_VERSION);
  assert.deepEqual(contract.original, { message, plan: null, brief: "Restaurant site, warm and calm." });
});

check("a prohibition is an exclusion, never a requirement; a conflict with the reading is surfaced and the words win", () => {
  const contract = buildTaskContract({ ...base, message: "Build a site for Saffron Table. Do not invent testimonials or awards. No pricing table, but show the menu.", enhanced: ENHANCED });
  assert.deepEqual(contract.exclusions, [{ text: "Do not invent testimonials or awards", source: "request" }, { text: "No pricing table,", source: "request" }]);
  assert.ok(contract.exclusions.every(item => !/show the menu/.test(item.text)), "\"but show the menu\" is a request, not a prohibition");
  assert.deepEqual(contractConflicts(contract), [{ required: "Testimonials section", prohibitedBy: "Do not invent testimonials or awards" }]);
});

check("the prohibition rule matches Codex's quality-gates clause rule on the same sentences", () => {
  const gate = fs.readFileSync(require.resolve("./quality-gates.ts"), "utf8");
  // Codex's negation fix (697cebd, combined candidate) is not on every branch yet; where it is, the two rules must agree.
  if (!gate.includes("affirmativeClauses")) { console.log("  note: quality-gates.ts here predates 697cebd; parity is checked once the candidate is merged"); assert.deepEqual(prohibitions("Add a gallery. Never show prices; skip the FAQ but keep contact"), ["Never show prices", "skip the FAQ"]); return; }
  const words = /\\b\(\?:no\|not\|never\|without\|avoid\|omit\|exclude\|remove\|skip\|don't\|don’t\|do not\)\\b/;
  assert.match(gate, words, "quality-gates.ts still uses the same negation words");
  assert.match(gate, /split\(\/\[\.!\?;\\n\]\+\|\\bbut\\b\/i\)/, "and the same clause split");
  assert.deepEqual(prohibitions("Add a gallery. Never show prices; skip the FAQ but keep contact"), ["Never show prices", "skip the FAQ"]);
});

check("facts are never invented: given facts are verified, missing ones unknown, or approved placeholders when the client will supply them", () => {
  const plain = buildTaskContract({ ...base, message: "A site for Saffron Table", enhanced: ENHANCED });
  assert.deepEqual(plain.facts.filter(fact => fact.status === "verified").map(fact => fact.text), ["Dinner Wed–Sat", "Located in Bristol"]);
  assert.deepEqual(plain.facts.find(fact => fact.text === "Street address"), { text: "Street address", source: "request", status: "unknown" });
  const later = buildTaskContract({ ...base, message: "A site for Saffron Table. I will send the street address later, so show placeholders for now.", enhanced: ENHANCED });
  assert.equal(later.facts.find(fact => fact.text === "Street address").status, "placeholder-approved");
  const none = buildTaskContract({ ...base, message: "A bakery site" });
  assert.equal(none.audience, "unknown"); assert.equal(none.outcome, "unknown"); assert.deepEqual(none.facts, []);
});

check("assumptions made for the client are explicit and reversible; constraints are kept apart from preferences", () => {
  const contract = buildTaskContract({ ...base, message: "A site", enhanced: { ...ENHANCED, workingName: "Ember" }, design: { theme: "light", vibe: "warm", imagery: "photo", colour: "#aa3300" }, brand: { name: "Saffron", colours: ["#aa3300"] } });
  assert.deepEqual(contract.assumptions.map(item => item.why), ["Two different opening days were given", "no business name was given"]);
  assert.ok(contract.assumptions.every(item => item.reversible === true));
  assert.deepEqual(contract.design.constraints, ["Keep the menu short", "Brand colours #aa3300", "Accent colour #aa3300", "light theme"]);
  assert.deepEqual(contract.design.preferences, ["warm feel", "photo imagery", "quiet tone"]);
});

check("scope and checks: a whole build runs the full contract, a localised edit only the checks it can break, plus every operational check", () => {
  const whole = buildTaskContract({ ...base, message: "A site" });
  assert.deepEqual(whole.scope, { kind: "artifact" });
  assert.ok(["W-H1", "W-H6", "W-D1", "O1", "O5"].every(id => whole.checks.includes(id)));
  const edit = buildTaskContract({ ...base, objective: "edit", message: "Make the heading warmer", target: { file: "src/components/Hero.tsx", line: 10, label: 'Heading "Supper"' } });
  assert.deepEqual(edit.scope, { kind: "element", file: "src/components/Hero.tsx", line: 10, label: 'Heading "Supper"' });
  assert.ok(!edit.checks.includes("W-H6"), "a heading edit does not re-litigate every section");
  assert.ok(edit.checks.includes("W-H5") && edit.checks.includes("O4"), "facts and revision safety are always checked");
  const deck = buildTaskContract({ ...base, artifact: "presentation", message: "A deck" });
  assert.ok(deck.checks.includes("S-D2") && !deck.checks.some(id => id.startsWith("W-")));
});

check("revision and limits come from the operation; defaults are one repair and one escalation", () => {
  const contract = buildTaskContract({ ...base, message: "A site", revision: { expectedVersion: 7, sourceRevision: "rev-7", assetDigest: "sha256:x" }, limits: { capCredits: 25, deadlineAt: "2026-10-22T20:00:00Z" } });
  assert.deepEqual(contract.revision, { expectedVersion: 7, sourceRevision: "rev-7", assetDigest: "sha256:x" });
  assert.deepEqual(contract.limits, { capCredits: 25, deadlineAt: "2026-10-22T20:00:00Z", repairs: 1, escalations: 1 });
});
console.log(`${count} task contract checks passed.`);

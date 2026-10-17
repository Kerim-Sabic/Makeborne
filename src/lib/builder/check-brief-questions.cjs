/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the questions asked before a first build. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { briefQuestions, briefWithAnswers } = require("./brief-questions.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const ids = (kind, brief, context) => briefQuestions(kind, brief, context).map(question => question.id);

check("a vague website brief gets the four most important questions", () => {
  assert.deepEqual(ids("website", "Website for my bakery"), ["goal", "style", "audience", "scope"]);
});

check("questions the brief already answers are not asked", () => {
  assert.deepEqual(ids("website", "Bold, modern one-page site for a bakery where locals can order bread for Saturday pickup. Our logo is attached."), []);
  assert.deepEqual(ids("website", "A calm, premium site for a law firm"), ["goal", "audience", "scope", "brand"]);
  assert.deepEqual(ids("website", "Landing page for my bakery so customers can order online"), ["style", "brand"]);
  assert.ok(!ids("website", "Bakery site, our colours are #8a2b1f and cream").includes("style"), "a hex colour sets the look");
  assert.ok(!ids("website", "Bakery site", { attachments: 1 }).includes("brand"), "attachments answer the brand question");
});

check("long, detailed briefs get fewer questions", () => {
  const detailed = `Website for Ovenbird, a sourdough bakery on Fennel Street. ${"We bake country loaves, rye and buns overnight in a wood-fired oven and sell from a hatch. ".repeat(12)}`;
  assert.ok(detailed.split(/\s+/).length > 150);
  assert.equal(briefQuestions("website", detailed).length, 2);
  const medium = `Website for Ovenbird, a sourdough bakery. ${"We bake loaves overnight in a wood-fired oven. ".repeat(7)}`;
  assert.equal(briefQuestions("website", medium).length, 3);
});

check("presentations ask about purpose, delivery, look and length", () => {
  assert.deepEqual(ids("presentation", "Deck about our water sensors"), ["purpose", "delivery", "style", "length"]);
  assert.deepEqual(ids("presentation", "10-slide investor pitch I'll present live, bold and modern"), []);
  assert.deepEqual(ids("presentation", "Sales proposal we will email to the client"), ["style", "length"]);
});

check("books ask about kind, reader, tone and length", () => {
  assert.deepEqual(ids("book", "Something about personal finance"), ["type", "reader", "tone", "length"]);
  assert.deepEqual(ids("book", "A short, friendly guide for freelancers on cash flow"), []);
});

check("answers are written into the brief in plain words; skipped questions are left out", () => {
  const questions = briefQuestions("website", "Website for my bakery");
  const brief = briefWithAnswers("Website for my bakery", questions, { goal: { option: "buy" }, style: { option: "warm" }, audience: { custom: "  Families\nin Leith  " } });
  assert.equal(brief, "Website for my bakery\n\nThe client's answers to Makeborne's questions (follow them):\n- Main thing visitors should do: Buy or order online\n- Look and feel: Warm and crafted (Earthy colours, texture, characterful type)\n- Main audience: Families in Leith");
  assert.equal(briefWithAnswers("  Website for my bakery ", questions, {}), "Website for my bakery", "no answers leave the brief unchanged");
  assert.equal(briefWithAnswers("x", questions, { goal: { option: "not-an-option" } }), "x", "unknown options are ignored");
  assert.ok(briefWithAnswers("x", questions, { goal: { custom: "y".repeat(500) } }).length < 400, "own answers are capped");
});

check("every question is complete and option values are unique", () => {
  for (const kind of ["website", "presentation", "book"]) for (const question of briefQuestions(kind, "")) {
    assert.ok(question.question.endsWith("?") && question.why && question.topic && question.custom, `${kind}/${question.id}`);
    assert.ok(question.options.length >= 3 && question.options.length <= 6);
    assert.equal(new Set(question.options.map(option => option.value)).size, question.options.length);
  }
});

console.log(`\n${passed} brief question checks passed.`);

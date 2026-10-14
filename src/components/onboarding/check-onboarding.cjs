/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the getting-started checklist: order, hidden steps, completion and guide links. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { checklist } = require("./checklist.ts");
const { HELP_ARTICLES } = require("../../lib/help/articles.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const calls = [];
const go = { create: kind => calls.push(`create:${kind}`), leads: () => calls.push("leads"), email: () => calls.push("email"), clients: () => calls.push("clients"), projects: () => calls.push("projects"), chat: () => calls.push("chat") };
const fresh = { artifacts: 0, clients: 0, finderLeads: 0, mailboxes: 0, sentEmails: 0, reviewLinks: 0 };

check("a new account sees every step, in the order that reaches a first win fastest", () => {
  const steps = checklist(fresh, false, go);
  assert.deepEqual(steps.map(step => step.id), ["create", "leads", "email", "send", "review", "advisor"]);
  assert.ok(steps.every(step => !step.done));
});

check("steps tick themselves off from real account data", () => {
  const steps = checklist({ artifacts: 2, clients: 3, finderLeads: 3, mailboxes: 1, sentEmails: 0, reviewLinks: 1 }, true, go);
  const done = Object.fromEntries(steps.map(step => [step.id, step.done]));
  assert.deepEqual(done, { create: true, leads: true, email: true, send: false, review: true, advisor: true });
  assert.equal(checklist({ ...fresh, clients: 12 }, false, go).find(step => step.id === "leads").done, true, "ten clients added any way also counts");
  assert.equal(checklist({ ...fresh, clients: 4 }, false, go).find(step => step.id === "leads").done, false);
});

check("steps whose data can't be read (email not set up yet, no access) are hidden, not shown as undone", () => {
  const steps = checklist({ ...fresh, mailboxes: null, sentEmails: null, reviewLinks: null }, false, go);
  assert.deepEqual(steps.map(step => step.id), ["create", "leads", "advisor"]);
});

check("each step's button does the right thing and links a real guide", () => {
  for (const step of checklist(fresh, false, go)) {
    step.run();
    assert.ok(HELP_ARTICLES.some(article => article.slug === step.guide), `${step.id}: guide ${step.guide}`);
    assert.ok(step.title && step.hint && step.action);
  }
  assert.deepEqual(calls, ["create:website", "leads", "email", "clients", "projects", "chat"]);
});

console.log(`\n${passed} onboarding checks passed.`);

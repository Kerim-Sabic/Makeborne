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
const go = { create: kind => calls.push(`create:${kind}`), leads: () => calls.push("leads"), addClients: () => calls.push("addClients"), email: () => calls.push("email"), clients: () => calls.push("clients"), projects: () => calls.push("projects"), chat: () => calls.push("chat") };
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

check("the review step and its guide name the control people actually click (Client review in the project's ••• menu)", () => {
  // The project header (60a92f0) moved review links into Project actions → Client review; "Open projects" alone lands on the library.
  const step = checklist(fresh, false, go).find(item => item.id === "review");
  assert.match(step.hint, /Client review/);
  const guide = HELP_ARTICLES.find(article => article.slug === step.guide);
  assert.match(guide.answer, /Client review/);
  assert.ok(guide.steps.some(item => /Client review/.test(item.name + item.text)), "a step names Client review");
  assert.doesNotMatch(`${guide.answer} ${guide.steps.map(item => item.name).join(" ")}`, /choose Share for review|^Share for review$/m, "no stale button name");
});

const paused = { available: false, configured: true, state: "paused" }, ready = { available: true, configured: true, state: "ready" }, off = { available: false, configured: false, state: "off" };
check("while AI is paused, the leads step becomes the path that works without it and completes with the first client", () => {
  const step = checklist(fresh, false, go, { leads: paused, advisor: paused }).find(item => item.id === "leads");
  assert.equal(step.title, "Add your first clients");
  assert.match(step.hint, /isn’t available right now/);
  assert.match(step.hint, /CSV/);
  assert.equal(step.waiting, undefined, "it can be done today");
  assert.equal(step.guide, "import-clients-from-csv");
  assert.ok(HELP_ARTICLES.some(article => article.slug === step.guide));
  calls.length = 0; step.run(); assert.deepEqual(calls, ["addClients"], "it opens Add client, not the lead finder");
  assert.equal(checklist({ ...fresh, clients: 1 }, false, go, { leads: off, advisor: off }).find(item => item.id === "leads").done, true, "one client counts while finding is off");
});
check("while advisors can't answer, Ask waits with a clear line, offers no button and isn't counted", () => {
  const steps = checklist(fresh, false, go, { leads: paused, advisor: paused });
  const ask = steps.find(item => item.id === "advisor");
  assert.equal(ask.waiting, "Opens when AI is switched back on.");
  assert.equal(checklist(fresh, false, go, { leads: null, advisor: { available: false, configured: true, state: "limit" } }).find(item => item.id === "advisor").waiting, "Opens again when today’s AI capacity resets.");
  assert.equal(checklist(fresh, true, go, { leads: paused, advisor: paused }).find(item => item.id === "advisor").waiting, undefined, "a step already done is just done");
  const component = fs.readFileSync(path.join(__dirname, "getting-started.tsx"), "utf8");
  assert.match(component, /const counted = steps\.filter\(step => !step\.waiting\)/, "waiting steps are left out of the count");
  assert.match(component, /\{!step\.done && !step\.waiting && <button/, "and get no action button");
});
check("when availability is ready or unknown, every step stays as it was (the server still decides)", () => {
  for (const ai of [undefined, { leads: null, advisor: null }, { leads: ready, advisor: ready }]) {
    const steps = checklist(fresh, false, go, ai);
    assert.equal(steps.find(item => item.id === "leads").title, "Find your first 10 leads");
    assert.ok(steps.every(item => !item.waiting));
  }
});
check("availability is read with the same gates the paid routes check first, without reserving anything", () => {
  const route = fs.readFileSync(path.join(src, "app", "api", "assistants", "route.ts"), "utf8");
  assert.match(route, /configured: chatEnabled\(\), priced: \(\) => \{ requirePricedModel\(RANK_MODEL\); requirePricedModel\(DISCOVER_MODEL\); \}/, "lead finder: connected and priced");
  assert.match(route, /configured: chatEnabled\(\), priced: \(\) => requirePricedModel\(CHAT_ROUTES\.standard\.model\)/, "advisor: connected and priced");
  assert.match(route, /providerCapacity\("anthropic"\)/, "provider spending open");
  assert.doesNotMatch(route, /reserveCredits|requireProviderCapacity|cloudContext|export async function POST/, "read-only: no hold, no account access, no write");
  const finder = fs.readFileSync(path.join(src, "app", "api", "cloud", "workspaces", "[workspaceId]", "leads", "find", "route.ts"), "utf8");
  assert.match(finder, /if \(!chatEnabled\(\)\) throw new RequestError\("FINDER_UNAVAILABLE"/, "the finder route still decides every request");
  const ui = fs.readFileSync(path.join(src, "components", "leads", "lead-finder.tsx"), "utf8");
  assert.match(ui, /disabled=\{!ready \|\| busy \|\| closed\}/, "a known-closed finder can't be submitted");
});

console.log(`\n${passed} onboarding checks passed.`);

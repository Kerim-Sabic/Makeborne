/* eslint-disable @typescript-eslint/no-require-imports -- Offline help center checks: article integrity, SEO lengths, demo links and search relevance. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);

const { HELP_ARTICLES, HELP_CATEGORIES } = require("./articles.ts");
const { searchHelp } = require("./search.ts");
const { DEMO_SCRIPTS, DEMO_IDS } = require("../../components/help-demo/scripts.ts");
const { captionsOf } = require("../../components/help-demo/engine.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

check("articles have unique slugs, real categories, valid related links and demos", () => {
  const slugs = new Set();
  for (const article of HELP_ARTICLES) {
    assert.match(article.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, article.slug);
    assert.ok(!slugs.has(article.slug), `duplicate ${article.slug}`); slugs.add(article.slug);
    assert.ok(HELP_CATEGORIES.some(category => category.id === article.category), article.slug);
    assert.match(article.updated, /^\d{4}-\d{2}-\d{2}$/);
    if (article.demo) assert.ok(DEMO_IDS.includes(article.demo), `${article.slug} demo`);
  }
  for (const article of HELP_ARTICLES) for (const related of article.related ?? []) assert.ok(slugs.has(related), `${article.slug} → ${related}`);
  for (const category of HELP_CATEGORIES) assert.ok(HELP_ARTICLES.some(article => article.category === category.id), `empty category ${category.id}`);
});

check("search and answer engines get a direct answer, a fitting title and a meta description", () => {
  for (const article of HELP_ARTICLES) {
    const words = article.answer.split(/\s+/).length;
    assert.ok(words >= 30 && words <= 90, `${article.slug}: answer is ${words} words (aim for 30–90)`);
    assert.ok(article.title.length <= 70, `${article.slug}: title ${article.title.length} chars`);
    assert.ok(article.description.length >= 70 && article.description.length <= 170, `${article.slug}: description ${article.description.length} chars`);
    assert.ok(article.keywords.length >= 4, `${article.slug}: keywords`);
    assert.ok((article.steps?.length ?? 0) + (article.sections?.length ?? 0) > 0, `${article.slug}: has body`);
  }
});

check("every demo exists, has captions and is used by at least one guide", () => {
  for (const id of DEMO_IDS) {
    const script = DEMO_SCRIPTS[id];
    assert.equal(script.id, id);
    assert.ok(captionsOf(script).length >= 3, `${id}: captions`);
    assert.equal(new Set(captionsOf(script)).size, captionsOf(script).length, `${id}: captions must be unique (they key the transcript)`);
    assert.ok(HELP_ARTICLES.some(article => article.demo === id), `${id} unused`);
  }
});

check("people's questions land on the right guide", () => {
  const expect = {
    "how do I find new leads?": "find-new-leads", "make a pitch deck": "make-a-presentation-with-ai", "send emails to my clients": "send-personal-outreach-emails",
    "connect gmail": "connect-gmail-or-outlook", "how much does it cost": "credits-and-pricing", "can I use my own domain": "publish-your-website",
    "export to powerpoint": "make-a-presentation-with-ai", "write an ebook": "make-a-book-with-ai", "get feedback from my client": "share-work-for-client-review",
    "import contacts from excel": "import-clients-from-csv", "what is genius mode": "ask-an-ai-advisor", "upload my logo": "attach-files-to-your-brief",
    "automate follow ups": "connect-gmail-or-outlook", "lead score": "manage-clients-and-follow-ups", "build a website for my bakery": "create-a-website-with-ai",
    "what should I write in the prompt": "write-a-great-brief", "difference between plan and create": "plan-create-and-effort",
  };
  const misses = Object.entries(expect).filter(([query, slug]) => searchHelp(query)[0]?.slug !== slug).map(([query, slug]) => `${query} → ${searchHelp(query)[0]?.slug ?? "(none)"} (want ${slug})`);
  assert.deepEqual(misses, []);
  assert.deepEqual(searchHelp("the of and"), [], "stop words alone match nothing");
});

console.log(`\n${passed} help center checks passed.`);

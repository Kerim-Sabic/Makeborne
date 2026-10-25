/* eslint-disable @typescript-eslint/no-require-imports -- Offline project title checks. */
// M04: a user's title is never overwritten; a project created without one gets a short,
// deterministic, non-sensitive and editable title from its saved brief, which a build
// may replace with its own name only while it is still that fallback or a placeholder.
const fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict");
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve("./project-title.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { fallbackProjectTitle, creationTitle, builtTitle, isPlaceholderTitle, placeholderTitle, FALLBACK_TITLE_MAX } = context.exports;
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }

check("an explicit title is kept exactly (only surrounding space is trimmed)", () => {
  assert.equal(creationTitle("  Maple Bakery — spring refresh ", "Help me plan a website for a client.", "website"), "Maple Bakery — spring refresh");
  assert.equal(creationTitle("Hiša Burja", "", "website"), "Hiša Burja");
  assert.equal(creationTitle("x".repeat(160), "brief", "book"), "x".repeat(160), "the user's limit, not the fallback cap");
  assert.equal(creationTitle("[e2e] E2E funnel (plan)", "Something else", "website"), "[e2e] E2E funnel (plan)");
});
check("no title, or the old placeholder, uses the brief-derived fallback", () => {
  assert.equal(creationTitle("", "Help me plan a website for a client. I will provide their business.", "website"), "Website for a client");
  assert.equal(creationTitle("Untitled website", "A website for Maple Bakery in Toronto", "website"), "A website for Maple Bakery in Toronto");
  assert.equal(isPlaceholderTitle("Untitled presentation"), true);
  assert.equal(isPlaceholderTitle(" untitled "), true);
  assert.equal(isPlaceholderTitle("Untitled Goose Tours"), false);
  assert.equal(placeholderTitle("book"), "Untitled book");
});
check("the fallback is short, readable and deterministic", () => {
  const cases = {
    "Help me shape my knowledge into a practical book. I will provide the topic.": "Knowledge into a practical book",
    "Help me structure a presentation that explains my idea clearly.": "Presentation that explains my idea clearly",
    "Dr. Smith's dental clinic in Sarajevo": "Dr. Smith's dental clinic in Sarajevo",
    "Build a 10-slide pitch deck for Series A. Then a summary.": "10-slide pitch deck for Series A",
    "I want to create a landing page for Hiša Burja, a guesthouse in Bled with 6 rooms and a sauna and a long list of amenities": "Landing page for Hiša Burja, a guesthouse in Bled",
    "website": "Website",
  };
  for (const [brief, title] of Object.entries(cases)) {
    assert.equal(fallbackProjectTitle(brief, "website"), title, brief);
    assert.equal(fallbackProjectTitle(brief, "website"), fallbackProjectTitle(brief, "website"));
    assert.ok(fallbackProjectTitle(brief, "website").length <= FALLBACK_TITLE_MAX);
  }
  const long = fallbackProjectTitle("Wordy ".repeat(40), "book");
  assert.ok(long.length <= FALLBACK_TITLE_MAX && !/\s$/.test(long), "cut at a word boundary");
  assert.equal(fallbackProjectTitle("A presentation for Harbour Dental York's open evening on 14 November with the new hygiene team", "presentation"), "A presentation for Harbour Dental York's open evening", "a cut never strands half a date");
  assert.equal(fallbackProjectTitle("Quarterly review 2025-2026 for the board", "presentation"), "Quarterly review 2025-2026 for the board", "numbers inside an uncut title stay");
});
check("contact details, links, handles and long numbers never reach the title", () => {
  const briefs = [
    "A website for Maple Bakery in Toronto — call 416-555-0199 or email hi@maple.ca",
    "Portfolio site for jane.doe@example.com, see https://jane.dev/work",
    "https://maplebakery.ca redesign for the 2026 season",
    "Site for @maplebakery and +49 30 1234567",
    "Pitch deck for account 12345678 and maple.ca",
    "Email owner@clinic.ba about the clinic website www.clinic.ba",
  ];
  for (const brief of briefs) {
    const title = fallbackProjectTitle(brief, "website");
    assert.doesNotMatch(title, /@|https?:|www\.|\.ca\b|\.dev\b|\.ba\b|\d{5,}|\d{3}[-\s]\d{3,4}/, `${brief} -> ${title}`);
    assert.ok((title.match(/\p{L}/gu) ?? []).length >= 2, title);
  }
  assert.equal(fallbackProjectTitle("https://maplebakery.ca redesign for the 2026 season", "website"), "Redesign for the 2026 season");
  assert.equal(fallbackProjectTitle("Portfolio site for jane.doe@example.com, see https://jane.dev", "website"), "Portfolio site");
  assert.equal(fallbackProjectTitle("Email owner@clinic.ba about the clinic website www.clinic.ba", "website"), "Email about the clinic website", "one word before a detail is not a name");
  assert.equal(fallbackProjectTitle("Quarterly review 2025-2026 for the board", "presentation"), "Quarterly review 2025-2026 for the board", "a year range is not a phone number");
});
check("only the brief's first paragraph is read; composed sections and empty briefs give the placeholder", () => {
  assert.equal(fallbackProjectTitle("Bakery website\n\nOwner phone 416 555 0199, notes from the attached PDF: secret supplier list", "website"), "Bakery website");
  assert.equal(fallbackProjectTitle("", "website"), "Untitled website");
  assert.equal(fallbackProjectTitle("📈📈📈 !!!", "presentation"), "Untitled presentation");
  assert.equal(fallbackProjectTitle("Requirements: keep it short", "book"), "Untitled book");
  assert.equal(fallbackProjectTitle("\n\nAPPROVED PROJECT PLAN\n\nAudience and intended outcome are recorded in the project fields.", "website"), "Untitled website");
  assert.equal(fallbackProjectTitle("hi@maple.ca 416-555-0199", "website"), "Untitled website", "nothing but contact details");
});
check("creation and the builder derive the same fallback from the saved brief", () => {
  const idea = "Help me plan a website for a client. I will provide the details.";
  const saved = [idea, "Requirements: no stock photos"].join("\n\n");
  const plan = [idea, "APPROVED PROJECT PLAN", "Audience and intended outcome are recorded in the project fields."].join("\n\n");
  assert.equal(creationTitle("", saved, "website"), fallbackProjectTitle(saved, "website"));
  assert.equal(fallbackProjectTitle(saved, "website"), fallbackProjectTitle(idea, "website"));
  assert.equal(fallbackProjectTitle(plan, "website"), fallbackProjectTitle(idea, "website"));
});
check("a build may rename only a placeholder or the derived fallback; a chosen title stays", () => {
  const brief = "Help me plan a website for a client.";
  assert.equal(builtTitle("Website for a client", "Maple Bakery", brief, "website"), "Maple Bakery", "the fallback gives way to the site's real name");
  assert.equal(builtTitle("Untitled website", "Maple Bakery", brief, "website"), "Maple Bakery", "legacy placeholder");
  assert.equal(builtTitle("Maple — client draft", "Maple Bakery", brief, "website"), "Maple — client draft", "user title kept");
  assert.equal(builtTitle("Maple Bakery", "Maple & Co", brief, "website"), "Maple Bakery", "a previous build's name is kept too");
  assert.equal(builtTitle("Website for a client", "", brief, "website"), "Website for a client", "review rounds propose nothing");
  assert.equal(builtTitle("Website for a client", undefined, brief, "website"), "Website for a client");
  assert.equal(builtTitle("Website for a client", "Maple Bakery", "A different, later brief", "website"), "Website for a client", "an edited brief makes the old fallback a kept title, never the other way round");
});

// Wiring: every creation path and every build save goes through these rules.
const read = file => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const studio = read("src/components/studio.tsx");
check("the studio no longer saves Untitled defaults and keeps the user's title", () => {
  assert.doesNotMatch(studio, /`Untitled \$\{/, "no inline Untitled defaults left in creation paths");
  assert.match(studio, /const values = \{ effort, kind, title: creationTitle\(title, savedBrief, kind\),\n\s+brief: savedBrief,/);
  assert.match(studio, /useState\(\(\) => isPlaceholderTitle\(initialTitle\) \? "" : initialTitle\)/);
  assert.match(studio, /setTitle\(isPlaceholderTitle\(draft\.title\) \? "" : draft\.title\)/);
  assert.match(studio, /placeholder=\{`Name it now or later · “\$\{fallbackProjectTitle\(brief, kind\)\}”`\}/, "the fallback is visible and editable before saving");
  // The draft seed still sees the old placeholder, so drafts opened before this change keep restoring.
  assert.match(studio, /creationSeed\(initialBrief, initialTitle,/);
});
check("website and document builds save titles through builtTitle", () => {
  const website = read("src/lib/builder/website-run.ts"), docs = read("src/lib/builder/docs-run.ts"), route = read("src/app/api/build/route.ts");
  assert.equal((website.match(/title: builtTitle\(current\.content\.title, reviewing \? "" : result\.title, input\.projectBrief \?\? "", "website"\)\.slice\(0, 200\)/g) ?? []).length, 2);
  assert.doesNotMatch(website, /result\.title\) \|\| current\.content\.title/);
  assert.equal((docs.match(/title: builtTitle\(current\.content\.title, (?:editor\.)?doc\.title, input\.project\.brief, artifact\.kind\)\.slice\(0, 200\)/g) ?? []).length, 3);
  assert.doesNotMatch(docs, /title: (?:editor\.)?doc\.title\.slice/);
  assert.match(route, /websiteBuildResponse\(\{[^}]*projectBrief: project\.brief,/);
});

console.log(`${count} project title checks passed.`);

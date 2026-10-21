/* eslint-disable @typescript-eslint/no-require-imports -- Offline saved-content compatibility checks: the editor preview follows the saved format, not the builder's availability. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { savedFormat, choosePreview, hasBuilderSource, editorEntry } = require("./saved-preview.ts");
const { ArtifactContentSchema } = require("../domain.ts");
const { emptyDocument } = require("../documents/editor.ts");
const { projectDocument } = require("../documents/project.ts");
const { buildCreationPayload } = require("./creation-payload.ts");

let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
const block = (type, text) => ({ id: randomUUID(), type, text, assetId: null, locked: false, sourceIds: [] });
const section = (title, blocks) => ({ id: randomUUID(), title, blocks });
// Shaped like the production records the audit found: only kind, title, sections and schemaVersion.
const outline = (kind, title, sections) => ArtifactContentSchema.parse({ schemaVersion: 1, kind, title, sections });
const legacy = [
  { name: "book v17, 2 chapters", version: 17, content: outline("book", "The Lantern Keeper", [section("Chapter 1", [block("heading", "Chapter 1"), block("paragraph", "The lamp was lit at dusk."), block("paragraph", "Nobody came.")]), section("Chapter 2", [block("heading", "Chapter 2"), block("paragraph", "Morning brought the boats.")])]) },
  { name: "book v6, 6 chapters", version: 6, content: outline("book", "Field Notes", Array.from({ length: 6 }, (_, index) => section(`Part ${index + 1}`, index ? [block("paragraph", `Note ${index}`)] : [block("heading", "Part 1"), block("paragraph", "Begin here.")]))) },
  { name: "book v1, one paragraph", version: 1, content: outline("book", "Short", [section("Short", [block("paragraph", "A single saved paragraph.")])]) },
  { name: "presentation v2", version: 2, content: outline("presentation", "Pitch", [section("Opening", [block("heading", "Opening"), block("paragraph", "Why now")])]) },
  { name: "presentation v3, 8 slides", version: 3, content: outline("presentation", "Quarterly", Array.from({ length: 8 }, (_, index) => section(`Slide ${index + 1}`, [block(index ? "paragraph" : "heading", `Point ${index + 1}`)].concat(index === 7 ? [block("callout", "Speaker notes: thank them")] : [])))) },
  { name: "website outline", version: 4, content: outline("website", "Harbour Bakery", [section("Hero", [block("heading", "Fresh every morning"), block("paragraph", "Sourdough and rye.")]), section("Visit", [block("paragraph", "Open 7–2")])]) },
  { name: "website static design", version: 5, content: ArtifactContentSchema.parse({ schemaVersion: 1, kind: "website", title: "Old site", sections: [], website: { html: `<main><h1>Old site</h1>${"<p>Saved copy.</p>".repeat(8)}</main>`, css: `main{font-family:serif;max-width:60ch;margin:auto}${"p{line-height:1.6}".repeat(6)}`, description: "Static design", designNotes: "Kept as saved" } }) },
  { name: "book with titled chapters but no text yet", version: 3, content: outline("book", "Plan", [section("Chapter one", []), section("Chapter two", [])]) },
];
// Builder states the editor can be in. A reviewer never has the builder.
const states = [
  { name: "builder off", builder: false, canBuild: false },
  { name: "builder configured, spending paused", builder: true, canBuild: false },
  { name: "builder ready", builder: true, canBuild: true },
];
const choose = (content, version, state, extra = {}) => choosePreview({ kind: content.kind, format: savedFormat(content, version), builder: state.builder, canBuild: state.canBuild, live: null, generatedVersion: false, ...extra });

check("every legacy record shape is classified as saved content, not a starting draft", () => {
  for (const item of legacy) {
    const format = savedFormat(item.content, item.version);
    assert.equal(format, item.content.website ? "website-design" : "outline", item.name);
    assert.equal(hasBuilderSource(format), false, `${item.name}: a build converts it, it is never edited as builder source`);
  }
});
check("legacy saved content shows in the outline preview whatever the builder's state", () => {
  for (const item of legacy) for (const state of states) assert.equal(choose(item.content, item.version, state), "outline", `${item.name} / ${state.name}`);
});
check("the audit's reproduction: a saved v17 book with the builder enabled is not the empty 'Describe your book' screen", () => {
  const book = legacy[0];
  assert.notEqual(choose(book.content, book.version, states[2]), "start-builder");
});
check("classifying and choosing never rewrites saved content", () => {
  for (const item of legacy) {
    const before = JSON.stringify(item.content);
    for (const state of states) choose(item.content, item.version, state, { live: { document: undefined }, generatedVersion: true });
    assert.equal(JSON.stringify(item.content), before, item.name);
  }
});
check("a build starting on legacy content keeps it visible until builder output streams", () => {
  for (const item of legacy.filter(entry => entry.content.kind !== "website")) {
    assert.equal(choose(item.content, item.version, states[2], { live: {} }), "outline", `${item.name}: live run with no document yet`);
    assert.equal(choose(item.content, item.version, states[2], { live: { document: {} } }), "live", `${item.name}: streamed document`);
  }
});

const deck = emptyDocument("deck", "Builder deck"), novel = emptyDocument("book", "Builder book");
const built = [
  { kind: "presentation", content: ArtifactContentSchema.parse({ schemaVersion: 1, kind: "presentation", title: deck.title, sections: projectDocument(deck), document: deck }) },
  { kind: "book", content: ArtifactContentSchema.parse({ schemaVersion: 1, kind: "book", title: novel.title, sections: projectDocument(novel), document: novel }) },
];
check("builder documents show their saved document in every builder state, and live output only from a shown builder", () => {
  for (const item of built) {
    assert.equal(savedFormat(item.content, 9), "document");
    assert.equal(hasBuilderSource("document"), true);
    for (const state of states) assert.equal(choose(item.content, 9, state), "document", `${item.kind} / ${state.name}`);
    assert.equal(choose(item.content, 9, states[2], { live: { document: {} } }), "live");
    assert.equal(choose(item.content, 9, states[0], { live: { document: {} } }), "document", "no builder, no live output");
  }
});
check("website source projects show their source preview in every builder state", () => {
  const site = { schemaVersion: 1, kind: "website", title: "Source site", sections: [], websiteSource: { files: [], routes: [], assets: [] } };
  assert.equal(savedFormat(site, 3), "website-source");
  assert.equal(hasBuilderSource("website-source"), true);
  for (const state of states) assert.equal(choose(site, 3, state), "website-source", state.name);
  assert.equal(choose(site, 3, states[2], { live: {} }), "live");
});
check("websites from the earlier generation worker keep their revision preview when no builder is shown", () => {
  const site = legacy.find(item => item.name === "website outline");
  assert.equal(choose(site.content, site.version, states[0], { generatedVersion: true }), "generated-website");
  assert.equal(choose(site.content, site.version, states[1], { generatedVersion: true }), "outline");
});

const style = { id: "s", name: "Fixture", color: "#7862A7", description: "Fixture", font: "sans" };
const values = { effort: "medium", title: "Corner Café", brief: "A café website", audience: "", purpose: "", styleId: "s", clientId: "", wording: "preserve", content: "", kind: "website" };
const fresh = () => ArtifactContentSchema.parse({ schemaVersion: 1, title: "New", kind: "book", sections: [section("Main content", [])] });
check("new projects are starting drafts; the empty state invites a build only when one can start", () => {
  const created = buildCreationPayload(values, style).content;
  for (const [content, version] of [[fresh(), 0], [fresh(), 1], [created, 1]]) {
    assert.equal(savedFormat(content, version), "starting");
    assert.equal(choose(content, version, states[2]), "start-builder");
    assert.equal(choose(content, version, states[1]), "start-draft", "paused: no invitation to a chat that cannot run");
    assert.equal(choose(content, version, states[0]), "start-draft");
  }
  assert.equal(savedFormat(created, 2), "outline", "a title heading saved again later is content");
});
check("text supplied at creation is saved content that the first build may still start from", () => {
  const created = buildCreationPayload({ ...values, content: "Our story.\n\nOur menu." }, style).content;
  assert.equal(savedFormat(created, 1), "outline");
  assert.equal(hasBuilderSource(savedFormat(created, 1)), false, "the home-prompt auto-start still runs for it");
  assert.equal(choose(created, 1, states[2]), "outline");
});

check("the editor selects previews through choosePreview and no longer hides saved content behind the builder", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "components", "cloud-studio.tsx"), "utf8");
  assert.match(source, /choosePreview\(\{ kind: artifact\.kind, format, builder: useLiveBuilder, canBuild: builder\.available/);
  assert.doesNotMatch(source, /!useLiveBuilder && !previewDocument/, "the outline preview is not gated on the builder being off");
  assert.match(source, /\(preview === "outline" \|\| preview === "start-draft"\) && <div className="cloud-workbench-preview">/);
  const invitations = [...source.matchAll(/\{view === "preview" && ([^<]+)<div className="lp-empty[^"]*">Describe your/g)].map(match => match[1]);
  assert.equal(invitations.length, 2);
  for (const condition of invitations) assert.match(condition, /preview === "start-builder"/, "the empty-builder screen appears only when nothing is saved");
  assert.match(source, /if \(!useLiveBuilder \|\| !builder\.available \|\| !format \|\| hasBuilderSource\(format\)/, "auto-start needs a runnable builder and no builder source");
});
check("the saved-format notice promises only what production delivers (no standard export there)", () => {
  const studio = fs.readFileSync(path.join(__dirname, "..", "..", "components", "cloud-studio.tsx"), "utf8");
  const notice = studio.slice(studio.indexOf('className="cloud-workbench-format"'), studio.indexOf("</p>", studio.indexOf('className="cloud-workbench-format"')));
  assert.ok(notice.length > 0, "notice found");
  const exportRoute = fs.readFileSync(path.join(__dirname, "..", "..", "app", "api", "export", "route.ts"), "utf8");
  if (/process\.env\.NODE_ENV === "production"\)\s*throw new RequestError\(\s*"EXPORT_NOT_CONFIGURED"/.test(exportRoute))
    assert.doesNotMatch(notice, /export/i, "outline and static-design records cannot be exported in production; the notice must not offer it");
});
check("F01: the format notice names the editor control actually shown, for every format and role", () => {
  // [content, toolbar label, does the editor tab itself offer a draft download?]
  const cases = [
    [{ kind: "website", website: { html: "<p>x</p>", css: "" } }, "Code", true],
    [{ kind: "website", websiteSource: { files: [] } }, "Code", false],
    [{ kind: "website" }, "Edit", true],
    [{ kind: "book" }, "Edit", true], [{ kind: "book", document: {} }, "Edit", true],
    [{ kind: "presentation" }, "Edit", true], [{ kind: "presentation", document: {} }, "Edit", true],
  ];
  for (const [content, label, editorDownload] of cases) for (const reviewer of [false, true]) {
    const entry = editorEntry(content, reviewer);
    assert.equal(entry.label, label, JSON.stringify(content));
    assert.ok(entry.instruction.includes(`from the ${label} tab`), entry.instruction);
    assert.equal(entry.canEdit, !reviewer);
    assert.equal(/edit it/.test(entry.instruction), !reviewer, "reviewers are not told they can edit");
    assert.equal(/download a copy/.test(entry.instruction), editorDownload, "download is promised only where the editor tab has it");
  }
  const studio = fs.readFileSync(path.join(__dirname, "..", "..", "components", "cloud-studio.tsx"), "utf8");
  assert.ok(studio.includes('title={editor.label} onClick={() => setView("edit")}><PencilLine size={15} /><span className="workbench-tab-label">{editor.label}</span>'), "toolbar label comes from the same definition");
  assert.ok(studio.includes('{editor.instruction}{" "}<button type="button" className="cloud-workbench-format-link" onClick={() => setView("edit")}>Open {editor.label}</button>'), "notice uses it and offers a navigation-only shortcut");
  assert.ok(!studio.includes("from the Edit tab"), "no hard-coded control name left");
});
console.log(`PASS ${count} saved-content compatibility checks: legacy books, decks and websites stay visible and unchanged in every builder state.`);

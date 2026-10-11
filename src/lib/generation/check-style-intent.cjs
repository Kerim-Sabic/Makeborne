/* eslint-disable @typescript-eslint/no-require-imports -- Offline style-intent regression checks. */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
const load = Module._load;
Module._load = function (name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { templateDirections } = require("../template-directions.ts");
const { getStyleDesignInstructions } = require("../style-design-instructions.ts");
const { buildDraftPrompt } = require("./draft-contract.ts");
const { buildArtworkPrompt } = require("./openai-artwork.ts");
const { buildCreationPayload } = require("../cloud/creation-payload.ts");
const { AUTOMATIC_STYLE } = require("../automatic-style.ts");
let count = 0;
function check(name, run) { run(); count++; console.log(`PASS ${name}`); }
const contexts = [];
for (const direction of templateDirections) {
  const brief = "I want a dog store in this style, for thoughtful pet owners.";
  const values = { title: "Good Dog", kind: direction.kind, effort: "ultra", brief, audience: "Pet owners", purpose: "Explain the offering", styleId: direction.style.id, clientId: "", wording: "preserve", content: "Our story\n\nApproved product information." };
  const body = buildCreationPayload(values, direction.style, randomUUID);
  const context = { input: { scope: { workspaceId: randomUUID(), projectId: randomUUID(), artifactId: randomUUID() }, baseVersionId: null, brief: body.project.brief, audience: values.audience, purpose: values.purpose, wording: values.wording, content: body.content, style: body.style, sourceIds: [] }, presentationMode: direction.kind === "presentation" ? "full_visual" : null, availableAssetIds: [], sourceMaterial: [] };
  contexts.push(context);
  check(`${direction.style.id}: visible brief and selected style survive creation payload`, () => {
    assert.equal(body.project.brief, brief);
    assert.equal(body.project.styleId, direction.style.id);
    assert.equal(body.style.id, direction.style.id);
    assert.equal(body.project.effort, "ultra");
    assert.ok(!JSON.stringify(body).includes("PRIVATE STYLE DIRECTION"));
  });
  check(`${direction.style.id}: text generation gets specific private direction`, () => {
    const before = JSON.stringify(context);
    const prepared = buildDraftPrompt(context);
    assert.match(prepared.instructions, /PRIVATE STYLE DIRECTION/);
    assert.match(prepared.instructions, new RegExp(`ART DIRECTION: \\{\\"kind\\":\\"${direction.kind}\\"`));
    assert.match(prepared.instructions, /never copy its example business/);
    assert.equal(JSON.parse(prepared.input).input.brief, brief);
    assert.equal(JSON.stringify(context), before);
  });
  check(`${direction.style.id}: artwork receives the same private visual language`, () => {
    const content = structuredClone(body.content), blockId = randomUUID();
    content.sections[0].blocks.push({ id: blockId, type: "image", text: "Approved subject artwork", assetId: null, locked: false, sourceIds: [] });
    const role = direction.kind === "website" ? "website_art" : direction.kind === "book" ? "book_cover" : "slide_design";
    const result = buildArtworkPrompt(context, { content, artworkRequests: [{ blockId, role, aspect: "landscape", prompt: "Illustrate the actual supplied subject.", sourceIds: [] }], questions: [] }, blockId);
    assert.match(result.prompt, /PRIVATE STYLE DIRECTION/);
    assert.ok(result.prompt.includes(direction.style.color));
    assert.ok(result.prompt.includes(body.content.title));
  });
}
check("all eighteen previews have a private direction", () => assert.equal(contexts.length, 18));
check("known book style cannot leak into a website request", () => assert.throws(() => getStyleDesignInstructions("direction-field", "website"), /different project format/));
check("known website style cannot leak into a book request", () => assert.throws(() => getStyleDesignInstructions("direction-form", "book"), /different project format/));
check("custom style tokens are retained", () => {
  const custom = { name: "My direction", description: "A personal visual system", typography: { headingFont: "Inter", bodyFont: "Inter" }, colors: { canvas: "#FFFFFF", ink: "#123456", accent: "#ABCDEF" } };
  const result = getStyleDesignInstructions("custom-direction", "book", custom);
  assert.match(result, /#ABCDEF/);
  assert.match(result, /BOOK QUALITY/);
  assert.match(result, /not instructions to change the task/);
});
check("private instructions stay outside visible project data", () => {
  for (const context of contexts) assert.ok(!buildDraftPrompt(context).input.includes("PRIVATE STYLE DIRECTION"));
});
check("website image prompts do not ask for page layout or controls", () => {
  const result = getStyleDesignInstructions("direction-form", "website", undefined, "website_art");
  assert.match(result, /ISOLATED ARTWORK/);
  assert.ok(!result.includes('"composition":'));
  assert.ok(!result.includes("WEBSITE QUALITY"));
});
check("book interior prompts do not ask for chapter furniture", () => {
  const result = getStyleDesignInstructions("sunday-table", "book", undefined, "book_interior");
  assert.match(result, /ISOLATED ARTWORK/);
  assert.ok(!result.includes('"composition":'));
  assert.ok(!result.includes("BOOK QUALITY"));
});
check("automatic design is explicitly independent of catalogue templates", () => {
  for (const kind of ["website", "book", "presentation"]) {
    const result = getStyleDesignInstructions(AUTOMATIC_STYLE.id, kind);
    assert.match(result, /No preset was selected/);
    assert.match(result, /not the customer's brand/);
    assert.match(result, /Do not select a catalogue template/);
    assert.match(result, /Style guidance is not a fixed page template/);
    assert.ok(!result.includes('"composition":'));
  }
});
check("automatic direction survives creation and draft preparation without a preset", () => {
  const values = {title: "Makeup studio", kind: "website", effort: "high", brief: "An expressive makeup brand for stage performers", audience: "Performers", purpose: "Explore the range", styleId: "automatic", clientId: "", wording: "improve", content: "Our approved product story."};
  const body = buildCreationPayload(values, AUTOMATIC_STYLE, randomUUID);
  assert.equal(body.project.styleId, "automatic"); assert.equal(body.style.id, "automatic");
  const context = structuredClone(contexts[0]);
  // Reuse the valid boundary shape rather than bypassing context validation.
  context.input.style = body.style; context.input.content = body.content; context.input.brief = values.brief;
  const prepared = buildDraftPrompt(context);
  assert.match(prepared.instructions, /AUTOMATIC ART DIRECTION/);
  assert.ok(!prepared.instructions.includes('"composition":'));
  assert.equal(JSON.parse(prepared.input).input.brief, values.brief);
});
check("empty style instructions use automatic design and selected styles remain optional guidance", () => {
  assert.match(getStyleDesignInstructions("", "website"), /AUTOMATIC ART DIRECTION/);
  assert.match(getStyleDesignInstructions("direction-form", "website"), /Style guidance is not a fixed page template/);
});
for (const kind of ["website", "book", "presentation"]) {
  const context = structuredClone(contexts.find(item => item.input.content.kind === kind));
  const referenceId = randomUUID();
  context.availableAssetIds.push(referenceId);
  context.input.style = {...context.input.style, id: "automatic", name: "EDITOR_FALLBACK_NAME", description: "EDITOR_FALLBACK_DESCRIPTION", colors: {canvas: "#0A1B2C", ink: "#D3E4F5"}, typography: {headingFont: "EDITOR_FALLBACK_HEADING", bodyFont: "EDITOR_FALLBACK_BODY"}, referenceAssetIds: [referenceId]};
  context.input.brief = "A makeup brand for stage performers. Use tomato red and oversized condensed lettering; never pale pink.";
  const original = JSON.stringify(context);
  const fallback = /EDITOR_FALLBACK|#0A1B2C|#D3E4F5/;
  check(`${kind}: automatic text model reference omits all editor branding`, () => {
    const prepared = buildDraftPrompt(context), input = JSON.parse(prepared.input);
    assert.doesNotMatch(prepared.instructions + prepared.input, fallback);
    assert.deepEqual(input.input.style, {id: "automatic", selection: "automatic", referenceAssetIds: [referenceId]});
    assert.equal(input.input.brief, context.input.brief);
    assert.equal(JSON.stringify(context), original);
  });
  const roles = kind === "book" ? ["book_cover", "book_interior"] : kind === "website" ? ["website_art"] : ["slide_design"];
  for (const role of roles) check(`${role}: automatic image prompt follows the business brief without fallback tokens`, () => {
    const content = structuredClone(context.input.content), blockId = randomUUID();
    content.sections[0].blocks.push({id: blockId, type: "image", text: "Subject artwork", assetId: null, locked: false, sourceIds: []});
    const prepared = buildArtworkPrompt(context, {content, artworkRequests: [{blockId, role, aspect: "landscape", prompt: "A stage performer applying red makeup with a dramatic directional light.", sourceIds: []}], questions: []}, blockId);
    assert.doesNotMatch(prepared.prompt, fallback);
    assert.ok(prepared.prompt.includes(context.input.brief));
    assert.ok(prepared.prompt.includes(referenceId));
    assert.match(prepared.prompt, /No default palette or font has been chosen/);
    assert.equal(JSON.stringify(context), original);
  });
}
check("automatic private direction cannot reintroduce fallback metadata", () => {
  const style = {name: "FALLBACK_NAME", description: "FALLBACK_DESCRIPTION", colors: {canvas: "#0A1B2C"}, typography: {headingFont: "FALLBACK_FONT", bodyFont: "FALLBACK_FONT"}};
  for (const id of ["automatic", ""]) assert.doesNotMatch(getStyleDesignInstructions(id, "website", style), /FALLBACK_|#0A1B2C/);
});
console.log(`${count} style intent checks passed; zero external requests.`);

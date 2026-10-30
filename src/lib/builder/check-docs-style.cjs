/* eslint-disable @typescript-eslint/no-require-imports -- Offline document-run context checks; no providers or database calls. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
let captured, calls = 0;
global.fetch = () => { throw Error("External requests are forbidden in this check"); };
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(__dirname, "../..", name.slice(2)), parent, main);
  if (name === "../credits/server" && parent.filename.endsWith("docs-run.ts")) return { holdIsActive: async () => true, settleRun: async () => {}, releaseRun: async () => {} };
  if (name === "./docs-agent" && parent.filename.endsWith("docs-run.ts")) return { runDocumentBuilder: async input => {
    calls++; captured = input;
    return { summary: "Context inspected", credits: 0, usd: 0, finished: true, stopped: null };
  } };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const { documentBuildResponse } = require("./docs-run.ts");
const { documentStyleDirection } = require("./docs-style.ts");
const { getStyleDesignInstructions } = require("../style-design-instructions.ts");
const { templateDirections } = require("../template-directions.ts");
const { operationApiError } = require("./operation-server.ts");
const { emptyDocument } = require("../documents/editor.ts");
const style = { name: "CUSTOM_BRAND_NAME", description: "CUSTOM_BRAND_DESCRIPTION", colors: { canvas: "#0A1B2C", ink: "#D3E4F5", accent: "#C23F81" }, typography: { headingFont: "CUSTOM_HEADING", bodyFont: "CUSTOM_BODY" }, referenceAssetIds: ["11111111-1111-4111-8111-111111111111"] };
const input = (kind, styleId, existing = false) => ({
  client: { rpc() { throw Error("Unexpected database call"); } }, hold: {}, spend: { customerCredits: () => 0, usageByModel: () => ({}), calls: [], providerMicrousd: 0, confirmedMicrousd: 0, uncertainMicrousd: 0, stopped: null }, workspaceId: "workspace",
  artifact: { id: "artifact", project_id: "project", kind, title: "A real brief", current_version: existing ? 1 : 0 },
  project: { brief: "An expressive makeup brand for stage performers. Use tomato red and condensed lettering; never pale pink.", styleId },
  current: { number: existing ? 1 : 0, assetIds: [], content: { title: "A real brief", sections: [], ...(existing ? { document: emptyDocument(kind === "book" ? "book" : "deck", "Existing document", styleId) } : {}) }, style },
  versions: [], message: "Make the requested document", effort: "medium", attachments: [], maxDuration: 60,
});
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
async function contextFor(kind, id, existing = false) {
  const before = calls, request = input(kind, id, existing), original = JSON.stringify(request.current);
  const events = (await documentBuildResponse(request).text()).split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  // The inspection stub deliberately makes no edit; any other terminal error is a fixture failure.
  assert.equal(events.at(-1).code, "BUILD_INCOMPLETE");
  assert.equal(events.at(-1).message, "Nothing changed.");
  assert.equal(calls, before + 1);
  assert.equal(captured.editor.kind, kind === "book" ? "book" : "deck");
  assert.equal(captured.request, request.message);
  assert.ok(captured.context.includes(request.project.brief));
  assert.equal(JSON.stringify(request.current), original);
  assert.doesNotMatch(captured.context, /WEBSITE QUALITY:/);
  assert.match(captured.context, kind === "book" ? /BOOK QUALITY:/ : /PRESENTATION QUALITY:/);
  return captured.context;
}
(async () => {
  const presets = templateDirections.filter(direction => direction.kind !== "website");
  assert.equal(presets.length, 12);
  for (const { kind, style: preset } of presets) await check(`${kind} ${preset.id}: actual document run receives complete direction and custom tokens`, async () => {
    const context = await contextFor(kind, preset.id);
    assert.ok(context.includes(getStyleDesignInstructions(preset.id, kind, style)));
    assert.match(context, new RegExp(`ART DIRECTION: \\{"kind":"${kind}"`));
    assert.match(context, /CUSTOM_HEADING/); assert.match(context, /#C23F81/);
  });
  for (const kind of ["book", "presentation"]) {
    for (const id of ["automatic", "", "  "]) await check(`${kind} ${JSON.stringify(id)}: automatic run omits fallback brand tokens and keeps references`, async () => {
      const context = await contextFor(kind, id);
      assert.match(context, /AUTOMATIC ART DIRECTION:/);
      assert.doesNotMatch(context, /CUSTOM_|#0A1B2C|#D3E4F5|#C23F81/);
      assert.ok(context.includes(style.referenceAssetIds[0]));
      assert.doesNotMatch(context, /ART DIRECTION: \{"kind":/);
    });
    await check(`${kind}: unknown custom style retains explicit user tokens`, async () => {
      const context = await contextFor(kind, "custom-client-direction");
      assert.match(context, /CUSTOM_BRAND_DESCRIPTION/); assert.match(context, /CUSTOM_BODY/); assert.match(context, /#C23F81/);
    });
    await check(`${kind}: an existing automatic document preserves its established theme`, async () => {
      const context = await contextFor(kind, "automatic", true);
      assert.match(context, /Full source:/); assert.match(context, /Existing document/);
      assert.doesNotMatch(context, /CUSTOM_|#0A1B2C|#D3E4F5/);
    });
    for (const preset of templateDirections.filter(direction => direction.kind !== kind)) await check(`${kind}: rejects ${preset.style.id} visibly before a model call`, async () => {
      const before = calls;
      let error;
      try { documentBuildResponse(input(kind, preset.style.id)); } catch (caught) { error = caught; }
      assert.ok(error); assert.equal(calls, before);
      const response = operationApiError(error), payload = await response.json();
      assert.equal(response.status, 400); assert.equal(payload.error.code, "INVALID_DOCUMENT_STYLE");
      assert.match(payload.error.message, /Choose a matching style or automatic art direction/);
      assert.throws(() => documentStyleDirection(kind, preset.style.id, style), /not valid/);
    });
  }
  console.log(`${passed} document style checks passed; zero external requests.`);
})().catch(error => { console.error(error); process.exitCode = 1; });

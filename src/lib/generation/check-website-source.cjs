/* eslint-disable @typescript-eslint/no-require-imports -- Offline contract qualification. */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict"), {randomUUID} = require("node:crypto");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);
const {buildWebsiteSourcePrompt, validateGeneratedWebsiteSource, WebsiteSourceResponseSchema} = require("./website-source-contract.ts");
const {createAnthropicWebsiteGenerator, createOpenAIWebsiteGenerator} = require("./website-generators.ts");
const {websiteProjectManifest} = require("../projects/source-manifest.ts");
const {websiteProjectSourceBundle} = require("../projects/source-bundle.ts");
const {websiteBuildInput} = require("../projects/build-input.ts");
const {ArtifactVersionSchema} = require("../domain.ts");
const {z} = require("zod");
const context = {input: {scope: {workspaceId: randomUUID(), projectId: randomUUID(), artifactId: randomUUID()}, baseVersionId: null,
  brief: "An expressive makeup store for stage performers, with tomato red and condensed typography; no pink.", audience: "Stage performers", purpose: "Explore the range", wording: "improve",
  content: {schemaVersion: 1, title: "Stage", kind: "website", sections: []},
  style: {id: "automatic", name: "FALLBACK_BRAND", description: "FALLBACK_DESCRIPTION", version: 1, typography: {headingFont: "FALLBACK_FONT", bodyFont: "FALLBACK_BODY"}, colors: {accent: "#123ABC"}, referenceAssetIds: []}, sourceIds: []},
  presentationMode: null, availableAssetIds: [], sourceMaterial: []};
const response = {title: "Stage", design: {positioning: "Makeup for performers", composition: "Product-led editorial rhythm", typography: "Condensed display, clear body", palette: "Tomato red, ink, white", imagery: "Original product photography when supplied", motion: "Restrained with reduced motion"},
  files: [{path: "index.html", content: '<html><head><title>Stage</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'},
    {path: "src/main.tsx", content: 'import React from "react"; import {createRoot} from "react-dom/client"; createRoot(document.getElementById("root")!).render(<main><h1>Stage</h1></main>);'}],
  assetIds: [], routes: [{path: "/", title: "Stage"}], questions: []};
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
function reject(change, code, ctx = context, assets = []) { const copy = structuredClone(response); change(copy); assert.throws(() => validateGeneratedWebsiteSource(ctx, assets, copy), error => error.code === code); }
(async () => {
  check("complete source candidate has pinned packages and no outline", () => {
    const candidate = validateGeneratedWebsiteSource(context, [], response);
    assert.equal(candidate.content.websiteSource.files.length, 4); assert.deepEqual(candidate.content.sections, []);
    assert.equal(candidate.requiresBuild, true); assert.equal(candidate.requiresVisualReview, true); assert.equal(candidate.readyForPublication, false);
    assert.equal(websiteProjectManifest(candidate.content.websiteSource).sourceHash.length, 64);
  });
  check("automatic prompt preserves brief without fallback branding", () => {
    const prompt = buildWebsiteSourcePrompt(context, []);
    assert.ok(prompt.input.includes(context.input.brief)); assert.doesNotMatch(prompt.input + prompt.instructions, /FALLBACK_|#123ABC/);
    assert.match(prompt.instructions, /No preset is required/); assert.match(prompt.instructions, /prefers-reduced-motion/);
    assert.match(prompt.instructions, /Reserve most of the response budget for the runnable source/);
    assert.match(prompt.instructions, /Do not invent product specifications/);assert.match(prompt.instructions, /complete keyboard behavior/);
  });
  check("inputs remain unchanged", () => {const before = JSON.stringify([context, response]); buildWebsiteSourcePrompt(context, []); validateGeneratedWebsiteSource(context, [], response); assert.equal(JSON.stringify([context, response]), before);});
  const candidate = validateGeneratedWebsiteSource(context, [], response);
  const version = {id: randomUUID(), artifactId: context.input.scope.artifactId, number: 1, parentVersionId: null, content: candidate.content,
    style: context.input.style, assetIds: [], createdAt: new Date().toISOString(), createdBy: randomUUID(), changeSummary: "Offline fixture"};
  check("resolved design survives canonical revision validation", () => assert.deepEqual(ArtifactVersionSchema.parse(version).content.websiteSource.designDirection, response.design));
  check("changing design changes source and build identity", () => {
    const copy = structuredClone(version); copy.content.websiteSource.designDirection.palette = "New palette";
    assert.notEqual(websiteProjectManifest(copy.content.websiteSource).sourceHash, websiteProjectManifest(version.content.websiteSource).sourceHash);
    assert.notEqual(websiteBuildInput(copy, []).sourceHash, websiteBuildInput(version, []).sourceHash);
  });
  check("old sources omit optional direction from their manifest", () => {
    const copy = structuredClone(candidate.content.websiteSource); delete copy.designDirection;
    assert.equal(Object.hasOwn(websiteProjectManifest(copy).manifest, "designDirection"), false);
  });
  check("revisions send established design as reference without mutating it", () => {
    const copy = structuredClone(context); copy.input.content = candidate.content; copy.input.baseVersionId = version.id;
    assert.deepEqual(JSON.parse(buildWebsiteSourcePrompt(copy, []).input).input.content.websiteSource.designDirection, response.design);
  });
  const bundle = await websiteProjectSourceBundle(version, []);
  const archive = await require("jszip").loadAsync(bundle.bytes);
  check("source export preserves revision-bound design", () => {
    assert.deepEqual(bundle.manifest.source.designDirection, response.design);
    assert.equal(bundle.manifest.sourceHash, websiteProjectManifest(candidate.content.websiteSource).sourceHash);
  });
  const exported = JSON.parse(await archive.file(".makeborne/manifest.json").async("string"));
  check("actual archive contains the same design direction", () => assert.deepEqual(exported.source.designDirection, response.design));
  check("provider schema serialises without transforms", () => assert.equal(z.toJSONSchema(WebsiteSourceResponseSchema).type, "object"));
  check("copy outline is rejected", () => reject(copy => {delete copy.files; copy.sections = [];}, "structure"));
  check("missing entrypoint is rejected", () => reject(copy => copy.files[1].path = "src/other.tsx", "structure"));
  check("traversal is rejected", () => reject(copy => copy.files[1].path = "../main.tsx", "structure"));
  check("case collision is rejected", () => reject(copy => copy.files.push({...copy.files[1], path: "SRC/MAIN.TSX"}), "structure"));
  check("model package overrides are rejected", () => reject(copy => copy.files.push({path: "package.json", content: "{}"}), "toolchain"));
  check("custom build configuration is rejected", () => reject(copy => copy.files.push({path: "vite.config.ts", content: "export default {}"}), "toolchain"));
  check("invented asset identity is rejected", () => reject(copy => copy.assetIds.push(randomUUID()), "assets"));
  check("invalid routes are rejected", () => reject(copy => copy.routes[0].path = "/../admin", "structure"));
  check("unapproved asset registry is rejected", () => assert.throws(() => buildWebsiteSourcePrompt(context, [{id: randomUUID(), path: "public/a.png", sha256: "a".repeat(64), bytes: 10, mediaType: "image/png"}]), error => error.code === "assets"));
  check("wrong output kind is rejected", () => {const copy = structuredClone(context); copy.input.content.kind = "book"; assert.throws(() => buildWebsiteSourcePrompt(copy, []), error => error.code === "format");});
  check("protected content is never silently rewritten", () => {
    const copy = structuredClone(context); copy.input.content.sections = [{id: randomUUID(), title: "Keep", blocks: [{id: randomUUID(), type: "paragraph", text: "Exact text", locked: true, sourceIds: [], assetId: null}]}];
    assert.throws(() => buildWebsiteSourcePrompt(copy, []), error => error.code === "protected_content");
    copy.input.content.sections[0].blocks[0].locked = false; copy.input.wording = "preserve";
    assert.throws(() => buildWebsiteSourcePrompt(copy, []), error => error.code === "protected_content");
  });
  for (const [name, factory] of [["Anthropic", createAnthropicWebsiteGenerator], ["OpenAI", createOpenAIWebsiteGenerator]]) {
    const generator = factory({apiKey: "offline-unused", model: "offline-unused", maximumInputTokens: 10000, maximumOutputTokens: 4000, timeoutMs: 1000},
      {spendingAllowed: () => false, countInputTokens: async () => {throw new Error("Must not count");}, claimDispatch: async () => {throw new Error("Must not dispatch");}, fetch: async () => {throw new Error("Must not fetch");}});
    const result = await generator(randomUUID(), context, [], new AbortController().signal);
    check(`${name} spending disabled means no provider call`, () => assert.deepEqual(result, {status: "not_dispatched", reason: "disabled"}));
  }
  for (const invalid of [false, true]) {
    let claims = 0, calls = 0;
    const output = structuredClone(response);
    if (invalid) output.files[1].path = "../outside.tsx";
    const generator = createAnthropicWebsiteGenerator({apiKey: "offline-unused", model: "offline-fixture-model", maximumInputTokens: 10000, maximumOutputTokens: 4000, timeoutMs: 1000}, {
      spendingAllowed: () => true, countInputTokens: async () => 100,
      claimDispatch: async binding => {assert.match(binding.requestHash, /^[a-f0-9]{64}$/); claims++; return true;},
      fetch: async () => {
        calls++;
        return new Response(JSON.stringify({id: "msg_offline_fixture", type: "message", role: "assistant", model: "offline-fixture-model", stop_reason: "end_turn", stop_sequence: null,
          content: [{type: "text", text: JSON.stringify(output)}], usage: {input_tokens: 100, output_tokens: 100}}),
          {status: 200, headers: {"content-type": "application/json", "request-id": "req_offline_fixture"}});
      },
    });
    const result = await generator(randomUUID(), context, [], new AbortController().signal);
    check(`mocked Claude ${invalid ? "unsafe source rejected with evidence retained" : "source candidate retains design and usage evidence"}`, () => {
      assert.equal(claims, 1); assert.equal(calls, 1);
      assert.equal(result.status, invalid ? "website_rejected" : "website_candidate");
      assert.equal(result.evidence.responseId, "msg_offline_fixture"); assert.equal(result.evidence.usage.total_tokens, 200);
      if (!invalid) assert.deepEqual(result.candidate.content.websiteSource.designDirection, response.design);
    });
  }
  if (process.env.MAKEBORNE_VERIFY_LOCAL_RUNTIME === "true") {
    const {runLocalBuild} = await import("../../../infra/project-runtime/local-adapter.mjs");
    const result = await runLocalBuild(websiteBuildInput(version, []));
    try {
      check("full source candidate compiles in the actual isolated local runtime", () => assert.equal(result.status, "built", result.logs));
      if (result.status === "built") {
        const receipt = JSON.parse(fs.readFileSync(require("node:path").join(result.outputDirectory, "makeborne-build.json"), "utf8"));
        check("build receipt binds exact revision and saved design", () => {
          assert.equal(receipt.revisionId, version.id); assert.equal(receipt.sourceHash, websiteProjectManifest(candidate.content.websiteSource).sourceHash);
        });
      }
    } finally { if (result.dispose) await result.dispose(); }
  }
  console.log(`${count} website source contract groups passed; no provider calls or visual quality claim. Local runtime opt-in: ${process.env.MAKEBORNE_VERIFY_LOCAL_RUNTIME === "true"}.`);
})().catch(error => {console.error(error); process.exitCode = 1;});

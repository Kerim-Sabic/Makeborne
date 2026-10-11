/* eslint-disable @typescript-eslint/no-require-imports -- Offline validation of the real source contracts. */
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), {createHash} = require("node:crypto"), ts = require("typescript");
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const compiledModule = {exports: {}}; cache.set(file, compiledModule);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  vm.runInNewContext(code, {module: compiledModule, exports: compiledModule.exports, Buffer, TextEncoder, Error, AbortSignal,
    require(name) {
      if (name === "server-only") return {};
      if (["zod", "node:crypto", "sharp", "jszip"].includes(name)) return require(name);
      if (!name.startsWith("./") && !name.startsWith("../")) throw new Error(`Unexpected source-contract dependency: ${name}`);
      return load(path.resolve(path.dirname(file), name + ".ts"));
    }}, {filename: file});
  return compiledModule.exports;
}
const {WebsiteProjectSourceSchema, SourcePathSchema, WEBSITE_SOURCE_LIMITS} = load("src/lib/projects/website-source.ts");
const {websiteProjectManifest} = load("src/lib/projects/source-manifest.ts");
const {canonicalSourceJson} = load("src/lib/projects/canonical-json.ts");
const assetId = "10000000-0000-4000-8000-000000000001";
function fixture() {
  return {schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx",
    files: [{path: "src/main.tsx", content: 'import React from "react";\n// Source candidate; not a build fixture.\n'},
      {path: "package.json", content: '{"name":"source-fixture","private":true}'},
      {path: "package-lock.json", content: '{"name":"source-fixture","lockfileVersion":3,"packages":{}}'},
      {path: "index.html", content: '<!doctype html><html><body><div id="root"></div></body></html>'}],
    assets: [{id: assetId, path: "public/hero.webp", sha256: "a".repeat(64), bytes: 1024, mediaType: "image/webp"}],
    routes: [{path: "/work", title: "Work"}, {path: "/", title: "Home"}]};
}
let checks = 0;
function check(name, run) {run(); checks++; console.log(`PASS ${name}`);}
function invalid(mutate) {const value = fixture(); mutate(value); assert(!WebsiteProjectSourceSchema.safeParse(value).success);}
check("valid source is normalised without mutating input", () => {
  const input = fixture(), original = JSON.stringify(input), result = WebsiteProjectSourceSchema.parse(input);
  assert.equal(JSON.stringify(input), original);
  assert.equal(result.files[0].path, "index.html"); assert.equal(result.routes[0].path, "/");
});
check("portable nested text and asset paths are accepted", () => {
  for (const value of ["src/components/Hero.tsx", "vite.config.ts", "README.md", "public/product-01.webp", ".gitignore"]) assert(SourcePathSchema.safeParse(value).success);
});
check("traversal, absolute, encoded, credential and device paths are denied", () => {
  for (const value of ["../outside", "/root/file", "a//b", "a/./b", "C:/secret", "src\\main.tsx", "src/file:token", "%2e%2e/a", ".env", ".env.production", "a/.ENV.local", ".git/config", "NODE_MODULES/x", "dist/a", ".next/x", ".makeborne/manifest.json", "CON", "con.txt", "AUX.json", "lpt9.js", "file.", "a /b", "a?b", "a#b", "nul\0file"]) assert(!SourcePathSchema.safeParse(value).success, value);
});
check("case collisions and file-asset collisions are denied", () => {
  invalid(v => v.files.push({path: "SRC/main.tsx", content: "collision"}));
  invalid(v => {v.assets[0].path = "index.html";});
  invalid(v => v.assets.push({...v.assets[0], path: "public/second.webp"}));
  invalid(v => {v.assets[0].id = "abcdefab-1234-4123-8123-123456789abc"; v.assets.push({...v.assets[0], id: v.assets[0].id.toUpperCase(), path: "public/second.webp"});});
});
check("files and assets cannot also serve as parent directories", () => {
  invalid(v => v.files.push({path: "src", content: "not a directory"}));
  invalid(v => {v.assets[0].path = "SRC";});
  invalid(v => {v.files.push({path: "public/hero.webp/nested.txt", content: "invalid child"});});
});
check("entrypoint and package metadata cannot be omitted", () => {
  for (const required of ["src/main.tsx", "index.html", "package.json", "package-lock.json"]) invalid(v => {v.files = v.files.filter(file => file.path !== required);});
  invalid(v => {v.entrypoint = "src/alternate.tsx";}); invalid(v => {v.toolchainId = "arbitrary-runtime";});
});
check("package metadata must be valid JSON objects", () => {
  for (const filename of ["package.json", "package-lock.json"]) for (const content of ["not json", "[]", "null", "5"]) invalid(v => {v.files.find(file => file.path === filename).content = content;});
});
check("byte bounds count UTF-8, not only characters", () => {
  invalid(v => {v.files[0].content = "😀".repeat(WEBSITE_SOURCE_LIMITS.fileBytes / 4 + 1);});
  invalid(v => {v.files.push({path: "src/bad.ts", content: "a\0b"});});
  invalid(v => {v.files[0].content = "unpaired surrogate: \ud800";});
  const v = fixture(); v.files[0].content = "é".repeat(WEBSITE_SOURCE_LIMITS.fileBytes / 2); assert(WebsiteProjectSourceSchema.safeParse(v).success);
});
check("total bytes, file count and asset bounds are enforced", () => {
  invalid(v => {v.assets = [0, 1, 2].map(i => ({...v.assets[0], id: `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`, path: `public/large-${i}.webp`, bytes: 20_000_000}));});
  invalid(v => {for (let i = 0; i < 9; i++) v.files.push({path: `src/large-${i}.ts`, content: "x".repeat(WEBSITE_SOURCE_LIMITS.fileBytes)});});
  invalid(v => {for (let i = 0; i < WEBSITE_SOURCE_LIMITS.files; i++) v.files.push({path: `src/file-${i}.ts`, content: ""});});
  invalid(v => {for (let i = 0; i < WEBSITE_SOURCE_LIMITS.assets; i++) v.assets.push({...v.assets[0], id: `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`, path: `public/asset-${i}.webp`});});
  for (const change of [a => {a.bytes = 0;}, a => {a.bytes = 20_000_001;}, a => {a.sha256 = "wrong";}, a => {a.id = "wrong";}, a => {a.mediaType = "text/html";}]) invalid(v => change(v.assets[0]));
});
check("routes need a unique home and safe direct paths", () => {
  invalid(v => {v.routes = [{path: "/work", title: "Work"}];}); invalid(v => v.routes.push({path: "/", title: "Duplicate"}));
  for (const route of ["https://evil.test", "//evil.test", "/../private", "/work?secret=1", "/work#section", "/work/", "/%2e%2e"]) invalid(v => {v.routes[1].path = route;});
  invalid(v => {v.routes[0].title = " ";});
  invalid(v => {for (let i = 0; i < WEBSITE_SOURCE_LIMITS.routes; i++) v.routes.push({path: `/route-${i}`, title: `Route ${i}`});});
});
check("unsupported schema fields cannot silently disappear", () => {
  invalid(v => {v.secret = "not supported";}); invalid(v => {v.files[0].symlink = "../escape";}); invalid(v => {v.assets[0].url = "https://unverified.test";});
});
check("manifest hashes every text file and binds asset and route metadata", () => {
  const result = websiteProjectManifest(fixture());
  assert.equal(result.sourceHash, createHash("sha256").update(result.manifestJson).digest("hex"));
  for (const file of result.manifest.files) {
    const content = result.source.files.find(source => source.path === file.path).content;
    assert.equal(file.bytes, Buffer.byteLength(content)); assert.equal(file.sha256, createHash("sha256").update(content).digest("hex"));
  }
  assert.equal(result.manifest.assets[0].id, assetId); assert.equal(result.manifest.routes[0].path, "/");
});
check("source identity is independent of input array and object insertion order", () => {
  const first = fixture(), second = fixture(); second.files.reverse(); second.routes.reverse();
  second.files = second.files.map(file => ({content: file.content, path: file.path}));
  assert.equal(websiteProjectManifest(first).sourceHash, websiteProjectManifest(second).sourceHash);
});
check("content, path, route or asset changes produce new identities", () => {
  const original = websiteProjectManifest(fixture()).sourceHash;
  for (const mutate of [v => {v.files[0].content += "// change";}, v => v.files.push({path: "src/styles.css", content: "body{}"}),
    v => {v.routes[0].title = "Portfolio";}, v => {v.assets[0].sha256 = "b".repeat(64);}, v => {v.assets[0].bytes++;}]) {
    const value = fixture(); mutate(value); assert.notEqual(websiteProjectManifest(value).sourceHash, original);
  }
});
check("canonical JSON rejects cycles, sparse arrays and non-JSON objects", () => {
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [cyclic, new Array(2), new Date(), new Map(), undefined, NaN, Infinity, 1n]) assert.throws(() => canonicalSourceJson(value));
  const shared = {a: 1}; assert.equal(canonicalSourceJson({x: shared, y: shared}), '{"x":{"a":1},"y":{"a":1}}');
});
async function checkSourceAssets() {
  const {resolveWebsiteSourceAssets} = load("src/lib/projects/source-assets.ts");
  const sharp = require("sharp");
  const scope = {workspaceId: "30000000-0000-4000-8000-000000000001", projectId: "40000000-0000-4000-8000-000000000001"};
  const png = await sharp({create: {width: 4, height: 4, channels: 3, background: "#3559d8"}}).png().toBuffer();
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  function setup() {
    const input = fixture();
    input.assets = [{id: assetId, path: "public/hero.png", sha256: digest(png), bytes: png.length, mediaType: "image/png"}];
    const state = {rows: [{id: assetId, workspace_id: scope.workspaceId, project_id: scope.projectId,
      object_path: `${scope.workspaceId}/${scope.projectId}/artwork/${assetId}.png`, content_type: "image/png", sha256: digest(png)}],
      blob: new Blob([png]), dbError: null, storageError: null, project: {id: scope.projectId}, downloads: []};
    const client = {from(table) {
      assert(["assets", "projects"].includes(table));
      const filters = {};
      const query = {select() {return query;}, eq(key, value) {filters[key] = value; return query;},
        maybeSingle() {assert.equal(filters.workspace_id, scope.workspaceId); assert.equal(filters.id, scope.projectId); return {data: state.project, error: state.dbError};},
        in(key, ids) {assert.equal(key, "id"); assert.deepEqual([...ids], input.assets.map(asset => asset.id));
          assert.equal(filters.workspace_id, scope.workspaceId); assert.equal(filters.project_id, scope.projectId);
          return {data: state.rows, error: state.dbError};}};
      return query;
    }, storage: {from(bucket) {assert.equal(bucket, "project-assets"); return {download(objectPath, options, requestOptions) {
      state.downloads.push(objectPath); assert(requestOptions.signal instanceof AbortSignal); assert.equal(requestOptions.cache, "no-store");
      return {data: state.blob, error: state.storageError};
    }};}}};
    return {input, state, client};
  }
  let assetChecks = 0;
  async function test(name, run) {await run(); assetChecks++; console.log(`PASS ${name}`);}
  async function reject(mutate, code = "SOURCE_ASSET_UNAVAILABLE") {
    const value = setup(); mutate(value);
    await assert.rejects(resolveWebsiteSourceAssets(value.client, scope, value.input), error => error.code === code);
    return value;
  }
  await test("authorised scoped asset bytes match the immutable descriptor", async () => {
    const {input, state, client} = setup(); const original = JSON.stringify(input);
    const resolved = await resolveWebsiteSourceAssets(client, scope, input);
    assert.equal(resolved.length, 1); assert.equal(resolved[0].path, "public/hero.png");
    assert.equal(Buffer.compare(Buffer.from(resolved[0].bytes), png), 0);
    assert.equal(JSON.stringify(input), original); assert.equal(state.downloads.length, 1);
  });
  await test("empty asset source still checks project scope without downloading", async () => {
    const value = setup(); value.input.assets = [];
    assert.equal((await resolveWebsiteSourceAssets(value.client, scope, value.input)).length, 0); assert.equal(value.state.downloads.length, 0);
    value.state.project = null;
    await assert.rejects(resolveWebsiteSourceAssets(value.client, scope, value.input), error => error.code === "SOURCE_ACCESS_DENIED");
  });
  await test("missing, duplicated and cross-project rows fail before download", async () => {
    for (const mutate of [v => {v.state.rows = [];}, v => {v.state.rows.push({...v.state.rows[0]});},
      v => {v.state.rows[0].workspace_id = "foreign";}, v => {v.state.rows[0].project_id = "foreign";},
      v => {v.state.rows[0].sha256 = "b".repeat(64);}, v => {v.state.rows[0].content_type = "image/webp";}]) {
      const value = await reject(mutate); assert.equal(value.state.downloads.length, 0);
    }
  });
  await test("unsafe stored paths fail before storage access", async () => {
    for (const path of ["https://evil.test/image.png", `${scope.workspaceId}/foreign/art.png`,
      `${scope.workspaceId}/${scope.projectId}/../secret`, `${scope.workspaceId}/${scope.projectId}/%2e%2e/a`,
      `${scope.workspaceId}/${scope.projectId}/a\\b`, `${scope.workspaceId}/${scope.projectId}//a`,
      `${scope.workspaceId}/${scope.projectId}/a?token`, `${scope.workspaceId}/${scope.projectId}/a#x`]) {
      const value = await reject(v => {v.state.rows[0].object_path = path;}); assert.equal(value.state.downloads.length, 0);
    }
  });
  await test("changed size or stored hash cannot hydrate source", async () => {
    await reject(v => {v.state.blob = new Blob([png, "extra"]);});
    await reject(v => {const changed = Buffer.from(png); changed[changed.length - 1] ^= 1; v.state.blob = new Blob([changed]);});
  });
  await test("hash-matched non-images and mismatched media types fail raster validation", async () => {
    await reject(v => {const bytes = Buffer.from("not raster pixels"); v.state.blob = new Blob([bytes]); v.input.assets[0].bytes = bytes.length;
      v.input.assets[0].sha256 = digest(bytes); v.state.rows[0].sha256 = digest(bytes);});
    await reject(v => {v.input.assets[0].mediaType = "image/webp"; v.state.rows[0].content_type = "image/webp";});
  });
  await test("database and storage errors return safe retryable errors", async () => {
    for (const mutate of [v => {v.state.dbError = {message: "private upstream details"};},
      v => {v.state.storageError = {message: "private upstream details"};}, v => {v.state.blob = null;}]) {
      await reject(mutate, "SOURCE_ASSET_UNCONFIRMED");
    }
  });
  const {resolveDocumentSourceAssets} = load("src/lib/projects/source-assets.ts");
  const documentStyle = {id: "fixture", name: "Fixture", version: 1, typography: {headingFont: "Arial", bodyFont: "Arial"}, colors: {canvas: "#FFFFFF", ink: "#000000", accent: "#3559D8"}, description: "Fixture", referenceAssetIds: []};
  const document = kind => ({schemaVersion: 1, kind, title: "Illustrated document", sections: [{id: scope.projectId, title: "Opening", blocks: [{id: scope.workspaceId, type: "image", text: "Original artwork", assetId}]}]});
  await test("books and decks resolve identical registered originals and portable descriptors", async () => {
    for (const kind of ["book", "presentation"]) {
      const value = setup(), result = await resolveDocumentSourceAssets(value.client, scope, document(kind), documentStyle);
      assert.equal(result.descriptors[0].bytes, png.length); assert.equal(result.descriptors[0].sha256, digest(png));
      assert.equal(result.descriptors[0].path, `public/artwork/${assetId}.png`);
      assert.equal(Buffer.compare(Buffer.from(result.artwork[0].bytes), png), 0);
    }
  });
  await test("repeated artwork and style references download once without changing content", async () => {
    const value = setup(), content = document("presentation"), before = JSON.stringify(content);
    const result = await resolveDocumentSourceAssets(value.client, scope, content, {...documentStyle, referenceAssetIds: [assetId, assetId.toUpperCase()]});
    assert.equal(result.artwork.length, 1); assert.equal(value.state.downloads.length, 1); assert.equal(JSON.stringify(content), before);
  });
  await test("documents refuse missing hashes, altered originals and foreign project metadata", async () => {
    for (const mutate of [v => {v.state.rows[0].sha256 = null;}, v => {v.state.rows[0].sha256 = "a".repeat(64);},
      v => {v.state.rows[0].project_id = "foreign";}, v => {v.state.rows[0].object_path = `${scope.workspaceId}/foreign/artwork.png`;},
      v => {v.state.blob = new Blob(["changed original"]);}]) {
      const value = setup(); mutate(value);
      await assert.rejects(resolveDocumentSourceAssets(value.client, scope, document("book"), documentStyle), error => error.code === "SOURCE_ASSET_UNAVAILABLE");
    }
  });
  await test("document byte cap refuses oversized downloads before allocating their buffers", async () => {
    for (const kind of ["book", "presentation"]) {
      const value = setup(); let allocated = false;
      value.state.blob = {size: kind === "presentation" ? 3_000_001 : 8 * 1024 * 1024 + 1, arrayBuffer(){allocated = true; throw Error("must not allocate");}};
      await assert.rejects(resolveDocumentSourceAssets(value.client, scope, document(kind), documentStyle), error => error.code === "SOURCE_ASSET_UNAVAILABLE");
      assert.equal(allocated, false);
    }
  });
  await test("empty documents still require project access and reject website inputs", async () => {
    const value = setup(); value.input.assets = [];
    const content = {...document("book"), sections: []};
    assert.equal((await resolveDocumentSourceAssets(value.client, scope, content, documentStyle)).artwork.length, 0);
    value.state.project = null;
    await assert.rejects(resolveDocumentSourceAssets(value.client, scope, content, documentStyle), error => error.code === "SOURCE_ACCESS_DENIED");
    await assert.rejects(resolveDocumentSourceAssets(value.client, scope, {...content, kind: "website"}, documentStyle), error => error.code === "INVALID_DOCUMENT");
  });
  console.log(`${assetChecks} source-asset resolver check groups passed with mocked scoped database/storage and real raster decoding. No persistence, live RLS or runtime acceptance is claimed.`);
  const {ArtifactContentSchema, ArtifactVersionSchema} = load("src/lib/domain.ts");
  const {websiteProjectSourceBundle} = load("src/lib/projects/source-bundle.ts");
  const {inspectAccountContent} = load("src/lib/cloud/editor-bridge.ts");
  const {accountExportRequest} = load("src/lib/cloud/account-export.ts");
  const {prepareVersionRestore} = load("src/lib/cloud/version-restore.ts");
  const source = setup().input;
  const content = {schemaVersion: 1, kind: "website", title: "Full project", sections: [], websiteSource: source};
  const style = {id: "automatic", name: "Automatic", version: 1, typography: {headingFont: "Inter", bodyFont: "Inter"}, colors: {canvas: "#FFFFFF", ink: "#000000", accent: "#3559D8"}, description: "Original direction", referenceAssetIds: []};
  const version = {id: "50000000-0000-4000-8000-000000000001", artifactId: "60000000-0000-4000-8000-000000000001", number: 1, parentVersionId: null, content, style, assetIds: [assetId], createdAt: "2026-10-08T00:00:00.000Z", createdBy: "70000000-0000-4000-8000-000000000001", changeSummary: "Full source"};
  check("full-source domain content is preserved without an outline or competing static design", () => {
    assert.equal(ArtifactContentSchema.parse(content).websiteSource.files.length, 4);
    assert(!ArtifactContentSchema.safeParse({...content, kind: "book"}).success);
    assert(!ArtifactContentSchema.safeParse({...content, website: {html: "x".repeat(100), css: "x".repeat(100), description: "static", designNotes: "static"}}).success);
    assert(!ArtifactContentSchema.safeParse({...content, sections: [{id: assetId, title: "Outline", blocks: []}]}).success);
    assert(!ArtifactVersionSchema.safeParse({...version, assetIds: []}).success);
    assert(!inspectAccountContent(content).editable);
    assert.throws(() => accountExportRequest(content, style, {format: "html", documentId: version.artifactId}), /verified build/);
    const outline = {...version, content: {schemaVersion: 1, kind: "website", title: "Older outline", sections: []}};
    assert.throws(() => prepareVersionRestore(content, outline, version.artifactId, 2), /outline cannot replace/);
    assert.equal(prepareVersionRestore(content, version, version.artifactId, 2).content.websiteSource.files.length, 4);
  });
  const value = setup();
  const resolved = await resolveWebsiteSourceAssets(value.client, scope, value.input);
  const bundle = await websiteProjectSourceBundle(version, resolved);
  const repeated = await websiteProjectSourceBundle(version, resolved);
  assert.equal(Buffer.compare(Buffer.from(bundle.bytes), Buffer.from(repeated.bytes)), 0);
  const archive = await require("jszip").loadAsync(bundle.bytes);
  for (const file of source.files) assert.equal(await archive.file(file.path).async("string"), file.content);
  assert.equal(Buffer.compare(await archive.file("public/hero.png").async("nodebuffer"), png), 0);
  assert.equal(JSON.parse(await archive.file(".makeborne/manifest.json").async("string")).sourceHash, websiteProjectManifest(source).sourceHash);
  assert.equal(Object.keys(archive.files).length, source.files.length + source.assets.length + 2);
  await assert.rejects(websiteProjectSourceBundle(version, []));
  await assert.rejects(websiteProjectSourceBundle(version, [{...resolved[0], bytes: Buffer.from("changed")} ]));
  console.log("PASS reproducible full-source archive preserves exact files, original artwork and revision-bound manifest; missing/changed artwork denied");
}
console.log(`${checks} canonical website source check groups passed.`);
checkSourceAssets().catch(error => {console.error(error); process.exitCode = 1;});

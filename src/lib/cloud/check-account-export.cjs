/* eslint-disable @typescript-eslint/no-require-imports -- Offline account export checks. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { accountExportRequest } = require("./account-export.ts");
const content = { schemaVersion: 1, title: "Export fixture", kind: "book", sections: [{ id: randomUUID(), title: "First chapter", blocks: [{ id: randomUUID(), type: "paragraph", text: "Supplied words <keep these> & punctuation.", assetId: null, locked: true, sourceIds: [] }] }] };
const style = { id: "mint", name: "Mint", version: 1, description: "Fixture", typography: { headingFont: "Inter", bodyFont: "Inter" }, colors: { accent: "#90EDAA", canvas: "#122822", ink: "#FFFFFF" }, referenceAssetIds: [] };
const options = { format: "pdf", documentId: randomUUID() };
const request = accountExportRequest(content, style, options);
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
check("section titles preserved", () => assert.equal(request.blocks[0].text, "First chapter"));
check("text and punctuation preserved", () => assert.equal(request.blocks[1].text, content.sections[0].blocks[0].text));
check("dark palette preserved", () => assert.equal(request.style.background, "#122822"));
check("export does not unlock or mutate content", () => assert.equal(content.sections[0].blocks[0].locked, true));
check("matching heading not duplicated", () => {
  const copy = structuredClone(content); copy.sections[0].blocks[0].type = "heading"; copy.sections[0].blocks[0].text = "First chapter";
  assert.equal(accountExportRequest(copy, style, options).blocks.length, 1);
});
for (const type of ["image", "list", "chart", "table", "callout"]) check(`${type} not silently dropped`, () => {
  const copy = structuredClone(content); copy.sections[0].blocks[0].type = type;
  assert.throws(() => accountExportRequest(copy, style, options), /cannot preserve/);
});
check("linked assets rejected without deletion", () => { const copy = structuredClone(content); copy.sections[0].blocks[0].assetId = randomUUID(); assert.throws(() => accountExportRequest(copy, style, options), /cannot preserve/); });
check("EPUB needs explicit language", () => assert.throws(() => accountExportRequest(content, style, { ...options, format: "epub" }), /language/));
check("EPUB metadata retained", () => assert.equal(accountExportRequest(content, style, { ...options, format: "epub", language: "bs", author: "Author" }).language, "bs"));
check("wrong format rejected", () => assert.throws(() => accountExportRequest(content, style, { ...options, format: "pptx" }), /supported/));
check("unsupported typography rejected", () => assert.throws(() => accountExportRequest(content, { ...style, typography: { headingFont: "Uninstalled", bodyFont: "Inter" } }, options), /fonts/));
check("missing palette rejected", () => assert.throws(() => accountExportRequest(content, { ...style, colors: {} }, options), /palette/));
check("large block rejected without truncation", () => { const copy = structuredClone(content); copy.sections[0].blocks[0].text = "x".repeat(20001); assert.throws(() => accountExportRequest(copy, style, options), /limit/); });
const artworkId = randomUUID();
const illustrated = structuredClone(content);
illustrated.sections[0].blocks.push({ id: randomUUID(), type: "image", text: "Artwork caption", assetId: artworkId, locked: false, sourceIds: [] });
check("missing artwork fails whole export", () => assert.throws(() => accountExportRequest(illustrated, style, options), /could not be included/));
check("external artwork URL rejected", () => assert.throws(() => accountExportRequest(illustrated, style, options, new Map([[artworkId, "https://example.com/image.png"]])), /could not be included/));
check("embedded artwork and caption preserved", () => {
 const result = accountExportRequest(illustrated, style, options, new Map([[artworkId, "data:image/png;base64,AQID"]]));
 assert.equal(result.blocks[2].image, "data:image/png;base64,AQID");assert.equal(result.blocks[2].text, "Artwork caption");
 assert.equal(illustrated.sections[0].blocks[1].assetId, artworkId);
});
console.log(`${count} account export checks passed.`);

// Explicit opt-in: exercise existing localhost renderer only; no provider calls.
if (process.env.MAKEBORNE_VERIFY_EXPORT_HTTP === "true") void (async () => {
  const JSZip = require("jszip");
  const png = await require("sharp")({create:{width:240,height:160,channels:3,background:"#456749"}}).png().toBuffer();
  const artwork = new Map([[artworkId, `data:image/png;base64,${png.toString("base64")}`]]);
  for (const [kind, format] of [["website", "html"], ["book", "epub"], ["presentation", "pptx"], ["book", "pdf"]]) {
    const body = accountExportRequest({ ...illustrated, kind }, style, { ...options, format, language: "en", author: "QA Author" }, artwork);
    const response = await fetch("http://127.0.0.1:3000/api/export", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000" }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, `${format}: ${response.status === 200 ? "" : await response.text()}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (format === "html") { assert.match(bytes.toString(), /Supplied words &lt;keep these&gt; &amp; punctuation/); assert.match(bytes.toString(), /#122822/); assert.match(bytes.toString(), /data:image\/png;base64/); assert.match(bytes.toString(), /Artwork caption/); }
    else if (format === "pdf") { assert.equal(bytes.subarray(0, 5).toString(), "%PDF-"); assert.match(bytes.toString("latin1"), /\/Subtype\s*\/Image/); }
    else {
      const zip = await JSZip.loadAsync(bytes);
      const files = Object.keys(zip.files).filter(path => format === "pptx" ? /^ppt\/slides\/slide\d+\.xml$/.test(path) : path.endsWith(".xhtml"));
      const text = (await Promise.all(files.map(path => zip.file(path).async("string")))).join("\n");
      assert.match(text, /Supplied words/); assert.match(text, /First chapter/);
      assert.match(text, /Artwork caption/);
      const media = Object.keys(zip.files).filter(path => /\.(png|jpe?g)$/.test(path));
      assert.ok(media.length > 0, `${format} embeds artwork`);
      const image = await zip.file(media[0]).async("nodebuffer");
      assert.equal((await require("sharp")(image).metadata()).width, 240);
      if (format === "pptx") assert.match(text, /<a:t>/);
    }
    console.log(`PASS localhost ${format.toUpperCase()} renderer (${bytes.length} bytes)`);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

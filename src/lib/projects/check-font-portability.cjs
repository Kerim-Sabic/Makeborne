/* eslint-disable @typescript-eslint/no-require-imports -- Offline source/runtime parity qualification. */
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module"), ts = require("typescript");
const {randomUUID, createHash} = require("node:crypto");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);
const portable = require("../../../infra/project-runtime/font-portability.cjs");
const licenses = require("../../../infra/project-runtime/font-licenses.cjs");
const browser = require("../builder/fonts.ts");
const {ProjectFiles} = require("../builder/files.ts");
const {websiteProjectSourceBundle} = require("./source-bundle.ts");
const {websiteProjectManifest} = require("./source-manifest.ts");
const {websiteBuildInput} = require("./build-input.ts");
const pkg = require("../../../infra/project-runtime/toolchain/package.json");
const lock = require("../../../infra/project-runtime/toolchain/package-lock.json");
const legacy = require("../../../infra/project-runtime/legacy-toolchain.json");
const sha = value => createHash("sha256").update(value).digest("hex");
let count = 0;
function check(name, run) { run(); count++; console.log(`PASS ${name}`); }
function fixture() {
  const project = new ProjectFiles();
  project.write("index.html", '<!doctype html><html lang="en"><head><title>Font parity</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  project.write("src/main.tsx", 'import {createRoot} from "react-dom/client"; import App from "./nested/App"; import "./style.css"; createRoot(document.getElementById("root")!).render(<App/>);');
  project.write("src/nested/App.tsx", 'import "@makeborne/fonts/fraunces.css"; import {ArrowUpRight, MapPin} from "lucide-react"; export default function App(){return <main><h1>Made for <em>people</em></h1><MapPin aria-hidden="true"/><a href="#contact">Contact<ArrowUpRight aria-hidden="true"/></a><p id="contact">Local and independent.</p></main>}');
  project.write("src/style.css", '@import "@makeborne/fonts/inter.css"; body{font-family:"Inter",sans-serif}h1{font-family:"Fraunces",serif}');
  return {id: randomUUID(), artifactId: randomUUID(), number: 1, parentVersionId: null,
    content: {schemaVersion: 1, kind: "website", title: "Font parity", sections: [], websiteSource: project.toSource()},
    style: {id: "automatic", name: "Automatic", description: "Original direction", version: 1, typography: {headingFont: "Inter", bodyFont: "Inter"}, colors: {accent: "#333333"}, referenceAssetIds: []},
    assetIds: [], createdAt: new Date().toISOString(), createdBy: randomUUID(), changeSummary: "Offline fixture"};
}

(async () => {
  await (await import("../../../scripts/prepare-font-licenses.mjs")).prepareFontLicenses();
  check("bundled license catalogue preserves exact approved package text, authors and hashes", () => {
    const pinned = require("../../../infra/project-runtime/font-licenses.json");
    assert.equal(pinned.schemaVersion, 1);
    assert.equal(Object.keys(pinned.licenses).length, portable.catalog.length);
    for (const font of portable.catalog) {
      const item = pinned.licenses[font.id];
      assert.equal(item.package, portable.fontPackage(font));
      assert.equal(item.version, pkg.dependencies[item.package]);
      assert.equal(item.sha256, sha(item.content));
      assert.equal(licenses([font])[0].content, item.content);
    }
    const helper = fs.readFileSync(path.resolve(__dirname, "../../../infra/project-runtime/font-licenses.cjs"), "utf8");
    assert.doesNotMatch(helper, /require\.resolve|node:fs|createRequire/);
    assert.throws(() => licenses([{id: "unapproved"}]), /Missing trusted/);
  });
  check("approved packages and lock contain Lucide and every exact Fontsource version", () => {
    assert.equal(pkg.dependencies["lucide-react"], "1.51.0");
    assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
    assert(!Object.values(pkg.dependencies).some(value => /file:|\^|~/.test(value)));
    for (const font of portable.catalog) {
      const name = portable.fontPackage(font);
      assert.equal(pkg.dependencies[name], "5.3.0"); assert.equal(lock.packages[`node_modules/${name}`].version, "5.3.0");
    }
  });
  check("all catalogue families, axes and styles select the exact browser font files", () => {
    for (const font of portable.catalog) for (const italic of [false, true]) {
      const input = [{path: "index.html", content: '<html><head></head><body></body></html>'}, {path: "src/theme.css", content: `body{font-family:"${font.family}";${italic ? "font-style:italic" : ""}}`}];
      const result = portable.portableFontFiles(input);
      assert.deepEqual(result.fonts.map(item => item.id), browser.detectFonts(input.map(file => [file.path, file.content])).fonts.map(item => item.id));
      assert.equal(result.styles.length, italic && font.italic ? 2 : 1);
      for (const {style} of result.styles) {
        const filename = `${font.id}-latin-${font.axis}-${style}.woff2`;
        const bytes = fs.readFileSync(require.resolve(`${portable.fontPackage(font)}/files/${filename}`));
        assert.equal(bytes.subarray(0, 4).toString(), "wOF2");
        assert.equal(portable.fontFaceRule(font, style, "local.woff2"), browser.fontFaceRule(font, style, "local.woff2"));
      }
      assert.match(licenses(result.fonts)[0].content, /SIL OPEN FONT LICENSE/i);
    }
  });
  const version = fixture(), source = version.content.websiteSource, before = JSON.stringify(source);
  const materialized = portable.portableFontFiles(source.files);
  check("nested JS and CSS markers become relative imports without changing saved source", () => {
    assert.match(materialized.files.find(file => file.path === "src/nested/App.tsx").content, /"\.\.\/\.\.\/makeborne-font-marker.css"/);
    assert.match(materialized.files.find(file => file.path === "src/style.css").content, /"\.\.\/makeborne-font-marker.css"/);
    assert.match(materialized.files.find(file => file.path === "index.html").content, /href="\/makeborne-fonts.css"/);
    assert.equal(JSON.stringify(source), before);
    assert.throws(() => portable.portableFontFiles([...source.files, {path: "Makeborne-Fonts.css", content: "reserved"}]), /reserved/);
  });
  const bundle = await websiteProjectSourceBundle(version, []), repeated = await websiteProjectSourceBundle(version, []);
  const archive = await require("jszip").loadAsync(bundle.bytes);
  check("archive preserves original identity and verifies every derived file and license", () => {
    assert.equal(Buffer.compare(Buffer.from(bundle.bytes), Buffer.from(repeated.bytes)), 0);
    assert.equal(bundle.manifest.sourceHash, websiteProjectManifest(source).sourceHash);
    assert.equal(JSON.stringify(source), before);
    assert.equal(bundle.manifest.fonts.length, 4);
    assert(archive.file("public/makeborne-font-licenses/fraunces.txt"));
  });
  assert.deepEqual(JSON.parse(await archive.file(".makeborne/original-source.json").async("string")), source);
  for (const file of bundle.manifest.files) {
    const bytes = await archive.file(file.path).async("nodebuffer"); assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256);
  }
  check("isolated build input remains the original verified source", () => {
    const input = websiteBuildInput(version, []);
    assert.equal(input.sourceHash, bundle.manifest.sourceHash);
    assert(!input.files.some(file => file.path === portable.FONT_CSS));
    assert.equal(input.files.find(file => file.path === "src/nested/App.tsx").sha256, sha(source.files.find(file => file.path === "src/nested/App.tsx").content));
  });
  const collision = structuredClone(version);
  collision.content.websiteSource.files.push({path: "public/makeborne-font-licenses/inter.txt", content: "customer file"});
  await assert.rejects(websiteProjectSourceBundle(collision, []), /conflict/);
  check("portable licenses cannot overwrite customer source", () => {});
  const legacyVersion = structuredClone(version);
  for (const file of legacyVersion.content.websiteSource.files) {
    if (file.path === "package.json") file.content = JSON.stringify(legacy.package);
    if (file.path === "package-lock.json") file.content = JSON.stringify(legacy.lock);
  }
  const legacyHash = websiteProjectManifest(legacyVersion.content.websiteSource).sourceHash;
  const legacyBundle = await websiteProjectSourceBundle(legacyVersion, []);
  const legacyArchive = await require("jszip").loadAsync(legacyBundle.bytes);
  check("exact historical pair derives approved packages while retaining historical source identity", () => {
    assert.equal(websiteBuildInput(legacyVersion, []).sourceHash, legacyHash);
    assert.equal(legacyBundle.manifest.compatibility, "react-vite-v1-pre-fonts");
    assert.equal(legacyBundle.manifest.sourceHash, legacyHash);
    assert.notEqual(legacyHash, bundle.manifest.sourceHash);
  });
  assert.deepEqual(JSON.parse(await legacyArchive.file("package.json").async("string")), pkg);
  assert.deepEqual(JSON.parse(await legacyArchive.file("package-lock.json").async("string")), lock);
  assert.deepEqual(JSON.parse(await legacyArchive.file(".makeborne/original-source.json").async("string")), legacyVersion.content.websiteSource);
  for (const change of ["package", "lock", "mixed", "config"]) {
    const invalid = structuredClone(legacyVersion), files = invalid.content.websiteSource.files;
    if (change === "config") files.push({path: "vite.config.ts", content: "export default {}"});
    else {
      const file = files.find(file => file.path === (change === "package" ? "package.json" : "package-lock.json"));
      const value = JSON.parse(file.content); value.name = "altered";
      file.content = change === "mixed" ? JSON.stringify(lock) : JSON.stringify(value);
    }
    assert.throws(() => websiteBuildInput(invalid, []), /approved|configuration/);
    await assert.rejects(websiteProjectSourceBundle(invalid, []), /approved|configuration/);
  }
  check("altered historical package/lock, mixed pairs and custom config are rejected", () => {});

  if (process.env.MAKEBORNE_VERIFY_PORTABLE_RUNTIME === "true") {
    const {dockerCommand, localRuntimeFlags, removeLocalTemporary} = await import("../../../infra/project-runtime/local-adapter.mjs");
    const image = await dockerCommand(["image", "inspect", "makeborne-react-vite:font-parity", "--format", "{{.Id}}"]);
    assert.equal(image.code, 0, image.output); const imageId = image.output.trim(); assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
    for (const candidate of [version, legacyVersion]) {
    const expectedHash = websiteProjectManifest(candidate.content.websiteSource).sourceHash;
    const archive = await require("jszip").loadAsync((await websiteProjectSourceBundle(candidate, [])).bytes);
    const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "makeborne-probe-"));
    try {
      fs.writeFileSync(path.join(dir, "request.json"), JSON.stringify(websiteBuildInput(candidate, [])));
      for (const [name, entry] of Object.entries(archive.files)) {
        if (entry.dir) continue; assert(!name.split("/").includes(".."));
        const dest = path.join(dir, "export", name); fs.mkdirSync(path.dirname(dest), {recursive: true}); fs.writeFileSync(dest, await entry.async("nodebuffer"));
      }
      const inspect = `const list=await fs.readdir(out,{recursive:true});const files=[];for(const f of list){const p=out+'/'+f;if((await fs.stat(p)).isFile())files.push({path:f,bytes:await fs.readFile(p)});}const css=files.filter(f=>f.path.endsWith('.css')).map(f=>f.bytes.toString()).join('');const js=files.filter(f=>f.path.endsWith('.js')).map(f=>f.bytes.toString()).join('');console.log('PARITY:'+JSON.stringify({fonts:files.filter(f=>f.path.endsWith('.woff2')).map(f=>sha(f.bytes)).sort(),licenses:files.filter(f=>f.path.startsWith('makeborne-font-licenses/')).length,faces:(css.match(/@font-face/g)||[]).length,inter:css.includes('Inter'),fraunces:css.includes('Fraunces'),icons:js.includes('arrow-up-right')&&js.includes('map-pin'),receipt:files.some(f=>f.path==='makeborne-build.json')?JSON.parse(files.find(f=>f.path==='makeborne-build.json').bytes):null}));process.exit(process.exitCode||0);`;
      const prefix = `import fs from 'node:fs/promises';import{createHash}from'node:crypto';const sha=x=>createHash('sha256').update(x).digest('hex');`;
      const modes = [
        ["verified runtime", `${prefix}await import('/opt/makeborne/build.mjs');const out='/tmp/result';${inspect}`],
        ["exported archive", `${prefix}import{spawnSync}from'node:child_process';await fs.cp('/input/export','/tmp/export',{recursive:true});await fs.symlink('/opt/makeborne/node_modules','/tmp/export/node_modules','dir');const built=spawnSync('npm',['run','build'],{cwd:'/tmp/export',encoding:'utf8'});if(built.status!==0){console.error(built.stdout,built.stderr);process.exit(1)}const out='/tmp/export/dist';${inspect}`],
      ];
      const results = [];
      for (const [mode, script] of modes) {
        const name = `makeborne-font-parity-${randomUUID()}`;
        try {
          const run = await dockerCommand(["run", "--rm", ...localRuntimeFlags(name, dir), "--env", `MAKEBORNE_RUNTIME_IMAGE=${imageId}`, "--entrypoint", "node", imageId, "--input-type=module", "--eval", script], 60_000);
          assert.equal(run.code, 0, `${mode}: ${run.output}`);
          const result = JSON.parse(run.output.split("\n").find(line => line.startsWith("PARITY:")).slice(7));
          check(`${mode} builds offline with four real font files, licenses and Lucide icons`, () => {
            assert.equal(result.fonts.length, 4); assert.equal(result.faces, 4); assert.equal(result.licenses, 2);
            assert(result.inter && result.fraunces && result.icons);
            if (mode === "verified runtime") assert.equal(result.receipt.sourceHash, expectedHash);
          });
          results.push(result);
        } finally { await dockerCommand(["rm", "-f", name]); }
      }
      check("export and verified runtime emit identical selected font bytes", () => assert.deepEqual(results[0].fonts, results[1].fonts));
      if (candidate === legacyVersion) for (const tamper of ["manifest", "lock bytes"]) {
        const invalid = websiteBuildInput(candidate, []);
        if (tamper === "manifest") invalid.sourceManifest.files[0].sha256 = "f".repeat(64);
        else invalid.files.find(file => file.path === "package-lock.json").base64 = Buffer.from('{"name":"altered"}').toString("base64");
        fs.writeFileSync(path.join(dir, "request.json"), JSON.stringify(invalid));
        const name = `makeborne-font-parity-${randomUUID()}`;
        try {
          const run = await dockerCommand(["run", "--rm", ...localRuntimeFlags(name, dir), "--env", `MAKEBORNE_RUNTIME_IMAGE=${imageId}`, "--entrypoint", "node", imageId, "--input-type=module", "--eval", "await import('/opt/makeborne/build.mjs');process.exit(process.exitCode||0)"], 60_000);
          check(`runtime refuses altered historical ${tamper} before materialization`, () => {
            assert.notEqual(run.code, 0); assert.match(run.output, /FILE_CHANGED|SOURCE_IDENTITY_MISMATCH/);
          });
        } finally { await dockerCommand(["rm", "-f", name]); }
      }
    } finally { await removeLocalTemporary(dir, "makeborne-probe-"); }
    }
  }
  console.log(`${count} font portability groups passed; no provider calls. Isolated builds: ${process.env.MAKEBORNE_VERIFY_PORTABLE_RUNTIME === "true"}.`);
})().catch(error => {console.error(error); process.exitCode = 1;});

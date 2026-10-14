/* eslint-disable @typescript-eslint/no-require-imports -- Local operator qualification. */
const fs = require("node:fs"), fsp = require("node:fs/promises"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), {createHash, randomUUID} = require("node:crypto"), ts = require("typescript");
const {tmpdir} = require("node:os");
const cache = new Map(), appRoot = path.resolve(__dirname, "../..");
function load(file) {
  file = path.resolve(appRoot, file);
  if (cache.has(file)) return cache.get(file).exports;
  const compiledModule = {exports: {}}; cache.set(file, compiledModule);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  vm.runInNewContext(code, {module: compiledModule, exports: compiledModule.exports, Buffer, TextEncoder, Error,
    require(name) {
      if (name === "server-only") return {};
      if (["zod", "node:crypto"].includes(name)) return require(name);
      if (!name.startsWith("./") && !name.startsWith("../")) throw new Error("Unexpected trusted dependency");
      const target = path.resolve(path.dirname(file), name);
      return name.endsWith(".json") ? require(target) : load(`${target}.ts`);
    }}, {filename: file});
  return compiledModule.exports;
}
const {websiteBuildInput, PROJECT_TOOLCHAIN} = load("src/lib/projects/build-input.ts");
const sha = value => createHash("sha256").update(value).digest("hex");
async function main() {
  if (process.env.MAKEBORNE_VERIFY_LOCAL_RUNTIME !== "true") throw new Error("Enable MAKEBORNE_VERIFY_LOCAL_RUNTIME for local Docker/browser checks.");
  const {runLocalBuild, dockerCommand, localRuntimeFlags, removeLocalTemporary} = await import("./local-adapter.mjs");
  await assert.rejects(removeLocalTemporary(appRoot), /RUNTIME_CLEANUP_PATH_INVALID/);
  const png = await require("sharp")({create: {width: 8, height: 8, channels: 3, background: "#6688aa"}}).png().toBuffer();
  const assetId = randomUUID();
  const source = {schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx", routes: [{path: "/", title: "Home"}, {path: "/work", title: "Work"}],
    files: [{path: "package.json", content: JSON.stringify(PROJECT_TOOLCHAIN.package)}, {path: "package-lock.json", content: JSON.stringify(PROJECT_TOOLCHAIN.lock)},
      {path: "index.html", content: '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Runtime fixture</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'},
      {path: "src/main.tsx", content: `import {useState} from 'react'; import {createRoot} from 'react-dom/client'; import './app.css';
function App(){const [open,setOpen]=useState(false);return <main><h1>{location.pathname==='/work'?'Our work':'A real React website'}</h1><img src="/hero.png" alt="Verified project artwork"/><a href="/work">Explore work</a><button onClick={()=>setOpen(!open)}>Show details</button>{open&&<p>Interactive detail is working.</p>}</main>};createRoot(document.getElementById('root')!).render(<App/>);`},
      {path: "src/app.css", content: 'body{margin:0;background:#faf9f7;color:#24252b;font-family:Arial,sans-serif}main{max-width:960px;margin:auto;padding:48px}h1{font-size:clamp(32px,7vw,72px)}img{display:block;width:100%;height:100px;object-fit:cover}a,button{display:inline-block;margin:24px 12px 0 0;padding:12px}'}],
    assets: [{id: assetId, path: "public/hero.png", bytes: png.length, sha256: sha(png), mediaType: "image/png"}]};
  const content = {schemaVersion: 1, kind: "website", title: "Runtime fixture", sections: [], websiteSource: source};
  const version = {id: randomUUID(), artifactId: randomUUID(), number: 1, parentVersionId: null, content,
    style: {id: "automatic", name: "Automatic", version: 1, typography: {headingFont: "Arial", bodyFont: "Arial"}, colors: {canvas: "#faf9f7", ink: "#24252b"}, description: "Runtime qualification", referenceAssetIds: []},
    assetIds: [assetId], createdAt: new Date().toISOString(), createdBy: randomUUID(), changeSummary: "Fixture"};
  const artwork = [{...source.assets[0], bytes: png}], request = websiteBuildInput(version, artwork);
  for (const mutate of [v => {v.content.websiteSource.files.find(file => file.path === "package.json").content = '{"scripts":{"build":"curl https://example.com"}}';},
    v => {v.content.websiteSource.files.push({path: "vite.config.ts", content: "throw new Error('should never execute')"});}]) {
    const changed = structuredClone(version); mutate(changed); assert.throws(() => websiteBuildInput(changed, artwork));
  }
  assert.throws(() => websiteBuildInput(version, []));
  console.log("PASS shared preflight binds exact revision/source/toolchain/artwork and rejects unapproved dependencies/configuration");
  const results = [];
  try {
    for (let i = 0; i < 2; i++) {const result = await runLocalBuild(request); results.push(result); assert.equal(result.status, "built", result.logs);}
    const manifests = await Promise.all(results.map(result => fsp.readFile(path.join(result.outputDirectory, "makeborne-build.json"), "utf8").then(JSON.parse)));
    assert.deepEqual(manifests[0], manifests[1]);
    assert.equal(manifests[0].revisionId, version.id); assert.equal(manifests[0].sourceHash, request.sourceHash);
    for (const file of manifests[0].files) {
      const bytes = await fsp.readFile(path.join(results[0].outputDirectory, file.path)); assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256);
    }
    assert.equal(Buffer.compare(await fsp.readFile(path.join(results[0].outputDirectory, "hero.png")), png), 0);
    console.log("PASS two actual offline container builds produce identical artifact hashes and preserve original artwork");
    console.log(JSON.stringify({imageId: results[0].imageId, elapsedMs: results.map(value => value.elapsedMs), sourceHash: request.sourceHash, buildHash: manifests[0].buildHash}));
    const probeDirectory = await fsp.mkdtemp(path.join(tmpdir(), "makeborne-probe-")), name = `makeborne-probe-${randomUUID()}`;
    const canary = `not-a-secret-${randomUUID()}`, priorCanary = process.env.MAKEBORNE_RUNTIME_CANARY;
    process.env.MAKEBORNE_RUNTIME_CANARY = canary;
    try {
      await fsp.writeFile(path.join(probeDirectory, "request.json"), "{}");
      const probe = `const fs=require('fs');(async()=>{let denied=0;for(const p of ['/var/run/docker.sock','/input/.env.local','/another-project/source.json']){try{fs.readFileSync(p)}catch{denied++}}let readonly=false;try{fs.writeFileSync('/opt/makeborne/forbidden','x')}catch{readonly=true}let offline=false;try{await fetch('https://1.1.1.1',{signal:AbortSignal.timeout(1500)})}catch{offline=true}console.log(JSON.stringify({uid:process.getuid(),canaryAbsent:!process.env.MAKEBORNE_RUNTIME_CANARY,denied,readonly,offline}))})()`;
      assert.equal((await dockerCommand(["create", ...localRuntimeFlags(name, probeDirectory), "--entrypoint", "node", results[0].imageId, "-e", probe])).code, 0);
      const inspected = await dockerCommand(["inspect", name, "--format", "{{json .HostConfig}}"]), limits = JSON.parse(inspected.output);
      assert.equal(limits.NetworkMode, "none"); assert.equal(limits.ReadonlyRootfs, true); assert.equal(limits.Memory, 512 * 1024 ** 2);
      assert.equal(limits.PidsLimit, 64); assert.equal(limits.NanoCpus, 1e9); assert.deepEqual(limits.CapDrop, ["ALL"]);
      const result = await dockerCommand(["start", "--attach", name]); assert.equal(result.code, 0);
      assert.deepEqual(JSON.parse(result.output), {uid: 1000, canaryAbsent: true, denied: 3, readonly: true, offline: true});
      console.log("PASS real container cannot read host canary/environment/socket/other-project paths, write toolchain or access network; quotas inspected");
      assert.equal((await dockerCommand(["rm", "--force", name])).code, 0);
      await fsp.writeFile(path.join(probeDirectory, "request.json"), JSON.stringify(request));
      assert.equal((await dockerCommand(["create", ...localRuntimeFlags(name, probeDirectory), "--env", `MAKEBORNE_RUNTIME_IMAGE=${results[0].imageId}`,
        "--env", "MAKEBORNE_RUNTIME_TTL_MS=100", results[0].imageId])).code, 0);
      const expired = await dockerCommand(["start", "--attach", name]); assert.equal(expired.code, 124);
      assert.match(expired.output, /RUNTIME_LEASE_EXPIRED/);
      console.log("PASS independent container watchdog stops the compiler when its lease expires");
    } finally {
      if (priorCanary === undefined) delete process.env.MAKEBORNE_RUNTIME_CANARY; else process.env.MAKEBORNE_RUNTIME_CANARY = priorCanary;
      await dockerCommand(["rm", "--force", name]); await removeLocalTemporary(probeDirectory, "makeborne-probe-");
    }
    const invalid = structuredClone(version); invalid.content.websiteSource.files.find(file => file.path === "src/main.tsx").content = "export const broken = <";
    const failure = await runLocalBuild(websiteBuildInput(invalid, artwork)); assert.equal(failure.status, "failed");
    const invalidType = structuredClone(version); invalidType.content.websiteSource.files.find(file => file.path === "src/main.tsx").content += '\nconst price: number = "wrong type";';
    const typeFailure = await runLocalBuild(websiteBuildInput(invalidType, artwork)); assert.equal(typeFailure.status, "failed");
    assert.match(typeFailure.logs, /not assignable to type 'number'/);
    const tampered = structuredClone(request); const entry = tampered.files.find(file => file.path === "src/main.tsx");
    const forgedBytes = Buffer.from("console.log('different source')"); entry.base64 = forgedBytes.toString("base64"); entry.bytes = forgedBytes.length; entry.sha256 = sha(forgedBytes);
    const forged = await runLocalBuild(tampered); assert.equal(forged.status, "failed"); assert.match(forged.logs, /FILE_CHANGED/);
    const wrongIdentity = structuredClone(request); wrongIdentity.sourceHash = "0".repeat(64);
    const wrongSource = await runLocalBuild(wrongIdentity); assert.equal(wrongSource.status, "failed"); assert.match(wrongSource.logs, /SOURCE_IDENTITY_MISMATCH/);
    console.log("PASS runtime independently rejects forged source identity and changed transfer bytes");
    await assert.rejects(runLocalBuild(request, {timeoutMs: 1}), /RUNTIME_DEADLINE/);
    assert.equal((await dockerCommand(["ps", "--all", "--filter", "label=makeborne.runtime=local-qualification", "--format", "{{.Names}}"])).output.trim(), "");
    console.log("PASS syntax/type failure and deadline preserve source, return failure and leave no qualification containers");
    await browserCheck(results[0].outputDirectory);
  } finally {for (const result of results) await result.dispose?.();}
  console.log("LOCAL RUNTIME QUALIFICATION PASSED. No cloud sandbox, paid provider or production execution is claimed.");
}
async function browserCheck(directory) {
  const http = require("node:http"), {chromium} = require("playwright");
  const server = http.createServer(async (request, response) => {
    try {
      const route = new URL(request.url, "http://localhost").pathname;
      const relative = ["/", "/work"].includes(route) ? "index.html" : route.slice(1);
      if (!/^[A-Za-z0-9_./-]+$/.test(relative) || relative.split("/").includes("..")) throw new Error("Bad path");
      const bytes = await fsp.readFile(path.join(directory, relative));
      response.writeHead(200, {"Content-Type": relative.endsWith(".js") ? "text/javascript" : relative.endsWith(".css") ? "text/css" : relative.endsWith(".png") ? "image/png" : "text/html",
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}); response.end(bytes);
    } catch {response.writeHead(404); response.end();}
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({headless: true}); const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    for (const width of [390, 1440]) {
      await page.setViewportSize({width, height: 900}); await page.goto(`http://127.0.0.1:${server.address().port}/work`);
      await page.getByRole("heading", {name: "Our work"}).waitFor();
      await page.getByRole("button", {name: "Show details"}).click(); await page.getByText("Interactive detail is working.").waitFor();
      assert(await page.getByAltText("Verified project artwork").evaluate(image => image.naturalWidth === 8));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const evidence = path.join(appRoot, "docs/execution/evidence/M04-T01-R01");
      await fsp.mkdir(evidence, {recursive: true});
      await page.screenshot({path: path.join(evidence, `runtime-${width}.png`), fullPage: true});
    }
    assert.deepEqual(errors, []); console.log("PASS real compiled React at 390/1440: direct nested-route load, interactive button, original image and no horizontal overflow or runtime errors");
  } finally {await browser?.close(); await new Promise(resolve => server.close(resolve));}
}
main().catch(error => {console.error(error); process.exitCode = 1;});

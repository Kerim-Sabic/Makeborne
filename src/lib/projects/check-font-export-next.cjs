/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in production bundler regression. */
// A private, generated Next app imports the real source exporter. No cloud/auth mocks
// are installed in production code, and no account/provider configuration is inherited.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const {spawn} = require("node:child_process"), {randomUUID, createHash} = require("node:crypto");
const root = path.resolve(__dirname, "../../..");

async function main() {
  if (process.env.MAKEBORNE_VERIFY_NEXT_SOURCE_EXPORT !== "true") {
    console.log("SKIP opt-in Next production source-export fixture."); return;
  }
  const work = path.join(root, "work");
  fs.mkdirSync(work, {recursive: true});
  const dir = fs.mkdtempSync(path.join(work, "font-export-next-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|APPDATA|LOCALAPPDATA|USERPROFILE|COMSPEC|PATHEXT|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(key)));
  Object.assign(env, {NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1"});
  const cli = path.join(root, "node_modules/next/dist/bin/next");
  const children = new Set();
  let output = "";
  function run(args) {
    const child = spawn(process.execPath, [cli, ...args], {cwd: dir, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]});
    children.add(child);
    child.stdout.on("data", bytes => { output = (output + bytes).slice(-16000); });
    child.stderr.on("data", bytes => { output = (output + bytes).slice(-16000); });
    return child;
  }
  const wait = child => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {child.kill(); reject(new Error(`Next timed out: ${output}`));}, 120000);
    child.on("error", reject);
    child.on("exit", code => {
      clearTimeout(timeout); children.delete(child);
      if (code === 0) resolve(); else reject(new Error(`Next exited ${code}: ${output}`));
    });
  });
  try {
    const route = path.join(dir, "app/export"); fs.mkdirSync(route, {recursive: true});
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({name: "private-source-export-probe", private: true}));
    fs.writeFileSync(path.join(dir, "next.config.mjs"), `export default {turbopack:{root:${JSON.stringify(root)}},outputFileTracingRoot:${JSON.stringify(root)}}`);
    const modulePath = file => JSON.stringify(path.relative(route, path.join(root, file)).replaceAll("\\", "/"));
    fs.writeFileSync(path.join(route, "route.js"), `
      import {websiteProjectSourceBundle} from ${modulePath("src/lib/projects/source-bundle.ts")};
      import {ProjectFiles} from ${modulePath("src/lib/builder/files.ts")};
      export const dynamic = "force-dynamic";
      export async function GET() {
        const project = new ProjectFiles();
        project.write("index.html", '<html><head></head><body><div id="root"></div></body></html>');
        project.write("src/App.tsx", 'import {MapPin} from "lucide-react"; export default function App(){return <main style={{fontFamily:"Fraunces"}}><em>Private font fixture</em><MapPin/></main>}');
        project.write("src/style.css", 'body{font-family:"Inter"}');
        project.write("src/main.tsx", 'import {createRoot} from "react-dom/client"; import App from "./App"; import "./style.css"; createRoot(document.getElementById("root")!).render(<App/>);');
        const version = {id:${JSON.stringify(randomUUID())},artifactId:${JSON.stringify(randomUUID())},number:1,parentVersionId:null,
          content:{schemaVersion:1,kind:"website",title:"Private local fixture",sections:[],websiteSource:project.toSource()},
          style:{id:"automatic",name:"Automatic",description:"Original",version:1,typography:{headingFont:"Inter",bodyFont:"Inter"},colors:{accent:"#333333"},referenceAssetIds:[]},
          assetIds:[],createdAt:"2026-10-13T00:00:00.000Z",createdBy:${JSON.stringify(randomUUID())},changeSummary:"Private fixture"};
        const bundle = await websiteProjectSourceBundle(version, []);
        return new Response(bundle.bytes,{headers:{"content-type":"application/zip"}});
      }`);
    await wait(run(["build"]));
    console.log("PASS real Next/Turbopack production fixture compiled the source exporter.");
    const net = require("node:net");
    const listener = net.createServer();
    await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    run(["start", "--hostname", "127.0.0.1", "--port", String(port)]);
    let response;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { response = await fetch(`http://127.0.0.1:${port}/export`, {signal: AbortSignal.timeout(10000)}); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(response, output); assert.equal(response.status, 200, output);
    const archive = await require("jszip").loadAsync(await response.arrayBuffer());
    const pinned = require("../../../infra/project-runtime/font-licenses.json");
    for (const id of ["fraunces", "inter"]) {
      const bytes = await archive.file(`public/makeborne-font-licenses/${id}.txt`).async("nodebuffer");
      assert.equal(createHash("sha256").update(bytes).digest("hex"), pinned.licenses[id].sha256);
      assert.equal(bytes.toString(), pinned.licenses[id].content);
    }
    const manifest = JSON.parse(await archive.file(".makeborne/manifest.json").async("string"));
    assert.equal(manifest.fonts.length, 4);
    for (const file of manifest.files) {
      const bytes = await archive.file(file.path).async("nodebuffer");
      assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
    }
    assert(archive.file(".makeborne/original-source.json"));
    console.log("PASS production HTTP source export returns original source, four font styles, exact OFL text and verified archive hashes.");
  } finally {
    for (const child of children) {
      child.kill();
      await new Promise(resolve => child.once("exit", resolve));
    }
    const resolved = fs.realpathSync(dir);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(work).toLowerCase());
    assert(path.basename(resolved).startsWith("font-export-next-"));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});

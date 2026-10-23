/* eslint-disable @typescript-eslint/no-require-imports -- Mounted LivePreview: a saved project's images load before its first compile (no false "Cannot find" build error),
   loads are fenced by identity, image failures are told apart, and a genuinely broken import still reports a real error. The compiler stand-in fails exactly like
   browser-bundler.ts when an imported image is absent from its image map. Every API is a local fixture; every non-localhost request is aborted: no provider, database or paid call. */
// Usage: node scripts/check-preview-assets-browser.cjs   (PW_ENGINE=chromium|firefox|webkit)
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, engineLabel } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const root = path.resolve(__dirname, "..");
const ids = { actor: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", dog: "33333333-3333-4333-8333-333333333333", cat: "66666666-6666-4666-8666-666666666666" };

async function fixtureBundle() {
  const contents = `import React from "react";import{createRoot}from"react-dom/client";import LivePreview from"./src/components/live-preview";
const project=(artifact,title,image,version)=>({artifact,version,files:{"index.html":"<div id=root></div>","src/main.tsx":image?'import art from "./artwork/'+image+'";\\nexport default art;\\n':"export {};\\n",title},assets:image?[{id:artifact.slice(0,8)+"-"+image,path:"src/artwork/"+image}]:[]});
window.__projects={dog:project("${ids.dog}","Coastal Dog Grooming","coastal-dog.webp",3),cat:project("${ids.cat}","Harbour Cats","harbour-cat.webp",1),
  broken:{artifact:"${ids.dog}",version:4,files:{"src/main.tsx":'import art from "./artwork/nope.webp";\\n',title:"Broken import"},assets:[]}};
function App(){const[p,setP]=React.useState(()=>window.__projects[new URLSearchParams(location.search).get("p")||"dog"]);
  React.useEffect(()=>{window.test={open:name=>setP(window.__projects[name]),set:setP,current:()=>p};});
  // Like the editor: one preview per account, workspace and project (switching projects remounts it).
  return <div style={{height:"100vh",display:"flex",flexDirection:"column"}}><LivePreview key={p.artifact} files={p.files} assets={p.assets} scope={{accountId:"${ids.actor}",workspaceId:"${ids.workspace}",artifactId:p.artifact}} subject={{version:p.version,unsaved:false}}/></div>;}
createRoot(document.getElementById("root")).render(<App/>);`;
  const output = await build({ stdin: { contents, loader: "jsx", resolveDir: root }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent", plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /browser-bundler$|cloud-api$|design-capture$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ loader: "js", contents: `
      // Same contract as browser-bundler.ts: an imported image must be in the image map, or the compile fails with "Cannot find".
      export async function bundleProject(files, images){
        (window.__compiles = window.__compiles || []).push(files.title);
        await new Promise(resolve => setTimeout(resolve, (window.__compileDelay || {})[files.title] || 0));
        const found = /from "\\.\\/artwork\\/([^"]+)"/.exec(files["src/main.tsx"] || "");
        const url = found ? images["/src/artwork/" + found[1]] : "";
        if (found && !url) return { ok: false, kind: "build", error: 'src/main.tsx:1: Cannot find "./artwork/' + found[1] + '" imported from src/main.tsx' };
        return { ok: true, html: "<!doctype html><html><head><title>" + files.title + "</title></head><body><h1>" + files.title + "</h1>" + (url ? '<img alt="artwork" src="' + url + '">' : "") + '<script>parent.postMessage({source:"makeborne-preview",type:"ready"},"*")<\\/script></body></html>' };
      }
      // Same contract as cloud-api.ts: a failed response carries its status; a dropped connection rejects with no status.
      export async function readCloudImage(path, account, signal){
        const response = await fetch(path, { signal, cache: "no-store", headers: { "X-Makeborne-Account": account } });
        if (!response.ok) throw Object.assign(new Error("Artwork is unavailable. Check access or try again."), { status: response.status });
        return response.blob();
      }
      export async function captureDesign(){ throw Error("Unexpected capture"); }` }));
    b.onResolve({ filter: /^@\// }, args => { const base = path.resolve(root, "src", args.path.slice(2)); return { path: fs.existsSync(base) ? base : fs.existsSync(base + ".tsx") ? base + ".tsx" : base + ".ts" }; });
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  } }] });
  return output.outputFiles[0].contents;
}

async function main() {
  const script = await fixtureBundle();
  const css = fs.readFileSync(path.join(root, "src/app/live-builder.css"), "utf8");
  // Per image id: the answers to give in order ({ status } or "drop"), then 200. Each answer can wait `delay` ms.
  const state = { plans: {}, delay: {}, requests: [], foreign: [] };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/fixture.js") { res.setHeader("content-type", "text/javascript"); res.end(script); return; }
    const asset = /^\/api\/cloud\/workspaces\/[^/]+\/artifacts\/([^/]+)\/assets\/([^/]+)$/.exec(url.pathname);
    if (asset) {
      const id = asset[2]; state.requests.push(id);
      const plan = state.plans[id] ?? [], answer = plan.length ? plan.shift() : { status: 200 };
      await new Promise(resolve => setTimeout(resolve, state.delay[id] ?? 0));
      if (answer === "drop") { req.socket.destroy(); return; }
      if (answer.status !== 200) { res.writeHead(answer.status, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: `Fixture ${answer.status}` } })); return; }
      res.writeHead(200, { "content-type": "image/webp", "cache-control": "no-store" }); res.end(Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 fixture")); return;
    }
    if (url.pathname.startsWith("/api/")) { state.foreign.push(req.method + " " + url.pathname); res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview assets</title><style>body{margin:0;font:14px sans-serif}*{box-sizing:border-box}.button{border:1px solid #ccc;border-radius:8px;padding:4px 10px;background:#fff}${css}</style><div id="root"></div><script src="/fixture.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await browserType.launch({ headless: true });
  const results = [];
  const reset = () => { state.plans = {}; state.delay = {}; state.requests = []; };
  const dogImage = `${ids.dog.slice(0, 8)}-coastal-dog.webp`, catImage = `${ids.cat.slice(0, 8)}-harbour-cat.webp`;

  async function open(project = "dog") {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10_000);
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => { state.foreign.push(route.request().url()); return route.abort(); });
    // "drop" fails the request in the browser as if offline (a server-side reset is resent by some browsers on their own).
    await page.route(/\/assets\/[^/]+$/, route => {
      const id = new URL(route.request().url()).pathname.split("/").pop(), plan = state.plans[id];
      if (plan?.[0] !== "drop") return route.continue();
      plan.shift(); state.requests.push(id);
      return route.abort("internetdisconnected");
    });
    // Record any moment a build error or a "needs a fix" status is on screen, however brief.
    await page.addInitScript(() => {
      window.__flashes = [];
      new MutationObserver(() => {
        const alert = [...document.querySelectorAll(".lp-problem[role=alert]")].map(node => node.textContent).join(" | ");
        const status = document.querySelector(".lp-status")?.textContent ?? "";
        if (/(?:has|have) a build error|repair it/i.test(alert + (document.querySelector(".lp-empty")?.textContent ?? "")) || status === "Needs a fix") window.__flashes.push(alert || status);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await page.goto(`${base}/?p=${project}`);
    return { context, page, errors, frame: page.frameLocator("iframe") };
  }
  const flashes = page => page.evaluate(() => window.__flashes);
  async function check(name, fn) {
    reset();
    try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
    catch (error) {
      const line = (String(error.stack).match(/check-preview-assets-browser\.cjs:(\d+)/) ?? [])[1];
      const message = `${String(error.message).split("\n")[0]}${line ? ` (line ${line})` : ""}`;
      results.push({ name, ok: false, error: message }); console.log(`FAIL ${name}: ${message}`);
    }
  }

  try {
    await check("cold open with slow images: calm loading, then the site with its image; never a build error", async () => {
      state.delay[dogImage] = 1500;
      const { context, page, frame, errors } = await open();
      await page.waitForFunction(() => document.querySelector(".lp-status")?.textContent === "Loading preview…");
      assert.match(await page.locator(".lp-empty").innerText(), /Loading the saved website/);
      await frame.locator("h1", { hasText: "Coastal Dog Grooming" }).waitFor();
      assert.match(await frame.locator("img").getAttribute("src"), /^data:/, "the saved image, not a stand-in");
      assert.deepEqual(await flashes(page), [], "no build-error flash while images were loading");
      assert.deepEqual(state.requests, [dogImage]);
      assert.deepEqual(await page.evaluate(() => window.__compiles), ["Coastal Dog Grooming"], "the first compile waited for the images");
      assert.deepEqual(errors, []);
      await context.close();
    });

    await check("warm open of a new version: cached images are reused, no refetch and no error", async () => {
      const { context, page, frame } = await open();
      await frame.locator("h1", { hasText: "Coastal Dog Grooming" }).waitFor();
      await page.evaluate(() => { const p = window.__projects.dog; window.test.set({ ...p, version: 4, files: { ...p.files, title: "Coastal Dog Grooming v4" }, assets: [...p.assets] }); });
      await frame.locator("h1", { hasText: "Coastal Dog Grooming v4" }).waitFor();
      assert.deepEqual(state.requests, [dogImage], "one request in all");
      assert.deepEqual(await flashes(page), []);
      await context.close();
    });

    await check("fast switching projects: a slow earlier project's images never reach the new project's preview", async () => {
      state.delay[dogImage] = 1200;
      const { context, page, frame } = await open();
      await page.waitForTimeout(100);
      await page.evaluate(() => window.test.open("cat"));
      await frame.locator("h1", { hasText: "Harbour Cats" }).waitFor();
      await page.waitForTimeout(1600);
      assert.equal(await frame.locator("h1").innerText(), "Harbour Cats", "still the project that was opened last");
      assert.equal(await page.evaluate(() => window.__compiles.includes("Coastal Dog Grooming")), false, "the abandoned project never compiled");
      assert.deepEqual(await flashes(page), []);
      await context.close();
    });

    await check("fast switching versions: an older compile that finishes later never replaces the newer preview", async () => {
      const { context, page, frame } = await open();
      await frame.locator("h1", { hasText: "Coastal Dog Grooming" }).waitFor();
      await page.evaluate(() => {
        window.__compileDelay = { "Older v5": 1200 };
        const p = window.__projects.dog;
        window.test.set({ ...p, version: 5, files: { ...p.files, title: "Older v5" } });
        setTimeout(() => window.test.set({ ...p, version: 6, files: { ...p.files, title: "Newer v6" } }), 400);
      });
      await frame.locator("h1", { hasText: "Newer v6" }).waitFor();
      await page.waitForTimeout(1500);
      assert.equal(await frame.locator("h1").innerText(), "Newer v6");
      assert.deepEqual(await flashes(page), []);
      await context.close();
    });

    await check("a genuinely missing image: one request, an actionable message naming it, no retry button", async () => {
      state.plans[dogImage] = [{ status: 404 }];
      const { context, page } = await open();
      const panel = page.locator(".lp-problem[role=alert]");
      await panel.waitFor();
      assert.match(await panel.innerText(), /artwork\/coastal-dog\.webp isn't in this project's saved images/);
      assert.match(await panel.innerText(), /Upload it in Code or change the reference/);
      assert.equal(await panel.getByRole("button", { name: "Load images again" }).count(), 0, "retrying cannot find a missing image");
      assert.equal(await page.locator(".lp-status").innerText(), "Images unavailable");
      assert.deepEqual(state.requests, [dogImage], "a 404 is not retried");
      await context.close();
    });

    await check("a denied image: says so, is not retried and is not called a build error", async () => {
      state.plans[dogImage] = [{ status: 403 }];
      const { context, page } = await open();
      const panel = page.locator(".lp-problem[role=alert]");
      await panel.waitFor();
      assert.match(await panel.innerText(), /isn't available to this account/);
      assert.doesNotMatch(await panel.innerText(), /build error/i);
      assert.deepEqual(state.requests, [dogImage]);
      await context.close();
    });

    await check("passing failures (503, 503) are retried within the bound and the site appears with no error", async () => {
      state.plans[dogImage] = [{ status: 503 }, { status: 503 }];
      const { context, page, frame } = await open();
      await frame.locator("h1", { hasText: "Coastal Dog Grooming" }).waitFor();
      assert.deepEqual(state.requests, [dogImage, dogImage, dogImage], "three attempts in all");
      assert.deepEqual(await flashes(page), []);
      await context.close();
    });

    await check("a dropped connection: after the bounded retries it says it's a loading problem; Load images again recovers", async () => {
      state.plans[dogImage] = ["drop", "drop", "drop"];
      const { context, page, frame } = await open();
      const panel = page.locator(".lp-problem[role=alert]");
      await panel.waitFor({ timeout: 20_000 }).catch(error => { throw new Error(`${error.message.split("\n")[0]}; requests so far: ${state.requests.length}`); });
      assert.match(await panel.innerText(), /couldn't be loaded \(connection problem\)/);
      assert.match(await panel.innerText(), /This is a loading problem, not a build error/);
      assert.equal(state.requests.length, 3, "three attempts in all");
      assert.deepEqual(await flashes(page), [], "never presented as a build error");
      state.plans[dogImage] = [];
      await panel.getByRole("button", { name: "Load images again" }).click();
      await frame.locator("h1", { hasText: "Coastal Dog Grooming" }).waitFor();
      assert.equal(await page.locator(".lp-problem[role=alert]").count(), 0);
      await context.close();
    });

    await check("reload after a temporary network failure recovers the saved site", async () => {
      state.plans[dogImage] = ["drop", "drop", "drop"];
      const { context, page, frame } = await open();
      await page.locator(".lp-problem[role=alert]").waitFor();
      state.plans[dogImage] = [];
      await page.reload();
      await frame.locator("h1", { hasText: "Coastal Dog Grooming" }).waitFor();
      assert.deepEqual(await flashes(page), []);
      await context.close();
    });

    await check("a genuinely broken import (no such image in the project) still reports a real build error", async () => {
      const { context, page } = await open("broken");
      const panel = page.locator(".lp-problem[role=alert]");
      await panel.waitFor();
      assert.match(await panel.innerText(), /Version 4 has a build error/);
      assert.match(await panel.innerText(), /Cannot find "\.\/artwork\/nope\.webp"/);
      assert.equal(await page.locator(".lp-status").innerText(), "Needs a fix");
      assert.deepEqual(state.requests, [], "nothing to load");
      await context.close();
    });
    assert.deepEqual(state.foreign, [], "no request left the fixture");
  } finally { await browser.close(); server.close(); }
  const failed = results.filter(result => !result.ok);
  if (failed.length) { console.log(`\n${failed.length} mounted preview asset checks failed.`); process.exitCode = 1; }
  else console.log(`\n${results.length} mounted preview asset checks passed (${engineLabel}, routed API, nothing built or published).`);
}
main().catch(error => { console.error(error); process.exit(1); });

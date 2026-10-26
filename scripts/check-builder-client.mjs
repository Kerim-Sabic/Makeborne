// Real mounted React checks, with provider/API responses mocked. No AI calls.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const fixture = `
import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
import LivePreview from './src/components/live-preview';import{useBuilderOperation}from'./src/components/use-builder-operation';
function App(){
 const[files,setFiles]=useState({'src/App.tsx':'dog;'+ 'x'.repeat(100),'src/style.css':'red'});
 const[accountId,setAccount]=useState('11111111-1111-4111-8111-111111111111');
 const operation=useBuilderOperation({accountId,workspaceId:'22222222-2222-4222-8222-222222222222',artifactId:'33333333-3333-4333-8333-333333333333'});
 useEffect(()=>{window.test={setFiles,setAccount,...operation};},[operation,setFiles,setAccount]);
 return <><LivePreview files={files} assets={[]} scope={{accountId,workspaceId:'w',artifactId:'a'}}/>
 <output id="operation">{JSON.stringify({operation:operation.operation,ready:operation.ready,previous:operation.hasPrevious,checking:operation.checking})}</output></>;
}createRoot(document.getElementById('root')).render(<App/>);`;
const bundled = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "isolated-fixture", setup(builder) {
  builder.onResolve({ filter: /browser-bundler|cloud-api/ }, args => ({ path: args.path, namespace: "mock" }));
  builder.onLoad({ filter: /browser-bundler/, namespace: "mock" }, () => ({ contents: `export async function bundleProject(files){await new Promise(r=>setTimeout(r,40));if(files['src/style.css']==='broken')return{ok:false,error:'Fixture CSS error'};return{ok:true,html:'<html><body><h1>'+files['src/App.tsx'].slice(0,3)+'</h1><style>h1{color:'+files['src/style.css']+'}</style></body></html>'}}`, loader: "js" }));
  builder.onLoad({ filter: /cloud-api/, namespace: "mock" }, () => ({ contents: "export async function readCloudImage(){throw new Error('No assets requested')}", loader: "js" }));
  // Stylesheets imported through the alias (live-preview imports @/app/visual-editor.css) are not under test here.
  builder.onResolve({ filter: /^@\/.*\.css$/ }, args => ({ path: args.path, namespace: "empty-css" }));
  builder.onLoad({ filter: /.*/, namespace: "empty-css" }, () => ({ contents: "", loader: "js" }));
  builder.onResolve({ filter: /^@\// }, args => ({ path: resolve("src", args.path.slice(2) + ".ts") }));
} }] });
const server = createServer((request, response) => {
  if (request.url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundled.outputFiles[0].contents); }
  else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>'); }
});
await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  const snapshot = { id: "44444444-4444-4444-8444-444444444444", revision: 1, kind: "build", effort: "medium", authorizedCredits: 50, chargedCredits: 50, reservedCredits: 0, remainingCredits: 0, maximumAdditionalCredits: 50, status: "paused", pendingKind: "continuation", lastVersion: 1, canContinue: true, recoverable: false, expiresAt: "2026-10-14T00:00:00Z" };
  const requests = []; let denyAuthorization = true; let delayedGet;
  await page.route("**/api/build/operations**", async route => {
    const request = route.request(); const body = request.postDataJSON(); requests.push({ method: request.method(), body, url: request.url() });
    if (request.method() === "PATCH" && denyAuthorization) { denyAuthorization = false; await route.fulfill({ status: 503, json: { error: { message: "Fixture lost response" } } }); return; }
    if (request.method() === "GET" && delayedGet) { const wait = delayedGet; delayedGet = null; await wait; }
    await route.fulfill({ status: 200, json: { operation: request.method() === "PATCH" ? { ...snapshot, revision: 2, authorizedCredits: 100, remainingCredits: 50 } : snapshot, result: { version: 1, charged: 50, changed: true, finished: false }, recovery: null } });
  });
  await page.goto(base); await page.waitForFunction(() => window.test?.ready);
  const preview = page.frameLocator('iframe[title="Website preview"]');
  await preview.locator("h1").waitFor(); assert.equal(await preview.locator("h1").innerText(), "dog");
  await page.evaluate(() => window.test.setFiles({ "src/App.tsx": "cat;" + "x".repeat(100), "src/style.css": "red" }));
  await preview.locator("h1").filter({ hasText: "cat" }).waitFor();
  await page.evaluate(() => window.test.setFiles({ "src/App.tsx": "cat;" + "x".repeat(100), "src/style.css": "tan" }));
  await page.waitForFunction(() => document.querySelector("iframe").srcdoc.includes("color:tan"));
  await page.evaluate(() => window.test.setFiles({ "src/App.tsx": "bad;" + "x".repeat(100), "src/style.css": "broken" }));
  await page.getByRole("alert").waitFor(); assert.equal(await preview.locator("h1").innerText(), "cat", "Last good render survives build failure");
  assert.equal(requests.length, 0, "Fresh render makes no operation/provider request");
  const intent = await page.evaluate(() => window.test.begin()); assert(intent.actionKey && intent.stepKey);
  await page.evaluate(value => window.test.observe(value), snapshot); await page.waitForFunction(() => window.test.operation?.id);
  assert.deepEqual(await page.evaluate(() => Object.values(sessionStorage).map(JSON.parse)), [{ actionKey: intent.actionKey, id: snapshot.id }], "Device metadata contains only identity");
  await page.evaluate(async value => { await window.test.authorize(value).catch(() => null); await window.test.authorize(value); }, snapshot);
  const authorizations = requests.filter(request => request.method === "PATCH");
  assert.equal(authorizations.length, 2); assert.deepEqual(authorizations[0].body, authorizations[1].body, "Ambiguous retry retains one authorization key");
  assert.equal(authorizations[0].body.additionalCredits, 50); assert.equal(authorizations[0].body.acknowledged, true);
  const beforeReload = requests.length; await page.reload(); await page.waitForFunction(() => window.test?.operation?.id);
  assert(requests.slice(beforeReload).every(request => request.method === "GET"), "Reload only checks durable status, never creates generation or spending consent");
  let releaseOldAction; delayedGet = new Promise(resolveWait => { releaseOldAction = resolveWait; });
  await page.evaluate(() => { void window.test.refresh(); });
  await page.waitForFunction(() => window.test.checking);
  const nextIntent = await page.evaluate(() => window.test.begin());
  releaseOldAction(); await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.test.operation), null, "Old action response cannot populate a newer request on the same artifact");
  assert.deepEqual(await page.evaluate(() => Object.values(sessionStorage).map(JSON.parse)), [{ actionKey: nextIntent.actionKey }]);
  await page.evaluate(value => window.test.observe(value), { ...snapshot, id: "66666666-6666-4666-8666-666666666666" });
  let release; delayedGet = new Promise(resolveWait => { release = resolveWait; });
  await page.evaluate(() => { void window.test.refresh(); });
  await page.waitForFunction(() => window.test.checking);
  await page.evaluate(() => window.test.setAccount("55555555-5555-4555-8555-555555555555"));
  await page.waitForFunction(() => !window.test.operation && !window.test.previous);
  release(); await page.waitForTimeout(100); assert.equal(await page.evaluate(() => window.test.operation), null, "Old account response cannot populate a new account");
  assert.deepEqual(errors, []);
  console.log("PASS: mounted preview middle/style edits, failed-render retention, identity-only recovery, no POST on reload, idempotent consent retry, old-action and account-response isolation (8 groups)");
} finally { await browser.close(); await new Promise(resolveClose => server.close(resolveClose)); }

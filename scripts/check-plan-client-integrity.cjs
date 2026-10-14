/* eslint-disable @typescript-eslint/no-require-imports -- Local mounted React fixture with mocked HTTP only. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright");
const out = path.resolve("work/plan-client-integrity");
const plan = title => ({ kind: "new_site", title, summary: "A clear site", goal: "Enquiries", audience: "Visitors", positioning: "Thoughtful",
  pages: [{ name: "Home", path: "/", purpose: "Explain", sections: [{ name: "Hero", purpose: "Introduce", content: "Hello" }] }],
  design: { concept: "Minimal", typography: { display: "serif", body: "sans-serif", rationale: "Contrast" },
    palette: [{ name: "Ink", hex: "#111111", role: "Text" }, { name: "Paper", hex: "#FFFFFF", role: "Background" }, { name: "Accent", hex: "#AA3300", role: "Buttons" }],
    layout: ["Grid"], imagery: "Photography", signatureInteraction: "Reveal" }, changes: [], questions: [], assumptions: [] });
const stored = (title, revision = 1, status = "draft") => ({ plan: plan(title), revision, status, basedOnVersion: 0, charged: 3 });
const view = (title, revision = 1, status = "draft") => ({ stored: stored(title, revision, status), persisted: true });
const runId = "22222222-2222-4222-8222-222222222222";
const operation = { id: "11111111-1111-4111-8111-111111111111", revision: 2, kind: "plan", effort: "medium", authorizedCredits: 10,
  chargedCredits: 3, reservedCredits: 0, remainingCredits: 7, maximumAdditionalCredits: 0, status: "active", pendingKind: null,
  lastVersion: 0, canContinue: false, recoverable: false, expiresAt: "2030-01-01T00:00:00Z" };
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "entry.tsx"), `
import React, {useState} from "react"; import {createRoot} from "react-dom/client";
import {usePlanMode} from "../../src/components/use-plan-mode";
const w = window as any; w.requests=[]; w.events=[];
w.fetch=(url:any, init:any={})=>new Promise(resolve=>w.requests.push({url:String(url),method:init.method||"GET",body:init.body?JSON.parse(init.body):null,headers:init.headers,resolve}));
w.respond=(index:number, body:any, status=200)=>w.requests[index].resolve(new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}}));
w.stream=(index:number, events:any[])=>w.requests[index].resolve(new Response(events.map(event=>"data: "+JSON.stringify(event)+"\\n\\n").join(""),{headers:{"Content-Type":"text/event-stream"}}));
const callbacks={onText:(v:any)=>w.events.push(["text",v]),onStatus:(v:any)=>w.events.push(["status",v]),onCredits:(v:any)=>w.events.push(["credits",v]),onPlan:(v:any)=>w.events.push(["plan",v]),onDone:(v:any)=>w.events.push(["done",v]),onError:(v:any)=>w.events.push(["error",v])};
function App(){const [scope,setScope]=useState({accountId:"account-a",workspaceId:"workspace-a",artifactId:"artifact-a"});
 const hook=usePlanMode(scope);w.hook=hook;w.scope=setScope;
 w.run=()=>{w.runDone=false;void hook.run({turnId:"run-plan",message:"Make a plan",effort:"medium",expectedVersion:0,attachments:[],revise:hook.active?.stored.plan??null},callbacks).finally(()=>w.runDone=true)};
 return <div>{hook.active?.stored.plan.title??"No plan"}</div>;
} const root=createRoot(document.getElementById("root")!);w.unmount=()=>root.unmount();root.render(<App/>);`);

(async () => {
  await require("esbuild").build({ entryPoints: [path.join(out, "entry.tsx")], bundle: true, outfile: path.join(out, "bundle.js"), platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent" });
  const server = http.createServer((req, res) => { if (req.url === "/bundle.js") { res.setHeader("content-type", "application/javascript"); res.end(fs.readFileSync(path.join(out, "bundle.js"))); }
    else { res.setHeader("content-type", "text/html"); res.end('<div id="root"></div><script src="/bundle.js"></script>'); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const fresh = async (initial = view("Initial", 4)) => {
      const page = await browser.newPage(); await page.clock.install();
      await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.requests.length === 1);
      await page.evaluate(body => window.respond(0, body), initial);
      if (initial.stored?.plan?.pages && initial.stored.status !== "built") await page.waitForFunction(() => window.hook.active !== null);
      else await page.evaluate(() => new Promise(resolve => queueMicrotask(resolve)));
      return page;
    };
    const edit = async (page, title) => page.evaluate(value => window.hook.edit(value), plan(title));
    const tick = async page => { await page.clock.runFor(710); };
    const calls = page => page.evaluate(() => window.requests.map(({ url, method, body, headers }) => ({ url, method, body, headers })));
    const put = async (page, index, title, revision, status = "draft") => { await page.evaluate(({ index, body }) => window.respond(index, body), { index, body: view(title, revision, status) }); };
    const state = page => page.evaluate(() => window.hook.active);

    {
      const p = await fresh(); await edit(p, "First edit"); await tick(p);
      await edit(p, "Latest edit"); await tick(p);
      assert.equal((await calls(p)).length, 2, "overlapping saves must be serialized");
      await put(p, 1, "First edit", 5); await p.waitForFunction(() => window.requests.length === 3);
      assert.equal((await state(p)).stored.plan.title, "Latest edit");
      assert.equal((await state(p)).save, "saving");
      assert.equal((await calls(p))[1].body.expectedRevision, 4);
      assert.equal((await calls(p))[2].body.expectedRevision, 5);
      await put(p, 2, "Latest edit", 6); await p.waitForFunction(() => window.hook.active.save === "saved");
      assert.equal((await state(p)).stored.revision, 6); await p.close();
      console.log("PASS mounted plan: serialized saves retain newest text and chain own authoritative revisions");
    }
    {
      const p = await fresh(); await edit(p, "Unsaved first"); await tick(p); await edit(p, "Unsaved latest"); await tick(p);
      await p.evaluate(() => window.respond(1, { error: { message: "Plan changed" } }, 409));
      await p.waitForFunction(() => window.hook.active.save === "error");
      assert.equal((await state(p)).stored.plan.title, "Unsaved latest"); assert.equal((await state(p)).stored.revision, 4);
      await edit(p, "Still local"); await tick(p); assert.equal((await calls(p)).length, 2); await p.close();
      console.log("PASS mounted plan: conflict retains unsaved text without rebasing or retrying stale edits");
    }
    {
      const p = await fresh(); await edit(p, "Dispatched"); await tick(p); await edit(p, "Pending");
      await p.evaluate(() => window.run()); await tick(p); assert.equal((await calls(p)).length, 2);
      await put(p, 1, "Dispatched", 5); await p.waitForFunction(() => window.requests.some(r => r.method === "POST"));
      const requests = await calls(p); assert.equal(requests[2].body.expectedRevision, 5); assert.equal(requests[2].body.previousPlan.title, "Pending");
      await p.evaluate(body => window.stream(2, [{ type: "plan", ...body }, { type: "done", charged: 3 }]), view("Generated", 6));
      await p.waitForFunction(() => window.runDone); await tick(p);
      assert.equal((await state(p)).stored.plan.title, "Generated"); assert.equal((await calls(p)).length, 3); await p.close();
      console.log("PASS mounted plan: new generation waits for dispatched save and cancels pending autosave");
    }
    {
      const p = await fresh(); await edit(p, "Dispatched before run"); await tick(p);
      await p.evaluate(() => window.run()); await edit(p, "Edited while waiting");
      await put(p, 1, "Dispatched before run", 5); await p.waitForFunction(() => window.requests.length === 3);
      await p.evaluate(body => window.stream(2, [{ type: "plan", ...body }, { type: "done", charged: 3 }]), view("AI after waiting", 6));
      await p.waitForFunction(() => window.runDone);
      assert.equal((await state(p)).stored.plan.title, "Edited while waiting");
      assert.equal((await state(p)).stored.revision, 5); assert.equal((await state(p)).save, "error"); await p.close();
      console.log("PASS mounted plan: edits made while generation waits for a manual save retain their own revision");
    }
    {
      const p = await fresh(); await edit(p, "Saving valid edit"); await tick(p);
      await p.evaluate(value => window.hook.edit({ ...value, title: "" }), plan("Invalid"));
      await put(p, 1, "Saving valid edit", 5); await tick(p);
      assert.equal((await state(p)).stored.plan.title, ""); assert.equal((await state(p)).save, "error");
      assert.equal((await state(p)).stored.revision, 5); assert.equal((await calls(p)).length, 2); await p.close();
      console.log("PASS mounted plan: save acknowledgement preserves newer invalid input and its error state");
    }
    {
      const p = await fresh(); await edit(p, "Pending old project");
      await p.evaluate(() => window.scope({ accountId: "account-a", workspaceId: "workspace-a", artifactId: "artifact-b" }));
      await p.waitForFunction(() => window.requests.length === 2); await tick(p);
      assert.equal(await state(p), null); assert.equal((await calls(p)).length, 2);
      await p.evaluate(body => window.respond(1, body), view("New project", 12)); await p.waitForFunction(() => window.hook.active?.stored.revision === 12);
      await p.evaluate(() => window.run()); await p.waitForFunction(() => window.requests.length === 3);
      await p.evaluate(() => window.scope({ accountId: "account-a", workspaceId: "workspace-a", artifactId: "artifact-c" }));
      await p.waitForFunction(() => window.requests.length === 4);
      await p.evaluate(body => window.respond(3, body), view("Third project", 30)); await p.waitForFunction(() => window.hook.active?.stored.revision === 30);
      await p.evaluate(body => window.stream(2, [{ type: "plan", ...body }, { type: "done", charged: 3 }]), view("Stale generated", 13));
      await tick(p); assert.equal((await state(p)).stored.plan.title, "Third project");
      assert.equal(await p.evaluate(() => window.events.length), 0); await p.close();
      console.log("PASS mounted plan: artifact switch cancels timers and ignores prior generation events and callbacks");
    }
    {
      for (const initial of [{ stored: null }, view("Built", 8, "built")]) {
        const p = await fresh(initial); assert.equal(await state(p), null);
        await p.evaluate(() => window.run()); await p.waitForFunction(() => window.requests.length === 2);
        assert.equal((await calls(p))[1].body.expectedRevision, initial.stored?.revision ?? 0); await p.close();
      }
      const p = await fresh({ stored: { plan: { title: "Invalid" }, revision: 2 } });
      await p.evaluate(() => window.run()); await p.waitForFunction(() => window.runDone);
      assert.equal(await state(p), null); assert.equal((await calls(p)).length, 1); await p.close();
      console.log("PASS mounted plan: POST uses confirmed absence or built-plan revision; malformed initial state fails closed");
    }
    {
      const p = await fresh(); await p.evaluate(() => window.run()); await p.waitForFunction(() => window.requests.length === 2);
      await p.evaluate(() => window.stream(1, [])); await p.waitForFunction(() => window.requests.length === 3);
      const recovery = { runId: "22222222-2222-4222-8222-222222222222", candidate: { stored: stored("Retained plan", 5) } };
      await p.evaluate(body => window.respond(2, body), { operation: { ...operation, recoverable: true }, result: { charged: 3 }, recovery });
      await p.waitForFunction(() => window.runDone && window.hook.recoverablePlan !== null);
      assert.equal((await state(p)).save, "local");
      assert.equal(await p.evaluate(() => window.events.filter(e => e[0] === "done").length), 0);
      await p.evaluate(() => { window.recovered = false; void window.hook.recoverPlan(0).then(() => window.recovered = true); });
      await p.waitForFunction(() => window.requests.length === 4);
      const request = (await calls(p))[3]; assert.equal(request.method, "POST"); assert.equal(request.body.acknowledged, true); assert.equal(request.body.runId, recovery.runId);
      await p.evaluate(body => window.respond(3, body), { operation, result: { runId, charged: 3, ...view("Retained plan", 6) }, recovery: null });
      await p.waitForFunction(() => window.recovered);
      assert.equal((await state(p)).save, "saved"); assert.equal((await state(p)).stored.revision, 6); await p.close();
      console.log("PASS mounted plan: retained candidate is previewed locally and becomes saved only after explicit recovery acknowledgement");
    }
    {
      const p = await fresh(); await p.evaluate(() => window.run()); await p.waitForFunction(() => window.requests.length === 2);
      await edit(p, "Edited during generation");
      await p.evaluate(body => window.stream(1, [{ type: "plan", ...body }, { type: "done", charged: 3 }]), view("AI result", 5));
      await p.waitForFunction(() => window.runDone); await tick(p);
      assert.equal((await state(p)).stored.plan.title, "Edited during generation"); assert.equal((await state(p)).stored.revision, 4);
      assert.equal((await state(p)).save, "error"); assert.equal((await calls(p)).length, 2); await p.close();
      console.log("PASS mounted plan: newer edits survive incoming generated plan without inheriting its revision");
    }
    {
      const p = await fresh(); await edit(p, "Old account edit"); await tick(p);
      await p.evaluate(() => window.scope({ accountId: "account-b", workspaceId: "workspace-a", artifactId: "artifact-a" }));
      await p.waitForFunction(() => window.requests.length === 3); assert.equal(await state(p), null);
      await p.evaluate(body => window.respond(2, body), view("Other account", 20)); await p.waitForFunction(() => window.hook.active?.stored.revision === 20);
      await put(p, 1, "Old account edit", 5); await tick(p); assert.equal((await state(p)).stored.plan.title, "Other account");
      await edit(p, "Cancelled pending"); await p.evaluate(() => window.unmount()); await tick(p); assert.equal((await calls(p)).length, 3); await p.close();
      console.log("PASS mounted plan: account switch isolates in-flight responses; unmount cancels pending autosave");
    }
    {
      const p = await fresh(); await edit(p, "Current draft");
      await p.evaluate(value => window.hook.markBuilt(value), plan("Initial")); await tick(p);
      assert.equal((await calls(p))[1].body.status, "draft");
      await put(p, 1, "Current draft", 5); await p.waitForFunction(() => window.hook.active.save === "saved");
      await p.evaluate(value => window.hook.markBuilt(value), plan("Current draft")); await p.waitForFunction(() => window.requests.length === 3);
      assert.equal((await calls(p))[2].body.expectedRevision, 5); assert.equal((await state(p)).stored.status, "draft");
      await put(p, 2, "Current draft", 6, "built"); await p.waitForFunction(() => window.hook.active.stored.status === "built"); await p.close();
      console.log("PASS mounted plan: build completion cannot mark newer draft built; built status waits for CAS acknowledgement");
    }
    {
      const p = await fresh(); await p.evaluate(() => window.run()); await p.waitForFunction(() => window.requests.length === 2);
      await p.evaluate(() => window.stream(1, [{ type: "text", delta: "Planning" }]));
      await p.waitForFunction(() => window.requests.length === 3);
      await p.evaluate(body => window.respond(2, body), { operation, result: { runId, charged: 3, ...view("Paid recorded plan", 5) }, recovery: null });
      await p.waitForFunction(() => window.runDone);
      assert.equal((await state(p)).stored.plan.title, "Paid recorded plan");
      assert.deepEqual(await p.evaluate(() => window.events.filter(e => e[0] === "done")), [["done", 3]]);
      assert.deepEqual(await p.evaluate(() => window.events.filter(e => e[0] === "error")), []);
      assert.equal(await p.evaluate(() => window.hook.operation.status), "active");
      assert.equal(await p.evaluate(() => window.hook.operation.canContinue), false); await p.close();
      console.log("PASS mounted plan: dropped stream restores SQL active/no-pending-step paid plan with its actual charge");
    }
    {
      for (const incomplete of [
        { operation: { ...operation, status: "running" }, result: { runId, charged: 3, ...view("Recorded while running", 5) } },
        { operation, result: { runId, charged: 3, ...view("Local candidate", 5), persisted: false } },
        { operation, result: { charged: 3, ...view("Missing run identity", 5) } },
      ]) {
        const p = await fresh(); await p.evaluate(() => window.run()); await p.waitForFunction(() => window.requests.length === 2);
        await p.evaluate(() => window.stream(1, [])); await p.waitForFunction(() => window.requests.length === 3);
        await p.evaluate(body => window.respond(2, body), { ...incomplete, recovery: null });
        await p.waitForFunction(() => window.runDone);
        assert.equal(await p.evaluate(() => window.events.filter(e => e[0] === "done").length), 0);
        assert.equal(await p.evaluate(() => window.events.filter(e => e[0] === "error").length), 1); await p.close();
      }
      console.log("PASS mounted plan: running, unpersisted, or unidentified recorded results never claim successful completion");
    }
    {
      const p = await fresh(); await p.evaluate(() => window.run()); await p.waitForFunction(() => window.requests.length === 2);
      await p.evaluate(() => window.stream(1, [{ type: "plan", stored: { plan: { title: "Malformed" } }, persisted: true }]));
      await p.waitForFunction(() => window.requests.length === 3);
      await p.evaluate(body => window.respond(2, body), { operation, result: { charged: 3, stored: { plan: { title: "Malformed" } } }, recovery: null });
      await p.waitForFunction(() => window.runDone);
      assert.equal((await state(p)).stored.plan.title, "Initial");
      assert.equal(await p.evaluate(() => window.events.filter(e => e[0] === "done").length), 0);
      assert.equal(await p.evaluate(() => window.events.filter(e => e[0] === "error").length), 1); await p.close();
      console.log("PASS mounted plan: malformed stream/status plans never render or fabricate zero-charge success");
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

/* eslint-disable @typescript-eslint/no-require-imports -- Mounted LiveBuilder + PlanCard in Chromium (audit M08 explicit intent): stale-base refusal keeps the text, pending text survives reload without resending, Undo restores as a new version, a picked element is bound to the file it was picked from, and Build approves exactly the saved plan revision and effort once. Local HTTP/SSE fixture with fictional data; no provider, database, cloud or paid call. Run: node scripts/check-edit-intent-browser.cjs [screenshot-dir] */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, args: engineArgs, collectPageErrors } = require("./browser-engine.cjs"), { createServer } = require("node:http");
const ids = { actor: "11111111-1111-4111-8111-111111111111", workspace: "22222222-2222-4222-8222-222222222222", artifact: "33333333-3333-4333-8333-333333333333", operation: "44444444-4444-4444-8444-444444444444", run: "55555555-5555-4555-8555-555555555555" };
const shots = engineArgs[0] ? path.resolve(engineArgs[0]) : null;
const fixture = `import React, { useState } from "react"; import { createRoot } from "react-dom/client"; import LiveBuilder from "./src/components/live-builder";
const SOURCE = "export default function App() { return <h1>Hello</h1>; }";
function Host() {
  const [version, setVersion] = useState(Number(new URLSearchParams(location.search).get("v") ?? 1));
  const [dirty, setDirty] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const pick = source => setPrefill({ key: crypto.randomUUID(), text: 'Change the <h1> "Hello" in src/App.tsx (line 1): ', target: { path: "src/App.tsx", line: 1, label: 'Heading "Hello" on Home (/)', source, version } });
  return <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
    <p data-testid="host">Host version {version}</p>
    <button type="button" onClick={() => setDirty(value => !value)}>Toggle dirty draft</button>
    <button type="button" onClick={() => setVersion(value => value + 1)}>Save elsewhere</button>
    <button type="button" onClick={() => pick("export default function App() { return <h1>Old</h1>; }")}>Pick stale element</button>
    <button type="button" onClick={() => pick(SOURCE)}>Pick current element</button>
    <LiveBuilder accountId="${ids.actor}" workspaceId="${ids.workspace}" artifactId="${ids.artifact}" version={version} history={[]} baseFiles={{ "src/App.tsx": SOURCE }} baseAssets={[]} defaultEffort="light" kind="website" prefill={prefill} brandKit="Fictional Co" autoStart={new URLSearchParams(location.search).get("auto")}
      onLive={() => {}} onSaved={async () => { const value = await fetch("/fixture/version").then(response => response.json()); setVersion(value.version); }}
      undoBlocked={dirty ? "Save or resolve the current draft before undoing." : null}
      onUndo={change => { if (version !== change.to) return "Newer version"; window.__undo = [...(window.__undo ?? []), change]; fetch("/fixture/restore", { method: "POST", body: JSON.stringify(change) }).then(response => response.json()).then(value => setVersion(value.version)); return null; }} />
  </div>;
}
createRoot(document.getElementById("root")).render(<Host />);`;
const plan = { kind: "edit", title: "Fictional Atelier refresh", summary: "Sharper hero and a city answer.", goal: "Book a consultation", audience: "Homeowners", positioning: "Calm craft",
  pages: [{ name: "Home", path: "/", purpose: "Win trust", sections: [{ name: "Hero", purpose: "Introduce", content: "Fictional studio" }] }],
  design: { concept: "Quiet", typography: { display: "Fraunces", body: "Inter", rationale: "Contrast" }, palette: [{ name: "Paper", hex: "#FFFFFF", role: "background" }, { name: "Ink", hex: "#111111", role: "text" }, { name: "Clay", hex: "#B4532A", role: "accent" }], layout: ["Split"], imagery: "Rooms", signatureInteraction: "Reveal" },
  changes: [{ change: "Make the hero headline larger", files: ["src/App.tsx"] }], questions: ["Which city do you work in?"], assumptions: [] };
const operation = extra => ({ id: ids.operation, revision: 1, kind: "build", effort: "light", authorizedCredits: 20, chargedCredits: 0, reservedCredits: 20, remainingCredits: 0, maximumAdditionalCredits: 0, status: "running", cancelRequested: false, pendingKind: null, lastVersion: 1, canContinue: false, recoverable: false, expiresAt: "2030-01-01T00:00:00Z", ...extra });

async function main() {
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env": "{}" }, plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /design-capture$|cloud-api$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: 'export async function captureDesign(){throw Error("Unexpected capture")}export async function readCloudImage(){throw Error("Unexpected image")}', loader: "js" }));
    b.onResolve({ filter: /^@\// }, args => { const base = path.resolve("src", args.path.slice(2)); return { path: fs.existsSync(base) ? base : fs.existsSync(base + ".tsx") ? base + ".tsx" : base + ".ts" }; });
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  } }] });
  const css = ["src/app/globals.css", "src/app/live-builder.css", "src/app/plan-card.css"].map(file => fs.readFileSync(file, "utf8").replace(/@import[^;]+;/g, "")).join("\n");
  let state;
  const json = (res, value, status = 200) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value)); };
  const server = createServer(async (req, res) => { try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (!pathname.startsWith("/api/") && !pathname.startsWith("/fixture/")) { res.setHeader("content-type", pathname === "/fixture.js" ? "text/javascript" : "text/html"); res.end(pathname === "/fixture.js" ? output.outputFiles[0].contents : `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;font:14px sans-serif}*{box-sizing:border-box}${css}</style><div id="root"></div><script src="/fixture.js"></script>`); return; }
    const current = state; let text = ""; for await (const chunk of req) text += chunk; const body = text ? JSON.parse(text) : null;
    if (pathname === "/fixture/version") return json(res, { version: current.version });
    if (pathname === "/fixture/restore") { current.restores.push(body); current.version++; return json(res, { version: current.version }); }
    if (pathname === "/api/credits") return json(res, { available: 500, unlimited: false });
    if (pathname === "/api/build/questions") return json(res, { questions: [] });
    // Account chat history (13b1343): it loads and saves turns; it never starts, stops or charges a build.
    if (pathname === `/api/cloud/workspaces/${ids.workspace}/artifacts/${ids.artifact}/chat`) {
      assert.equal(req.headers["x-makeborne-account"], ids.actor);
      if (req.method === "GET") return json(res, { messages: [], next: null });
      assert.equal(req.method, "POST"); return json(res, { saved: (body?.messages ?? []).map(message => message.id) });
    }
    if (pathname === "/api/build/plan") {
      if (req.method === "GET") return json(res, current.plan ? { stored: current.plan } : { stored: null });
      current.planSaves.push(body);
      await new Promise(resolve => setTimeout(resolve, current.saveDelay ?? 300));
      if (body.expectedRevision !== current.plan.revision) return json(res, { error: { code: "PLAN_REVISION_CONFLICT", message: "The plan changed." } }, 409);
      const changed = JSON.stringify(body.plan) !== JSON.stringify(current.plan.plan) || body.status !== current.plan.status;
      current.plan = { ...current.plan, plan: body.plan, status: body.status, revision: current.plan.revision + (changed ? 1 : 0) };
      return json(res, { stored: current.plan, persisted: true });
    }
    if (pathname === "/api/build/operations") return current.operation ? json(res, { operation: current.operation, result: current.result ?? null, recovery: null }) : json(res, { error: { message: "Not recorded" } }, 404);
    assert.equal(pathname, "/api/build"); assert.equal(req.method, "POST");
    current.builds.push(body);
    const reply = current.reply(body, current);
    if (reply.status) return json(res, reply.body, reply.status);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" }); res.flushHeaders();
    const emit = event => { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`); };
    current.operation = operation({ lastVersion: body.expectedVersion });
    emit({ type: "operation", operation: current.operation });
    if (reply.hold) { current.stream = res; return; }
    current.version = body.expectedVersion + 1;
    current.operation = operation({ status: "completed", reservedCredits: 0, chargedCredits: 1, remainingCredits: 19, lastVersion: current.version });
    current.result = { runId: ids.run, version: current.version, summary: "Made the hero bolder.", charged: 1, changed: true, finished: true };
    emit({ ...current.result, type: "done", operation: current.operation }); res.end();
  } catch (error) { state?.errors.push(String(error.message)); if (!res.headersSent) json(res, { error: { message: "Fixture failed" } }, 500); else res.destroy(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await browserType.launch({ headless: true });
  const failures = [];
  let passed = 0;
  const scenario = async (name, setup, run, viewport = { width: 1100, height: 1000 }, query = "") => {
    state = { version: 1, builds: [], planSaves: [], restores: [], errors: [], plan: null, operation: null, reply: () => ({}), ...setup };
    const current = state, context = await browser.newContext({ viewport }), page = await context.newPage(), errors = [];
    page.setDefaultTimeout(8000); collectPageErrors(page, errors);
    await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => route.abort());
    try {
      await page.goto(base + query); await page.getByRole("textbox", { name: "Message the builder" }).waitFor();
      await run(page, current);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal page scroll");
      assert.deepEqual(errors, []); assert.deepEqual(current.errors, []);
      if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true }); }
      passed++; console.log(`PASS ${name}`);
    } catch (error) { failures.push(name); console.log(`FAIL ${name}: ${error.message.split("\n").slice(0, 6).join(" | ")}`); if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${name}-failed.png`), fullPage: true }).catch(() => undefined); } }
    finally { current.stream?.destroy(); await context.close(); }
  };
  const composer = page => page.getByRole("textbox", { name: "Message the builder" });
  const send = async (page, text) => { await composer(page).fill(text); await page.getByRole("button", { name: "Send", exact: true }).click(); };
  try {
    await scenario("stale-base-refused-text-kept", { version: 2, reply: body => body.expectedVersion === 2 ? {} : { status: 409, body: { error: { code: "VERSION_CONFLICT", message: "This request was written for version 1, but version 2 is now saved. Nothing was sent or charged. Review the latest version, then send your request again." } } } }, async (page, current) => {
      await send(page, "Make the hero bolder");
      await page.getByText("Your request is back in the composer. Nothing was sent or charged for it.").waitFor();
      await page.getByText(/written for version 1, but version 2 is now saved/).first().waitFor({ state: "attached" });
      assert.equal(await composer(page).inputValue(), "Make the hero bolder", "the refused request text is back in the composer");
      await page.getByTestId("host").filter({ hasText: "Host version 2" }).waitFor();
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.getByText("Saved as version 3, from version 2.").waitFor();
      assert.deepEqual(current.builds.map(build => build.expectedVersion), [1, 2], "the resend is an explicit new request on the current version");
      assert.deepEqual(current.builds.map(build => build.approvedMaximum), [20, 20], "each new request names the maximum shown in the composer");
      // The brand note lives in the composer's Request details (13b1343); it is one click away, not on screen by default.
      await page.locator(".lb-request-details > summary").click();
      await page.getByText("Brand kit: Fictional Co · used for this request").waitFor();
      const receipt = page.getByRole("region", { name: "Request receipt" }).last();
      assert.match(await receipt.innerText(), /Sources sent\s+None/, "the receipt names the sources sent (none here)");
      await page.getByText("No source files were sent with this request.").waitFor();
    });
    await scenario("pending-survives-reload-no-resend", { reply: () => ({ hold: true }) }, async (page, current) => {
      await send(page, "Add an FAQ section");
      await page.getByText("Sending “Add an FAQ section” · based on version 1").waitFor();
      await page.getByText("0 / 20 credits", { exact: true }).waitFor();
      current.operation = operation({ status: "completed", reservedCredits: 0, chargedCredits: 0, remainingCredits: 20 });
      current.result = { runId: ids.run, charged: 0, code: "REQUEST_FAILED", message: "Fixture outcome unknown" };
      await page.reload(); await composer(page).waitFor();
      await page.getByText(/may already have been sent: “Add an FAQ section”/).waitFor();
      assert.equal(await composer(page).inputValue(), "", "nothing is restored into the composer on its own");
      await page.getByRole("button", { name: "Put it back in the composer" }).click();
      assert.equal(await composer(page).inputValue(), "Add an FAQ section");
      await composer(page).fill("Add an FAQ section about delivery times");
      await page.reload(); await composer(page).waitFor();
      await page.getByText(/Restored your unsent brief/).waitFor();
      assert.equal(await composer(page).inputValue(), "Add an FAQ section about delivery times", "unsent text survives a reload");
      assert.equal(current.builds.length, 1, "reloads never send the request again");
    });
    await scenario("undo-restores-as-new-version", {}, async (page, current) => {
      await send(page, "Make the hero bolder");
      await page.getByText("Saved as version 2, from version 1.").waitFor();
      const undo = page.getByRole("button", { name: "Undo this change" });
      await page.getByRole("button", { name: "Toggle dirty draft" }).click();
      assert.equal(await undo.isDisabled(), true); await page.getByText("Save or resolve the current draft before undoing.").first().waitFor();
      await page.getByRole("button", { name: "Toggle dirty draft" }).click();
      assert.equal(await undo.isDisabled(), false);
      await undo.dblclick();
      await page.getByText("Restored version 1 as version 3. Version 2 stays in History.").waitFor();
      assert.deepEqual(current.restores, [{ from: 1, to: 2 }], "one restore of the base version, as a new version");
      assert.equal(current.builds.length, 1, "Undo makes no AI call");
    });
    await scenario("undo-refuses-after-newer-save", {}, async page => {
      await send(page, "Make the hero bolder");
      await page.getByText("Saved as version 2, from version 1.").waitFor();
      await page.getByRole("button", { name: "Save elsewhere" }).click();
      await page.getByText("Version 3 was saved after this change. Restore an earlier version from History instead.").waitFor();
      assert.equal(await page.getByRole("button", { name: "Undo this change" }).isDisabled(), true);
    });
    await scenario("picked-element-bound-to-its-file", {}, async (page, current) => {
      await page.getByRole("button", { name: "Pick stale element" }).click();
      // The readable label, with the file and line as the detail underneath.
      await page.waitForFunction(() => { const span = document.querySelector(".lb-target > span"); return span?.textContent === 'Editing Heading "Hello" on Home (/)src/App.tsx (line 1) · selected in version 1' && span.querySelector("small")?.textContent === "src/App.tsx (line 1) · selected in version 1"; });
      await composer(page).press("End"); await composer(page).pressSequentially("bigger");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.getByText(/changed after you selected it/).waitFor();
      assert.equal(current.builds.length, 0, "a changed target is refused before any request");
      assert.match(await composer(page).inputValue(), /bigger$/, "the typed text stays");
      await page.getByRole("button", { name: "Pick current element" }).click();
      await composer(page).press("End"); await composer(page).pressSequentially("bigger");
      current.reply = () => ({ hold: true });
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.getByText("Sending “Change the <h1> \"Hello\" in src/App.tsx (line 1): bigger” · based on version 1 · Heading \"Hello\" on Home (/) · src/App.tsx (line 1)").waitFor();
      await page.getByText("0 / 20 credits", { exact: true }).waitFor();
      assert.equal(current.builds.length, 1); assert.equal(current.builds[0].expectedVersion, 1);
    });
    await scenario("plan-approval-binds-saved-revision-once", { plan: { plan, status: "draft", basedOnVersion: 1, revision: 3, charged: 1 } }, async (page, current) => {
      await page.getByText("Here is the plan we left off with.", { exact: false }).waitFor();
      await page.getByText(/Builds saved plan v3 at .* effort/).waitFor();
      assert.match(await page.locator(".pc-build span").innerText(), /^Estimated ~\d+(–\d+)? · At most 20 credits$/, "estimate and maximum are labelled distinctly");
      // An edit must save before Build is possible; the quote then names the new revision.
      await page.getByRole("button", { name: "Edit site title" }).click();
      await page.getByRole("textbox", { name: "site title" }).fill("Fictional Atelier, edited");
      await page.getByRole("textbox", { name: "site title" }).press("Enter");
      await page.getByText("Saving your edits… Build waits for the saved plan.").waitFor();
      assert.equal(await page.getByRole("button", { name: /Build this plan/ }).isDisabled(), true, "unsaved edits cannot be built");
      await page.getByText(/Builds saved plan v4 at /).waitFor();
      await page.getByRole("radio", { name: /^Medium/ }).click();
      await page.getByText(/Builds saved plan v4 at Medium effort\. Estimated ~\d+(–\d+)? credits .*At most 50 credits/).waitFor();
      assert.match(await page.locator(".pc-approval").innerText(), /Brand kit: Fictional Co./, "the approval names the brand kit");
      await page.getByPlaceholder(/Your answer/).fill("Lisbon");
      current.saveDelay = 150;
      await page.getByRole("button", { name: /Build this plan/ }).dblclick();
      await page.waitForFunction(() => document.body.innerText.includes("Saved as version 2, from version 1."));
      await page.waitForTimeout(300);
      assert.equal(current.builds.length, 1, "a double click sends one build");
      const [buildBody] = current.builds;
      assert.equal(buildBody.planRevision, 5, "the build names the saved revision that includes the answer");
      assert.equal(buildBody.effort, "medium", "the build uses the effort shown in the approval");
      assert.equal(buildBody.approvedMaximum, 50, "the approval is bound to the maximum it showed");
      assert.equal(buildBody.plan.title, "Fictional Atelier, edited");
      assert.ok(buildBody.plan.assumptions.includes("Which city do you work in? → Lisbon"), "the answer is part of the approved plan");
      assert.deepEqual(current.planSaves.slice(0, 2).map(save => save.expectedRevision), [3, 4], "edit and answer were saved before the build");
      assert.ok("actionKey" in buildBody.operation);
    });
    await scenario("plan-approval-refused-retry-is-new-approval", { plan: { plan: { ...plan, questions: [] }, status: "draft", basedOnVersion: 1, revision: 3, charged: 1 },
      reply: (body, current) => current.builds.length === 1 ? { status: 409, body: { error: { code: "PLAN_REVISION_CONFLICT", message: "The plan changed after you approved it (you approved revision 3; the saved plan is revision 4). Nothing was built or charged. Review the saved plan and build again." } } } : { hold: true } }, async (page, current) => {
      await page.getByText(/Builds saved plan v3 at /).waitFor();
      await page.getByRole("button", { name: /Build this plan/ }).click();
      await page.getByText(/you approved revision 3; the saved plan is revision 4/).first().waitFor({ state: "attached" });
      assert.equal(await composer(page).inputValue(), "", "a plan approval never becomes composer text");
      await page.getByRole("button", { name: /Build this plan/ }).click();
      await page.getByText(/· saved plan v3 · .* effort/).waitFor();
      // The line shows as the request leaves; give the request itself time to reach the fixture server (later in WebKit/Firefox).
      for (const until = Date.now() + 3000; current.builds.length < 2 && Date.now() < until;) await new Promise(resolve => setTimeout(resolve, 20));
      await page.waitForTimeout(200);
      assert.equal(current.builds.length, 2); assert.notEqual(current.builds[0].operation.actionKey, current.builds[1].operation.actionKey, "a refused approval is not reused");
    });
    await scenario("handed-over-brief-waits-for-send", {}, async (page, current) => {
      await page.getByText(/Your brief is ready below\. Review it and the maximum, then choose Send to start\. Nothing has been sent\./).waitFor();
      assert.equal(await composer(page).inputValue(), "A fictional bakery site");
      await page.waitForTimeout(400);
      assert.equal(current.builds.length, 0, "a brief handed over from project creation is never sent on load");
      await page.reload(); await composer(page).waitFor(); await page.waitForTimeout(400);
      assert.equal(current.builds.length, 0, "nor on reload");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.getByText("Saved as version 2, from version 1.").waitFor();
      assert.equal(current.builds.length, 1);
    }, undefined, "?auto=A%20fictional%20bakery%20site");
    await scenario("phone-width-intent-controls-fit", { reply: () => ({ hold: true }) }, async page => {
      await page.getByRole("button", { name: "Pick current element" }).click();
      await page.getByText(/Editing Heading "Hello"/).waitFor();
      await composer(page).press("End"); await composer(page).pressSequentially("a much longer instruction that wraps across several lines on a phone");
      // Enter sends: at phone width the focused composer shrinks on blur, which moves the Send button under a mouse press.
      await composer(page).press("Enter");
      await page.getByText(/^Sending “/).waitFor();
    }, { width: 375, height: 812 });
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  console.log(`${passed} mounted edit-intent scenarios passed${failures.length ? `, ${failures.length} failed: ${failures.join(", ")}` : ""}; no paid calls.`);
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });

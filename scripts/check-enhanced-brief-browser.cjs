/* eslint-disable @typescript-eslint/no-require-imports -- Mounted design questions (multi-select sections, colour picker) and the Enhanced brief card in a real browser engine: what each control sends, keyboard use, focus, and no overflow at 320 and 375 px. Local only, no network. Run: node scripts/check-enhanced-brief-browser.cjs [--engine firefox|webkit] */
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), { build } = require("esbuild"), { browserType, engineLabel } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const enhanced = {
  business: "Ovenbird, a sourdough bakery in Leith.", workingName: null, goal: "Visits and pre-orders.", primaryAction: { label: "Pre-order bread", kind: "buy" }, audience: "Neighbours.",
  sections: [{ name: "Hero", anchor: "top", purpose: "Who we are.", include: [] }, { name: "Opening hours", anchor: "hours", purpose: "When we open.", include: [] }],
  tone: "loud", toneWhy: "Food.", imagery: { plan: "illustration", notes: "Drawn loaves.", textInImage: null },
  factsGiven: [], factsMissing: [{ fact: "Opening hours", placeholder: "Example — replace with your hours", example: "Tue–Sat 7:30–15:00" }], constraints: [], answersUsed: [],
};
const fixture = `import React, { useState } from "react"; import { createRoot } from "react-dom/client";
import BriefQuestionsCard from "./src/components/brief-questions-card";
import EnhancedBriefCard from "./src/components/enhanced-brief-card";
import { briefWithAnswers, designAnswers, standardQuestion } from "./src/lib/builder/brief-questions";
const ENHANCED = ${JSON.stringify(enhanced)};
function App() {
  const [view, setView] = useState({ kind: "none", run: 0 });
  window.show = (kind, ids) => { window.events = []; setView(current => ({ kind, ids, run: current.run + 1 })); };
  if (view.kind === "questions") {
    const list = view.ids.map(id => standardQuestion("website", id));
    return <BriefQuestionsCard key={view.run} questions={list} kind="website" planning={false} busy={false} finalLabel="Continue"
      onStart={answers => window.events.push({ type: "start", brief: briefWithAnswers("bakery site", list, answers), design: designAnswers(list, answers) })}
      onSkip={() => window.events.push({ type: "skip" })} />;
  }
  if (view.kind === "none") return null;
  const key = "00000000-0000-4000-8000-0000000000aa";
  const state = view.kind === "ready" ? { status: "ready", key, enhanced: ENHANCED, text: "Business: Ovenbird\\n1. Hero (#top): Who we are.\\n2. Opening hours (#hours): When we open.", charged: 0 }
    : view.kind === "blocked" ? { status: "failed", key: null, charged: 0, blocking: true, message: "AI is paused right now. Nothing was started or charged." }
    : view.kind === "failed" ? { status: "failed", key, charged: 0, message: "Your brief couldn't be improved just now. Nothing was charged. The build can use your own words." }
    : view.kind === "unconfirmed" ? { status: "failed", key, charged: null, message: "Improving your brief didn't finish. The build can use your own words." }
    : view.kind === "checking" ? { status: "checking", key, reason: "unknown", message: "The reply was lost. Checking what happened to your brief's improvement; it will not be run again." }
    : view.kind === "loading" ? { status: "loading", key } : { status: "offer" };
  return <EnhancedBriefCard key={view.run} state={state} design={{ vibe: "warm", sections: ["hours"] }} maximum={50} busy={false}
    onStart={brief => window.events.push({ type: "start", brief })} onOriginal={() => window.events.push({ type: "original" })} onCancel={() => window.events.push({ type: "cancel" })}
    onImprove={() => window.events.push({ type: "improve" })} onStop={() => window.events.push({ type: "stop" })} onCheck={() => window.events.push({ type: "check" })} />;
}
window.events = [];
createRoot(document.getElementById("root")).render(<App />);`;

async function main() {
  const css = fs.readFileSync(path.resolve("src/app/brief-questions.css"), "utf8");
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}" },
    plugins: [{ name: "fixture", setup(b) {
      b.onLoad({ filter: /\.css$/ }, () => ({ contents: `const s = document.createElement("style"); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s);`, loader: "js" }));
      b.onResolve({ filter: /^@\// }, args => ({ path: path.resolve("src", args.path.slice(2) + (args.path.endsWith(".css") ? "" : ".ts")) }));
    } }] });
  const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : "text/html"); res.end(req.url === "/fixture.js" ? output.outputFiles[0].contents : '<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0;padding:16px;font:14px system-ui}.button{min-height:44px}</style><div id="root"></div><script src="/fixture.js"></script>'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await browserType.launch({ headless: true });
  let passed = 0; const pass = name => { passed++; console.log(`PASS ${name}`); };
  try {
    const page = await browser.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => typeof window.show === "function");
    const show = (kind, ids) => page.evaluate(([value, list]) => new Promise(resolve => { window.show(value, list); requestAnimationFrame(() => setTimeout(resolve, 0)); }), [kind, ids]);
    const events = () => page.evaluate(() => window.events);
    const kicker = () => page.locator(".bq-kicker").textContent();

    // Must-have sections: several chips, never auto-advancing, announced; Next moves on.
    await show("questions", ["sections", "colour"]);
    await page.getByRole("button", { name: "Opening hours" }).click();
    await page.getByRole("button", { name: "FAQ" }).click();
    await page.waitForTimeout(450);
    assert.match(await kicker(), /1 of 2/, "a multi-select question stays put after choices");
    assert.equal(await page.getByRole("button", { name: "Opening hours" }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByRole("button", { name: "FAQ" }).getAttribute("aria-pressed"), "true");
    assert.match(await page.locator(".bq-announce").innerText(), /Added FAQ\. 2 chosen\./);
    await page.getByRole("button", { name: "FAQ" }).click();
    assert.equal(await page.getByRole("button", { name: "FAQ" }).getAttribute("aria-pressed"), "false", "a second press removes the chip");
    await page.getByRole("button", { name: "Gallery" }).focus(); await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Next" }).click();
    assert.match(await kicker(), /2 of 2/);
    pass("must-have sections: multi-select by pointer and keyboard, toggles, announces, no auto-advance");

    // Colour: the native picker sets a hex answer; the final button continues to the enhanced brief.
    await page.getByLabel("Pick a colour").fill("#8a2b1f");
    assert.match(await page.locator(".bq-color output").innerText(), /#8a2b1f/i);
    await page.getByRole("button", { name: "Continue" }).click();
    let list = await events();
    assert.equal(list.length, 1); assert.equal(list[0].type, "start");
    assert.match(list[0].brief, /- Must-have sections: Opening hours, Gallery\n- Brand colour: #8a2b1f$/);
    assert.deepEqual(list[0].design, { sections: ["hours", "gallery"], colour: "#8a2b1f" });
    pass("colour picker answers with a hex; answers reach the brief and the design answers; the last button says Continue");

    await show("questions", ["sections", "colour"]);
    await page.getByRole("button", { name: "Opening hours" }).click();
    await page.getByRole("button", { name: "Skip this question" }).click();
    await page.getByRole("button", { name: "Use my logo's colours" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    list = await events();
    assert.doesNotMatch(list[0].brief, /Must-have sections/, "a skipped multi-select never reaches the brief (F04)");
    assert.deepEqual(list[0].design, { logoColours: true });
    pass("skipping a multi-select drops its choices; 'Use my logo's colours' is recorded");

    // Enhanced brief: start, edit, original, cancel; focus and keyboard.
    await show("ready");
    await page.waitForFunction(() => document.activeElement?.textContent === "Improved brief", null, { timeout: 3000 }).catch(() => assert.fail("focus moves to the card's heading"));
    assert.match(await page.locator(".eb").innerText(), /Improving your brief charged 0 credits\./, "the receipt line comes from the action's verified charge");
    assert.match(await page.locator(".eb").innerText(), /Sections[\s\S]*Hero[\s\S]*Opening hours[\s\S]*Shown as placeholders until you add them[\s\S]*Your answers used[\s\S]*Feel: Warm and crafted/);
    await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    await page.getByRole("button", { name: "Start building" }).focus(); await page.keyboard.press("Enter");
    list = await events();
    assert.deepEqual(list, [{ type: "start", brief: { mode: "enhanced", text: "Business: Ovenbird\n1. Hero (#top): Who we are.\n2. Opening hours (#hours): When we open." } }]);
    pass("Start building sends exactly the enhanced brief shown (keyboard)");
    await show("ready");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.id === "eb-text", null, { timeout: 3000 }).catch(() => assert.fail("Edit focuses the text"));
    await page.locator("#eb-text").fill("Business: Ovenbird\n1. Hero (#top): Who we are.\n2. Gift cards (#gifts): In store.");
    await page.getByRole("button", { name: "Start with my edits" }).click();
    list = await events();
    assert.deepEqual(list[0].brief, { mode: "edited", text: "Business: Ovenbird\n1. Hero (#top): Who we are.\n2. Gift cards (#gifts): In store." });
    await show("ready");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Start with my edits" }).click();
    assert.equal((await events())[0].brief.mode, "enhanced", "unchanged text is still the enhanced brief");
    pass("Edit sends the client's edited text as an edited brief; untouched text stays enhanced");
    await show("ready");
    await page.getByRole("button", { name: "Build with my original instead · up to 50 credits" }).click();
    assert.deepEqual(await events(), [{ type: "original" }]);
    assert.doesNotMatch(await page.locator("body").innerText(), /refund/i, "using the original never implies a refund");
    await show("ready");
    await page.getByRole("button", { name: "Cancel" }).click();
    assert.deepEqual(await events(), [{ type: "cancel" }]);
    await show("failed");
    assert.match(await page.locator(".eb").innerText(), /couldn.t be improved just now\. Nothing was charged/);
    await page.getByRole("button", { name: "Start building with my brief · up to 50 credits" }).click();
    assert.deepEqual(await events(), [{ type: "original" }]);
    await show("unconfirmed");
    assert.doesNotMatch(await page.locator(".eb").innerText(), /Nothing was charged/, "no 'nothing was charged' while the charge is unconfirmed");
    assert.match(await page.locator(".eb").innerText(), /still being confirmed/);
    await show("blocked");
    assert.match(await page.locator(".eb").innerText(), /AI is paused right now. Nothing was started or charged./, "the server's own reason is shown");
    assert.equal(await page.getByRole("button", { name: /Start building/ }).count(), 0, "no start that would fail for the same reason");
    await show("loading");
    assert.match(await page.locator(".bq-loading").innerText(), /Improving your brief… \(free\)/);
    await page.getByRole("button", { name: "Stop" }).click();
    assert.deepEqual(await events(), [{ type: "stop" }]);
    pass("Build with my original instead (no refund implied), Cancel, a confirmed failure (nothing charged), an unconfirmed outcome (never 'nothing was charged'), a blocking refusal (its reason, no start) and Stop each do one thing");

    // The explicit choice: nothing is sent until the client picks; improving is labelled free beside building now.
    await show("offer");
    assert.match(await page.locator(".eb").innerText(), /Improving your brief is free and starts nothing paid/);
    await page.getByRole("button", { name: "Improve my brief first · free" }).click();
    assert.deepEqual(await events(), [{ type: "improve" }]);
    await show("offer");
    await page.getByRole("button", { name: "Build with my brief · up to 50 credits" }).click();
    assert.deepEqual(await events(), [{ type: "original" }]);
    await show("checking");
    assert.match(await page.locator(".eb").innerText(), /reply was lost[\s\S]*will not be run again/);
    await page.getByRole("button", { name: "Check again" }).click();
    assert.deepEqual(await events(), [{ type: "check" }]);
    pass("the offer (build now, or 'Improve my brief first · free') and the lost-reply state (check again; never re-run) each do one thing");

    // Phone widths: nothing overflows, actions stay at least 44 px tall.
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 800 });
      for (const [kind, ids] of [["questions", ["sections"]], ["questions", ["colour"]], ["ready"], ["failed"], ["offer"], ["checking"]]) {
        await show(kind, ids);
        const metrics = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth,
          small: [...document.querySelectorAll(".eb-actions button")].filter(button => button.getBoundingClientRect().height < 44).map(button => button.textContent) }));
        assert.ok(metrics.scroll <= metrics.width, `${kind} overflows at ${width}px (${metrics.scroll})`);
        assert.deepEqual(metrics.small, [], `${kind} at ${width}px: actions under 44 px`);
      }
    }
    pass("320 and 375 px: no horizontal overflow; enhanced-brief actions are at least 44 px tall");
  } finally { await browser.close(); server.close(); }
  console.log(`${passed} mounted design-question and enhanced-brief checks passed (${engineLabel}, no network).`);
}
main().catch(error => { console.error(error); process.exit(1); });

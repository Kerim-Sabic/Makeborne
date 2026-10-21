/* eslint-disable @typescript-eslint/no-require-imports -- Mounted BriefQuestionsCard in Chromium (audit F04): the start payload and the composed brief omit skipped answers. Local only. Run: node scripts/check-brief-skip-browser.cjs */
const path = require("node:path"), assert = require("node:assert/strict"), { build } = require("esbuild"), { browserType, engineLabel } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const questions = [
  { id: "tone", topic: "Tone", question: "How should it sound?", why: "Sets the voice.", custom: "e.g. calm and expert", options: [{ value: "warm", label: "Warm" }, { value: "formal", label: "Formal" }] },
  { id: "audience", topic: "Audience", question: "Who is it for?", why: "Shapes the content.", custom: "e.g. local families", options: [{ value: "families", label: "Families" }, { value: "business", label: "Businesses" }] },
];
const fixture = `import React, { useState } from "react"; import { createRoot } from "react-dom/client";
import BriefQuestionsCard from "./src/components/brief-questions-card";
import { briefWithAnswers } from "./src/lib/builder/brief-questions";
const QUESTIONS = ${JSON.stringify(questions)};
function App() {
  const [run, setRun] = useState(0); const [count, setCount] = useState(2);
  window.remount = n => { window.started = []; window.skipped = 0; setCount(n); setRun(value => value + 1); };
  const list = QUESTIONS.slice(QUESTIONS.length - count);
  return <BriefQuestionsCard key={run} questions={list} kind="website" planning={false} busy={false}
    onStart={answers => window.started.push({ answers: JSON.parse(JSON.stringify(answers)), brief: briefWithAnswers("A bakery website.", list, answers) })}
    onSkip={() => { window.skipped++; }} />;
}
window.started = []; window.skipped = 0;
createRoot(document.getElementById("root")).render(<App />);`;

async function main() {
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}" },
    plugins: [{ name: "fixture", setup(b) {
      b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      b.onResolve({ filter: /^@\// }, args => ({ path: path.resolve("src", args.path.slice(2) + (args.path.endsWith(".css") ? "" : ".ts")) }));
    } }] });
  const server = createServer((req, res) => { res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : "text/html"); res.end(req.url === "/fixture.js" ? output.outputFiles[0].contents : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await browserType.launch({ headless: true });
  let passed = 0; const pass = name => { passed++; console.log(`PASS ${name}`); };
  try {
    const page = await browser.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    // React's first render is scheduled after load; some engines run it later than Chromium does.
    await page.waitForFunction(() => typeof window.remount === "function");
    const started = () => page.evaluate(() => window.started);
    const one = async () => { const list = await started(); assert.equal(list.length, 1, JSON.stringify(list)); return list[0]; };
    // Wait for the new card to render before interacting, so actions never reach the previous card.
    const remount = n => page.evaluate(count => new Promise(resolve => { window.remount(count); requestAnimationFrame(() => setTimeout(resolve, 0)); }), n);

    // The audit's two reproductions, on a single (final) question.
    await remount(1);
    await page.getByRole("button", { name: "Families" }).click();
    await page.getByRole("button", { name: "Skip this question" }).click();
    let result = await one();
    assert.deepEqual(result.answers, { audience: {} }); assert.equal(result.brief, "A bakery website.");
    pass("final Skip after choosing an option sends no answer and the brief stays as written");
    await remount(1);
    await page.getByLabel("Or in your own words").fill("Fictional custom audience");
    await page.getByRole("button", { name: "Skip this question" }).click();
    result = await one();
    assert.deepEqual(result.answers, { audience: {} }); assert.doesNotMatch(result.brief, /Fictional custom audience/);
    pass("final Skip after typing a custom answer sends no answer");

    // Controls: ordinary submit, custom Enter, Skip all.
    await remount(1);
    await page.getByRole("button", { name: "Families" }).click();
    await page.getByRole("button", { name: "Start building" }).click();
    result = await one();
    assert.deepEqual(result.answers, { audience: { option: "families", custom: "" } }); assert.match(result.brief, /- Audience: Families/);
    pass("Start building with a chosen option sends it and the brief follows it");
    await remount(1);
    await page.getByLabel("Or in your own words").fill("Local office managers");
    await page.getByLabel("Or in your own words").press("Enter");
    result = await one();
    assert.match(result.brief, /- Audience: Local office managers/);
    pass("Enter in the custom field submits the custom answer");
    await remount(2);
    await page.getByRole("button", { name: "Warm" }).click();
    await page.getByRole("button", { name: "Skip all" }).click();
    assert.equal(await page.evaluate(() => window.skipped), 1); assert.deepEqual(await started(), []);
    pass("Skip all uses its own callback and sends no answers");

    // Non-final Skip and backtracking across two questions.
    await remount(2);
    await page.getByRole("button", { name: "Warm" }).click();
    await page.getByRole("heading", { name: "Who is it for?" }).waitFor();       // auto-advance after a choice
    await page.getByRole("button", { name: "Previous question" }).click();
    await page.getByRole("button", { name: "Skip this question" }).click();       // non-final skip of the earlier choice
    await page.getByRole("button", { name: "Businesses" }).click();
    await page.getByRole("button", { name: "Start building" }).click();
    result = await one();
    assert.deepEqual(result.answers, { tone: {}, audience: { option: "business", custom: "" } });
    assert.doesNotMatch(result.brief, /Tone:/); assert.match(result.brief, /- Audience: Businesses/);
    pass("non-final Skip (after going back) drops that answer; the next answer is kept");
    await remount(2);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Or in your own words").fill("Teachers");
    await page.getByRole("button", { name: "Skip this question" }).click();
    result = await one();
    assert.equal(result.brief, "A bakery website.", "nothing answered, nothing added");
    pass("Next on an untouched question then a final Skip leaves the brief unchanged");
    // Advancing is explicit for keyboard and screen-reader users; a pointer choice advances and is announced.
    const kicker = () => page.locator(".bq-kicker").innerText();
    await remount(2);
    await page.getByRole("button", { name: "Warm" }).focus(); await page.keyboard.press("Enter");
    await page.waitForTimeout(450);
    assert.match(await kicker(), /1 of 2/, "keyboard choice stays on the question");
    assert.equal(await page.getByRole("button", { name: "Warm" }).getAttribute("aria-pressed"), "true");
    assert.match(await page.locator(".bq-announce").innerText(), /Chose Warm. Press Next when you are ready./);
    await page.getByRole("button", { name: "Formal" }).focus(); await page.keyboard.press("Space");
    await page.waitForTimeout(450);
    assert.match(await kicker(), /1 of 2/, "Space does not advance either");
    await page.getByRole("button", { name: "Next" }).click();
    assert.match(await kicker(), /2 of 2/);
    pass("keyboard choices never auto-advance; Next moves on");
    await remount(2);
    await page.getByRole("button", { name: "Warm" }).click();
    await page.waitForFunction(() => document.querySelector(".bq-kicker")?.textContent?.includes("2 of 2"));
    assert.match(await page.locator(".bq-announce").innerText(), /Chose Warm. Moved to question 2 of 2./);
    pass("a pointer choice advances after showing it and announces the move");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await remount(2);
    await page.getByRole("button", { name: "Warm" }).click();
    await page.waitForTimeout(450);
    assert.match(await kicker(), /1 of 2/, "reduced motion keeps the question in place");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    pass("prefers-reduced-motion disables auto-advance");
  } finally { await browser.close(); server.close(); }
  console.log(`${passed} mounted brief-question checks passed (${engineLabel}, no network).`);
}
main().catch(error => { console.error(error); process.exit(1); });

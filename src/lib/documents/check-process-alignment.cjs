/* eslint-disable @typescript-eslint/no-require-imports -- Offline Chromium regression for process diagram label rows. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
const {chromium} = require("playwright");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText, file);
const {DeckSchema} = require("./schema.ts"), {defaultTheme, FONTS} = require("./theme.ts");
const {composeSlide} = require("./slide-scene.ts"), {deckHtml} = require("./render-deck.ts");
const cases = [
  ["1. Join at the counter", "2. Ride with scheduled check-ups", "3. Drop in for quick fixes"],
  ["Join", "Plan a community repair visit together", "Return"],
];
const details = ["Sign up in store; we log the bike and do a baseline safety check on the spot.", "We send a reminder when each check-up is due, and you book a slot that suits you.", "Squeaks, rubbing brakes or a flat tyre? Pop in and we sort it, labour included."];
async function main() {
  const browser = await chromium.launch({headless: true});
  let passed = 0, wrappedLabels = 0, singleLineLabels = 0;
  try {
    const context = await browser.newContext({viewport: {width: 1280, height: 900}, javaScriptEnabled: false, serviceWorkers: "block"});
    await context.route("**/*", route => route.abort());
    for (const fonts of Object.keys(FONTS)) for (const labels of cases) for (const mode of ["preview", "print"]) {
      const deck = DeckSchema.parse({kind: "deck", schemaVersion: 1, title: "Process alignment regression", assets: [], theme: {...defaultTheme("presentation"), fonts}, slides: [{id: "journey", layout: "diagram", title: "Being a member takes three simple steps", eyebrow: "Member journey", notes: "Synthetic local regression.", diagram: {kind: "process", items: labels.map((label, index) => ({label, detail: details[index]}))}}]});
      const scene = composeSlide(deck, deck.slides[0], 0, 1);
      const bodies = scene.prims.filter(p => p.k === "text" && details.includes(p.text));
      assert.equal(new Set(bodies.map(p => p.y)).size, 1, "process descriptions share a row");
      const page = await context.newPage();
      await page.emulateMedia({media: mode === "print" ? "print" : "screen"});
      await page.setContent(deckHtml(deck, {}, mode)); await page.evaluate(() => document.fonts.ready);
      const measured = await page.evaluate(({labels, details}) => {
        const slide = document.querySelector(".slide").getBoundingClientRect();
        const read = value => {const element = [...document.querySelectorAll(".t")].find(e => e.textContent === value), box = element.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(element); const ink = [...range.getClientRects()]; return {top: box.top, bottom: Math.max(...ink.map(r => r.bottom)), lines: new Set(ink.map(r => r.top)).size, inside: ink.every(r => r.left >= slide.left - 1 && r.right <= slide.right + 1 && r.top >= slide.top && r.bottom <= slide.bottom - 20)};};
        return {labels: labels.map(read), bodies: details.map(read)};
      }, {labels, details});
      assert(Math.max(...measured.bodies.map(b => b.top)) - Math.min(...measured.bodies.map(b => b.top)) < 1);
      measured.labels.forEach((label, index) => {assert(label.inside && measured.bodies[index].inside, `${fonts}/${mode}: text stays inside slide`); assert(label.bottom + 3 < measured.bodies[index].top, `${fonts}/${mode}: label and detail must not overlap`); if (label.lines > 1) wrappedLabels++; else singleLineLabels++;});
      await page.close(); passed++;
    }
  } finally {await browser.close();}
  assert(wrappedLabels > 0 && singleLineLabels > 0, "exercise real one- and multi-line labels");
  console.log(JSON.stringify({passed,wrappedLabels,singleLineLabels,providerCalls: 0}));
}
main().catch(error => {console.error(error); process.exitCode = 1;});

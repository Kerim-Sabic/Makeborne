/* eslint-disable @typescript-eslint/no-require-imports -- Mounted PlanCard in Chromium (audit effort/cost contract): a plan no effort level fits is not labelled "Best fit" and explains the scope options; a normal plan keeps its Best fit. Fictional plans, no network, no build. Local only. Run: node scripts/check-plan-nofit-browser.cjs */
const path = require("node:path"), fs = require("node:fs"), assert = require("node:assert/strict"), { build } = require("esbuild"), { browserType, engineLabel } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const section = name => ({ name, purpose: `Why ${name} exists.`, content: `Key content for ${name}.` });
const base = { kind: "new_site", title: "Fictional Atelier", summary: "A calm studio site.", goal: "Book a consultation.", audience: "Homeowners.", positioning: "Calm craft.",
  pages: [{ name: "Home", path: "/", purpose: "Win trust.", sections: ["Hero", "Approach", "Work", "Contact"].map(section) }],
  design: { concept: "Quiet editorial", palette: [{ name: "Ink", hex: "#1d1720", role: "text" }, { name: "Paper", hex: "#faf7f2", role: "background" }, { name: "Clay", hex: "#b4532a", role: "accent" }], typography: { display: "Fraunces", body: "Inter", rationale: "Warm serif over a plain sans." }, layout: ["Generous whitespace"], imagery: "Natural light", signatureInteraction: "Soft reveal" },
  changes: [], questions: [], assumptions: [] };
const huge = { ...base, pages: Array.from({ length: 12 }, (_, page) => ({ name: `Page ${page + 1}`, path: page ? `/p${page}` : "/", purpose: "Fictional page.", sections: Array.from({ length: 14 }, (_, item) => section(`Section ${item + 1}`)) })) };
const fixture = `import React from "react"; import { createRoot } from "react-dom/client";
import PlanCard from "./src/components/plan-card";
import { SitePlanSchema, estimatePlanCredits, recommendedEffort } from "./src/lib/builder/plan";
const plan = SitePlanSchema.parse(new URLSearchParams(location.search).get("plan") === "huge" ? ${JSON.stringify(huge)} : ${JSON.stringify(base)});
createRoot(document.getElementById("root")).render(<div style={{ maxWidth: 760, margin: "0 auto" }}><PlanCard plan={plan} estimate={estimatePlanCredits(plan)} recommended={recommendedEffort(plan)} revision={1} save="saved" onChange={() => {}} onBuild={() => {}} onRevise={() => {}} /></div>);`;

async function main() {
  const css = [];
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}" },
    plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "", loader: "js" }));
      b.onLoad({ filter: /\.css$/ }, args => { css.push(fs.readFileSync(args.path, "utf8")); return { contents: "", loader: "js" }; });
      b.onResolve({ filter: /^@\// }, args => ({ path: path.resolve("src", args.path.slice(2) + (args.path.endsWith(".css") ? "" : fs.existsSync(path.resolve("src", args.path.slice(2) + ".tsx")) ? ".tsx" : ".ts")) }));
    } }] });
  const globals = fs.readFileSync(path.resolve("src/app/globals.css"), "utf8").replace(/@import[^;]+;/g, "");
  const server = createServer((req, res) => { const js = req.url === "/fixture.js"; res.setHeader("Content-Type", js ? "text/javascript" : "text/html"); res.end(js ? output.outputFiles[0].contents : `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${globals}${css.join("\n")}</style><div id="root"></div><script src="/fixture.js"></script>`); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await browserType.launch({ headless: true });
  let passed = 0; const pass = name => { passed++; console.log(`PASS ${name}`); };
  const shots = process.env.SHOTS_DIR;
  try {
    for (const width of [1280, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
      await page.goto(`${url}/?plan=huge`); await page.locator(".pc-effort").waitFor();
      assert.equal(await page.locator(".pc-effort em").count(), 0, "no level is labelled Best fit");
      const note = page.getByRole("note");
      assert.match(await note.innerText(), /No effort level is sized to finish this plan in one build/);
      assert.match(await note.innerText(), /Remove pages or sections, or build the most important part first/);
      assert.equal(await page.getByRole("radio", { checked: true }).innerText().then(text => text.split("\n")[0]), "High", "the preselected fallback is unchanged");
      assert.match(await page.locator(".pc-build span").innerText(), /^Estimated ~90 · At most 90 credits$/, "an equal range is shown once, beside the distinct authorized maximum");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `no horizontal overflow at ${width}px (${overflow})`);
      if (shots) await page.locator(".pc-foot").screenshot({ path: path.join(shots, `plan-nofit-${width}.png`) });
      pass(`${width}px: oversized plan shows the no-fit note, no Best fit, no overflow`);
      await page.goto(url); await page.locator(".pc-effort").waitFor();
      assert.equal(await page.locator(".pc-effort em").count(), 1); assert.equal(await page.getByRole("note").count(), 0);
      pass(`${width}px: a normal plan keeps exactly one Best fit and no note`);
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log(`${passed} mounted plan-fit checks passed (${engineLabel}, fictional plans, no network).`);
}
main().catch(error => { console.error(error); process.exit(1); });

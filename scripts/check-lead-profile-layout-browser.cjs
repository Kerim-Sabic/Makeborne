/* eslint-disable @typescript-eslint/no-require-imports -- Mounted LeadProfileCard with the real client-page CSS (new-user journey audit, 26 Oct 2026): on phones the score chip, deal currency, source select and research buttons stay inside the card and the page never scrolls sideways. Fictional data; no network, no AI.
 * Run: node scripts/check-lead-profile-layout-browser.cjs [screenshot-dir] */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, args: engineArgs } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const shots = engineArgs[0] ? path.resolve(engineArgs[0]) : null;
const fixture = `import React from "react"; import { createRoot } from "react-dom/client";
import LeadProfileCard from "./src/components/leads/lead-profile";
import "./src/app/account-clients.css";
const researched = new URLSearchParams(location.search).get("lead") === "researched";
const lead = researched ? { tags: ["restaurant", "Leeds", "bookings"], dealValue: 2400, dealCurrency: "GBP", source: "Cold email",
  profile: { research: { url: "https://example.test", followers: "1.2K", bio: "Family-run Lebanese kitchen in the city centre since 2009." } } } : { tags: [], dealValue: null, dealCurrency: "EUR", source: "", profile: {} };
createRoot(document.getElementById("root")).render(<main className="workspace-content"><section className="ac-workspace"><div className="ac-detail">
  <LeadProfileCard accountId="a" workspaceId="w" clientId="c" clientName="Saffron Table" lead={lead} stage="Lead" hasEmail overdue={false} canEdit onChange={() => {}} />
</div></section></main>);`;
const mocks = { "lead-api": `export async function leadApi() { throw new Error("offline"); }` };

async function bundle() {
  const css = [];
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    logLevel: "silent", plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: /(?:^|[\\/])lead-api$/ }, () => ({ path: "lead-api", namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "jsx", resolveDir: process.cwd() }));
      b.onResolve({ filter: /^@\// }, args => {
        const base = path.resolve("src", args.path.slice(2));
        return { path: [base, `${base}.tsx`, `${base}.ts`].find(file => fs.existsSync(file) && fs.statSync(file).isFile()) };
      });
      b.onLoad({ filter: /\.css$/ }, args => { css.push(fs.readFileSync(args.path, "utf8")); return { contents: "", loader: "js" }; });
    } }] });
  return { js: output.outputFiles[0].contents, styles: [fs.readFileSync("src/app/globals.css", "utf8"), ...new Set(css)].join("\n").replace(/@import[^;]+;/g, "") };
}

async function main() {
  const { js, styles } = await bundle();
  const server = createServer((req, res) => {
    if (req.url.split("?")[0] === "/fixture.js") { res.setHeader("content-type", "text/javascript"); return res.end(js); }
    res.setHeader("content-type", "text/html");
    // The studio's phone gutter around the client page.
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}${styles}.ac-workspace{margin:26px 19px}</style><div id="root"></div><script src="/fixture.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await browserType.launch({ headless: true });
  let passed = 0; const failures = [];
  try {
    for (const width of [375, 390, 1280]) for (const lead of ["new", "researched"]) {
      const name = `${lead}-${width}`, page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => route.abort());
      try {
        await page.goto(`${base}/?lead=${lead}`);
        await page.locator(".lp-card").waitFor({ timeout: 15000 }).catch(error => { throw new Error(`${error.message.split("\n")[0]} ${errors.join(" | ")}`); });
        const result = await page.evaluate(() => {
          const card = document.querySelector(".lp-card"), edge = card.getBoundingClientRect().right - parseFloat(getComputedStyle(card).borderRightWidth);
          const outside = [...card.querySelectorAll("*")].filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.right > edge + 0.5; })
            .map(element => `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]} ends at ${Math.round(element.getBoundingClientRect().right)} > ${Math.round(edge)}`);
          return { outside, pageScroll: document.documentElement.scrollWidth - innerWidth };
        });
        assert.deepEqual(result.outside, [], "everything stays inside the card");
        assert.ok(result.pageScroll <= 0, `no sideways page scroll (${result.pageScroll}px)`);
        assert.deepEqual(errors, []);
        if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `lead-profile-${name}.png`), fullPage: true }); }
        passed++; console.log(`PASS ${name}`);
      } catch (error) { failures.push(name); console.log(`FAIL ${name}: ${error.message.split("\n").slice(0, 8).join(" | ")}`); }
      finally { await page.close(); }
    }
  } finally { await browser.close(); server.close(); }
  console.log(`\n${passed} passed, ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exit(1); });

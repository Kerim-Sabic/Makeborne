/* eslint-disable @typescript-eslint/no-require-imports -- Mounted CRM research components (flag MAKEBORNE_CRM_RESEARCH) in a real browser: hidden when off, needs-attention list, prospect website check with cited findings and fit, duplicate confirmation, do-not-contact, reviewer read-only, client next step with compare-and-set conflict, honest first email (copy only, never sent), timeline, Lead finder row check, 375 px. Routed APIs with fictional data; no network, no AI.
 * Run: node scripts/check-crm-research-browser.cjs [screenshot-dir] [--engine chromium|firefox|webkit] */
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { build } = require("esbuild"), { browserType, args: engineArgs } = require("./browser-engine.cjs"), { createServer } = require("node:http");

const shots = engineArgs[0] ? path.resolve(engineArgs[0]) : null;
const W = "22222222-2222-4222-8222-222222222222", C1 = "33333333-3333-4333-8333-333333333333", C2 = "44444444-4444-4444-8444-444444444444", ACCOUNT = "11111111-1111-4111-8111-111111111111";
const fixture = `import React from "react"; import { createRoot } from "react-dom/client";
import CrmInsights from "./src/components/crm/crm-insights";
import ClientCrm from "./src/components/crm/client-crm";
import LeadWebsiteCheck from "./src/components/crm/lead-website-check";
const view = new URLSearchParams(location.search).get("view");
const lead = { id: "l1", name: "Dental Studio Lana", category: "Dentist", website: "https://lana.example/", profileUrl: "", email: "", emailSource: null, linkHub: "", phone: "035 555 0101", address: "Tuzla", platform: "Website", handle: null, followers: null, bio: "", summary: "", source: "OpenStreetMap", verified: true, note: "", score: 40 };
function App() {
  const [opened, setOpened] = React.useState(""); const [message, setMessage] = React.useState("");
  return <div className="ac-workspace" style={{ padding: 16 }}>
    {view === "client" ? <ClientCrm accountId="${ACCOUNT}" workspaceId="${W}" clientId="${C1}" onOpenClient={setOpened} onOpenEmail={() => setMessage("email tab")} />
      : view === "lead" ? <ol className="lf-list-results"><li className="lf-row"><div className="lf-main"><strong>Dental Studio Lana</strong><LeadWebsiteCheck accountId="${ACCOUNT}" workspaceId="${W}" lead={lead} tag="dentists" /></div></li></ol>
      : <CrmInsights accountId="${ACCOUNT}" workspaceId="${W}" onOpenClient={setOpened} onAdded={setMessage} />}
    <p id="opened">{opened}</p><p id="message">{message}</p></div>;
}
createRoot(document.getElementById("root")).render(<App />);`;
const mocks = {
  "cloud-api": `export function cloudAccountGuard() { return () => true; } export class CloudError extends Error {}`,
};
const mockFor = request => /(?:^|[\\/])(cloud-api)$/.exec(request)?.[1];

async function bundle() {
  const css = [];
  const output = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    logLevel: "silent", plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: /.*/ }, args => { const mock = mockFor(args.path); return mock && mocks[mock] ? { path: mock, namespace: "mock" } : undefined; });
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "jsx", resolveDir: process.cwd() }));
      b.onResolve({ filter: /^@\// }, args => {
        const base = path.resolve("src", args.path.slice(2));
        const found = [base, `${base}.tsx`, `${base}.ts`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
        return { path: found ?? base };
      });
      b.onLoad({ filter: /\.css$/ }, args => { css.push(fs.readFileSync(args.path, "utf8")); return { contents: "", loader: "js" }; });
    } }] });
  return { js: output.outputFiles[0].contents, styles: [fs.readFileSync("src/app/globals.css", "utf8"), fs.readFileSync("src/app/account-clients.css", "utf8"), ...new Set(css)].join("\n").replace(/@import[^;]+;/g, "") };
}

// ---------- fictional API ----------
const now = new Date().toISOString();
const evidence = (quote, measured) => ({ url: "https://lana.example/", checkedAt: now, sha256: "a".repeat(64), ...(quote ? { quote } : {}), ...(measured ? { measured } : {}) });
const CHECK = { version: "crm-site-check-2026-10-25.1", input: "lana.example", url: "https://lana.example/", finalUrl: "https://lana.example/", host: "lana.example", status: "checked", reason: null, reasonLabel: null, checkedAt: now,
  score: 62, band: "strong", summary: "A better website would clearly help: not built for phones, no clear next step, no enquiry form.",
  findings: [
    { id: "mobile", level: "high", points: 16, title: "Not built for phones", detail: "The page has no mobile viewport setting, so phones show a shrunken desktop page.", evidence: evidence("Phone layout: no") },
    { id: "cta", level: "high", points: 12, title: "No clear next step", detail: "We found no book, call or contact button or link on the home page.", evidence: evidence("Clear next step: no") },
    { id: "broken_links", level: "medium", points: 8, title: "Broken links", detail: "1 link on the home page leads to a missing page: “Gallery”.", evidence: evidence(null, "https://lana.example/gallery answered “not found”") },
    { id: "dated", level: "medium", points: 8, title: "Looks out of date", detail: "The footer says © 2018, which makes the business look inactive.", evidence: evidence("© 2018") },
    { id: "form", level: "medium", points: 5, title: "No enquiry form", detail: "Visitors can't send a message from the home page.", evidence: evidence("Enquiry form: no") },
  ],
  strengths: [{ id: "https", title: "Secure connection (https)", evidence: evidence("Secure connection: yes") }], contacts: [], platform: null,
  pages: [{ url: "https://lana.example/", role: "home", fetchedAt: now, sha256: "a".repeat(64), bytes: 4000 }], inaccessible: [], links: { checked: 2, broken: [{ url: "https://lana.example/gallery", label: "Gallery" }], unchecked: 0 },
  notChecked: ["How fast the site feels on a real phone (we time one download from our server)", "Google Business Profile, reviews and search ranking"] };
const FIT = { score: 59, tier: "hot", reasons: [{ text: "Website check: 62/100 room to improve", points: 31 }, { text: "Public phone number", points: 8 }, { text: "Category you serve (dentist)", points: 15 }] };

let state;
function reset(options = {}) {
  state = { enabled: options.enabled ?? true, canEdit: options.canEdit ?? true, posts: [], gets: [], revision: 2, stepText: "Send the quote", suppressed: options.suppressed ?? null, addAttempts: 0, conflict: options.conflict ?? false };
}
const json = (res, status, value) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
function api(req, res, body) {
  const url = new URL(req.url, "http://x"), file = url.pathname;
  if (req.method === "GET") state.gets.push(file); else state.posts.push({ file, body, headers: { account: req.headers["x-makeborne-account"], protocol: req.headers["x-makeborne-crm-protocol"] } });
  if (!state.enabled) return json(res, 404, { error: { code: "CRM_RESEARCH_DISABLED", message: "This isn't available yet." } });
  if (file === `/api/cloud/workspaces/${W}/crm` && req.method === "GET") {
    if (url.searchParams.get("probe") === "1") return json(res, 200, { enabled: true, canEdit: state.canEdit });
    assert.match(url.searchParams.get("day") ?? "", /^\d{4}-\d{2}-\d{2}$/);
    return json(res, 200, { enabled: true, canEdit: state.canEdit, truncated: false,
      attention: [{ id: C1, name: "Lana", company: "Dental Studio Lana", stage: "Proposal", nextFollowUp: "2026-10-20", nextStep: "Send the quote", items: [{ kind: "overdue", text: "Follow-up was due 5 days ago: Send the quote" }, { kind: "stalled", text: "25 days in Proposal with no logged activity" }] },
        { id: C2, name: "Mlin Bistro", company: "", stage: "Lead", nextFollowUp: null, nextStep: "", items: [{ kind: "no_next_step", text: "No follow-up date: decide the next step" }] }],
      duplicates: [{ a: C1, b: C2, aName: "Dental Studio Lana", bName: "Lana Dental", reasons: [{ kind: "domain", text: "Same website (lana.example)" }], strength: "strong" }],
      suppressions: [{ id: "55555555-5555-4555-8555-555555555555", kind: "domain", value: "spam.example", reason: "Asked not to be contacted", createdAt: now }], suppressedClients: [] });
  }
  if (file === `/api/cloud/workspaces/${W}/crm` && req.method === "POST") {
    if (body.action === "check") return json(res, 200, { checkId: "66666666-6666-4666-8666-666666666666", check: CHECK, fit: FIT, matches: [], suppressed: state.suppressed });
    if (body.action === "add") {
      state.addAttempts++;
      if (!body.allowDuplicate) return json(res, 409, { error: { code: "POSSIBLE_DUPLICATE", message: "This looks like a client you already have.", details: { matches: [{ id: C1, name: "Dental Studio Lana", reasons: [{ kind: "domain", text: "Same website (lana.example)" }], strength: "strong" }] } } });
      return json(res, 201, { clientId: C2, replayed: false, outreachSaved: true, attached: true, knowledge: { proposed: 3, deduplicated: 0, invalid: 0, stopped: null, available: true } });
    }
    return json(res, 200, { ok: true });
  }
  if (file === `/api/cloud/workspaces/${W}/clients/${C1}/crm` && req.method === "GET") {
    return json(res, 200, { enabled: true, canEdit: state.canEdit, knowledge: true, check: { id: "77777777-7777-4777-8777-777777777777", ...CHECK },
      nextStep: { text: state.stepText, revision: state.revision, updatedAt: now }, attention: [{ kind: "overdue", text: "Follow-up was due 5 days ago: Send the quote" }],
      timeline: [{ id: "c:1", at: now, kind: "site_check", title: "Website checked", detail: "https://lana.example/: 62/100 room to improve" }, { id: "m:1", at: "2026-10-02T10:01:00Z", kind: "email_out", title: "Email sent", detail: "Hello" }, { id: "rd:1", at: "2026-10-05T10:00:00Z", kind: "review_decision", title: "Approved by the client", detail: "Clinic site by Lana" }],
      duplicates: [{ id: C2, name: "Lana Dental", reasons: [{ kind: "domain", text: "Same website (lana.example)" }], strength: "strong" }], suppressed: state.suppressed });
  }
  if (file === `/api/cloud/workspaces/${W}/clients/${C1}/crm` && req.method === "POST") {
    if (body.action === "next_step") {
      if (state.conflict || body.expectedRevision !== state.revision) { state.conflict = false; state.revision++; state.stepText = "Changed by a colleague"; return json(res, 409, { error: { code: "NEXT_STEP_CHANGED", message: "Someone else changed the next step. Reload to see it before saving yours." } }); }
      state.revision++; state.stepText = body.text; return json(res, 200, { nextStep: { text: body.text, revision: state.revision, updatedAt: now } });
    }
    if (body.action === "draft") return json(res, 200, { sent: false, draft: { subject: "A few quick ideas for Dental Studio Lana's website", warnings: [], uses: [{ kind: "finding", text: "Not built for phones" }],
      body: "Hi Lana,\n\nI'm Kerim from Example Studio.\n\nWhen I looked at lana.example on 25 Oct, I noticed that:\n- on a phone the site shows as a shrunken desktop page\n\nIf this isn't useful, just reply “no thanks” and I won't contact you again.\n\nBest,\nKerim" } });
    if (body.action === "propose") return json(res, 200, { knowledge: { proposed: 2, deduplicated: 0, invalid: 0, stopped: null } });
    if (body.action === "check") return json(res, 201, { check: { id: "88888888-8888-4888-8888-888888888888", ...CHECK } });
  }
  return json(res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
}

async function main() {
  const { js, styles } = await bundle();
  const server = createServer((req, res) => {
    const file = req.url.split("?")[0];
    if (file === "/fixture.js") { res.setHeader("content-type", "text/javascript"); return res.end(js); }
    if (file.startsWith("/api/")) { let raw = ""; req.on("data", chunk => { raw += chunk; }); req.on("end", () => { try { api(req, res, raw ? JSON.parse(raw) : null); } catch (error) { json(res, 500, { error: { code: "FIXTURE", message: error.message } }); } }); return; }
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}${styles}</style><div id="root"></div><script src="/fixture.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await browserType.launch({ headless: true });
  let passed = 0; const failures = [];
  const scenario = async (name, options, run, viewport = { width: 1280, height: 900 }) => {
    reset(options);
    const context = await browser.newContext({ viewport, permissions: [] });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => void dialog.accept());
    await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/, route => route.abort());
    try {
      await run(page);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal page scroll");
      assert.ok(state.posts.every(post => !/\/mail|send|publish/.test(post.file) && !/send/i.test(post.body?.action ?? "")), "nothing is sent");
      assert.ok(state.posts.every(post => post.headers.account === ACCOUNT && post.headers.protocol === "2"), "account and CRM protocol headers on every write");
      assert.deepEqual(errors, []);
      if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `crm-${name}.png`), fullPage: true }); }
      passed++; console.log(`PASS ${name}`);
    } catch (error) { failures.push(name); console.log(`FAIL ${name}: ${error.message.split("\n").slice(0, 6).join(" | ")}`); }
    finally { await context.close(); }
  };
  try {
    await scenario("off-renders-nothing", { enabled: false }, async page => {
      await page.goto(`${base}/`); await page.waitForTimeout(400);
      assert.equal(await page.getByTestId("crm-insights").count(), 0);
      await page.goto(`${base}/?view=client`); await page.waitForTimeout(400);
      assert.equal(await page.getByTestId("crm-client").count(), 0);
      await page.goto(`${base}/?view=lead`); await page.waitForTimeout(400);
      assert.equal(await page.getByTestId("crm-lead-check").count(), 0);
    });
    await scenario("attention-and-prospect-check", {}, async page => {
      await page.goto(`${base}/`);
      await page.getByTestId("crm-insights").waitFor();
      await page.getByText("Follow-up was due 5 days ago: Send the quote").waitFor();
      await page.getByRole("button", { name: /Dental Studio Lana/ }).first().click();
      assert.equal(await page.locator("#opened").textContent(), C1, "opens the client");
      await page.getByRole("button", { name: "Check a business" }).click();
      await page.getByLabel("Business website").fill("lana.example");
      await page.getByRole("button", { name: "Check website" }).click();
      await page.getByTestId("crm-check").waitFor();
      assert.match(await page.getByTestId("crm-check").textContent(), /62\/100/);
      await page.getByText("Where we saw this").first().click();
      await page.getByText("on the page: “Phone layout: no”").waitFor();
      assert.match(await page.getByTestId("crm-fit").textContent(), /Fit 59\/100/);
      await page.getByRole("button", { name: "Add as client with this check" }).click();
      await page.getByText("This looks like a client you already have. Open it, or add a new client anyway.").waitFor();
      await page.getByRole("button", { name: "Add anyway" }).click();
      await page.locator("#message").filter({ hasText: "Added" }).waitFor();
      const adds = state.posts.filter(post => post.body.action === "add");
      assert.equal(adds.length, 2); assert.equal(adds[0].body.allowDuplicate, false); assert.equal(adds[1].body.allowDuplicate, true);
      assert.equal(adds[0].body.requestKey, adds[1].body.requestKey, "the same request key on the confirmed retry");
      assert.equal(adds[1].body.checkId, "66666666-6666-4666-8666-666666666666");
      assert.match(await page.locator("#message").textContent(), /3 facts are waiting for your review/);
    });
    await scenario("duplicates-and-do-not-contact", {}, async page => {
      await page.goto(`${base}/`);
      await page.getByRole("button", { name: /Possible duplicates/ }).click();
      await page.getByText("Same website (lana.example)").waitFor();
      await page.getByRole("button", { name: "Not the same" }).click();
      await page.waitForFunction(() => true);
      await page.getByRole("button", { name: /Do not contact/ }).click();
      await page.getByText("spam.example").waitFor();
      await page.getByLabel("Email address").fill("owner@lana.example");
      await page.getByRole("button", { name: "Add" }).click();
      await page.getByRole("button", { name: "Remove spam.example from the do-not-contact list" }).click();
      await page.waitForTimeout(300);
      const actions = state.posts.map(post => post.body.action);
      assert.deepEqual(actions, ["dismiss_duplicate", "suppress", "unsuppress"]);
      assert.deepEqual(state.posts[1].body, { action: "suppress", kind: "email", value: "owner@lana.example", reason: "" });
    });
    await scenario("reviewer-read-only", { canEdit: false }, async page => {
      await page.goto(`${base}/`);
      await page.getByRole("button", { name: "Check a business" }).click();
      await page.getByText("Only owners and editors can check websites and add clients.").waitFor();
      await page.getByRole("button", { name: /Possible duplicates/ }).click();
      assert.equal(await page.getByRole("button", { name: "Not the same" }).count(), 0);
      await page.goto(`${base}/?view=client`);
      await page.getByTestId("crm-client").waitFor();
      assert.equal(await page.getByRole("button", { name: /Check again|Check website/ }).count(), 0);
      assert.equal(await page.getByRole("button", { name: /Draft an honest first email/ }).count(), 0);
      assert.ok(await page.getByRole("textbox", { name: "Next step" }).isDisabled());
      assert.equal(state.posts.length, 0, "a reviewer writes nothing");
    });
    await scenario("client-next-step-conflict-draft-timeline", { conflict: true }, async page => {
      await page.goto(`${base}/?view=client`);
      await page.getByTestId("crm-client").waitFor();
      await page.getByText("Might be the same business as:").waitFor();
      const step = page.getByRole("textbox", { name: "Next step" });
      assert.equal(await step.inputValue(), "Send the quote");
      await step.fill("Call Lana about the quote");
      await page.getByRole("button", { name: "Save" }).click();
      await page.getByText("Someone else changed the next step. Reload to see it before saving yours.").waitFor();
      assert.equal(await step.inputValue(), "Changed by a colleague", "the colleague's version is shown, nothing overwritten");
      await step.fill("Call Lana about the quote");
      await page.getByRole("button", { name: "Save" }).click();
      await page.getByText("Next step saved.").waitFor();
      const steps = state.posts.filter(post => post.body.action === "next_step");
      assert.deepEqual(steps.map(post => post.body.expectedRevision), [2, 3], "compare-and-set with the revision the person saw");
      await page.getByRole("button", { name: "Draft an honest first email" }).click();
      const draft = page.getByTestId("crm-draft");
      await draft.waitFor();
      assert.match(await page.getByRole("textbox", { name: "Draft email" }).inputValue(), /reply “no thanks” and I won't contact you again/);
      await page.getByRole("button", { name: "Open the Email tab to send it" }).click();
      assert.equal(await page.locator("#message").textContent(), "email tab");
      await page.getByRole("button", { name: "Suggest facts from this check" }).click();
      await page.getByText("2 facts suggested. Review and approve them under Contact details.").waitFor();
      await page.getByText("Approved by the client").waitFor();
    });
    await scenario("client-do-not-contact-blocks-draft", { suppressed: { kind: "domain", value: "lana.example" } }, async page => {
      await page.goto(`${base}/?view=client`);
      await page.getByText("On your do-not-contact list (lana.example)").waitFor();
      assert.equal(await page.getByRole("button", { name: /Draft an honest first email/ }).count(), 0);
    });
    await scenario("lead-finder-row-check", {}, async page => {
      await page.goto(`${base}/?view=lead`);
      await page.getByRole("button", { name: "Check website" }).click();
      await page.getByTestId("crm-check").waitFor();
      await page.getByRole("button", { name: "Add with this check" }).click();
      await page.getByRole("button", { name: "Add anyway" }).click();
      await page.getByText("Added with its website check.").waitFor();
      const add = state.posts.filter(post => post.body.action === "add").at(-1).body;
      assert.equal(add.prospect.source, "Lead finder"); assert.equal(add.prospect.tag, "dentists"); assert.equal(add.prospect.phone, "035 555 0101");
    });
    await scenario("phone-375-insights", {}, async page => {
      await page.goto(`${base}/`);
      await page.getByRole("button", { name: "Check a business" }).click();
      await page.getByLabel("Business website").fill("lana.example");
      await page.getByRole("button", { name: "Check website" }).click();
      await page.getByTestId("crm-check").waitFor();
    }, { width: 375, height: 812 });
    await scenario("phone-375-client", {}, async page => {
      await page.goto(`${base}/?view=client`);
      await page.getByTestId("crm-check").waitFor();
    }, { width: 375, height: 812 });
  } finally { await browser.close(); server.close(); }
  console.log(`\n${passed}/${passed + failures.length} CRM research scenarios passed.`);
  if (failures.length) process.exit(1);
}
main().catch(error => { console.error(error); process.exit(1); });

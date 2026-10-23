/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks (audit M07/RSR/PUB): saved, checked and live facts; the per-page publish report and audience line; SEO checks read the prepared output when it matches. No network. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText, filename);
const {readPreparedHead, publishReport, indexingPolicy, audienceLine, INDEX_LABELS} = require("./publish-report.ts");
const {versionFacts, parseCheckRecord, checkCounts, checkRecordKey} = require("./version-facts.ts");
const {renderHostedSnapshot} = require("./snapshot.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const read = file => fs.readFileSync(path.join(__dirname, "../..", file), "utf8");

const page = (title, description, canonical, extra = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${description === null ? "" : `<meta name="description" content="${description}">`}${canonical ? `<link rel="canonical" href="${canonical}">` : ""}<meta property="og:title" content="${title}">${extra}</head><body><main><h1>${title}</h1></main></body></html>`;

check("the prepared head is read as published: title, description, canonical, robots, share image", () => {
  const head = readPreparedHead(page("Menu · Ovenbird &amp; Co", "Seasonal bakes", "https://ovenbird.makeborne.site/menu", '<meta name="robots" content="noindex"><meta property="og:image" content="https://ovenbird.makeborne.site/images/hero.webp">'));
  assert.deepEqual(head, {title: "Menu · Ovenbird & Co", description: "Seasonal bakes", canonical: "https://ovenbird.makeborne.site/menu", robots: "noindex", socialImage: "https://ovenbird.makeborne.site/images/hero.webp", h1: 1});
  assert.deepEqual(readPreparedHead("<html><body><h1>x</h1></body></html>"), {title: null, description: null, canonical: null, robots: null, socialImage: null, h1: 1});
  {
    const html = renderHostedSnapshot('<!doctype html><html><head></head><body><div id="root"><main><h1>Real</h1></main></div></body></html>', "Home · Real", "A description long enough.", "https://real.makeborne.site/", {image: "https://real.makeborne.site/images/a.webp"});
    assert.deepEqual(readPreparedHead(html), {title: "Home · Real", description: "A description long enough.", canonical: "https://real.makeborne.site/", robots: null, socialImage: "https://real.makeborne.site/images/a.webp", h1: 1}, "the hosted renderer's own head");
  }
});

check("per-page report: every route, problems named, indexing follows the hosting policy", () => {
  const routes = [{path: "/", html: page("Ovenbird", "Bread", "https://ovenbird.makeborne.site/")}, {path: "/menu", html: page("Menu", null, "https://ovenbird.makeborne.site/")}, {path: "/about", html: page("About", "Us", null, '<meta name="robots" content="noindex,follow">')}];
  const publicReport = publishReport(routes, indexingPolicy({testAddresses: false, localHosting: false}));
  assert.deepEqual(publicReport.map(route => [route.path, route.status, route.index]), [["/", "ready", "allowed"], ["/menu", "check", "allowed"], ["/about", "check", "noindex-page"]]);
  assert.deepEqual(publicReport[1].problems, ["No description", "Canonical points to /"]);
  assert.deepEqual(publicReport[2].problems, ["No canonical address"]);
  assert.equal(publicReport[0].socialImage, null);
  const custom = publishReport([{path: "/", html: page("Ovenbird", "Bread", "https://www.ovenbird.co.uk/")}], indexingPolicy({testAddresses: false, localHosting: false}));
  assert.equal(custom[0].status, "ready", "a custom primary domain in the canonical is fine; only the path must match");
  const legacy = publishReport([{path: "/", html: page("Ovenbird", "Bread", "https://sites.makeborne.com/ovenbird-test")}, {path: "/menu", html: page("Menu", "Bread", "https://sites.makeborne.com/ovenbird-test/menu")}, {path: "/about", html: page("About", "Us", "https://sites.makeborne.com/ovenbird-test")}],
    indexingPolicy({testAddresses: false, localHosting: false}), "https://sites.makeborne.com/ovenbird-test");
  assert.deepEqual(legacy.map(route => route.problems), [[], [], ["Canonical points to /ovenbird-test"]], "a path-based site address is the canonical base");
  for (const policy of [indexingPolicy({testAddresses: true, localHosting: false}), indexingPolicy({testAddresses: false, localHosting: true})])
    assert.ok(publishReport(routes, policy).every(route => route.index === "noindex-policy"), policy.reason);
  assert.equal(INDEX_LABELS["noindex-policy"], "Not indexed (test or local address)");
});

check("one plain line on audience and indexing, honest for test, local and public hosting", () => {
  assert.match(audienceLine(indexingPolicy({testAddresses: false, localHosting: false})), /anyone with the address — no sign-in\. Search engines may find and list the home page and every published page \(each is in the site’s sitemap\)\. Makeborne can’t control whether or how they rank it\./);
  assert.match(audienceLine(indexingPolicy({testAddresses: true, localHosting: false})), /test address: every page is sent with noindex/);
  assert.match(audienceLine(indexingPolicy({testAddresses: true, localHosting: true})), /only this computer/);
  // Matches the Worker: staging and local namespaces are never indexable; nested pages are indexable only when listed in the sitemap.
  const worker = fs.readFileSync(path.join(__dirname, "../../../infra/customer-sites/namespace-policy.js"), "utf8");
  assert.match(worker, /namespace==='local'[\s\S]*indexable:false/); assert.match(worker, /namespace==='staging'[\s\S]*indexable:false/);
  assert.match(fs.readFileSync(path.join(__dirname, "../../../infra/customer-sites/_worker.js"), "utf8"), /sitePaths\(value\)\?\.paths\.includes\(pathname\)/);
});

check("saved, checked and live are three facts; newer saved changes are called out", () => {
  const record = {version: 4, kind: "search", at: "2026-10-20T10:00:00Z", prepared: true};
  assert.deepEqual(versionFacts({saved: 5, dirty: false, checked: record, live: 3}), {saved: "Saved version 5", checked: "Checked version 4 (prepared pages) · older than saved", live: "Live version 3",
    notice: "Newer saved changes aren’t live yet: version 5 is saved, version 3 is live. Publish to update the site.", checkedVersion: 4, liveVersion: 3});
  const same = versionFacts({saved: 5, dirty: false, checked: {...record, version: 5, prepared: false}, live: 5});
  assert.equal(same.notice, null); assert.equal(same.checked, "Checked version 5");
  assert.equal(versionFacts({saved: 5, dirty: true, checked: null, live: 5}).notice, "Your unsaved edits aren’t live. Version 5 is live.");
  assert.equal(versionFacts({saved: 5, dirty: true, checked: null, live: 5}).saved, "Saved version 5 · newer edits not saved");
  assert.equal(versionFacts({saved: 2, dirty: false, checked: null, live: "offline"}).live, "Not live");
  assert.equal(versionFacts({saved: 2, dirty: false, checked: null, live: "error"}).live, "Couldn’t check what’s live");
  assert.equal(versionFacts({saved: 2, dirty: false, checked: null, live: undefined}).live, "Checking live version…");
  assert.equal(versionFacts({saved: 2, dirty: false, checked: null, live: "error"}).notice, null, "an unknown live state never claims 'not live yet'");
  assert.equal(versionFacts({saved: 2, dirty: false, checked: {...record, version: 9}, live: 2}).checkedVersion, null, "a record for a version this editor doesn't have is ignored");
});

check("the check record: only saved versions without unsaved edits count; malformed or foreign values are ignored", () => {
  assert.equal(checkCounts(3, false), true); assert.equal(checkCounts(3, true), false); assert.equal(checkCounts(0, false), false);
  assert.deepEqual(parseCheckRecord('{"version":3,"kind":"search","at":"2026-10-20T10:00:00.000Z","prepared":false}'), {version: 3, kind: "search", at: "2026-10-20T10:00:00.000Z", prepared: false});
  for (const raw of [null, "", "{", '{"version":0,"kind":"search","at":"2026-10-20","prepared":false}', '{"version":3,"kind":"other","at":"2026-10-20","prepared":false}', '{"version":3,"kind":"search","at":"soon","prepared":false}', "x".repeat(500)]) assert.equal(parseCheckRecord(raw), null, String(raw).slice(0, 40));
  assert.equal(checkRecordKey({accountId: "a", workspaceId: "w", artifactId: "p"}), "makeborne-checked-v1:a:w:p", "scoped by account, workspace and website");
});

check("wiring: header facts, History 'Checked', Copy link, report, audience line and SEO on the prepared output", () => {
  const studio = read("components/cloud-studio.tsx");
  // The facts sit in the project details popover of the header (websites only); scripts/check-editor-header-browser.cjs checks them mounted.
  assert.ok(studio.includes('details={artifact.kind === "website" ? <>') && studio.includes('<VersionFactsBar saved={expectedVersion} dirty={dirty} checked={checkRecord} live={liveVersion} />'));
  assert.ok(studio.includes('v.number === checkRecord?.version && <span className="cloud-version-checked"'));
  assert.equal((studio.match(/onPublished=\{\(\) => setLiveRefresh\(value => value \+ 1\)\}/g) ?? []).length, 2, "both publish panels refresh the header");
  const trusted = read("components/trusted-website-publish.tsx");
  assert.ok(trusted.includes("<Copy size={13}/>Copy link</button>") && trusted.includes("navigator.clipboard.writeText(address)"));
  assert.ok(trusted.includes('<PublishReport routes={preparation.previewRoutes} policy={policy} version={preparation.version} published={false} address={siteAddress(preparation.slug)}/>') && trusted.includes("matches&&!dirty&&preparation.previewRoutes.length>0&&<PublishReport"), "the report describes only the matching saved version");
  assert.ok(trusted.includes("setPublishedReport({version:preparation.version,routes:preparation.previewRoutes})") && trusted.includes("site.version_number===publishedReport.version"), "after publishing, the report stays for the published version");
  assert.ok(trusted.includes('<p className="website-publish-audience">{audienceLine(policy)}</p><label className="website-publish-consent">'), "audience line sits next to the consent");
  assert.ok(trusted.includes('testAddresses:addressPolicy.enabled&&addressPolicy.allowedSlugs!==null,localHosting:HOSTING.domain==="localhost"'));
  const seo = read("components/website-seo.tsx");
  assert.ok(seo.includes('preparation.state === "ready" && preparation.version === version && preparation.previewRoutes.length ? preparation.previewRoutes : null'), "only a ready preparation of this exact saved version");
  assert.ok(seo.includes("if (dirty || version < 1) return null;"), "unsaved edits are never checked against prepared pages");
  assert.ok(seo.includes("Read from the prepared pages: all ") && seo.includes("Read from the saved source: the home page rendered in this browser, other pages by title only."));
  assert.ok(!/method:\s*"(?:POST|PATCH|DELETE)"/.test(seo), "SEO reads only");
  assert.equal((seo.match(/recordCheck\(scope, \{ version: scopeAtStart\.version, dirty: scopeAtStart\.dirty, kind: "search"/g) ?? []).length, 2, "both check paths record what they read");
});

console.log(`\n${passed} publish-report checks passed.`);

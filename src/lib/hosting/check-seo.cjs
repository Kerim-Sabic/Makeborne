/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for search metadata, structured data, sitemap and the publish checklist. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { pageMeta, pageSummary, clip, structuredData, sitemapXml, seoChecklist, SiteSeoSchema } = require("./seo.ts");
const { renderHostedSnapshot } = require("./snapshot.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const page = (body, title = "") => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><div id="root"><nav><p>Menu Book Visit and lots of navigation words that are long enough</p></nav><main>${body}</main></div></body></html>`;
const HOME = page(`<h1>Supper for the street</h1><p>Open soon</p><p>A neighbourhood restaurant in Bristol cooking the season&rsquo;s best produce over fire, six nights a week, with a short wine list.</p><p>[Phone number]</p>`);
const seo = { siteName: "Saffron Table", business: { type: "Restaurant", name: "Saffron Table", street: "12 North St", city: "Bristol", postcode: "BS3 1HT", country: "GB", phone: "+44 117 496 0000", priceRange: "££", hours: [{ days: ["Tu", "We", "Th", "Fr", "Sa"], opens: "17:30", closes: "22:00" }], sameAs: ["https://instagram.com/saffrontable"] }, shareImage: "/images/hero.webp" };

check("descriptions come from the page's own opening copy, never navigation or short or placeholder text", () => {
  assert.equal(pageSummary(HOME), "A neighbourhood restaurant in Bristol cooking the season’s best produce over fire, six nights a week, with a short wine list.");
  assert.equal(pageSummary(page("<p>[Write your story here, at least fifty characters long please]</p>")), null);
  const captionFirst = page("<h1>Supper</h1><p>On the pass: saffron &amp; leek risotto, aged parmesan</p><p>A neighbourhood restaurant in Bristol cooking over fire, six nights a week, with a short natural wine list.</p>");
  assert.match(pageSummary(captionFirst), /^A neighbourhood restaurant/, "an introduction beats a short caption that comes first");
  assert.equal(clip("One sentence here. Another sentence that runs on and on and on.", 25), "One sentence here.");
  assert.equal(clip("One sentence here. Another sentence that runs on and on and on.", 40), "One sentence here. Another sentence that");
  assert.equal(clip("word ".repeat(50).trim(), 30).length <= 30, true);
});

check("each page gets its own title; the home page is the site name; owner text wins", () => {
  assert.deepEqual(pageMeta({ path: "/", siteTitle: "Saffron Table", html: HOME }), { title: "Saffron Table", description: "A neighbourhood restaurant in Bristol cooking the season’s best produce over fire, six nights a week, with a short wine list." });
  assert.equal(pageMeta({ path: "/menu", routeTitle: "Menu", siteTitle: "Saffron Table", html: page("<h1>Late spring menu</h1>") }).title, "Menu · Saffron Table");
  assert.equal(pageMeta({ path: "/about", siteTitle: "Saffron Table", html: page("<h1>Our story</h1>") }).title, "Our story · Saffron Table", "falls back to the page heading");
  const custom = pageMeta({ path: "/menu", routeTitle: "Menu", siteTitle: "x", html: "", seo: { siteName: "Saffron", pages: [{ path: "/menu", title: "Seasonal menu in Bristol", description: "Small plates and fire-cooked mains, changing every month." }] } });
  assert.deepEqual(custom, { title: "Seasonal menu in Bristol", description: "Small plates and fire-cooked mains, changing every month." });
  assert.ok(pageMeta({ path: "/x", routeTitle: "y".repeat(90), siteTitle: "Site", html: "" }).title.length <= 70);
});

check("settings are validated strictly", () => {
  assert.equal(SiteSeoSchema.safeParse(seo).success, true);
  for (const bad of [{ shareImage: "https://evil.example/x.png" }, { business: { type: "Restaurant", name: "x", phone: "call me" } }, { business: { type: "Spaceship", name: "x" } }, { business: { type: "Restaurant", name: "x", hours: [{ days: ["Mo"], opens: "25:00", closes: "10:00" }] } }, { business: { type: "Restaurant", name: "x", sameAs: ["http://insecure.example"] } }, { pages: [{ path: "../etc", title: "x" }] }, { extra: true }])
    assert.equal(SiteSeoSchema.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(SiteSeoSchema.safeParse({ business: { type: "Restaurant", name: "x", phone: "call us" } }).error.issues[0].message, "Use a phone number like +44 117 496 0000.", "messages are written for owners");
});

check("structured data describes the business and cannot break out of its script", () => {
  const json = structuredData(seo, "https://www.saffrontable.co.uk/", "https://www.saffrontable.co.uk/images/hero.webp");
  const data = JSON.parse(json);
  assert.equal(data["@type"], "Restaurant"); assert.equal(data.address.postalCode, "BS3 1HT"); assert.equal(data.telephone, "+44 117 496 0000");
  assert.deepEqual(data.openingHoursSpecification[0].dayOfWeek.slice(0, 2), ["https://schema.org/Tuesday", "https://schema.org/Wednesday"]);
  const hostile = structuredData({ business: { type: "Store", name: "</script><script>alert(1)</script> & <!--" } }, "https://a.example/");
  assert.doesNotMatch(hostile, /[<>]/); assert.equal(JSON.parse(hostile).name, "</script><script>alert(1)</script> & <!--");
  assert.equal(structuredData({}, "https://a.example/"), null);
});

check("the page head gets share tags and structured data; unsafe data is refused", () => {
  const html = renderHostedSnapshot(HOME, "Menu · Saffron Table", "Seasonal plates", "https://www.saffrontable.co.uk/menu", { siteName: "Saffron Table", image: "https://www.saffrontable.co.uk/images/hero.webp", jsonLd: structuredData(seo, "https://www.saffrontable.co.uk/"), requireReactRoot: true });
  assert.match(html, /<title>Menu · Saffron Table<\/title>/);
  assert.match(html, /<meta property="og:site_name" content="Saffron Table">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/www\.saffrontable\.co\.uk\/images\/hero\.webp"><meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"Restaurant"/);
  assert.equal((html.match(/<script/g) ?? []).length, 1, "the only script element is the data block");
  assert.throws(() => renderHostedSnapshot(HOME, "t", "d", "https://a.example/", { jsonLd: "</script><script>alert(1)" }), /Invalid structured data/);
  assert.doesNotMatch(renderHostedSnapshot(HOME, "t", "d", "https://a.example/", { image: "javascript:alert(1)" }), /og:image/);
});

check("sitemap lists every page once, escaped", () => {
  const xml = sitemapXml("https://www.saffrontable.co.uk/", ["/menu", "/", "/menu", "/visit"], "2026-10-14T10:00:00Z");
  assert.equal((xml.match(/<url>/g) ?? []).length, 3);
  assert.match(xml, /<loc>https:\/\/www\.saffrontable\.co\.uk\/<\/loc><lastmod>2026-10-14<\/lastmod>/);
  assert.match(sitemapXml("https://a.example", ["/a&b"]), /a&amp;b/);
});

check("the checklist catches real problems in plain words", () => {
  const thin = page(`<h1>Hi</h1><h1>Again</h1><img src="/images/a.webp"><a href="/missing">x</a><p>[Address]</p>`);
  const results = seoChecklist({ siteTitle: "Saffron Table", pages: [{ path: "/", html: thin }, { path: "/menu", routeTitle: "Menu", html: HOME }], images: ["/images/a.webp"] });
  const ids = results.map(item => item.id);
  for (const id of ["h1:/", "alt:/", "links:/", "thin:/", "placeholder:/", "business", "share-image"]) assert.ok(ids.includes(id), id);
  assert.equal(results.find(item => item.id === "links:/").level, "fail");
  assert.equal(results.find(item => item.id === "h1:/").title, "The home page has 2 main headings");
  const good = page(`<h1>Supper for the street</h1><p>${"A neighbourhood restaurant cooking with the seasons. ".repeat(30)}</p><img src="/images/a.webp" alt="Risotto"><a href="/menu">Menu</a>`);
  const clean = seoChecklist({ siteTitle: "Saffron Table", pages: [{ path: "/", html: good }, { path: "/menu", routeTitle: "Menu", html: good.replace("Supper for the street", "Menu") }], seo });
  assert.deepEqual(clean.map(item => item.level), ["pass"]);
});

check("publishing never uses internal design notes as the description", () => {
  const worker = fs.readFileSync(path.join(src, "lib", "projects", "publication-worker.ts"), "utf8");
  assert.doesNotMatch(worker, /designDirection/);
  assert.match(worker, /seo: content\.seo, routes: content\.websiteSource\?\.routes/);
  const output = fs.readFileSync(path.join(src, "lib", "projects", "publication-output.ts"), "utf8");
  assert.match(output, /pageMeta\(\{path, routeTitle/); assert.match(output, /path === "\/" \? structuredData/);
});

console.log(`\n${passed} SEO checks passed.`);

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
const { pageMeta, pageSummary, clip, structuredData, sitemapXml, seoChecklist, imageAlt, SiteSeoSchema } = require("./seo.ts");
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

check("image descriptions: informative, intentionally decorative, missing and unassessed are told apart", () => {
  const cases = [
    ['<img src="/a.webp" alt="Risotto with leeks">', "informative"], ["<img src='/a.webp' alt='Bread & butter'>", "informative"], ['<img alt=Loaves src=/a.webp>', "informative"],
    ['<img src="/a.webp" alt="">', "decorative"], ["<img src='/a.webp' alt=''>", "decorative"], ['<img src="/a.webp" alt>', "decorative"], ['<img src="/a.webp" alt="  ">', "decorative"],
    ['<img src="/a.webp" aria-hidden="true">', "decorative"], ['<img src="/a.webp" role="presentation">', "decorative"], ['<IMG SRC="/a.webp" ALT="" />', "decorative"],
    ['<img src="/a.webp">', "missing"], ["<img>", "missing"], ['<img src="/a.webp" title="Risotto">', "missing"], ['<img src="/a.webp" data-alt="Risotto">', "missing"],
    ['<img src="/a.webp" alt="undefined">', "unassessed"], ['<img src="/a.webp" alt="{photo.alt}">', "unassessed"], ['<img src="/a.webp" alt="${name}">', "unassessed"],
    ['<img src="/a.webp" alt={alt}>', "unassessed"], ['<img src="/a.webp" alt="Risotto>', "unassessed"],
  ];
  for (const [tag, kind] of cases) assert.equal(imageAlt(tag), kind, tag);
  assert.equal(imageAlt('<img alt="Plates &gt; 2 people" src="/a.webp">'), "informative");
});

check("the checklist reports missing alt, accepts decorative alt=\"\" and flags unreadable descriptions", () => {
  const body = `<h1>Supper for the street</h1><p>${"A neighbourhood restaurant cooking with the seasons. ".repeat(30)}</p>`;
  const mixed = page(`${body}<img src="/images/a.webp" alt="Risotto"><img src="/images/rule.webp" alt=""><img src="/images/b.webp"><img src="/images/c.webp" alt="undefined"><img src="/images/d.webp" alt="Plates > 2">`);
  const results = seoChecklist({ siteTitle: "Saffron Table", pages: [{ path: "/", html: mixed }], seo });
  const byId = Object.fromEntries(results.map(item => [item.id, item]));
  assert.equal(byId["alt:/"].title, "1 image on the home page has no alt text");
  assert.equal(byId["alt:/"].level, "warn"); assert.match(byId["alt:/"].detail, /alt=""/, "explains the decorative option");
  assert.equal(byId["alt-unknown:/"].level, "warn"); assert.equal(byId["alt-unknown:/"].title, "1 image on the home page couldn't be checked");
  assert.equal(byId["alt-decorative:/"].level, "info"); assert.equal(byId["alt-decorative:/"].title, "1 image on the home page is marked decorative");
  assert.equal(byId.ready, undefined, "an unassessed or missing description never shows as a pass");
  const decorativeOnly = page(`${body}<img src="/images/a.webp" alt="Risotto"><img src="/images/rule.webp" alt=""><img src="/images/dots.webp" alt="">`);
  const clean = seoChecklist({ siteTitle: "Saffron Table", pages: [{ path: "/", html: decorativeOnly }], seo });
  assert.deepEqual(clean.map(item => [item.id, item.level]), [["alt-decorative:/", "info"], ["ready", "pass"]], "decorative images are intentional, not missing");
  assert.equal(clean.find(item => item.id === "alt-decorative:/").title, "2 images on the home page are marked decorative");
});

check("page length is a contextual hint: never a ranking claim, never a reason to pad contact or gallery pages", () => {
  const run = (path, routeTitle, body) => seoChecklist({ siteTitle: "Saffron Table", pages: [{ path, routeTitle, html: page(body) }], seo });
  const short = "<p>We are a small family bakery in Leith, baking sourdough and rye every morning. Come and see us soon.</p>";
  for (const [path, title, body] of [
    ["/contact", "Contact", `<h1>Contact us</h1>${short}`],
    ["/visit", "Visit", `<h1>Find us</h1>${short}`],
    ["/gallery", "Gallery", `<h1>Our loaves</h1>${short}`],
    ["/booking", "Book a table", `<h1>Book</h1>${short}`],
    ["/private-dining", "Private dining", `<h1>Private dining</h1>${short}<form><input name="email"></form>`],
    ["/team", "Team", `<h1>Team</h1>${short}<a href="tel:+441315550123">Call</a>`],
    ["/kitchen", "Kitchen", `<h1>Kitchen</h1>${short}${'<img src="/images/k.webp" alt="Oven">'.repeat(4)}`],
    ["/thank-you", "Thanks", `<h1>Thanks</h1>${short}`],
  ]) assert.equal(run(path, title, body).some(item => item.id === `thin:${path}`), false, `${path} does its job in a few words`);
  const about = run("/about", "About", `<h1>Our story</h1>${short}`).find(item => item.id === "thin:/about");
  assert.equal(about.level, "info", "a hint, not a warning");
  assert.match(about.detail, /^About \d{2} words\./); assert.match(about.detail, /no word count to reach/);
  const long = run("/about", "About", `<h1>Our story</h1><p>${"We bake sourdough in a wood-fired oven every morning. ".repeat(12)}</p>`);
  assert.equal(long.some(item => item.id === "thin:/about"), false);
  const everything = seoChecklist({ siteTitle: "S", pages: [{ path: "/", html: page("<h1>Hi</h1><h1>Again</h1><img src=\"/a.webp\"><a href=\"/missing\">x</a><p>[Address]</p>") }, { path: "/about", html: page(`<h1>About</h1>${short}`) }], images: ["/a.webp"] });
  for (const item of everything) assert.doesNotMatch(`${item.title} ${item.detail}`, /\brank(?:s|ed|ing)? (?:better|higher)|\bboosts?\b|\bguarantee/i, item.id);
  assert.equal(run("/about", "About", `<h1>Our story</h1>${short}`).find(item => item.id === "ready").title, "No problems found by these checks", "a hint alone doesn't fail the page");
});

check("a pass says what was checked and makes no ranking promise; the panel says other pages were only title-checked", () => {
  const good = page(`<h1>Supper for the street</h1><p>${"A neighbourhood restaurant cooking with the seasons. ".repeat(30)}</p>`);
  const ready = seoChecklist({ siteTitle: "Saffron Table", pages: [{ path: "/", html: good }], seo }).find(item => item.id === "ready");
  assert.match(ready.detail, /^The home page has a title, a description, one main heading/);
  assert.match(ready.detail, /can't predict/);
  assert.equal(seoChecklist({ siteTitle: "x", pages: [], seo }).some(item => item.id === "ready"), false, "nothing checked is never a pass");
  const ui = fs.readFileSync(path.join(src, "components", "website-seo.tsx"), "utf8");
  assert.match(ui, /id: "other-pages", level: "info"/);
  assert.match(ui, /checked for titles only/);
  assert.match(ui, /check\.level === "info" \? <Info /, "info hints get their own icon, not the warning triangle");
  assert.doesNotMatch(ui, /full content is checked when publishing/, "no claim the publisher re-checks content");
  assert.match(fs.readFileSync(path.join(src, "app", "website-seo.css"), "utf8"), /data-level="info"/);
});

check("publishing never uses internal design notes as the description", () => {
  const worker = fs.readFileSync(path.join(src, "lib", "projects", "publication-worker.ts"), "utf8");
  assert.doesNotMatch(worker, /designDirection/);
  assert.match(worker, /seo: content\.seo, routes: content\.websiteSource\?\.routes/);
  const output = fs.readFileSync(path.join(src, "lib", "projects", "publication-output.ts"), "utf8");
  assert.match(output, /pageMeta\(\{path, routeTitle/); assert.match(output, /path === "\/" \? structuredData/);
});

console.log(`\n${passed} SEO checks passed.`);

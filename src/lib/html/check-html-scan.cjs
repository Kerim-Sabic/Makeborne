/* eslint-disable @typescript-eslint/no-require-imports -- Offline harness: the linear HTML scanners must return exactly what the regular expressions they replace return, and hostile 600 KB pages must be read in well under a second. No network. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");

const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(__dirname, "../..", name.slice(2)), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);

const scan = require("./scan.ts");
const page = require("../research/page.ts"), redesign = require("../leads/redesign.ts"), siteCheck = require("../crm-research/site-check.ts");

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`ok - ${name}`); }

// ---- Random HTML-like text: the characters every pattern turns on, in short runs, so failures and odd nesting are common. ----
let seed = 0x5eed;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const PIECES = ["<", ">", "/", "!", "-", "--", "<!--", "-->", " ", "\n", "\t", " ", "\"", "'", "=", "&", ":", "?", "_", "a", "A", "x", "2", "1",
  "<a", "<A", "</a>", "</A>", "<a ", "a_", "<p", "<P", "</p>", "<p>", "<h1", "</h1>", "<h2>", "</H2>", "<h12", "<li", "</li>", "<title", "<TITLE>", "</title>",
  "<meta", "<meta ", "<metax", "<script", "<SCRIPT ", "</script>", "<style", "</style>", "<svg", "</svg>", "<main", "</main>", "<nav", "</nav>", "<header", "</header>",
  "<footer", "</footer>", "<button", "</button>", "<img", "<img ", "<input ", "<table ", "<div", "</div>", "<div hidden>", "<span", "<br", "<br/>",
  " href", " HREF", "href", " href=", "=\"", "='", "/x", "#a", " name=", "name=\"viewport\"", " type=", "type='password'", "password", " src=", " alt=", " class=", "logo",
  " width=", "bgcolor=", "application/ld+json", "APPLICATION/LD+JSON", "type=\"application/ld+json\"", "{\"@type\":\"Bakery\"}",
  "fonts.googleapis.com/css", "fonts.googleapis.com/css2?", "fonts.googleapis.com/css?", "FONTS.GOOGLEAPIS.COM/CSS?", "family=", "FAMILY=", "Inter", "Roboto+Slab", ":wght@400"];
const fuzz = (pieces = 40) => { let out = ""; const n = 1 + Math.floor(random() * pieces); for (let i = 0; i < n; i++) out += PIECES[Math.floor(random() * PIECES.length)]; return out; };
const ROUNDS = 6000;

const groups = (re, s) => [...s.matchAll(re)].map(m => m.slice(0));
function same(label, s, expected, actual) {
  try { assert.deepEqual(actual, expected); } catch (error) { console.error(`${label} differs on ${JSON.stringify(s)}`); throw error; }
}

(async () => {
  await check("each scanner returns exactly what its regular expression returns (random input)", () => {
    for (let round = 0; round < ROUNDS; round++) {
      const s = fuzz();
      same("stripComments", s, s.replace(/<!--[\s\S]*?-->/g, " "), scan.stripComments(s));
      same("stripTags", s, s.replace(/<[^>]+>/g, " "), scan.stripTags(s));
      same("tags(meta)", s, s.match(/<meta\b[^>]*>/gi) ?? [], scan.tags(s, ["meta"]));
      same("tags(img)", s, s.match(/<img\b[^>]*>/gi) ?? [], scan.tags(s, ["img"]));
      // Every generic open tag, walked with nextTag as stripHidden walks it.
      const generic = []; for (let tag = scan.nextTag(s, 0); tag; tag = scan.nextTag(s, tag.end)) generic.push([tag.raw, tag.name, tag.attrs]);
      same("nextTag", s, groups(/<([a-z][a-z0-9]*)\b([^>]*)>/gi, s).map(m => [m[0], m[1].toLowerCase(), m[2]]), generic);
      for (const name of ["a", "div", "p"]) {
        const walked = []; for (let tag = scan.nextOpenOrClose(s, 0, name); tag; tag = scan.nextOpenOrClose(s, tag.end, name)) walked.push([tag.raw, tag.closing]);
        same(`nextOpenOrClose(${name})`, s, groups(new RegExp(`<(/?)${name}\\b[^>]*>`, "gi"), s).map(m => [m[0], Boolean(m[1])]), walked);
      }
      const tagged = (re, names) => same(`elements(${names})`, s, groups(re, s).map(m => [m[0], m[m.length - 1]]), scan.elements(s, names, { open: "tag" }).map(e => [e.raw, e.content]));
      tagged(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, ["p"]);
      tagged(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, ["li"]);
      tagged(/<(h1|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/gi, ["h1", "h2", "h3"]);
      tagged(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi, ["a", "button"]);
      same("title", s, /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1], scan.firstElement(s, ["title"], { open: "tag", boundary: false })?.content);
      same("main", s, /<main\b[\s\S]*?<\/main>/i.exec(s)?.[0], scan.firstElement(s, ["main"], { open: "name" })?.raw);
      const VISIBLE = ["script", "style", "noscript", "svg", "template", "select", "iframe"];
      same("replaceElements(visible)", s, s.replace(/<(script|style|noscript|svg|template|select|iframe)\b[\s\S]*?<\/\1>/gi, " "), scan.replaceElements(s, VISIBLE, { open: "name" }));
      same("replaceElements(nav|header|footer)", s, s.replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, " "), scan.replaceElements(s, ["nav", "header", "footer"], { open: "name" }));
      same("elements(nav|header)", s, groups(/<(nav|header)\b[\s\S]*?<\/\1>/gi, s).map(m => m[0]), scan.elements(s, ["nav", "header"], { open: "name" }).map(e => e.raw));
      same("replaceElements(script|style, no \\b)", s, s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " "), scan.replaceElements(s, ["script", "style"], { open: "name", boundary: false }));
      same("jsonLdBlocks", s, groups(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi, s).map(m => m[1]), scan.jsonLdBlocks(s));
      same("jsonLdBlocks(12)", s, groups(/<script[^>]+application\/ld\+json[^>]*>([\s\S]{0,12}?)<\/script>/gi, s).map(m => m[1]), scan.jsonLdBlocks(s, 12));
      same("anchorsWithHref", s, groups(/<a\b[^>]*\shref\s*=\s*["']([^"']{1,500})["'][^>]*>([\s\S]{0,300}?)<\/a>/gi, s).map(m => [m[1], m[2]]), scan.anchorsWithHref(s));
      same("googleFontFamilies", s, groups(/fonts\.googleapis\.com\/css2?\?[^"'>]*family=([^"'&>:]+)/gi, s).map(m => m[1]), scan.googleFontFamilies(s));
      same("tagTest(logo)", s, /<img\b[^>]*(?:src|alt|class)\s*=\s*["'][^"']*logo/i.test(s), scan.tagTest(s, "img", true, /<img\b[^>]*(?:src|alt|class)\s*=\s*["'][^"']*logo/iy));
      same("tagTest(password)", s, /<input\b[^>]*type\s*=\s*["']?password/i.test(s), scan.tagTest(s, "input", true, /<input\b[^>]*type\s*=\s*["']?password/iy));
      same("tagTest(viewport)", s, /<meta[^>]+name=["']viewport["']/i.test(s), scan.tagTest(s, "meta", false, /<meta[^>]+name=["']viewport["']/iy));
      same("tagTest(table)", s, /<table[^>]+(width|bgcolor)=/i.test(s), scan.tagTest(s, "table", false, /<table[^>]+(width|bgcolor)=/iy));
    }
  });

  await check("long labels and values: the 300- and 500-character limits match the pattern", () => {
    for (const s of [`<a href="${"x".repeat(500)}">${"y".repeat(300)}</a>`, `<a href="${"x".repeat(501)}">y</a>`, `<a href="/x">${"y".repeat(301)}</a>`,
      `<a href="/x>y" title='>'>${"z".repeat(299)}</a>`, `<a href="a" href='b'>c</a><a  href = "/d" >e</a>`, `<script type="application/ld+json">${"j".repeat(70_000)}</script>`])
      for (const [re, fn] of [[/<a\b[^>]*\shref\s*=\s*["']([^"']{1,500})["'][^>]*>([\s\S]{0,300}?)<\/a>/gi, () => scan.anchorsWithHref(s)], [/<script[^>]+application\/ld\+json[^>]*>([\s\S]{0,60000}?)<\/script>/gi, () => scan.jsonLdBlocks(s, 60_000).map(x => [x])]])
        same("limits", s.slice(0, 80), groups(re, s).map(m => m.slice(1)), fn());
  });

  // ---- Hostile pages: every construct left unfinished, 600 KB (the reader's per-page cap). ----
  const SIZE = 600_000, LIMIT_MS = 200;
  const fill = unit => unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);
  const HOSTILE = ["<a", "<a ", "<A\t", "<meta", "<meta ", "<!--", "<p>x", "<p ", "<img ", "<img src='", "<input ", "<script", "<script>", "<script type=application/ld+json>", "<style",
    "<h1>", "<h2 ", "<a href='x'>", "<a href=\"/x\" ", "<a href=' href='", "<title>", "<main>", "<nav>", "<header ", "<li>", "<br", "<table ", "<div hidden>", "<div hidden><div",
    "<", "<<", "fonts.googleapis.com/css?", "fonts.googleapis.com/css?family=a:", "a", "a@", "1 ", "+1 2-", "© 20", "&#1", "href=\"http://a", "<x style=\"display:none\">"];
  const url = new URL("https://hostile.test/");
  await check(`hostile ${SIZE / 1000} KB pages: page extraction, website check and lead redesign reader each finish in under ${LIMIT_MS} ms`, () => {
    const slow = [];
    for (const unit of HOSTILE) {
      const html = fill(unit);
      const started = performance.now();
      const data = page.extractPage(html, url, new Date("2026-10-26T00:00:00Z"));
      const home = { role: "home", url: url.href, finalUrl: url.href, fetchedAt: "2026-10-26T00:00:00.000Z", sha256: "0".repeat(64), bytes: html.length, page: data };
      siteCheck.linksToCheck(home, html, new Set(), 5);
      siteCheck.findingsFromPages({ home, pages: [home], captures: new Map([[url.href, { html, ms: 10, bytes: html.length }]]), broken: [], now: new Date("2026-10-26T00:00:00Z") });
      const ms = performance.now() - started;
      const content = redesign.readSiteContent(html, url);
      redesign.auditSite({ html, finalUrl: url.href, content, now: new Date("2026-10-26T00:00:00Z") });
      const total = performance.now() - started;
      if (ms >= LIMIT_MS || total - ms >= LIMIT_MS) slow.push(`${JSON.stringify(unit)}: research+check ${Math.round(ms)} ms, redesign ${Math.round(total - ms)} ms`);
    }
    assert.deepEqual(slow, []);
  });

  console.log(`\n${passed} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });

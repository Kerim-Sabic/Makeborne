/* eslint-disable @typescript-eslint/no-require-imports -- standalone offline checks for interactive hosting (no network, no database). */
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");

const cache = {};
function load(file) {
  file = path.resolve(file);
  if (cache[file]) return cache[file].exports;
  const compiled = {exports: {}};
  cache[file] = compiled;
  const localRequire = id => {
    if (!id.startsWith(".") && !id.startsWith("@/")) return require(id);
    const base = id.startsWith("@/") ? path.resolve("src", id.slice(2)) : path.resolve(path.dirname(file), id);
    const resolved = [base, base + ".ts", base + ".js"].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!resolved) throw new Error(`Cannot resolve fixture module: ${id}`);
    return load(resolved);
  };
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  new Function("require", "module", "exports", js)(localRequire, compiled, compiled.exports);
  return compiled.exports;
}

const policy = load("infra/customer-sites/site-policy.js");
const {default: worker} = load("infra/customer-sites/_worker.js");
const {prepareSiteBundle, serializeSiteFiles, SiteBundleError} = load("src/lib/hosting/bundle.ts");
const {renderHostedSnapshot, inlineSnapshotImages} = load("src/lib/hosting/snapshot.ts");
const config = load("src/lib/hosting/config.ts");

let count = 0;
const pending = [];
function check(name, fn) {
  const run = async () => { await fn(); count++; console.log(`PASS ${name}`); };
  pending.push([name, run]);
}
const directives = csp => Object.fromEntries(csp.split(";").map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const webp = (size = 64) => { const bytes = Buffer.alloc(size); bytes.write("RIFF", 0, "latin1"); bytes.writeUInt32LE(size - 8, 4); bytes.write("WEBP", 8, "latin1"); return bytes; };

check("interactive CSP allows exactly one same-origin script and nothing third-party", () => {
  const csp = directives(policy.siteDocumentCsp({interactive: true, secure: true}));
  assert.deepEqual(csp["default-src"], ["'none'"]);
  assert.deepEqual(csp["script-src"], ["'self'"]);
  assert.deepEqual(csp["connect-src"], ["'self'"]);
  assert.deepEqual(csp["worker-src"], ["'none'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.deepEqual(csp["frame-src"], ["'none'"]);
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.deepEqual(csp["base-uri"], ["'none'"]);
  assert.deepEqual(csp["form-action"], ["'self'"]);
  assert.ok("upgrade-insecure-requests" in csp);
  const all = Object.values(csp).flat().join(" ");
  assert.doesNotMatch(all, /unsafe-eval|strict-dynamic|wasm-unsafe-eval|\*|https:(?!\/\/makeborne\.com\/generated\/)/);
  for (const source of csp["img-src"].filter(value => value.startsWith("https://"))) assert.match(source, /^https:\/\/makeborne\.com\/generated\//);
});
check("static CSP disables scripts and connections; local http omits upgrade", () => {
  const csp = directives(policy.siteDocumentCsp({interactive: false, secure: false}));
  assert.deepEqual(csp["script-src"], ["'none'"]);
  assert.deepEqual(csp["connect-src"], ["'none'"]);
  assert.ok(!("upgrade-insecure-requests" in csp));
});
check("document, file and error headers carry isolation, caching and HSTS rules", () => {
  const secure = policy.siteDocumentHeaders({interactive: true, secure: true, indexable: true, etag: '"x"'});
  assert.equal(secure["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
  assert.equal(secure["X-Content-Type-Options"], "nosniff");
  assert.equal(secure["X-Frame-Options"], "DENY");
  assert.equal(secure["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(secure["Cross-Origin-Resource-Policy"], "same-origin");
  assert.equal(secure["Cache-Control"], "public, max-age=0, must-revalidate");
  assert.match(secure["Permissions-Policy"], /camera=\(\)/);
  assert.match(secure["Permissions-Policy"], /geolocation=\(\)/);
  assert.match(secure["Permissions-Policy"], /payment=\(\)/);
  assert.equal(secure["X-Robots-Tag"], undefined);
  const local = policy.siteDocumentHeaders({interactive: true, secure: false, indexable: false});
  assert.equal(local["Strict-Transport-Security"], undefined);
  assert.equal(local["X-Robots-Tag"], "noindex");
  const script = policy.siteFileHeaders({pathname: "/_mb/app-0123456789abcdef.js", contentType: "text/javascript; charset=utf-8", secure: true});
  assert.equal(script["Cache-Control"], "public, max-age=31536000, immutable");
  assert.match(script["Content-Security-Policy"], /sandbox/);
  assert.match(script["Content-Security-Policy"], /default-src 'none'/);
  const image = policy.siteFileHeaders({pathname: "/images/hero.webp", contentType: "image/webp", secure: true});
  assert.equal(image["Cache-Control"], "public, max-age=300, stale-while-revalidate=3600");
  const missing = policy.siteErrorHeaders({secure: true, status: 404});
  assert.equal(missing["X-Robots-Tag"], "noindex");
  assert.match(policy.siteErrorPage(404), /Page not found/);
  assert.doesNotMatch(policy.siteErrorPage(503), /<script/);
});
check("site hosts map to exactly one label on the isolated domain", () => {
  assert.equal(policy.siteSlugFromHost("good-dog.makeborne.site", "makeborne.site"), "good-dog");
  assert.equal(policy.siteSlugFromHost("GOOD-DOG.makeborne.site.", "makeborne.site"), "good-dog");
  assert.equal(policy.siteSlugFromHost("a.good-dog.makeborne.site", "makeborne.site"), null);
  assert.equal(policy.siteSlugFromHost("makeborne.site", "makeborne.site"), null);
  assert.equal(policy.siteSlugFromHost("www.makeborne.site", "makeborne.site"), null);
  assert.equal(policy.siteSlugFromHost("xn--80ak6aa92e.makeborne.site", "makeborne.site"), null);
  assert.equal(policy.siteSlugFromHost("good-dog.makeborne.com", "makeborne.site"), null);
  assert.equal(policy.siteSlugFromHost("good-dogmakeborne.site", "makeborne.site"), null);
  assert.equal(policy.siteSlugFromHost("good-dog.localhost", "localhost"), "good-dog");
});
check("paths split into stored files, client routes and 404s", () => {
  for (const ok of ["/_mb/app-0123456789abcdef.js", "/_mb/app-0123456789abcdef.css", "/images/hero.webp", "/hero.PNG", "/a/b/c.jpeg"]) assert.ok(policy.siteFilePath(ok), ok);
  for (const bad of ["/_mb/app-xyz.js", "/_mb/other.webp", "/../etc.webp", "/images//x.webp", "/x.svg", "/x.html", "/.env", "/app.js"]) assert.ok(!policy.siteFilePath(bad), bad);
  for (const ok of ["/", "/index.html", "/about", "/pricing/", "/blog/my-post"]) assert.ok(policy.siteDocumentPath(ok), ok);
  for (const bad of ["/favicon.ico", "/x.js", "//evil", "/a//b", "/wp-login.php"]) assert.ok(!policy.siteDocumentPath(bad), bad);
});
check("the bundle script is attached only while JavaScript is on", () => {
  const html = "<!doctype html><html><head><title>T</title></head><body><div id=\"root\"><h1>Hi</h1></div></body></html>";
  const on = policy.composeSiteDocument(html, {script: "/_mb/app-0123456789abcdef.js", interactive: true});
  assert.match(on, /<script type="module" src="\/_mb\/app-0123456789abcdef\.js"><\/script><\/head>/);
  assert.equal((on.match(/<script/g) || []).length, 1);
  assert.equal(policy.composeSiteDocument(html, {script: "/_mb/app-0123456789abcdef.js", interactive: false}), html);
  assert.equal(policy.composeSiteDocument(html, {script: null, interactive: true}), html);
  assert.throws(() => policy.composeSiteDocument(html, {script: "https://evil.example/x.js", interactive: true}), /invalid_script/);
  assert.throws(() => policy.composeSiteDocument("<html>", {script: null, interactive: true}), /invalid_document/);
});
check("bundles are content-addressed and validated before storage", () => {
  const js = "console.log('hi')", css = "body{margin:0}";
  const bundle = prepareSiteBundle({js, css, images: [{path: "/images/hero.webp", bytes: webp()}]});
  assert.equal(bundle.script, `/_mb/app-${sha(js).slice(0, 16)}.js`);
  assert.equal(bundle.stylesheet, `/_mb/app-${sha(css).slice(0, 16)}.css`);
  assert.deepEqual([...bundle.assetPaths], ["/images/hero.webp"]);
  assert.deepEqual(bundle.files.map(file => file.contentType), ["text/javascript; charset=utf-8", "text/css; charset=utf-8", "image/webp"]);
  for (const file of bundle.files) assert.equal(file.sha256, sha(file.body));
  const wire = serializeSiteFiles(bundle.files);
  assert.equal(Buffer.from(wire[0].body, "base64").toString(), js);
  assert.equal(prepareSiteBundle({js, css: "", images: []}).stylesheet, null);
  assert.throws(() => prepareSiteBundle({js: "  ", css, images: []}), SiteBundleError);
  assert.throws(() => prepareSiteBundle({js: "x".repeat(1_500_001), css, images: []}), /exceeds/);
  assert.throws(() => prepareSiteBundle({js: "a\0b", css, images: []}), /not valid/);
  assert.throws(() => prepareSiteBundle({js, css, images: [{path: "/images/x.webp", bytes: Buffer.from("<svg onload=alert(1)>")}]}), /could not be prepared/);
  assert.throws(() => prepareSiteBundle({js, css, images: [{path: "/_mb/app-0123456789abcdef.webp", bytes: webp()}]}), /cannot be published/);
  assert.throws(() => prepareSiteBundle({js, css, images: [{path: "/x.svg", bytes: webp()}]}), /cannot be published/);
  assert.throws(() => prepareSiteBundle({js, css, images: [{path: "/a.webp", bytes: webp()}, {path: "/a.webp", bytes: webp()}]}), /share one address/);
  assert.throws(() => prepareSiteBundle({js, css, images: [{path: "/a.webp", bytes: webp(2_000_001)}]}), /exceeds 2 MB/);
  const big = Array.from({length: 4}, (_, index) => ({path: `/i${index}.webp`, bytes: webp(1_900_000)}));
  assert.throws(() => prepareSiteBundle({js, css, images: big}), /6 MB/);
});
check("the static fallback keeps published images and the hosted stylesheet, nothing executable", () => {
  for (const incomplete of ['<html><head></head>', '<html><body><div id="root"></div></body></html>']) {
    assert.throws(() => renderHostedSnapshot(incomplete, "S", "D", "https://x.makeborne.site/", {requireReactRoot:true}), /preview is incomplete/);
  }
  assert.match(renderHostedSnapshot('<html><body><div id="root"><main>Ready</main></div></body></html>', "S", "D", "https://x.makeborne.site/", {requireReactRoot:true}), /<main>Ready<\/main>/);
  const snapshot = '<!doctype html><html lang="en"><head><style data-makeborne-bundle>.a{color:red}</style><style>.b{background:url(/images/hero.webp)} .c{background:url("https://evil.test/t.png")} .d{background:url(/images/unknown.webp)}</style></head><body><div id="root"><img src="/images/hero.webp" alt="Hero"><img src="/images/unknown.webp" alt="x"><img src="https://evil.test/p.png" alt="y"><a href="/about">About</a><a href="https://example.com">Out</a><button onclick="steal()">Go</button><script>alert(1)</script></div></body></html>';
  const html = renderHostedSnapshot(snapshot, "Site", "Desc", "https://site.makeborne.site/", {assetPaths: new Set(["/images/hero.webp"]), stylesheet: "/_mb/app-0123456789abcdef.css"});
  assert.match(html, /<link rel="stylesheet" href="\/_mb\/app-0123456789abcdef\.css">/);
  assert.doesNotMatch(html, /\.a\{color:red\}/, "the inline bundle copy is replaced by the hosted stylesheet");
  assert.match(html, /url\(\/images\/hero\.webp\)/);
  assert.doesNotMatch(html, /evil\.test|unknown\.webp|<script|onclick/);
  assert.match(html, /<img src="\/images\/hero\.webp" alt="Hero"/);
  assert.match(html, /<a href="\/about">About<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com" rel="noopener noreferrer" target="_blank">/);
  assert.match(html, /<div id="root">/);
  const legacy = renderHostedSnapshot(snapshot, "Site", "Desc", "https://site.makeborne.site/");
  assert.match(legacy, /\.a\{color:red\}/, "without a hosted stylesheet the captured CSS stays inline");
  assert.doesNotMatch(legacy, /<link rel="stylesheet"|hero\.webp" alt/);
  const forged = renderHostedSnapshot(snapshot, "S", "D", "https://x.makeborne.site/", {stylesheet: "https://evil.test/x.css"});
  assert.doesNotMatch(forged, /evil\.test|<link rel="stylesheet"/, "only content-addressed same-origin stylesheets are linked");
});
check("publication preserves safe document attributes without reviving executable markup", () => {
  const snapshot = `<!doctype html><html lang="zh-Hant-TW" dir="rtl" class="dark" data-theme="midnight" style="--ink:#eee;background:#101010" onpointerdown="steal()"><head><style>html.dark body.wide{color:var(--ink)}</style></head><body id="page" class="wide" data-layout="a&amp;b" aria-label="A &quot;quoted&quot; page" title="x > y" style="margin:0;background-image:url('/images/hero.webp')" onload="steal()" background="https://evil.test/x.png"><div id="root"><main>Ready</main></div></body></html>`;
  for (const options of [{}, { assetPaths: new Set(["/images/hero.webp"]), stylesheet: "/_mb/app-0123456789abcdef.css" }]) {
    const html = renderHostedSnapshot(snapshot, "S", "D", "https://x.makeborne.site/", { ...options, requireReactRoot: true });
    assert.match(html, /<html[^>]*lang="zh-Hant-TW"[^>]*dir="rtl"[^>]*class="dark"[^>]*data-theme="midnight"/);
    assert.match(html, /--ink:#eee;background:#101010/);
    assert.match(html, /<body[^>]*id="page"[^>]*class="wide"[^>]*data-layout="a&amp;b"/);
    assert.match(html, /aria-label="A &quot;quoted&quot; page"/);
    assert.match(html, /title="x &gt; y"/);
    assert.match(html, /<div id="root"><main>Ready<\/main><\/div>/);
    assert.doesNotMatch(html, /onload|onpointerdown|steal\(|evil\.test|\sbackground="/);
    if (options.assetPaths) assert.match(html, /url\(&#39;\/images\/hero\.webp&#39;\)/);
    else assert.doesNotMatch(html, /\/images\/hero\.webp/);
  }
  const bad = renderHostedSnapshot('<html lang="invalid language" dir="wrong" onclick="x()"><body style="background:url(https://evil.test/p.png)" onload="x()"><main>Ready</main></body></html>', "S", "D", "https://x.makeborne.site/");
  assert.match(bad, /<html lang="en">/);
  assert.doesNotMatch(bad, /onclick|onload|evil\.test|dir="wrong"/);
});
check("without configuration, sites keep their existing addresses and stay static", () => {
  assert.equal(config.HOSTING.mode, "legacy", "the harness runs with no hosting variables");
  assert.equal(config.siteAddress("good-dog"), "https://sites.makeborne.com/good-dog");
  assert.deepEqual(config.SITE_ADDRESS_PARTS, {before: "sites.makeborne.com/", after: ""});
  assert.equal(config.HOSTING.interactiveAllowed, false);
  assert.ok(config.validSiteSlug("good-dog"));
  for (const bad of ["xn--abc", "www", "api", "a", "-ab", "ab-", "UPPER", "a_b"]) assert.ok(!config.validSiteSlug(bad), bad);
});
check("the isolated domain needs explicit, validated and attested configuration", () => {
  const resolve = config.resolveHostingConfig;
  const valid = {NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING: "isolated", NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE: "https://{slug}.makeborne.site/", NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED: "makeborne.site", NODE_ENV: "production"};
  const on = resolve(valid);
  assert.deepEqual([on.mode, on.domain, on.interactiveAllowed, on.issues], ["isolated", "makeborne.site", true, []]);
  assert.equal(config.siteAddress("good-dog", on), "https://good-dog.makeborne.site/");
  assert.deepEqual(config.addressParts(on.template), {before: "", after: ".makeborne.site"});
  const refused = [
    [{}, false],
    [{NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE: "https://{slug}.makeborne.site/"}, true],            // the old single variable no longer switches hosts
    [{...valid, NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING: "yes"}, true],
    [{...valid, NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED: undefined}, true],                       // prerequisites not attested
    [{...valid, NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED: "other.site"}, true],
    [{...valid, NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE: "https://{slug}.sites.makeborne.com/", NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED: "sites.makeborne.com"}, true], // application domain
    [{...valid, NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE: "https://{slug}.makeborne.com/", NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED: "makeborne.com"}, true],
    [{...valid, NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE: "https://sites.makeborne.site/{slug}"}, true],  // path addresses share one origin
    [{...valid, NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE: "http://{slug}.makeborne.site/"}, true],
    [{...valid, NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE: "https://{slug}.{slug}.makeborne.site/"}, true],
    [{...valid, NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE: "https://{slug}.Makeborne.site/"}, true],
    [{...valid, NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE: "http://{slug}.localhost:8787/"}, true],      // localhost only outside production
  ];
  for (const [env, reported] of refused) {
    const result = resolve(env);
    assert.deepEqual([result.mode, result.template, result.interactiveAllowed], ["legacy", "https://sites.makeborne.com/{slug}", false], JSON.stringify(env));
    assert.equal(result.issues.length > 0, reported, JSON.stringify(env));
  }
  const local = resolve({...valid, NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE: "http://{slug}.localhost:8787/", NODE_ENV: "development"});
  assert.deepEqual([local.mode, local.interactiveAllowed], ["isolated", true]);
});
check("portable copies embed project images within a budget and never carry scripts", () => {
  const img = Buffer.from("RIFF0000WEBPVP8 fixture");
  const big = Buffer.alloc(3_000_000, 1);
  const snapshot = '<html><head><style>.hero{background:url("/images/hero.webp")}</style></head><body><img src="/images/hero.webp" alt="Hero"><img src="/images/team.webp" alt="Team"><img src="/images/huge.webp" alt="Huge"><script>alert(1)</script></body></html>';
  const result = inlineSnapshotImages(snapshot, [{path: "/images/hero.webp", bytes: img}, {path: "/images/huge.webp", bytes: big}, {path: "/images/team.webp", bytes: img}], 2_500_000);
  assert.deepEqual(result.embedded, ["/images/hero.webp", "/images/team.webp"]);
  assert.deepEqual(result.omitted, ["/images/huge.webp"]);
  const html = renderHostedSnapshot(result.snapshot, "Site", "Desc", "https://sites.makeborne.com/site");
  assert.equal((html.match(/data:image\/webp;base64,/g) ?? []).length, 3, "hero (img + CSS) and team embedded");
  assert.doesNotMatch(html, /\/images\/|<script|huge/i, "over-budget images and scripts are removed");
  assert.match(html, /<link rel="canonical" href="https:\/\/sites\.makeborne\.com\/site">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/sites\.makeborne\.com\/site">/);
  assert.deepEqual(inlineSnapshotImages('<img src="/images/../secret.webp">', [{path: "/images/../secret.webp", bytes: img}]).embedded, [], "only plain image paths are embedded");
});

const ENV = {SITE_NAMESPACE: "production", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_URL: "https://rklojnmmsmhwnkbzuidp.supabase.co", SITES_DOMAIN: "makeborne.site"};
check("standalone legacy redirect excludes every reserved QA address", async () => {
  const {default: legacy} = load("infra/customer-sites/legacy-redirect/_worker.js");
  const {STAGING_SITE_LABELS} = load("infra/customer-sites/namespace-policy.js");
  for(const slug of STAGING_SITE_LABELS) for(const method of ["GET","HEAD"]) {
    const response=await legacy.fetch(new Request(`https://sites.makeborne.com/${slug}`,{method}));
    assert.equal(response.status,404);assert.equal(response.headers.get("Location"),null);
  }
  assert.equal((await legacy.fetch(new Request("https://sites.makeborne.com/good-dog"))).headers.get("Location"),"https://good-dog.makeborne.site/");
});
const SITE_HTML = '<!doctype html><html lang="en"><head><title>Site</title><link rel="stylesheet" href="/_mb/app-1111111111111111.css"></head><body><div id="root"><h1>Hi</h1></div></body></html>';
async function withRpc(handler, fn) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({url, body: JSON.parse(init.body), headers: init.headers});
    const value = await handler(url.split("/").pop(), JSON.parse(init.body));
    if (value instanceof Response) return value;
    return new Response(JSON.stringify(value), {headers: {"Content-Type": "application/json"}});
  };
  try { return await fn(calls); } finally { global.fetch = original; }
}

check("worker serves an interactive document with its bundle under the strict policy", () => withRpc(() => ({html: SITE_HTML, interactive: true, script: "/_mb/app-2222222222222222.js", revision: 7}), async calls => {
  const response = await worker.fetch(new Request("https://good-dog.makeborne.site/"), ENV);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /<script type="module" src="\/_mb\/app-2222222222222222\.js"><\/script><\/head>/);
  assert.equal(response.headers.get("Content-Security-Policy"), policy.siteDocumentCsp({interactive: true, secure: true}));
  assert.equal(response.headers.get("ETag"), '"mb4-7-1"');
  assert.equal(response.headers.get("X-Robots-Tag"), null);
  assert.equal(calls[0].url, "https://rklojnmmsmhwnkbzuidp.supabase.co/rest/v1/rpc/makeborne_read_hosted_site_v3");
  assert.deepEqual(Object.keys(calls[0].headers).sort(), ["Content-Type", "apikey"]);
  const revalidated = await worker.fetch(new Request("https://good-dog.makeborne.site/", {headers: {"If-None-Match": '"mb4-7-1"'}}), ENV);
  assert.equal(revalidated.status, 304);
  const route = await worker.fetch(new Request("https://good-dog.makeborne.site/services"), ENV);
  assert.equal(route.status, 200, "client routes fall back to the document");
  assert.equal(route.headers.get("X-Robots-Tag"), "noindex");
}));
check("worker withholds the script while JavaScript is off", () => withRpc(() => ({html: SITE_HTML, interactive: false, script: "/_mb/app-2222222222222222.js", revision: 8}), async () => {
  const response = await worker.fetch(new Request("https://good-dog.makeborne.site/"), ENV);
  assert.doesNotMatch(await response.text(), /<script/);
  assert.match(response.headers.get("Content-Security-Policy"), /script-src 'none'/);
}));
check("worker serves stored files only after verifying their digest", async () => {
  const js = Buffer.from("console.log(1)");
  await withRpc((name, args) => {
    assert.equal(name, "makeborne_read_hosted_site_file");
    assert.deepEqual(args, {p_slug: "good-dog", p_path: "/_mb/app-2222222222222222.js"});
    return {content_type: "text/javascript; charset=utf-8", sha256: sha(js), body: js.toString("base64")};
  }, async () => {
    const response = await worker.fetch(new Request("https://good-dog.makeborne.site/_mb/app-2222222222222222.js"), ENV);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "console.log(1)");
    assert.equal(response.headers.get("Content-Type"), "text/javascript; charset=utf-8");
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assert.match(response.headers.get("Content-Security-Policy"), /sandbox/);
    const conditional = await worker.fetch(new Request("https://good-dog.makeborne.site/_mb/app-2222222222222222.js", {headers: {"If-None-Match": `"${sha(js)}"`}}), ENV);
    assert.equal(conditional.status, 304);
  });
  await withRpc(() => ({content_type: "text/javascript; charset=utf-8", sha256: sha("other"), body: js.toString("base64")}), async () => {
    const response = await worker.fetch(new Request("https://good-dog.makeborne.site/_mb/app-2222222222222222.js"), ENV);
    assert.equal(response.status, 503, "tampered bytes are never served");
  });
  await withRpc(() => ({content_type: "text/html", sha256: sha(js), body: js.toString("base64")}), async () => {
    assert.equal((await worker.fetch(new Request("https://good-dog.makeborne.site/images/x.webp"), ENV)).status, 503, "unexpected content types are refused");
  });
  await withRpc(() => null, async () => {
    assert.equal((await worker.fetch(new Request("https://good-dog.makeborne.site/images/x.webp"), ENV)).status, 404);
  });
});
check("worker routes hosts, unknown paths and failures safely", () => withRpc(() => null, async calls => {
  const unpublished = await worker.fetch(new Request("https://nobody.makeborne.site/"), ENV);
  assert.equal(unpublished.status, 404);
  assert.match(await unpublished.text(), /Page not found/);
  assert.equal((await worker.fetch(new Request("https://good-dog.makeborne.site/favicon.ico"), ENV)).status, 404);
  assert.equal((await worker.fetch(new Request("https://good-dog.makeborne.site/x.php"), ENV)).status, 404);
  assert.equal((await worker.fetch(new Request("https://a.b.makeborne.site/"), ENV)).status, 404);
  const apex = await worker.fetch(new Request("https://makeborne.site/"), ENV);
  assert.equal(apex.status, 308);
  assert.equal(apex.headers.get("Location"), "https://makeborne.com/");
  const legacy = await worker.fetch(new Request("https://sites.makeborne.com/good-dog"), ENV);
  assert.equal(legacy.headers.get("Location"), "https://good-dog.makeborne.site/");
  const robots = await worker.fetch(new Request("https://good-dog.makeborne.site/robots.txt"), ENV);
  assert.equal(await robots.text(), "User-agent: *\nAllow: /\nSitemap: https://good-dog.makeborne.site/sitemap.xml\n", "robots points search engines to the site's own sitemap");
  assert.equal((await worker.fetch(new Request("https://good-dog.makeborne.site/", {method: "PUT"}), ENV)).status, 405);
  assert.equal(calls.length, 1, "only the unpublished site lookup reached the database");
}));
check("worker refuses local or non-Supabase upstreams unless explicitly in local mode", () => withRpc(() => ({html: SITE_HTML, interactive: false, script: null, revision: 1}), async calls => {
  const local = {...ENV, SUPABASE_URL: "http://127.0.0.1:55321"};
  assert.equal((await worker.fetch(new Request("https://good-dog.makeborne.site/"), local)).status, 503);
  assert.equal((await worker.fetch(new Request("https://good-dog.makeborne.site/"), {...ENV, SUPABASE_URL: "https://evil.example"})).status, 503);
  assert.equal((await worker.fetch(new Request("https://good-dog.makeborne.site/"), {...ENV, SUPABASE_PUBLISHABLE_KEY: "sb_secret_x"})).status, 503);
  assert.equal(calls.length, 0);
  const allowed = await worker.fetch(new Request("http://good-dog.localhost:8787/"), {...local, SITE_NAMESPACE: "local", APP_ORIGIN: "http://127.0.0.1:3000", ALLOW_LOCAL_SUPABASE: "true", SITES_DOMAIN: "localhost"});
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("Strict-Transport-Security"), null);
  assert.equal(calls[0].url, "http://127.0.0.1:55321/rest/v1/rpc/makeborne_read_hosted_site_v3");
}));
check("worker sends enquiries only to an HTTPS app origin; a bad origin disables the host instead of falling back", () => withRpc(() => ({html: SITE_HTML, interactive: false, script: null, revision: 1}), async calls => {
  for (const bad of ["http://makeborne.com", "https://makeborne.com/path", "ftp://x", "https://evil.example@makeborne.com", ""]) {
    assert.equal((await worker.fetch(new Request("https://good-dog.makeborne.site/"), {...ENV, APP_ORIGIN: bad})).status, 503, bad);
  }
  assert.equal(calls.length, 0, "a refused configuration reads nothing");
  assert.equal((await worker.fetch(new Request("https://good-dog.makeborne.site/"), {...ENV, APP_ORIGIN: "https://makeborne-release-staging-abc-kerimsabic-6594s-projects.vercel.app"})).status, 503);
  assert.equal((await worker.fetch(new Request("https://good-dog.makeborne.site/"), ENV)).status, 200, "unset keeps the production default");
  const local = {...ENV, SITE_NAMESPACE: "local", SUPABASE_URL: "http://127.0.0.1:55321", ALLOW_LOCAL_SUPABASE: "true", SITES_DOMAIN: "localhost", APP_ORIGIN: "http://127.0.0.1:3000"};
  assert.equal((await worker.fetch(new Request("http://good-dog.localhost:8787/"), local)).status, 200, "plain HTTP only for local qualification");
}));
check("Vite manifest paths and exact declared document requests preserve isolation", async () => {
  for(const path of ["/assets/index-AbCd123.js","/assets/styles-0123.css","/assets/inter-latin-123.woff2"]){assert.ok(policy.siteFilePath(path));assert.ok(policy.siteFileContentType(path));}
  for(const path of ["/assets/.env","/assets/a.json","/assets/a.svg","/assets/nested/app.js","/assets/../app.js"]){assert.ok(!policy.siteFilePath(path));}
  await withRpc((name,args)=>{
    assert.equal(name,"makeborne_read_hosted_site_v3");assert.equal(args.p_slug,"good-dog");
    return args.p_path==='/work'?{html:SITE_HTML,interactive:true,script:'/assets/index-AbCd123.js',revision:10}:null;
  },async()=>{
    const found=await worker.fetch(new Request('https://good-dog.makeborne.site/work'),ENV);assert.equal(found.status,200);assert.match(await found.text(),/src="\/assets\/index-AbCd123.js"/);
    assert.equal((await worker.fetch(new Request('https://good-dog.makeborne.site/not-declared'),ENV)).status,404);
  });
  const font=Buffer.from('wOF2fixture');
  await withRpc(()=>({content_type:'font/woff2',sha256:sha(font),body:font.toString('base64')}),async()=>{
    const response=await worker.fetch(new Request('https://good-dog.makeborne.site/assets/font-123.woff2'),ENV);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'font/woff2');assert.match(response.headers.get('Content-Security-Policy'),/sandbox/);
    assert.equal((await worker.fetch(new Request('https://good-dog.makeborne.site/assets/app-123.js'),ENV)).status,503);
  });
});
check("migration keeps file storage private and readers bounded", () => {
  const sql = fs.readFileSync("supabase/migrations/20261011140000_hosted_site_bundles.sql", "utf8");
  assert.match(sql, /revoke all on public\.hosted_site_files from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.makeborne_read_hosted_site_file\(text,text\) to anon/);
  assert.doesNotMatch(sql, /grant (?:select|insert|update|delete)[^;]*hosted_site_files[^;]*to (?:anon|authenticated)/i);
  assert.match(sql, /s\.interactive or f\.content_type<>'text\/javascript; charset=utf-8'/);
  assert.match(sql, /makeborne_hosting\.owner_can_host\(s\.owner_id\)/);
});

(async () => {
  for (const [name, run] of pending) {
    try { await run(); }
    catch (error) { console.error(`FAIL ${name}`); throw error; }
  }
  console.log(`${count} hosting checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });


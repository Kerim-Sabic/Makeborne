/* eslint-disable @typescript-eslint/no-require-imports -- standalone offline checks for responsive hero images (no network, no database, no provider). */
// Responsive copies (srcset) and the first-screen image: variant generation,
// the shared manifest and JSX runtime, the hosted snapshot rewrite, LCP
// candidate choice, the same-site preload and the sanitiser's allow/deny rules.
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");

const cache = {};
function load(file) {
  file = path.resolve(file);
  if (cache[file]) return cache[file].exports;
  const compiled = {exports: {}};
  cache[file] = compiled;
  const localRequire = id => {
    if (id === "server-only") return {};
    if (!id.startsWith(".") && !id.startsWith("@/")) return require(id);
    const base = id.startsWith("@/") ? path.resolve("src", id.slice(2)) : path.resolve(path.dirname(file), id);
    if (/\.c?js$/.test(base) && fs.existsSync(base)) return require(base);
    const resolved = [base + ".ts", base + ".js"].find(candidate => fs.existsSync(candidate));
    if (!resolved) throw new Error(`Cannot resolve fixture module: ${id}`);
    return load(resolved);
  };
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  new Function("require", "module", "exports", js)(localRequire, compiled, compiled.exports);
  return compiled.exports;
}

const responsive = require("../../../infra/project-runtime/responsive-images.cjs");
const {renderHostedSnapshot} = load("src/lib/hosting/snapshot.ts");
const {responsiveVariantBytes} = load("src/lib/builder/image-variants.ts");
const sharp = require("sharp");
const sha = value => createHash("sha256").update(value).digest("hex");

const checks = [];
const check = (name, run) => checks.push([name, run]);

// A 1536x1024 original with copies, a portrait 1024x1536 original, and a stale copy.
const HERO_SHA = "ab".repeat(32), ROOM_SHA = "cd".repeat(32), OLD_SHA = "ef".repeat(32);
const asset = (assetPath, sha256 = sha(assetPath), bytes = 1000) => ({id: "00000000-0000-4000-8000-000000000000", path: assetPath, sha256, bytes, mediaType: "image/webp"});
const SOURCE_ASSETS = [
  asset("public/images/hero.webp", HERO_SHA, 150_000),
  asset("public/images/room.webp", ROOM_SHA, 120_000),
  ...[640, 828, 1280].map(width => asset(responsive.variantPath({sha256: HERO_SHA, width: 1536, height: 1024}, width), undefined, 30_000)),
  ...[640, 828].map(width => asset(responsive.variantPath({sha256: ROOM_SHA, width: 1024, height: 1536}, width), undefined, 30_000)),
  asset(responsive.variantPath({sha256: OLD_SHA, width: 1536, height: 1024}, 640), undefined, 30_000),
];
const MANIFEST = responsive.responsiveManifest(SOURCE_ASSETS);
const SITE_FILES = new Set(SOURCE_ASSETS.map(item => `/${item.path.slice("public/".length)}`));
const HERO_SRCSET = "/images/_r/abababababababab-1536x1024/640.webp 640w, /images/_r/abababababababab-1536x1024/828.webp 828w, /images/_r/abababababababab-1536x1024/1280.webp 1280w, /images/hero.webp 1536w";

check("copies: widths 640/828/1280 only below 85% of the original, never upscaled", () => {
  assert.deepEqual(responsive.variantWidths(1536), [640, 828, 1280]);
  assert.deepEqual(responsive.variantWidths(1024), [640, 828]);
  assert.deepEqual(responsive.variantWidths(700), []);
  assert.deepEqual(responsive.variantWidths(0), []);
  assert.equal(responsive.variantPath({sha256: HERO_SHA, width: 1536, height: 1024}, 640), "public/images/_r/abababababababab-1536x1024/640.webp");
  assert.throws(() => responsive.variantPath({sha256: "x", width: 1, height: 1}, 640), /Invalid/);
  assert.ok(responsive.isOriginalPath("public/images/hero.webp") && responsive.isOriginalPath("public/images/brand-logo.webp"));
  assert.ok(!responsive.isOriginalPath("public/images/_r/abababababababab-1536x1024/640.webp") && !responsive.isOriginalPath("public/artwork/a.webp"));
});

check("copies: generated from stored bytes with real sizes; alpha survives; small images get none", async () => {
  const photo = await sharp({create: {width: 1536, height: 1024, channels: 3, background: "#8a6040"}}).webp({quality: 76}).toBuffer();
  const variants = await responsiveVariantBytes(photo, {quality: 76});
  assert.deepEqual(variants.map(variant => [variant.width, variant.height]), [[640, 427], [828, 552], [1280, 853]]);
  for (const variant of variants) {
    const meta = await sharp(variant.bytes).metadata();
    assert.equal(meta.format, "webp");
    assert.ok(variant.bytes.length < photo.length * 2, "a copy is never larger than the original by much");
  }
  const cutout = await sharp({create: {width: 1024, height: 1024, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}}}).webp().toBuffer();
  const copies = await responsiveVariantBytes(cutout);
  assert.deepEqual(copies.map(copy => copy.width), [640, 828]);
  assert.ok((await sharp(copies[0].bytes).metadata()).hasAlpha, "cut-out copies keep transparency");
  assert.deepEqual(await responsiveVariantBytes(await sharp({create: {width: 600, height: 400, channels: 3, background: "#fff"}}).webp().toBuffer()), []);
});

check("manifest: bound to the original's bytes and size; stale or ambiguous copies are ignored and pruned", () => {
  assert.deepEqual(Object.keys(MANIFEST).sort(), ["/images/hero.webp", "/images/room.webp"]);
  assert.deepEqual(MANIFEST["/images/hero.webp"], {width: 1536, height: 1024, srcset: HERO_SRCSET});
  assert.equal(MANIFEST["/images/room.webp"].srcset, "/images/_r/cdcdcdcdcdcdcdcd-1024x1536/640.webp 640w, /images/_r/cdcdcdcdcdcdcdcd-1024x1536/828.webp 828w, /images/room.webp 1024w");
  // Replacing an image's bytes (new sha) leaves its old copies unused.
  assert.deepEqual(responsive.responsiveManifest([asset("public/images/hero.webp", OLD_SHA.replace(/^ef/, "00")), ...SOURCE_ASSETS.slice(2, 5)]), {});
  // Two sizes claimed for the same bytes: no srcset at all.
  assert.deepEqual(responsive.responsiveManifest([SOURCE_ASSETS[0], SOURCE_ASSETS[2], asset("public/images/_r/abababababababab-1600x900/640.webp")]), {});
  const pruned = responsive.pruneVariants(SOURCE_ASSETS).map(item => item.path);
  assert.ok(!pruned.some(item => item.includes("efefefefefefefef")) && pruned.length === SOURCE_ASSETS.length - 1);
});

check("budget: copies stop before the site host's image count and byte limits", () => {
  assert.ok(responsive.variantsFit(SOURCE_ASSETS, [{bytes: 50_000}, {bytes: 50_000}]));
  const many = Array.from({length: 34}, (_, index) => asset(`public/images/p${index}.webp`, undefined, 10_000));
  assert.ok(!responsive.variantsFit(many, [{bytes: 1}, {bytes: 1}, {bytes: 1}]), "36 images at most");
  assert.ok(!responsive.variantsFit([asset("public/images/big.webp", undefined, 3_900_000)], [{bytes: 200_000}]), "4 MB of images at most");
});

check("JSX runtime: <img> of a manifest original gets srcset, sizes, size, lazy loading; the hero stays eager", async () => {
  const esbuild = require("esbuild-wasm");
  const code = (await esbuild.transform(responsive.jsxRuntimeModule(MANIFEST), {format: "cjs", loader: "js"})).code;
  const runtime = {exports: {}};
  new Function("require", "module", "exports", code)(id => (assert.equal(id, "react/jsx-runtime"), require("react/jsx-runtime")), runtime, runtime.exports);
  const {renderToStaticMarkup} = require("react-dom/server");
  const {jsx, jsxs} = runtime.exports;
  const html = renderToStaticMarkup(jsxs("main", {children: [
    jsx("img", {src: "/images/hero.webp", width: 1536, height: 1024, alt: "Hero", fetchPriority: "high"}),
    jsx("img", {src: "/images/room.webp", alt: "Room"}),
    jsx("img", {src: "/images/room.webp", alt: "Own", srcSet: "/images/room.webp 1024w", loading: "eager"}),
    jsx("img", {src: "/images/other.webp", alt: "Other"}),
  ]}));
  assert.match(html, /<img src="\/images\/hero\.webp" width="1536" height="1024" alt="Hero" fetchPriority="high" srcSet="[^"]+1536w" sizes="100vw" decoding="async"\/>/i);
  assert.doesNotMatch(html.split("<img")[1], /loading=/, "the high-priority hero is not lazy");
  assert.match(html, /alt="Room" srcSet="\/images\/_r\/cdcdcdcdcdcdcdcd-1024x1536\/640\.webp 640w[^"]*" sizes="100vw" width="1024" height="1536" decoding="async" loading="lazy"/);
  assert.match(html, /alt="Own" srcSet="\/images\/room\.webp 1024w" loading="eager"\/>/, "authored srcSet is left alone");
  assert.match(html, /<img src="\/images\/other\.webp" alt="Other"\/>/, "images without copies are untouched");
  assert.throws(() => responsive.jsxRuntimeModule({"/images/x.webp\"</script>": {width: 1, height: 1, srcset: "a"}}), /Invalid/);
  assert.throws(() => responsive.jsxRuntimeModule({"/images/x.webp": {width: 1, height: 1, srcset: "javascript:alert(1) 1w"}}), /Invalid/);
});

const page = body => `<!doctype html><html lang="en"><head></head><body><div id="root">${body}</div></body></html>`;
const publish = (body, options = {}) => renderHostedSnapshot(page(body), "Site", "Desc", "https://site.makeborne.site/", {assetPaths: SITE_FILES, responsiveImages: MANIFEST, requireReactRoot: true, ...options});
const imgs = html => html.match(/<img\b[^>]*>/g) ?? [];

check("snapshot: copies become srcset with sizes and real dimensions; the hero is preloaded from this site only", () => {
  const html = publish('<header><nav><img src="/images/room.webp" width="120" height="40" alt="Logo"></nav></header><main><section><h1>Hi</h1><img src="/images/hero.webp" alt="Hero" loading="eager"></section><section><h2>Room</h2><img src="/images/room.webp" alt="Room" fetchpriority="low"></section></main><footer><img src="/images/room.webp" alt="Footer"></footer>');
  const [logo, hero, room, footer] = imgs(html);
  assert.match(hero, /src="\/images\/hero\.webp" alt="Hero" srcset="\/images\/_r\/abababababababab-1536x1024\/640\.webp 640w, [^"]+, \/images\/hero\.webp 1536w" sizes="100vw" width="1536" height="1024" decoding="async" fetchpriority="high" loading="eager"/);
  for (const other of [logo, room, footer]) {
    assert.match(other, /loading="lazy"/);
    assert.doesNotMatch(other, /fetchpriority/);
  }
  assert.match(logo, /width="120" height="40"/, "authored dimensions are kept");
  const preloads = html.match(/<link rel="preload"[^>]*>/g);
  assert.deepEqual(preloads, [`<link rel="preload" as="image" imagesrcset="${HERO_SRCSET}" imagesizes="100vw" fetchpriority="high">`]);
  assert.ok(html.indexOf("<link rel=\"preload\"") < html.indexOf("<style>"), "the preload comes before render-blocking styles");
});

check("snapshot: the builder's fetchpriority hero wins; otherwise the first large image before the first h2; none after", () => {
  const marked = imgs(publish('<main><img src="/images/room.webp" alt="a"><img src="/images/hero.webp" alt="b" fetchpriority="high"></main>'));
  assert.match(marked[1], /fetchpriority="high" loading="eager"/);
  assert.match(marked[0], /loading="lazy"/);
  const late = publish('<main><h1>Text hero</h1><h2>Next</h2><img src="/images/hero.webp" alt="late"></main>');
  assert.doesNotMatch(late, /fetchpriority|rel="preload"|loading="eager"/, "an image after the first h2 is not guessed as the hero");
  const small = publish('<main><img src="/images/hero.webp" width="64" height="64" alt="icon"><img src="/images/room.webp" alt="big"></main>');
  assert.match(imgs(small)[1], /fetchpriority="high"/);
  assert.match(small, /<link rel="preload" as="image" imagesrcset="\/images\/_r\/cdcdcdcdcdcdcdcd-1024x1536\/640\.webp 640w/);
  const nocopies = publish('<main><img src="/images/plain.webp" width="800" height="600" alt="p"></main>', {assetPaths: new Set([...SITE_FILES, "/images/plain.webp"])});
  assert.match(nocopies, /<link rel="preload" as="image" href="\/images\/plain\.webp" fetchpriority="high">/);
  assert.doesNotMatch(imgs(nocopies)[0], /srcset/);
});

check("sanitiser: srcset, sizes and preload never carry remote, script, data or unlisted URLs", () => {
  const hostile = [
    'https://evil.test/a.webp 640w, /images/hero.webp 1536w',
    '//evil.test/a.webp 640w',
    'javascript:alert(1) 640w',
    'data:image/webp;base64,AAAA 640w',
    '/images/unlisted.webp 640w, /images/hero.webp 1536w',
    '/images/hero.webp 2x',
    '/images/hero.webp 640w" onerror="alert(1)',
    Array.from({length: 9}, (_, index) => `/images/hero.webp ${index + 1}w`).join(", "),
    '/_mb/app-0123456789abcdef.css 640w',
  ];
  for (const srcset of hostile) {
    const html = publish(`<main><img src="/images/plain.webp" srcset="${srcset.replace(/"/g, "&quot;")}" sizes="50vw" alt="x"></main>`, {assetPaths: new Set([...SITE_FILES, "/images/plain.webp", "/_mb/app-0123456789abcdef.css"])});
    assert.doesNotMatch(html, /evil\.test|javascript:|onerror|unlisted|srcset=|imagesrcset|sizes="50vw"|app-0123456789abcdef\.css 640w/, srcset);
  }
  const sizes = publish('<main><img src="/images/hero.webp" sizes="url(https://evil.test) 10px" alt="x"></main>');
  assert.doesNotMatch(sizes, /evil\.test|url\(/);
  assert.match(imgs(sizes)[0], /sizes="100vw"/);
  const remote = publish('<main><img src="https://evil.test/hero.webp" srcset="/images/hero.webp 1536w" alt="x"><img src="/images/hero.webp" alt="ok"></main>');
  assert.doesNotMatch(remote, /evil\.test/);
  assert.equal(imgs(remote).length, 1, "an image whose src is not allowed is still dropped");
  const values = publish('<main><img src="/images/hero.webp" alt="x" fetchpriority="banana" loading="auto" decoding="sync" onload="steal()"></main>');
  assert.match(imgs(values)[0], /decoding="async" fetchpriority="high" loading="eager"/);
  assert.doesNotMatch(values, /banana|loading="auto"|decoding="sync"|onload|steal/);
});

check("portable copies (no published files): data images stay, no srcset and no preload", () => {
  const html = renderHostedSnapshot(page('<main><img src="data:image/webp;base64,AAAA" srcset="/images/hero.webp 1536w" alt="x" width="1536" height="1024"></main>'), "S", "D", "https://x.makeborne.site/", {responsiveImages: MANIFEST});
  assert.match(imgs(html)[0], /src="data:image\/webp;base64,AAAA"[^>]*fetchpriority="high" loading="eager"/);
  assert.doesNotMatch(html, /srcset|rel="preload"/);
});

(async () => {
  let failed = 0;
  for (const [name, run] of checks) {
    try { await run(); console.log(`ok   ${name}`); }
    catch (error) { failed++; console.log(`FAIL ${name}\n     ${error.stack.split("\n").slice(0, 4).join("\n     ")}`); }
  }
  console.log(`\n${checks.length - failed}/${checks.length} responsive image checks passed.`);
  if (failed) process.exitCode = 1;
})();

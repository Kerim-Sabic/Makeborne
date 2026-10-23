/* eslint-disable @typescript-eslint/no-require-imports -- Offline design-system checks: motion, accessibility patterns, design seed, quality gates, image cut-outs (no network, no paid calls). */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);

const {BUILDER_SYSTEM, MOTION_PATTERN, FORM_PATTERN, ROUTE_PATTERN, FONT_FILE_KB, FONT_FALLBACKS, FONT_FALLBACKS_BOLD} = require("./prompt.ts");
const {FONT_CATALOG} = require("./fonts.ts");
const {ProjectFiles} = require("./files.ts");
const {qualityProblems, withoutBlocks} = require("./quality-gates.ts");
const {designSeed, designSeedBlock, detectIndustry, ARCHETYPES} = require("./design-seed.ts");
const {compileWebsite} = require("./compile.ts");
const prices = require("../ai/prices.ts");

const pending = [];
let count = 0;
function check(name, fn) {
  const run = async () => { await fn(); count++; console.log(`PASS ${name}`); };
  pending.push(run);
}

// ---------------------------------------------------------------- the patterns as a real project
const between = (text, start, end) => { const from = text.indexOf(start) + start.length; return text.slice(from, end ? text.indexOf(end, from) : undefined).trim(); };
const revealHook = between(MOTION_PATTERN, "src/useReveal.ts:\n", "\nCall useReveal");
const motionCss = between(MOTION_PATTERN, "src/styles/motion.css:\n");
const formLines = FORM_PATTERN.split("\n");
const jsxStart = formLines.findIndex(line => line.startsWith("{Object.keys(errors)"));
const formStatements = formLines.slice(0, jsxStart).join("\n").replace("// ...send; on accepted === true:", "if (!sent) {") + "\n}";
const formJsx = formLines.slice(jsxStart).join("\n");
const routeStatements = ROUTE_PATTERN.split("\n").filter(line => !line.startsWith("// In App:")).join("\n");

function sampleProject() {
  const files = new ProjectFiles();
  files.write("index.html", '<!doctype html><html lang="en"><head><title>T</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  files.write("src/main.tsx", 'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles/motion.css";\ncreateRoot(document.getElementById("root")!).render(<App />);\n');
  files.write("src/useReveal.ts", revealHook);
  files.write("src/styles/motion.css", motionCss + "\n.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }\n");
  files.write("src/components/Enquiry.tsx", `import { useRef, useState, type FormEvent } from "react";
function validate(data: FormData): Record<string, string> {
  const found: Record<string, string> = {};
  if (!String(data.get("email") ?? "").includes("@")) found.email = "Enter an email address like name@example.com";
  return found;
}
export default function Enquiry() {
  const [sent, setSent] = useState(false);
${formStatements}
  return (
    <form onSubmit={onSubmit} noValidate>
${formJsx.replace("…", "Thanks, your enquiry was sent.")}
      <button type="submit">Send the enquiry</button>
    </form>
  );
}
`);
  files.write("src/App.tsx", `import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useReveal } from "./useReveal";
import Enquiry from "./components/Enquiry";
const SITE_NAME = "Saffron Table";
export default function App() {
${routeStatements}
  useReveal(path);
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <main id="main">
        {PAGES[path] ? <h1>{title}</h1> : <NotFound />}
        <ul>{["a", "b"].map((item, index) => <li key={item} data-reveal style={{ "--i": index } as CSSProperties}>{item}</li>)}</ul>
        <Enquiry />
      </main>
      <p id="route-status" className="sr-only" aria-live="polite"></p>
    </>
  );
}
function NotFound() { return <><h1>Page not found</h1><p>That page does not exist.</p><a href="#/">Back to the home page</a></>; }
`);
  return files;
}

/** In-memory TypeScript program over the project (react types from node_modules), like the eval's W2. */
function typecheck(files) {
  const root = path.join(process.cwd(), ".design-system-check-virtual").split(path.sep).join("/");
  const key = file => path.resolve(file).split(path.sep).join("/").toLowerCase();
  const memory = new Map([...files].map(([file, content]) => [key(`${root}/${file}`), content]));
  const inside = file => key(file).startsWith(key(root));
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"], types: ["react", "react-dom"],
    typeRoots: [path.join(process.cwd(), "node_modules", "@types")] };
  const host = ts.createCompilerHost(options, true);
  const folders = new Set([key(root), ...[...files.keys()].flatMap(file => file.split("/").slice(0, -1).map((_, index, parts) => key(`${root}/${parts.slice(0, index + 1).join("/")}`)))]);
  host.writeFile = () => {};
  host.realpath = file => file;
  host.getCurrentDirectory = () => root;
  host.directoryExists = folder => folders.has(key(folder)) || (!inside(folder) && ts.sys.directoryExists(folder));
  host.getDirectories = folder => (inside(folder) ? [] : ts.sys.getDirectories(folder));
  host.fileExists = file => memory.has(key(file)) || (!inside(file) && ts.sys.fileExists(file));
  host.readFile = file => memory.get(key(file)) ?? (inside(file) ? undefined : ts.sys.readFile(file));
  host.getSourceFile = (fileName, version) => {
    const content = memory.get(key(fileName)) ?? (inside(fileName) ? undefined : ts.sys.readFile(fileName));
    return content === undefined ? undefined : ts.createSourceFile(fileName, content, version, true);
  };
  // CSS imports are side-effect modules for TypeScript.
  memory.set(key(`${root}/css.d.ts`), 'declare module "*.css";');
  const names = [...files.keys()].filter(file => /\.tsx?$/.test(file)).map(file => `${root}/${file}`).concat(`${root}/css.d.ts`);
  const program = ts.createProgram(names, options, host);
  return ts.getPreEmitDiagnostics(program).map(item => `${item.file ? path.basename(item.file.fileName) : ""}: ${ts.flattenDiagnosticMessageText(item.messageText, " ")}`);
}

check("motion pattern: on-screen blocks are shown before the hidden state exists; all hidden states sit inside both gates", () => {
  assert.match(revealHook, /useLayoutEffect/, "runs before paint, so the snapshot never flashes");
  const marking = revealHook.indexOf('setAttribute("data-in"'), gating = revealHook.indexOf('classList.add("js")');
  assert.ok(marking > 0 && gating > marking, "blocks above the fold get data-in before html.js is added");
  assert.match(revealHook, /removeAttribute\("data-in"\)/, "a hydrated or reused snapshot still animates below the fold");
  assert.match(revealHook, /prefers-reduced-motion: reduce/, "reduced motion shows everything at once");
  assert.doesNotMatch(revealHook, /addEventListener\("scroll"|style\.opacity|setTimeout/);
  const outside = withoutBlocks(motionCss, /@media\s*\(\s*prefers-reduced-motion:\s*no-preference\s*\)\s*\{/g);
  assert.doesNotMatch(outside, /opacity:\s*0(?![.\d])|inset\(0 0 100% 0\)|@keyframes|animation-timeline/, "nothing hides or moves outside the no-preference gate");
  for (const rule of motionCss.match(/[^{}]+\{[^{}]*(?:opacity:\s*0(?![.\d])|inset\(0 0 100% 0\))[^{}]*\}/g) ?? []) {
    if (/@keyframes|from|to/.test(rule.split("{")[0])) continue;
    assert.match(rule.split("{")[0], /html\.js/, `hidden state is scoped under html.js: ${rule.trim().slice(0, 80)}`);
  }
  assert.match(motionCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(motionCss, /transition: all|bounce|elastic/);
  assert.match(motionCss, /@supports \(animation-timeline: view\(\)\)/, "scroll-linked effects only where supported");
});

check("motion, form and route patterns build, type-check and pass the quality gates as a real project", async () => {
  const files = sampleProject();
  assert.deepEqual(files.problems(), []);
  assert.deepEqual(qualityProblems({ files: files.files, changed: files.changed, routes: [] }), []);
  const compiled = await compileWebsite(files.files);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  assert.deepEqual(typecheck(files.files), []);
});

check("accessibility patterns: linked field errors, focused summary and success, page titles, focus and a not-found page", () => {
  for (const needle of ['aria-invalid', 'aria-describedby={errors.email ? "email-error"', 'role="alert"', "summaryRef.current?.focus()", 'role="status"', "doneRef.current?.focus()", "tabIndex={-1}", 'htmlFor="email"', 'autoComplete="email"']) assert.ok(FORM_PATTERN.includes(needle), needle);
  for (const needle of ["document.title =", 'heading?.focus({ preventScroll: true })', "first.current", "aria-live", "Page not found", 'addEventListener("hashchange"']) assert.ok(ROUTE_PATTERN.includes(needle), needle);
  assert.ok(BUILDER_SYSTEM.includes(FORM_PATTERN) && BUILDER_SYSTEM.includes(ROUTE_PATTERN));
  assert.match(BUILDER_SYSTEM, /move focus to the summary/);
  assert.match(BUILDER_SYSTEM, /first link goes to the first invalid field/);
  assert.match(BUILDER_SYSTEM, /never move focus on the first load/);
  // Contracts that must survive the rewrite (audit reconciliation, 2026-10-20).
  for (const rule of [/a skip link/, /scroll-margin-top/, /accepted === true/, /touch targets of at least 44px/, /prefers-reduced-motion: reduce/, /untrusted content/]) assert.match(BUILDER_SYSTEM, rule);
});

check("quality gates: report missing contracts once, accept compliant and one-line CSS, ignore untouched files", () => {
  const form = new Map([["src/Form.tsx", 'export default function F() { return <form><label htmlFor="e">E</label><input id="e" /></form>; }']]);
  const gaps = qualityProblems({ files: form, changed: new Set(form.keys()) });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /aria-invalid.*aria-describedby.*role="alert".*focus/);
  assert.deepEqual(qualityProblems({ files: form, changed: new Set() }), [], "an untouched older form is left alone");
  const enquiry = new Map([["src/Form.tsx", 'fetch("/_mb/enquiries"); <form aria-invalid aria-describedby role="alert" /> x.focus()']]);
  assert.match(qualityProblems({ files: enquiry, changed: new Set(enquiry.keys()) }).join(" "), /role="status"/);
  const pages = new Map([["src/App.tsx", 'addEventListener("hashchange", go);']]);
  assert.match(qualityProblems({ files: pages, changed: new Set(pages.keys()) }).join(" "), /document\.title.*focus.*aria-live.*Page not found/);
  assert.match(qualityProblems({ files: new Map([["src/App.tsx", "x"]]), changed: new Set(["src/App.tsx"]), routes: [{ path: "/" }, { path: "/menu" }] }).join(" "), /several pages/);
  const oneLine = new Map([["src/m.css", "@media (prefers-reduced-motion: no-preference) { html.js [data-reveal] { opacity: 0 } html.js [data-reveal][data-in] { opacity: 1 } } @media (prefers-reduced-motion: reduce) { * { transition: none } }"]]);
  assert.deepEqual(qualityProblems({ files: oneLine, changed: new Set(oneLine.keys()) }), []);
  const ungated = new Map([["src/m.css", "[data-reveal] { opacity: 0 } @media (prefers-reduced-motion: reduce) { * { transition: none } }"]]);
  assert.match(qualityProblems({ files: ungated, changed: new Set(ungated.keys()) }).join(" "), /outside @media \(prefers-reduced-motion: no-preference\)/);
  const noReduce = new Map([["src/m.css", "@keyframes spin { to { transform: rotate(1turn) } }"]]);
  assert.match(qualityProblems({ files: noReduce, changed: new Set(noReduce.keys()) }).join(" "), /no @media \(prefers-reduced-motion: reduce\)/);
  const images = new Map([["src/Hero.tsx", '<img src="/images/hero.webp" alt="Bread" onLoad={() => ready()} />\n<img\n  src="/images/side.webp"\n  width="1024"\n  height="1536"\n  alt=""\n/>']]);
  const bars = new Map([["src/m.css", ".callbar { position: fixed; bottom: 0; left: 0; right: 0 } .hdr { position: sticky; top: 0 } .fab{position:fixed;right:16px;bottom:16px}"]]);
  const barProblems = qualityProblems({ files: bars, changed: new Set(bars.keys()) }).join(" ");
  assert.match(barProblems, /Remove the fixed bottom bar or floating button \(\.callbar, \.fab\)/);
  assert.doesNotMatch(barProblems, /\.hdr/, "a sticky header is fine");
  const unsized = qualityProblems({ files: images, changed: new Set(images.keys()) }).join(" ");
  assert.match(unsized, /\/images\/hero\.webp/);
  assert.doesNotMatch(unsized, /side\.webp/);
});

check("design seed: deterministic, fitted to the industry and spread across projects", () => {
  const briefs = JSON.parse(fs.readFileSync("scripts/eval/briefs/index.json", "utf8"));
  const expected = { restaurant: "food", saas: "saas", professional: "professional", creator: "creator", ecommerce: "commerce", wellness: "wellness", trades: "trades", property: "property", events: "events", civic: "civic" };
  let matched = 0, total = 0;
  for (const id of briefs.order ?? briefs.items?.map(item => item.id) ?? []) {
    const brief = JSON.parse(fs.readFileSync(`scripts/eval/briefs/${id}.json`, "utf8"));
    if (brief.format !== "website") continue;
    total++;
    const got = detectIndustry(brief.brief);
    if (got === expected[brief.direction] || (brief.direction === "events" && got === "weddings")) matched++;
  }
  assert.ok(total >= 20 && matched / total >= 0.85, `industry detection ${matched}/${total}`);
  const one = designSeed({ seed: "project-a", brief: "A sourdough bakery in Leith", images: true });
  assert.deepEqual(designSeed({ seed: "project-a", brief: "A sourdough bakery in Leith", images: true }), one, "same project, same seed");
  const families = new Set(FONT_CATALOG.map(font => font.family));
  const archetypes = {}, pairings = new Set();
  for (let index = 0; index < 400; index++) {
    const seed = designSeed({ seed: `p-${index}`, brief: index % 2 ? "Heating and plumbing repairs in Saint Paul" : "Employment solicitors in Manchester", images: index % 4 !== 0 });
    archetypes[seed.archetype] = (archetypes[seed.archetype] ?? 0) + 1;
    pairings.add(seed.pairing.join("+"));
    for (const family of seed.pairing) assert.ok(families.has(family), family);
    if (index % 4 === 0) { assert.notEqual(seed.archetype, "Photographic"); assert.notEqual(seed.ground, "photographic"); }
  }
  assert.ok(Object.keys(archetypes).every(name => ARCHETYPES.includes(name)));
  assert.ok((archetypes["Type as image"] ?? 0) / 400 < 0.15, "the over-used archetype is rarely suggested");
  assert.ok(Math.max(...Object.values(archetypes)) / 400 < 0.45 && Object.keys(archetypes).length >= 4, JSON.stringify(archetypes));
  assert.ok(pairings.size >= 8, `pairings ${pairings.size}`);
  for (let index = 0; index < 200; index++) {
    const quiet = designSeed({ seed: `q-${index}`, brief: index % 2 ? "Employment solicitors in Manchester" : "A family dental clinic in Leeds", images: true });
    assert.equal(quiet.tone, "quiet");
    assert.notEqual(quiet.ground, "dark", "quiet subjects never get a dark ground");
    assert.doesNotMatch(quiet.motion, /marquee|depth/);
    assert.doesNotMatch(quiet.compositions.join(" "), /bento|stat band/);
    const loud = designSeed({ seed: `l-${index}`, brief: "A basement club night with gigs and DJs", images: false });
    assert.equal(loud.tone, "loud");
  }
  const block = designSeedBlock({ seed: "x", brief: "Climbing gym", images: false, brand: true });
  // The tone line no longer names the ground (the seed's ground line does, since round 3), so the light-ground rule
  // for quiet subjects is checked on the seeds themselves: never dark, and light, pale or tinted on most projects.
  assert.match(block, /- Tone: quiet: generous space/);
  const quietGrounds = Array.from({ length: 200 }, (_, index) => designSeed({ seed: `ql-${index}`, brief: index % 2 ? "Employment solicitors in Manchester" : "A family dental clinic in Leeds", images: true }).ground);
  assert.ok(!quietGrounds.includes("dark") && !quietGrounds.includes("colour flood"), "quiet subjects never get a dark or colour-flooded ground");
  assert.ok(quietGrounds.filter(ground => /light|pale tint/.test(ground)).length >= 150, "quiet subjects get a light ground on at least three projects in four");
  assert.match(block, /- Motif: one quiet visual motif/);
  assert.match(block, /^<design_seed>[\s\S]*the brand kit[\s\S]*<\/design_seed>$/);
  assert.match(BUILDER_SYSTEM, /<design_seed>/);
});

check("font sizes in the prompt match the runtime files and drive a font budget", () => {
  for (const font of FONT_CATALOG) {
    const kb = FONT_FILE_KB[font.family];
    assert.ok(kb && kb[0] > 0, `${font.family} has a size`);
    assert.equal(Boolean(font.italic), kb.length === 2, `${font.family} italic size listed exactly when it has an italic`);
    assert.ok(BUILDER_SYSTEM.includes(`~${kb[0]} KB`));
    const file = path.join("public", "builder-runtime", "fonts", `${font.id}-normal.woff2`);
    if (fs.existsSync(file)) {
      const actual = fs.statSync(file).size / 1024;
      assert.ok(Math.abs(actual - kb[0]) <= Math.max(8, kb[0] * 0.25), `${font.family}: prompt ${kb[0]} KB, runtime ${actual.toFixed(0)} KB`);
    }
  }
  for (const font of FONT_CATALOG) {
    const [local, size, ascent, descent] = FONT_FALLBACKS[font.family] ?? [];
    assert.ok(["Georgia", "Arial", "Courier New"].includes(local), `${font.family} fallback face`);
    assert.ok(size > 60 && size < 150 && ascent > 60 && ascent < 140 && descent > 10 && descent < 50, `${font.family} metrics are plausible`);
    assert.equal(local === "Georgia", font.category === "serif", `${font.family}: serif families fall back to Georgia`);
    assert.ok(BUILDER_SYSTEM.includes(`Fallback: "${font.family} Fallback", `), `${font.family} stack names its fallback face`);
    const bold = FONT_FALLBACKS_BOLD[font.family];
    // Families with several weights get a real bold face (measured: one size-adjust cannot fit 400 and 800).
    assert.equal(Boolean(bold), font.weight.includes(" "), `${font.family}: a bold face exactly when the family has several weights`);
    if (bold) assert.ok(bold[0] === `${local} Bold` && bold[1] > 60 && bold[1] < 150, `${font.family} bold face`);
  }
  assert.match(BUILDER_SYSTEM, /@font-face \{ font-family: "Archivo Fallback"; src: local\("Arial"\); font-weight: 100 599; size-adjust: 98%;[^}]*\} @font-face \{ font-family: "Archivo Fallback"; src: local\("Arial Bold"\); font-weight: 600 900; size-adjust: 98\.7%;/);
  assert.match(BUILDER_SYSTEM, /Font budget: about 100 KB/);
  assert.match(BUILDER_SYSTEM, /any <em>, <i>, <cite>, <address>, <dfn>, <var> or font-style: italic anywhere in the project loads them/);
});

check("image cut-outs: transparency only on models that support it; 2.5 bounds only where measured (D8, 2026-10-21)", () => {
  assert.equal(prices.supportsTransparentImages("gpt-image-2"), false, "gpt-image-2 refused transparent live (400 invalid_value)");
  assert.equal(prices.supportsTransparentImages("gpt-image-2.5-flare"), true);
  assert.throws(() => prices.assertSupportedImageRequest({ model: "gpt-image-2", quality: "medium", size: "1024x1024", background: "transparent" }), error => error.code === "UNSUPPORTED_AI_CONFIG");
  assert.throws(() => prices.assertSupportedImageRequest({ model: "gpt-image-2", quality: "medium", size: "1024x1024", background: "checkerboard" }), error => error.code === "UNSUPPORTED_AI_CONFIG");
  prices.assertSupportedImageRequest({ model: "gpt-image-2", quality: "medium", size: "1024x1024", background: "opaque" });
  for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
    prices.assertSupportedImageRequest({ model, quality: "medium", size: "1024x1024", background: "transparent" });
    assert.throws(() => prices.assertSupportedImageRequest({ model, quality: "low", size: "1024x1536" }), error => error.code === "UNSUPPORTED_AI_CONFIG", `${model}: unmeasured cell refused`);
  }
});

check("image cut-outs are trimmed to the subject with alpha kept; opaque results are reported as opaque", async () => {
  const sharp = require("sharp");
  const {prepareImageBytes} = require("./images.ts");
  const {imageReadyMessage} = require("./agent.ts");
  const object = await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 120, height: 80, channels: 4, background: { r: 200, g: 120, b: 40, alpha: 1 } } }).png().toBuffer(), left: 150, top: 110 }]).png().toBuffer();
  const cut = await prepareImageBytes(object, { transparent: true });
  const meta = await sharp(cut.bytes).metadata();
  assert.equal(cut.transparent, true);
  assert.equal(meta.format, "webp");
  assert.equal(meta.hasAlpha, true);
  assert.ok(meta.width >= 120 && meta.width <= 145 && meta.height >= 80 && meta.height <= 105, `${meta.width}x${meta.height}`);
  const opaque = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#336699" } }).png().toBuffer();
  assert.equal((await prepareImageBytes(opaque, { transparent: true })).transparent, false);
  const photo = await prepareImageBytes(object);
  assert.equal(photo.transparent, false);
  assert.equal((await sharp(photo.bytes).metadata()).width, 400, "photos are never trimmed");
  assert.match(imageReadyMessage({ url: "/images/cup.webp", width: 916, height: 812, transparent: true }, "square", "cutout"), /src="\/images\/cup\.webp" width="916" height="812" \(cutout, square\)\. Transparent cut-out/);
  assert.match(imageReadyMessage({ url: "/images/cup.webp", width: 1024, height: 1024, transparent: false }, "square", "cutout"), /came back opaque/);
  assert.equal(imageReadyMessage({ url: "/images/h.webp" }, "landscape", "photo"), 'Image ready. Use src="/images/h.webp" (photo, landscape).');
});

check("the platform badge's accessible name contains its visible text (no aria-label)", async () => {
  const {composeSiteDocument} = await import(require("node:url").pathToFileURL(path.resolve("infra/customer-sites/site-policy.js")).href);
  const html = composeSiteDocument("<!doctype html><html><body><main>x</main></body></html>", { branding: true, interactive: false });
  const badge = /<footer data-makeborne-attribution[\s\S]*?<\/footer>/.exec(html)[0];
  assert.doesNotMatch(badge, /aria-label/);
  assert.match(badge, /<\/span>Made with Makeborne<span style="position:absolute;[^"]*clip:rect\(0 0 0 0\)[^"]*">, opens in a new tab<\/span>/);
});

(async () => {
  for (const run of pending) await run();
  console.log(`${count} design-system checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });

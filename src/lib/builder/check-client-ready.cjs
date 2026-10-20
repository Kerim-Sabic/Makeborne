/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks: server-side compile at finish and the client-ready check (no network, no paid calls). */
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);
globalThis.fetch = async () => { throw new Error("Network forbidden"); };

const {compileWebsite, compileVerdict, compilerSelfTest} = require("./compile.ts");
const {clientReadyCheck, clientReadySummary, contrastRatio} = require("./client-ready.ts");
const {ProjectFiles} = require("./files.ts");

let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }

const INDEX = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ovenbird Bakehouse</title><meta name="description" content="Wood-fired sourdough baked daily in Leith."></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';
const MAIN = 'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\ncreateRoot(document.getElementById("root")!).render(<App />);';
/** A clean project: compiles and has no client-ready findings. */
function clean() {
  return new Map([
    ["index.html", INDEX],
    ["src/main.tsx", MAIN],
    ["src/App.tsx", [
      'import { ArrowRight, MapPin } from "lucide-react";',
      'import "@makeborne/fonts/fraunces.css";',
      'import Menu from "./components/Menu";',
      'import content from "./data/site.json";',
      "",
      "export default function App() {",
      "  return (",
      "    <main>",
      '      <header><a href="#menu">See the menu <ArrowRight size={16} aria-hidden="true" /></a></header>',
      "      <h1>{content.headline}</h1>",
      '      <img src="/images/hero.webp" alt="Loaves cooling on a rack" width={1200} height={800} />',
      "      <Menu />",
      '      <section id="visit"><p><MapPin size={16} aria-hidden="true" /> 14 Fennel Street, Leith</p>',
      '        <a href="tel:+441315550123">Call the bakery</a> <a href="mailto:hello@ovenbird.co.uk">Email us</a> <a href="/about">Our story</a></section>',
      '      <p style={{ color: "#1d1d24", background: "#faf7f2" }}>Open Tuesday to Sunday.</p>',
      "    </main>",
      "  );",
      "}",
    ].join("\n")],
    ["src/components/Menu.tsx", 'const ITEMS = [{ name: "Country loaf", price: "£5" }, { name: "Rye", price: "£6" }];\nexport default function Menu() {\n  return <section id="menu"><h2>Menu</h2><ul>{ITEMS.map(item => <li key={item.name}>{item.name} · {item.price}</li>)}</ul><a href="#visit">Find us</a></section>;\n}'],
    ["src/data/site.json", '{ "headline": "Sourdough from a wood-fired oven" }'],
    ["src/styles.css", ":root { --ink: #1d1d24; --paper: #faf7f2; }\nbody { margin: 0; color: var(--ink); background: var(--paper); font-family: \"Fraunces\", Georgia, serif; }\n.hero { background: url(/images/hero.webp) center / cover; }"],
  ]);
}
const routes = [{path: "/", title: "Home"}, {path: "/about", title: "About"}];
const assets = [{path: "public/images/hero.webp"}];
const source = files => ({files: [...files].map(([path, content]) => ({path, content})), routes, assets});

(async () => {
  // ---- compile at finish ---------------------------------------------------
  await check("the admin compiler self-test compiles (System tab shows it per deployment)", async () => {
    const outcome = await compilerSelfTest();
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    const read = file => fs.readFileSync(require("node:path").join(__dirname, ...file), "utf8");
    assert.ok(read(["..", "..", "app", "admin", "page.tsx"]).includes("compiler: await compilerSelfTest()"), "the System tab runs the self-test");
    assert.ok(read(["..", "..", "..", "next.config.ts"]).includes('"/admin": ["./node_modules/esbuild-wasm/package.json"'), "the admin route traces the compiler files");
  });
  await check("a valid project compiles in memory without network or npm", async () => {
    const outcome = await compileWebsite(clean());
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    assert.ok(outcome.bytes > 0);
    console.log(`     first compile, including the esbuild-wasm service start: ${outcome.ms} ms`);
    assert.deepEqual(await compileVerdict(clean()), {status: "passed"});
  });

  await check("a typical generated project compiles quickly (cold and warm)", async () => {
    // About the size of a Medium-effort site: 12 components, ~45 KB of source.
    const files = clean();
    const sections = Array.from({length: 12}, (_, index) => `Section${index}`);
    for (const name of sections) {
      files.set(`src/components/${name}.tsx`, `import { Check } from "lucide-react";\nimport type { CSSProperties } from "react";\nimport { useState } from "react";\nconst ROWS = ${JSON.stringify(Array.from({length: 24}, (_, row) => ({id: `${name}-${row}`, title: `Row ${row} of ${name}`, text: "Sourdough, rye and seasonal bakes from a small wood-fired oven. ".repeat(2)})))};\nexport default function ${name}() {\n  const [open, setOpen] = useState<string | null>(null);\n  return <section id="${name.toLowerCase()}" style={{ "--i": 1 } as CSSProperties}><h2>${name}</h2><ul>{ROWS.map(row => <li key={row.id}><button type="button" aria-expanded={open === row.id} onClick={() => setOpen(open === row.id ? null : row.id)}><Check size={14} aria-hidden="true" />{row.title}</button>{open === row.id && <p>{row.text}</p>}</li>)}</ul></section>;\n}\n`);
    }
    files.set("src/App.tsx", `${sections.map(name => `import ${name} from "./components/${name}";`).join("\n")}\nexport default function App() { return <main>${sections.map(name => `<${name} />`).join("")}</main>; }`);
    const bytes = [...files.values()].reduce((total, text) => total + text.length, 0);
    const first = await compileWebsite(files);
    const second = await compileWebsite(files);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.ok, true);
    assert.ok(second.ms < 5_000, `warm compile took ${second.ms} ms`);
    console.log(`     typical project (${files.size} files, ${Math.round(bytes / 1000)} KB): ${first.ms} ms, then ${second.ms} ms`);
  });

  await check("a syntax error fails the compile with file, line and the source line", async () => {
    const files = clean();
    files.set("src/components/Menu.tsx", "export default function Menu() {\n  return <section><h2>Menu</h2>;\n}");
    const outcome = await compileWebsite(files);
    assert.equal(outcome.ok, false);
    assert.match(outcome.errors.join("\n"), /^src\/components\/Menu\.tsx:\d+:\d+: /m);
    const verdict = await compileVerdict(files);
    assert.equal(verdict.status, "failed");
    const problems = verdict.problems;
    assert.equal(problems.length, 1);
    assert.match(problems[0], /does not compile/);
    assert.match(problems[0], /src\/components\/Menu\.tsx/);
  });

  await check("missing files and missing named exports fail the compile (the static check misses the latter)", async () => {
    const missingFile = clean();
    missingFile.set("src/App.tsx", 'import Hero from "./components/Hero";\nexport default function App() { return <Hero />; }');
    const outcome = await compileWebsite(missingFile);
    assert.equal(outcome.ok, false);
    assert.match(outcome.errors.join("\n"), /Cannot find "\.\/components\/Hero" imported from src\/App\.tsx/);

    const missingExport = clean();
    missingExport.set("src/App.tsx", 'import { Menu } from "./components/Menu";\nexport default function App() { return <Menu />; }');
    const files = new ProjectFiles();
    for (const [path, content] of missingExport) files.write(path, content);
    files.addAsset({id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", path: "public/images/hero.webp", sha256: "a".repeat(64), bytes: 9, mediaType: "image/webp"});
    assert.deepEqual(files.problems(), [], "static checks pass");
    const exported = await compileWebsite(missingExport);
    assert.equal(exported.ok, false);
    assert.match(exported.errors.join("\n"), /No matching export in "src\/components\/Menu\.tsx" for import "Menu"/);
  });

  await check("packages outside the toolchain, unknown fonts and a missing entry fail the compile", async () => {
    const files = clean();
    files.set("src/App.tsx", 'import { motion } from "framer-motion";\nexport default function App() { return <motion.div />; }');
    assert.match((await compileWebsite(files)).errors.join("\n"), /"framer-motion" is not installed/);
    files.set("src/App.tsx", 'import "@makeborne/fonts/papyrus.css";\nexport default function App() { return null; }');
    assert.match((await compileWebsite(files)).errors.join("\n"), /not in the font library/);
    files.delete("src/main.tsx");
    assert.deepEqual(await compileWebsite(files), {ok: false, ms: 0, errors: ["Missing src/main.tsx."]});
  });

  await check("an unavailable or timed-out compiler is unverified, never a pass, and is logged", async () => {
    const logged = [], original = console.error;
    console.error = line => logged.push(String(line));
    try {
      assert.deepEqual(await compileVerdict(clean(), async () => ({ok: null, ms: 3, reason: "spawn node ENOENT"})), {status: "unverified", reason: "spawn node ENOENT"});
      // A real timeout from compileWebsite (1 ms budget) is infrastructure, not a project error and not a pass.
      const timedOut = await compileWebsite(clean(), {timeoutMs: 1});
      if (timedOut.ok === null) {
        assert.match(timedOut.reason, /timed out/);
        assert.equal((await compileVerdict(clean(), async () => timedOut)).status, "unverified");
      } else assert.equal(timedOut.ok, true, "a warm engine may finish within 1 ms; it must still never report a failure for a valid project");
    } finally { console.error = original; }
    assert.match(logged.join("\n"), /builder_compile_unavailable/);
  });

  // ---- client-ready check ---------------------------------------------------
  await check("a clean project has zero client-ready findings", async () => {
    const findings = clientReadyCheck(source(clean()));
    assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
    assert.deepEqual(clientReadySummary(findings), {error: 0, warning: 0, info: 0});
  });

  await check("placeholder text and made-up contact details are errors", async () => {
    const files = clean();
    files.set("src/components/Footer.tsx", 'export default function Footer() {\n  return <footer>\n    <p>Lorem ipsum dolor sit amet.</p>\n    <p>[Street address], [Your phone]</p>\n    <p>Your Company</p>\n    <a href="mailto:hello@example.com">Email</a>\n    <p>Call (555) 123-4567 or visit 123 Main Street, Anytown.</p>\n    <p>Opening hours TBD</p>\n    <label>Your name<input /></label>\n  </footer>;\n}');
    files.set("src/content/team.json", '{ "lead": "Jane Doe" }');
    const findings = clientReadyCheck(source(files));
    const placeholder = findings.find(finding => finding.rule === "placeholder-text");
    assert.equal(placeholder.severity, "error");
    assert.deepEqual(placeholder.locations, ["src/components/Footer.tsx:3", "src/components/Footer.tsx:4", "src/components/Footer.tsx:5", "src/content/team.json:1"]);
    const contact = findings.find(finding => finding.rule === "placeholder-contact");
    assert.ok(contact.locations.includes("src/components/Footer.tsx:6") && contact.locations.includes("src/components/Footer.tsx:7"), JSON.stringify(contact));
    assert.deepEqual(findings.find(finding => finding.rule === "unfinished-note").locations, ["src/components/Footer.tsx:8"]);
    assert.ok(!findings.some(finding => finding.locations.includes("src/components/Footer.tsx:9")), "a form label such as “Your name” is not a placeholder");
    assert.equal(findings[0].severity, "error", "errors sort first");
  });

  await check("href=\"#\", empty links, dead routes and missing sections are found in markup and navigation data", async () => {
    const files = clean();
    files.set("src/components/Nav.tsx", 'const LINKS = [{ label: "Home", href: "/" }, { label: "Shop", href: "#" }, { label: "Prices", href: "/pricing" }, { label: "Story", href: "/about#team" }];\nexport default function Nav() {\n  return <nav>{LINKS.map(link => <a key={link.label} href={link.href}>{link.label}</a>)}\n    <a href="#">Book now</a>\n    <a href={"#"}>Gift cards</a>\n    <a href="tel:">Call</a>\n    <a href="#newsletter">Newsletter</a>\n    <a href="/menu.pdf">Menu (PDF)</a>\n    <a href="#top">Back to top</a>\n  </nav>;\n}');
    const findings = clientReadyCheck(source(files));
    const by = rule => findings.find(finding => finding.rule === rule);
    assert.deepEqual(by("empty-link").locations, ["src/components/Nav.tsx:4", "src/components/Nav.tsx:5", "src/components/Nav.tsx:6", "src/components/Nav.tsx:1"]);
    assert.deepEqual(by("dead-route").locations, ["src/components/Nav.tsx:8 (/menu.pdf)", "src/components/Nav.tsx:1 (/pricing)"]);
    assert.deepEqual(by("missing-anchor").locations, ["src/components/Nav.tsx:7 (#newsletter)", "src/components/Nav.tsx:1 (/about#team)"]);
    assert.equal(by("dead-route").severity, "error");
  });

  await check("images without alt, without dimensions, missing or from placeholder services are found", async () => {
    const files = clean();
    files.set("src/components/Gallery.tsx", 'export default function Gallery({ extra }: { extra: object }) {\n  return <div>\n    <img src="/images/hero.webp" />\n    <img src="/images/hero.webp" alt="" width={10} height={10} />\n    <img src="/images/oven.webp" alt="The oven" width="800" height="600" />\n    <img src="https://via.placeholder.com/600x400" alt="Placeholder" width={600} height={400} />\n    <img {...extra} src="/images/hero.webp" />\n    <img src={`/images/${"hero"}.webp`} onLoad={() => { if (extra) { console.log("x > y"); } }} alt="Loaded" width={1} height={1} />\n  </div>;\n}');
    files.set("src/styles.css", `${clean().get("src/styles.css")}\n.band { background-image: url("/images/missing-band.webp"); }`);
    const findings = clientReadyCheck(source(files));
    const by = rule => findings.find(finding => finding.rule === rule);
    assert.deepEqual(by("image-alt").locations, ["src/components/Gallery.tsx:3"]);
    assert.deepEqual(by("image-size").locations, ["src/components/Gallery.tsx:3"]);
    assert.deepEqual(by("missing-image").locations, ["src/styles.css:4 (/images/missing-band.webp)", "src/components/Gallery.tsx:5 (/images/oven.webp)"]);
    assert.deepEqual(by("placeholder-image").locations, ["src/components/Gallery.tsx:6"]);
  });

  await check("low contrast from literal colours, generic titles, missing language and mismatched link labels", async () => {
    assert.equal(contrastRatio("#000", "#fff"), 21);
    assert.equal(contrastRatio("#777", "#fff"), 4.48);
    assert.equal(contrastRatio("rgba(0,0,0,.5)", "#fff"), null, "translucent colours are not guessed");
    const files = clean();
    files.set("index.html", '<!doctype html><html><head><title>Vite + React + TS</title></head><body><div id="root"></div></body></html>');
    files.set("src/styles.css", ":root { --muted: #9a9aa6; --paper: #ffffff; }\n.note { color: var(--muted); background: var(--paper); }\n.ok { color: #222; background: #fff; }\n.hero { color: #fff; background: linear-gradient(#000, #333); }");
    files.set("src/components/Badge.tsx", 'export default function Badge() {\n  return <div>\n    <p style={{ color: "#aaa", backgroundColor: "#fff" }}>Faint</p>\n    <a href="#menu" aria-label="Open the menu">Menu</a>\n    <a href="#menu" aria-label="Skip to bookings">See the menu</a>\n  </div>;\n}');
    const findings = clientReadyCheck(source(files));
    const by = rule => findings.find(finding => finding.rule === rule);
    assert.deepEqual(by("low-contrast").locations, ["src/styles.css:2 .note (2.78:1)", "src/components/Badge.tsx:3 (2.32:1)"]);
    assert.deepEqual(by("link-name").locations, ["src/components/Badge.tsx:5 (“See the menu” vs “Skip to bookings”)"]);
    assert.equal(by("page-title").severity, "warning");
    assert.equal(by("meta-description").severity, "info");
    assert.equal(by("html-lang").severity, "info");
  });

  await check("rendered pages add what code builds from data, without double-reporting the platform badge", async () => {
    const findings = clientReadyCheck({...source(clean()), pages: [
      {path: "/", html: '<!doctype html><html lang="en"><body><main id="top"><a href="#">Order</a><img src="/images/hero.webp"><p>Call [Your phone]</p><a href="/gallery">Gallery</a></main><footer data-makeborne-attribution><a href="https://makeborne.com/" aria-label="Made with Makeborne">Made with Makeborne</a></footer></body></html>'},
      {path: "/about", html: '<!doctype html><html lang="en"><body><main><h1>About</h1></main></body></html>'},
    ]});
    const by = rule => findings.find(finding => finding.rule === rule);
    assert.deepEqual(by("empty-link").locations, ["page /"]);
    assert.deepEqual(by("dead-route").locations, ["page / (/gallery)"]);
    assert.deepEqual(by("image-alt").locations, ["page /"]);
    assert.deepEqual(by("placeholder-text").locations, ["page /"]);
    assert.equal(findings.filter(finding => finding.locations.some(location => location.startsWith("page /about"))).length, 0);
  });

  await check("malformed percent-encoding in links becomes a located finding; every other check still runs", async () => {
    const files = clean();
    files.set("src/components/Broken.tsx", [
      'const NAV = [{ label: "Odd", href: "#%" }, { label: "Odd page", href: "/about#%" }];',
      "export default function Broken() {",
      "  return <nav>{NAV.map(item => <a key={item.label} href={item.href}>{item.label}</a>)}",
      '    <a href="#%">Percent</a>',
      '    <a href="/about#broken%E0%A4%A">Truncated</a>',
      '    <a href="#bad%ZZ">Not hex</a>',
      '    <a href="/about%">Bad path</a>',
      '    <a href="#">Book now</a>',
      "    <p>Lorem ipsum dolor sit amet.</p>",
      "  </nav>;",
      "}",
    ].join("\n"));
    let findings;
    assert.doesNotThrow(() => { findings = clientReadyCheck(source(files)); }, "a malformed link must not stop the check");
    const by = rule => findings.find(finding => finding.rule === rule);
    const unreadable = by("unreadable-link");
    assert.ok(unreadable, JSON.stringify(findings.map(finding => finding.rule)));
    assert.equal(unreadable.severity, "warning");
    assert.deepEqual(unreadable.locations, [
      "src/components/Broken.tsx:4 (#%)", "src/components/Broken.tsx:5 (/about#broken%E0%A4%A)", "src/components/Broken.tsx:6 (#bad%ZZ)",
      "src/components/Broken.tsx:7 (/about%)", "src/components/Broken.tsx:1 (#%)", "src/components/Broken.tsx:1 (/about#%)",
    ]);
    assert.equal(unreadable.count, 6);
    assert.match(unreadable.detail, /%25/, "says how to write a literal percent sign");
    assert.ok(!by("missing-anchor"), "a malformed fragment is not also reported as a missing section");
    assert.ok(!by("dead-route"), "or as a missing page");
    assert.deepEqual(by("empty-link").locations, ["src/components/Broken.tsx:8"], "other link findings are still reported");
    assert.deepEqual(by("placeholder-text").locations, ["src/components/Broken.tsx:9"], "other rules still run");
  });

  await check("valid encoded and Unicode links are preserved, in code and in prepared pages", async () => {
    const files = clean();
    files.set("src/components/Sections.tsx", [
      "export default function Sections() {",
      '  return <main><section id="features" /><section id="pricing-details" /><section id="café" /><section id="100%" /><section id="naïve-sauce" />',
      '    <a href="#features">Features</a> <a href="#pricing%2Ddetails">Prices</a> <a href="#caf%C3%A9">Café</a> <a href="#café">Café again</a>',
      '    <a href="#100%25">Percent</a> <a href="#na%C3%AFve-sauce">Sauce</a> <a href="/about#caf%C3%A9">About café</a> <a href="/about">About</a>',
      "  </main>;",
      "}",
    ].join("\n"));
    const findings = clientReadyCheck(source(files));
    assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
    const pages = [{path: "/", html: '<!doctype html><html lang="en"><body><main id="top"><h2 id="ünïcode">Ü</h2><a href="#%C3%BCn%C3%AFcode">Jump</a><a href="#%">Bad</a><a href="/about#%E0%A4%A">Bad too</a><a href="#%">Bad again</a></main></body></html>'}];
    const rendered = clientReadyCheck({...source(clean()), pages});
    assert.deepEqual(rendered.map(finding => [finding.rule, finding.locations, finding.count]), [["unreadable-link", ["page / (#%)", "page / (/about#%E0%A4%A)"], 2]], "repeats at one location count once; valid Unicode passes");
  });

  await check("unreadable links are bounded: very long values are reported and shortened, empty input checks cleanly", async () => {
    const long = `#${"a%".repeat(3000)}`, longValid = `#${"b".repeat(5000)}`;
    const files = clean();
    files.set("src/components/Long.tsx", `export default function Long() {\n  return <div><a href="${long}">Long</a>\n<a href="${longValid}">Long valid</a></div>;\n}`);
    const findings = clientReadyCheck(source(files));
    const unreadable = findings.find(finding => finding.rule === "unreadable-link");
    assert.equal(unreadable.count, 2, "over-long fragments are not decoded");
    for (const location of unreadable.locations) assert.ok(location.length < 140, location.length);
    assert.match(unreadable.locations[0], /^src\/components\/Long\.tsx:2 \(#a%a%.*…\)$/);
    assert.ok(!findings.some(finding => finding.rule === "missing-anchor" && finding.locations.some(location => location.length > 140)), "no unbounded location text");
    assert.deepEqual(clientReadyCheck({files: []}), []);
    assert.deepEqual(clientReadyCheck({files: [], pages: [{path: "/", html: ""}]}), []);
  });

  await check("the real card renders malformed links as a finding, never fails to green, and states its static scope", async () => {
    const React = require("react");
    const { renderToStaticMarkup } = require("react-dom/server");
    const path = require("node:path"), src = path.join(__dirname, "..", "..");
    const cardPath = path.join(src, "components", "client-ready-check.tsx");
    const previousTsx = require.extensions[".tsx"], previousLoad = Module._load;
    require.extensions[".tsx"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}}).outputText, filename);
    let override = null;
    Module._load = function(name, parent, main) {
      if (name === "@/lib/builder/client-ready") {
        const real = previousLoad.call(this, path.join(src, "lib", "builder", "client-ready.ts"), parent, main);
        return override ? {...real, clientReadyCheck: override} : real;
      }
      return previousLoad.call(this, name, parent, main);
    };
    const render = props => { delete require.cache[cardPath]; return renderToStaticMarkup(React.createElement(require(cardPath).default, props)); };
    try {
      const files = clean();
      files.set("src/components/Broken.tsx", 'export default function Broken() {\n  return <nav><a href="#%">Percent</a><a href="/about#%">About</a></nav>;\n}');
      let html;
      assert.doesNotThrow(() => { html = render({source: source(files), pages: [{path: "/", html: '<!doctype html><html lang="en"><body><a href="/about#broken%E0%A4%A">x</a></body></html>'}]}); });
      assert.match(html, /data-state="warning"/); assert.match(html, /1 to review/);
      assert.match(html, /Links with broken encoding/);
      assert.match(html, /<code>src\/components\/Broken\.tsx:2 \(#%\)<\/code>/); assert.match(html, /<code>page \/ \(\/about#broken%E0%A4%A\)<\/code>/);
      assert.doesNotMatch(html, /Nothing to fix|No issues found/);
      const clean_ = render({source: source(clean())});
      assert.match(clean_, /No issues found by these checks/);
      assert.doesNotMatch(clean_, /Nothing to fix before you share/, "a static pass is not a promise the site is ready");
      assert.match(clean_, /not a full visual, accessibility or security review/);
      override = () => { throw new URIError("URI malformed"); };
      const failed = render({source: source(clean())});
      assert.match(failed, /data-state="error"/); assert.match(failed, /Check couldn’t finish/);
      assert.doesNotMatch(failed, /No issues found|data-state="clean"/, "a failed check never shows as clean");
    } finally { Module._load = previousLoad; require.extensions[".tsx"] = previousTsx; delete require.cache[cardPath]; }
  });

  console.log(`${count} compile and client-ready checks passed`);
})().catch(error => { console.error(error); process.exit(1); });

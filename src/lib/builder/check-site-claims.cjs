/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks (audit NPD "mark assumptions for confirmation before publish"): the pre-publish list of unconfirmed claims is pattern based, bounded, advisory and ignores code-only look-alikes. No AI, no network. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, filename);
globalThis.fetch = async () => { throw new Error("Network forbidden"); };
const {siteClaims} = require("./site-claims.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const site = (app, extra = {}) => ({files: [{path: "src/App.tsx", content: app}], routes: [{path: "/"}], assets: [], ...extra});
const kinds = groups => Object.fromEntries(groups.map(group => [group.kind, group.items.map(item => item.text)]));

const COPY = `export default function App() {
  return <main>
    <h1>The #1 bakery in Leith</h1>
    <p>Award-winning sourdough since 2009. Winner of the Scottish Baker of the Year 2024 award.</p>
    <p>Loaves from £4.50. Free delivery on orders over €30. 10% off your first order.</p>
    <p>Money-back guarantee on every cake. 2 year warranty on ovens.</p>
    <p>Rated 4.9 by 1,200+ reviews on Google Reviews ★★★★★</p>
    <blockquote>“The best croissants I have had outside Paris, honestly.” — Morag T.</blockquote>
    <p>Fully certified organic. ISO 9001 and Gas Safe registered engineers.</p>
    <p>Over 25 years of experience and 3,000 happy customers.</p>
    <p>Open Mon–Fri 7:00–18:00, Sat 8am–2pm. Open 7 days a week.</p>
    <p>Call +44 131 496 0000 or email hello@ovenbird.co.uk. Visit 12 Shore Street, EH6 6QW.</p>
  </main>;
}`;

check("every claim kind in ordinary site copy is listed with its place", () => {
  const found = kinds(siteClaims(site(COPY)));
  assert.deepEqual(Object.keys(found), ["price", "guarantee", "award", "testimonial", "ranking", "certification", "figure", "hours", "contact"]);
  assert.ok(found.ranking.some(text => /^#1 bakery/.test(text)), found.ranking.join(" | "));
  assert.ok(found.price.includes("£4.50") && found.price.includes("€30") && found.price.some(text => /^free delivery$/i.test(text)) && found.price.includes("10% off"), found.price.join(" | "));
  assert.ok(found.guarantee.some(text => /^Money-back guarantee$/i.test(text)) && found.guarantee.includes("2 year warranty"), found.guarantee.join(" | "));
  assert.ok(found.award.includes("Award-winning") && found.award.some(text => text.startsWith("Winner of the Scottish Baker")), found.award.join(" | "));
  assert.ok(found.testimonial.includes("★★★★★") && found.testimonial.includes("Rated 4.9") && found.testimonial.some(text => text.startsWith("“The best croissants")), found.testimonial.join(" | "));
  assert.ok(found.certification.some(text => /^Fully certified organic/.test(text)) && found.certification.includes("ISO 9001") && found.certification.includes("Gas Safe"), found.certification.join(" | "));
  assert.ok(found.figure.some(text => text.startsWith("25 years")) && found.figure.includes("since 2009"), found.figure.join(" | "));
  assert.ok(found.hours.some(text => text.startsWith("Mon–Fri")) && found.hours.includes("8am–2pm") && found.hours.includes("Open 7 days a week"), found.hours.join(" | "));
  assert.ok(found.contact.includes("+44 131 496 0000") && found.contact.includes("hello@ovenbird.co.uk") && found.contact.includes("12 Shore Street") && found.contact.includes("EH6 6QW"), found.contact.join(" | "));
  const where = siteClaims(site(COPY)).find(group => group.kind === "ranking").items[0].locations;
  assert.deepEqual(where, ["src/App.tsx:3"]);
});

check("code look-alikes are not claims: colours, sizes, dates, viewBoxes, imports and asset names", () => {
  const code = `import logo from "./assets/logo@2x.png";
const colors = { brand: "#1e293b", accent: "#10b981", ink: "#1f2937" };
export default function App() {
  return <svg viewBox="0 0 1440 320"><path d="M12 2L2 7l10 5" /></svg>;
}
const meta = { updated: "2026-10-20", version: "1.2.3", grid: "grid-cols-12 gap-4", width: "100%" };`;
  assert.deepEqual(siteClaims(site(code)), []);
});

check("prepared pages are read too; results are bounded per group and per item", () => {
  const many = Array.from({length: 12}, (_, index) => `<p>From £${index + 10}</p>`).join("");
  const groups = siteClaims({...site("export default () => <h1>Menu</h1>;"), pages: [{path: "/menu", html: `<main>${many}<p>From £10</p></main>`}, {path: "/", html: "<p>From £10</p>"}]}, 8, 1);
  const price = groups.find(group => group.kind === "price");
  assert.equal(price.count, 12); assert.equal(price.items.length, 8);
  assert.deepEqual(price.items[0], {text: "£10", locations: ["page /menu"], count: 2}, "the same claim on two pages counts both places, lists one");
});

check("the panel is advisory: it never gates publishing and names what it read", () => {
  const panel = fs.readFileSync(path.join(__dirname, "../../components/site-claims.tsx"), "utf8");
  assert.ok(panel.includes("Advice only: you can still publish.") && panel.includes("claims worded differently aren’t listed"));
  for (const file of ["trusted-website-publish.tsx", "website-publish.tsx"]) {
    const source = fs.readFileSync(path.join(__dirname, "../../components", file), "utf8");
    assert.ok(source.includes("<SiteClaims source={source} scope={checkedLabel({version,dirty})}"), file);
    assert.ok(!/canPublish[^\n]*claims|disabled=\{[^}]*claims/i.test(source), `${file}: claims never disable publishing`);
  }
});

console.log(`\n${passed} site-claims checks passed.`);

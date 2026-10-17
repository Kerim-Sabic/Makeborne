/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the client-editable content model (manifest, values, links, canonical text, summaries). */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
globalThis.fetch = async () => { throw new Error("Network access is not allowed in this check."); };

const model = require("./content-model.ts");
const { parseManifest, cleanText, safeLink, checkCollection, serialiseContent, describeChange, contentProblems, readCollections, newItemId, MANIFEST_PATH, CONTENT_LIMITS, HoursSchema, emptyHours } = model;

const MANIFEST = {
  version: 1, locale: "en-GB", currency: "GBP",
  collections: {
    menu: { label: "Menu", kind: "list", itemLabel: "Dish", titleField: "name", maxItems: 3, fields: {
      name: { type: "text", required: true, max: 80 }, description: { type: "text", multiline: true, max: 300 }, price: { type: "price" },
      category: { type: "select", options: ["Starters", "Mains"] }, image: { type: "image" }, available: { type: "boolean" }, link: { type: "url" } } },
    hours: { label: "Opening hours", kind: "single", fields: { week: { type: "hours" }, note: { type: "text", max: 160 }, opens: { type: "date" }, at: { type: "time" } } },
    contact: { label: "Contact details", kind: "single", fields: { phone: { type: "phone" }, email: { type: "email" }, booking: { type: "url" }, story: { type: "richtext" }, seats: { type: "number", min: 1, max: 500 } } },
  },
};
const manifest = parseManifest(JSON.stringify(MANIFEST));
assert.equal(manifest.ok, true, "fixture manifest must be valid");
const { menu, hours, contact } = manifest.manifest.collections;
const ctx = { assets: new Set(["/images/dish.webp"]), routes: ["/", "/menu", "/visit"] };
const item = (extra = {}) => ({ id: "m1", name: "Margherita", description: null, price: "9.50", category: "Mains", image: null, available: true, link: null, ...extra });
const list = (...items) => JSON.stringify({ items: items.length ? items : [item()] });
const ok = (collection, value) => { const result = checkCollection(collection, typeof value === "string" ? value : JSON.stringify(value), ctx); assert.equal(result.ok, true, result.message); return result; };
const bad = (collection, value, note) => { const result = checkCollection(collection, typeof value === "string" ? value : JSON.stringify(value), ctx); assert.equal(result.ok, false, note ?? JSON.stringify(value).slice(0, 120)); return result.message; };

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check("manifest refusals: reserved and prototype names, bad shapes, limits", () => {
  const variant = mutate => { const value = JSON.parse(JSON.stringify(MANIFEST)); mutate(value); return JSON.stringify(value); };
  const refused = [
    ["missing", undefined], ["not JSON", "{"], ["no version", variant(v => delete v.version)], ["version 2", variant(v => { v.version = 2; })],
    ["extra key", variant(v => { v.extra = true; })], ["no collections", variant(v => { v.collections = {}; })],
    ["__proto__ collection", '{"version":1,"collections":{"__proto__":{"label":"X","kind":"single","fields":{"a":{"type":"text"}}}}}'],
    ["constructor collection", variant(v => { v.collections.constructor = v.collections.hours; })],
    ["collections collection", variant(v => { v.collections.collections = v.collections.hours; })],
    ["upper-case collection", variant(v => { v.collections.Menu = v.collections.hours; })],
    ["__proto__ field", variant(v => { v.collections.hours.fields = JSON.parse('{"__proto__":{"type":"text"}}'); })],
    ["prototype field", variant(v => { v.collections.hours.fields.prototype = { type: "text" }; })],
    ["unknown field type", variant(v => { v.collections.hours.fields.note = { type: "html" }; })],
    ["field extra key", variant(v => { v.collections.hours.fields.note.onClick = "x"; })],
    ["label with angle bracket", variant(v => { v.collections.menu.label = "<b>Menu</b>"; })],
    ["titleField not a field", variant(v => { v.collections.menu.titleField = "title"; })],
    ["single with maxItems", variant(v => { v.collections.hours.maxItems = 3; })],
    ["maxItems over 200", variant(v => { v.collections.menu.maxItems = 201; })],
    ["select without options", variant(v => { v.collections.menu.fields.category.options = []; })],
    ["bad locale", variant(v => { v.locale = "english"; })], ["bad currency", variant(v => { v.currency = "gbp"; })],
    ["31 collections", variant(v => { for (let i = 0; i < 31; i++) v.collections[`c${i}`] = v.collections.hours; })],
  ];
  for (const [name, text] of refused) assert.equal(parseManifest(text).ok, false, name);
  assert.match(parseManifest("{").error, /collections\.json is not valid JSON/);
  // JSON.parse makes "__proto__" an own key; it must be refused, never merged into a prototype.
  assert.equal(({}).label, undefined, "prototype untouched");
});

check("text normalisation strips bidi overrides and control characters, NFC-normalises and collapses spaces", () => {
  assert.equal(cleanText("Ma\u202Erg\u0007herita\u0000  "), "Marg herita");
  assert.equal(cleanText("Café \u2066del\u2069 \u200Emar\u200F"), "Café del mar");
  assert.equal(cleanText("a\r\nb\u0000c\n\n\n\nd  \n", true), "a\nbc\n\nd");
  const result = ok(menu, list(item({ name: " \u202EMargherita\u0007 ", description: "Line one\r\nLine two\u0001" })));
  assert.equal(result.value.items[0].name, "Margherita");
  assert.equal(result.value.items[0].description, "Line one\nLine two");
  assert.equal(bad(menu, list(item({ name: "\u202E\u0007 " }))), "Dish 1, Name: Required.", "empty after cleaning is still required");
  assert.match(bad(menu, list(item({ name: "x".repeat(81) }))), /Too long/);
});

check("links: javascript:, data:, protocol-relative, credentials, backslashes and unknown routes refused; https, tel:, mailto:, routes and anchors accepted", () => {
  for (const link of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,<script>", "vbscript:x", "//evil.example", "/\\evil.example",
    "https://user@evil.example", "https://user:pass@evil.example", "http://example.com", "https://localhost", "https://10.0.0.1", "ftp://example.com",
    "https://example.com/a b", "https:\\\\evil.example", "/unknown", "#", "#1bad", "mailto:", "mailto:a@b@c", "tel:12", "tel:+44<script>", "x".repeat(501)]) {
    assert.equal(safeLink(link, ctx.routes), false, link);
  }
  for (const link of ["https://example.com", "https://www.example.co.uk/path?q=1#top", "tel:+44 117 496 0000", "tel:(0117) 496-0000", "mailto:hello@example.com",
    "/", "/menu", "/visit#map", "#visit", "#opening-hours"]) {
    assert.equal(safeLink(link, ctx.routes), true, link);
  }
  assert.equal(safeLink("/anything"), true, "without a route list any clean route is accepted");
  assert.match(bad(menu, list(item({ link: "javascript:alert(1)" }))), /Dish 1, Link: Use a full https:\/\/ address/);
  assert.equal(ok(contact, { booking: " https://book.example.com/table " }).value.booking, "https://book.example.com/table");
  bad(contact, { booking: "data:text/html,hi" });
});

check("hours, price, date, time, number, select, email, phone and image formats", () => {
  const week = { ...emptyHours(), mon: [{ open: "09:00", close: "17:30" }], sat: [{ open: "10:00", close: "13:00" }, { open: "14:00", close: "23:59" }],
    exceptions: [{ date: "2026-12-25", closed: true, label: "Christmas" }] };
  ok(hours, { week, note: "Closed on bank holidays", opens: "2026-10-15", at: "07:45" });
  assert.equal(HoursSchema.safeParse(week).success, true);
  for (const broken of [{ ...week, mon: [{ open: "9:00", close: "17:30" }] }, { ...week, mon: [{ open: "24:00", close: "17:30" }] }, { ...week, mon: [{ open: "09:60", close: "17:30" }] },
    { ...week, funday: [] }, { ...week, mon: Array.from({ length: 4 }, () => ({ open: "09:00", close: "10:00" })) }, (() => { const value = { ...week }; delete value.sun; return value; })(),
    { ...week, exceptions: [{ date: "2026-13-01", closed: true }] }, { ...week, exceptions: [{ date: "2026-12-25", closed: true, label: "<b>" }] }])
    bad(hours, { week: broken });
  for (const price of ["12.50", "12", "0.99", "1234567.00", " 9.50 "]) ok(menu, list(item({ price })));
  for (const price of ["12.5", "-1", "1,000", "12.505", "£12", "12345678", 12.5]) bad(menu, list(item({ price })));
  for (const date of ["2026-13-01", "2026-02-32", "15/10/2026", "2026-1-5"]) bad(hours, { opens: date });
  for (const time of ["7:45", "24:00", "12:60", "noon"]) bad(hours, { at: time });
  ok(contact, { seats: 40 }); bad(contact, { seats: 0 }); bad(contact, { seats: 501 }); bad(contact, { seats: "40" });
  bad(menu, list(item({ category: "Puddings" })));
  ok(contact, { email: "hello@example.com", phone: "+44 117 496 0000" });
  for (const email of ["hello", "a@b", "<a>@example.com", "a@@example.com"]) bad(contact, { email });
  for (const phone of ["12", "call me", "+44 <117>"]) bad(contact, { phone });
  assert.equal(ok(menu, list(item({ image: { src: "/images/dish.webp", alt: " A \u202Edish " } }))).value.items[0].image.alt, "A dish");
  for (const image of [{ src: "/images/other.webp", alt: "" }, { src: "https://evil.example/x.png", alt: "" }, { src: "/images/dish.webp", alt: "", onerror: "x" }])
    bad(menu, list(item({ image })));
  ok(contact, { story: [{ type: "heading", text: "Our story" }, { type: "paragraph", text: "Since 1999." }, { type: "list", items: ["One", "Two"] }, { type: "quote", text: "Lovely" }] });
  bad(contact, { story: [{ type: "html", text: "<b>x</b>" }] });
  bad(contact, { story: "<p>raw html</p>" });
});

check("lists: stable unique ids, maxItems, strict fields; files are bounded", () => {
  bad(menu, list(item(), item()), "duplicate ids");
  bad(menu, list(item({ id: "M1" })), "upper-case id");
  bad(menu, list(item({ id: "x".repeat(17) })), "long id");
  bad(menu, list(item({ id: "m1" }), item({ id: "m2" }), item({ id: "m3" }), item({ id: "m4" })), "maxItems");
  bad(menu, list(item({ extra: "x" })), "unknown field");
  bad(menu, { items: [item()], extra: true }, "extra top-level key");
  bad(menu, JSON.stringify({ items: [item()] }).replace('"m1"', '"m1","__proto__":{"admin":true}'), "__proto__ item key");
  bad(hours, { note: "x", constructor: "y" }, "constructor key on a single");
  assert.match(checkCollection(menu, "x".repeat(CONTENT_LIMITS.fileBytes + 1), ctx).message, /larger than 200 KB/);
  assert.equal(checkCollection(menu, undefined, ctx).message, "is missing.");
  assert.equal(checkCollection(menu, "{", ctx).message, "is not valid JSON.");
  ok(menu, { items: [] });
  const id = newItemId();
  assert.match(id, /^[a-z0-9]{6}$/);
  ok(menu, list(item({ id })));
});

check("canonical serialisation: two-space JSON with a trailing newline, idempotent, raw input never kept", () => {
  const raw = `{"items":[{"id":"m1","name":"  Margherita\u202E ","price":"9.50","description":null,"category":"Mains","image":null,"available":true,"link":null}]}`;
  const first = ok(menu, raw);
  assert.equal(first.text, serialiseContent(first.value));
  assert.ok(first.text.endsWith("}\n") && first.text.includes('\n  "items": ['), "two-space layout");
  assert.ok(!first.text.includes("\u202E"), "bidi override removed from stored text");
  assert.equal(ok(menu, first.text).text, first.text, "re-validating the stored text changes nothing");
  assert.equal(serialiseContent({ a: 1 }), '{\n  "a": 1\n}\n');
});

check("describeChange summarises changed, added, removed and reordered items and single updates", () => {
  const before = { items: [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })] };
  assert.equal(describeChange(menu, before, { items: [item({ id: "a", price: "10.00" }), item({ id: "b" }), item({ id: "c" }), item({ id: "d" })] }), "Menu: 1 changed, 1 added");
  assert.equal(describeChange(menu, before, { items: [item({ id: "a" })] }), "Menu: 2 removed");
  assert.equal(describeChange(menu, before, { items: [item({ id: "c" }), item({ id: "a" }), item({ id: "b" })] }), "Menu: reordered");
  assert.equal(describeChange(menu, before, before), null);
  assert.equal(describeChange(menu, null, { items: [item()] }), "Menu: 1 added");
  assert.equal(describeChange(hours, { note: "a" }, { note: "b" }), "Opening hours: updated");
  assert.equal(describeChange(hours, { note: "a" }, { note: "a" }), null);
});

check("project checks: declared files must exist, validate, be imported and be declared", () => {
  const files = new Map([[MANIFEST_PATH, JSON.stringify(MANIFEST)], ["src/content/menu.json", list()], ["src/content/hours.json", "{}"],
    ["src/content/stray.json", "{}"], ["src/App.tsx", 'import menu from "./content/menu.json"; import hours from "./content/hours.json";']]);
  const problems = contentProblems(files, ctx.assets, ctx.routes).map(problem => problem.message);
  assert.ok(problems.some(message => message.startsWith("src/content/contact.json is missing")), problems.join("\n"));
  assert.ok(problems.some(message => message === "src/content/contact.json is declared but no component imports it."));
  assert.ok(problems.some(message => message === "src/content/stray.json has no declaration in src/content/collections.json."));
  assert.ok(!problems.some(message => message.startsWith("src/content/menu.json")), "valid, imported collection has no problems");
  assert.deepEqual(contentProblems(new Map([["src/content/menu.json", "{}"]]), ctx.assets).map(problem => problem.path), ["src/content/menu.json"]);
  const read = readCollections(files, ctx.assets);
  assert.deepEqual(read.collections.map(entry => [entry.key, entry.problem === null]), [["menu", true], ["hours", true], ["contact", false]]);
  assert.equal(readCollections(new Map(), ctx.assets), null);
});

check("studio wiring: make-editable fills the builder chat, hand-over is offered only on client sites, photos are shown before approval", () => {
  const read = file => fs.readFileSync(path.join(src, "..", file), "utf8");
  const { MAKE_EDITABLE_REQUEST, CONTENT_CONTRACT } = require("../builder/content-prompt.ts");
  assert.match(MAKE_EDITABLE_REQUEST, /restructure, not a redesign/);
  assert.match(MAKE_EDITABLE_REQUEST, /keep every visible word, number, image, style, layout and animation exactly/);
  assert.ok(CONTENT_CONTRACT.length > 200);
  const settings = read("src/components/website-portal-settings.tsx");
  assert.match(settings, /!declared\.length && onAskBuilder && <button[^>]*onClick=\{\(\) => onAskBuilder\(MAKE_EDITABLE_REQUEST\)\}/, "the button only prefills; the owner sends it");
  assert.match(settings, /uses credits; you can undo it from History/);
  assert.match(settings, /New photos in this change/);
  const studio = read("src/components/cloud-studio.tsx");
  assert.match(studio, /onAskBuilder=\{useLiveBuilder \? text => \{ setBuilderPrefill\(\{ key: crypto\.randomUUID\(\), text \}\); setView\("preview"\); \} : undefined\}/);
  assert.match(studio, /clientEditing: Boolean\(project\?\.clientId\)/);
  assert.match(read("src/components/live-preview.tsx"), /clientEditing=\{visualEdit\?\.clientEditing\}/);
  assert.match(read("src/components/visual-editor-panel.tsx"), /\{clientEditing && text && <HandOver [^\n]*kind: "extract", loc, label, rendered: picked\.text/);
});

let failed = 0;
for (const [name, fn] of checks) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.log(`FAIL ${name}\n${error.stack}`); }
}
console.log(`${checks.length - failed}/${checks.length} content model checks passed.`);
if (failed) process.exitCode = 1;

/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for copy edits (src/lib/ai/copy-edit.ts): which requests are copy edits, and the model-free check that holds a cheap model's result to exactly what was asked. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { explicitValues, looksLikeCopyEdit, copyEditFindings, lineChanges } = require("./copy-edit.ts");

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
const APP = [
  "export default function App() {",
  "  return <main>",
  "    <h1>Saffron Table</h1>",
  "    <p>Seasonal plates in the heart of Bristol.</p>",
  '    <a href="tel:+441179000000">+44 117 900 0000</a>',
  '    <a href="mailto:hello@saffron.example.com">hello@saffron.example.com</a>',
  "    <p>Saturday 10:00–22:00</p>",
  "    <p>Free parking</p>",
  "    <button>Book now</button>",
  "  </main>;",
  "}",
].join("\n");
const before = new Map([["src/App.tsx", APP], ["src/styles.css", "body{margin:0}"]]);
const after = (edit, extra = {}) => new Map([...before, ["src/App.tsx", edit(APP)], ...Object.entries(extra)]);
const findings = (request, edited) => copyEditFindings({ request, before, after: edited });

check("values: quoted text in every quote style, phone numbers, emails, times and prices; apostrophes are not quotes", () => {
  assert.deepEqual(explicitValues('Replace "Book now" with “Reserve a table”'), ["Book now", "Reserve a table"]);
  assert.deepEqual(explicitValues("Obriši „Besplatan parking“ i «Wi-Fi»"), ["Besplatan parking", "Wi-Fi"]);
  assert.deepEqual(explicitValues("Change the phone to +387 61 123 456 and the email to ana@studio.example.com"), ["+387 61 123 456", "ana@studio.example.com"]);
  assert.deepEqual(explicitValues("Saturday is now 10:00–14:00 and a haircut costs 25 KM"), ["10:00–14:00", "25 KM"]);
  assert.deepEqual(explicitValues("Change the price from $1,200 to $1,350."), ["$1,200", "$1,350"], "a sentence's full stop is not part of the value");
  assert.deepEqual(explicitValues("Change our phone number to (916) 555-0199."), ["(916) 555-0199"]);
  assert.deepEqual(explicitValues("It doesn't open on Sundays, so change it to 'Closed'"), ["Closed"]);
});

check("classification: replacements, corrections and removals of named content are copy edits; additions, styling and block removals are not", () => {
  for (const request of ["Change the phone number to +387 61 123 456", 'Fix the typo "Resturant"', "Promijeni radno vrijeme subotom na 10:00–14:00", 'Remove the line "Free parking"',
    "Change the mobile number on the contact page to 061 222 333"]) assert.equal(looksLikeCopyEdit(request), true, request);
  for (const request of ['Add "Gift cards" to the menu', "Remove the testimonials section", 'Make the heading "Hi" bigger', "Change the background to dark blue", "Change the phone number",
    'Replace "a" "b" "c" "d" "e" "f" "g"']) assert.equal(looksLikeCopyEdit(request), false, request);
});

check("an exact replacement passes; the same text missing, or the old text still there, fails with a note the repair can act on", () => {
  assert.deepEqual(findings('Replace "Book now" with "Reserve a table"', after(app => app.replace("Book now", "Reserve a table"))), []);
  assert.match(findings('Replace "Book now" with "Reserve a table"', after(app => app.replace("Book now", "Reserve"))).join(" "), /"Reserve a table" does not appear/);
  assert.match(findings('Replace "Book now" with "Reserve a table"', after(app => app.replace("</main>", "<p>Reserve a table</p></main>"))).join(" "), /still in place/);
});

check("a contact change must reach every copy, tel: and mailto: links included", () => {
  const request = "Change the phone number from +44 117 900 0000 to +44 117 911 1111";
  assert.deepEqual(findings(request, after(app => app.replace("tel:+441179000000", "tel:+441179111111").replace("+44 117 900 0000", "+44 117 911 1111"))), []);
  assert.match(findings(request, after(app => app.replace("+44 117 900 0000", "+44 117 911 1111"))).join(" "), /old contact .* tel: or mailto:/);
  // No old number named: the project's only number is the one replaced, so a stale tel: link is still caught.
  const unnamed = "Change the phone number to +44 117 911 1111";
  assert.match(findings(unnamed, after(app => app.replace("+44 117 900 0000", "+44 117 911 1111"))).join(" "), /old contact .* tel: or mailto:/);
  assert.deepEqual(findings(unnamed, after(app => app.replace("tel:+441179000000", "tel:+441179111111").replace("+44 117 900 0000", "+44 117 911 1111"))), []);
  // National and international formats of one number are the same number.
  assert.deepEqual(findings("Change the phone number to 0117 911 1111", after(app => app.replace("tel:+441179000000", "tel:+441179111111").replace("+44 117 900 0000", "0117 911 1111"))), []);
  assert.match(findings("Change the email to bookings@saffron.example.com", after(app => app.replace(">hello@saffron.example.com<", ">bookings@saffron.example.com<"))).join(" "), /old contact "hello@saffron\.example\.com"/);
});

check("removal: the named text must go, and nothing else may", () => {
  assert.deepEqual(findings('Remove the line "Free parking"', after(app => app.replace("    <p>Free parking</p>\n", ""))), []);
  assert.match(findings('Remove the line "Free parking"', after(app => app)).join(" "), /Nothing was changed/);
  assert.match(findings('Remove the line "Free parking"', after(app => app.replace("Free parking", "Free street parking"))).join(" "), /reworded instead of removed/);
  assert.deepEqual(findings('Remove "Free parking" from the footer', after(app => app.replace("    <p>Free parking</p>\n", ""))), [], "removing the whole line is a removal");
  const shared = new Map([["src/App.tsx", "<p>Free parking and Wi-Fi</p>"]]);
  assert.deepEqual(copyEditFindings({ request: 'Delete "Free parking and"', before: shared, after: new Map([["src/App.tsx", "<p>Wi-Fi</p>"]]) }), [], "cutting words out of a line is a removal");
});

check("footprint: no new files, no restyling, no new structure, no rewrites beyond the named values", () => {
  const request = 'Replace "Book now" with "Reserve a table"';
  assert.match(findings(request, after(app => app.replace("Book now", "Reserve a table"), { "src/Extra.tsx": "export {}" })).join(" "), /must not add or delete files/);
  const bloated = app => app.replace("Book now", "Reserve a table").replace("</main>", `${"    <section><h2>More</h2><p>New text</p></section>\n".repeat(6)}  </main>`);
  assert.match(findings(request, after(bloated)).join(" "), /keep the page structure|carry none of the requested values/);
  const restyled = new Map([...after(app => app.replace("Book now", "Reserve a table"))]);
  restyled.set("src/styles.css", "body{margin:0;background:#000}");
  assert.match(findings(request, restyled).join(" "), /src\/styles\.css changed without any of the requested values/, "a stylesheet changed for no requested value is a stray change");
  // Unless the builder's own finish checks asked for fixes (a layout already cut off at 360 px): those are the platform's.
  assert.deepEqual(copyEditFindings({ request, before, after: restyled, allowStylesheetFixes: true }), []);
  // A value spread over many components is fine: every changed file carries it.
  const spread = new Map([["src/A.tsx", "<p>Book now</p>"], ["src/B.tsx", "<a>Book now</a>"], ["src/C.tsx", "<b>Book now</b>"], ["src/D.tsx", "<i>Book now</i>"]]);
  assert.deepEqual(copyEditFindings({ request, before: spread, after: new Map([...spread].map(([path, text]) => [path, text.replace("Book now", "Reserve a table")])) }), []);
});

check("a value repeated across the site may change every line it is on, but no line without it", () => {
  const lines = Array.from({ length: 9 }, (_, i) => i % 2 ? `    <a href="tel:+19165550148">Call (916) 555-0148</a>` : `    <p>Ring (916) 555-0148 for slot ${i}</p>`);
  const site = new Map([["src/App.tsx", ["export default function App() {", "  return <main>", ...lines, "  </main>;", "}"].join("\n")]]);
  const swap = text => text.split("(916) 555-0148").join("(916) 555-0199").split("tel:+19165550148").join("tel:+19165550199");
  const request = "Change our phone number to (916) 555-0199.";
  assert.deepEqual(copyEditFindings({ request, before: site, after: new Map([["src/App.tsx", swap(site.get("src/App.tsx"))]]) }), [], "18 changed lines, every one carrying the number");
  const plus = new Map([["src/App.tsx", swap(site.get("src/App.tsx")).replace("  </main>;", "    <p>We moved!</p>\n    <p>Ask us anything.</p>\n    <p>Open late.</p>\n    <p>Free parking.</p>\n    <p>New team.</p>\n  </main>;")]]);
  assert.match(copyEditFindings({ request, before: site, after: plus }).join(" "), /carry none of the requested values|keep the page structure/);
  const partial = new Map([["src/App.tsx", site.get("src/App.tsx").split("(916) 555-0148").join("(916) 555-0199")]]);
  assert.match(copyEditFindings({ request, before: site, after: partial }).join(" "), /old contact .* tel:/, "the visible number changed but the links still dial the old one");
});

check("line diff: counts only what changed, also for moved and repeated lines", () => {
  assert.deepEqual(lineChanges("a\nb\nc", "a\nb\nc"), { removed: 0, added: 0 });
  assert.deepEqual(lineChanges("a\nb\nc", "a\nB\nc"), { removed: 1, added: 1 });
  assert.deepEqual(lineChanges("a\nb\nc\nd", "a\nc\nb\nd"), { removed: 1, added: 1 });
  assert.deepEqual(lineChanges("x", "x\ny\nz"), { removed: 0, added: 2 });
});

console.log(`${passed} copy-edit checks passed (no model or network).`);

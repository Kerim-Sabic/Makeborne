/* eslint-disable @typescript-eslint/no-require-imports -- Offline studio shell layout and keyboard checks. */
// Static guards for the outer studio shell. Real reflow, focus order and landmark
// behaviour are qualified in a browser; these catch regressions of the contract.
const fs = require("node:fs"), assert = require("node:assert/strict");
const css = fs.readFileSync("src/app/studio-refresh.css", "utf8").replace(/\r\n/g, "\n");
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }

check("format filters wrap instead of widening the page at 320px", () => {
  const rule = css.match(/\.studio-shell \.list-toolbar > \.filter-tabs \{([^}]*)\}/);
  assert.ok(rule, "list-toolbar filter rule exists");
  assert.match(rule[1], /flex-wrap:\s*wrap/);
  assert.match(rule[1], /max-width:\s*100%/);
  // Wrapping, not clipping: nothing may hide a format or the page overflow.
  assert.doesNotMatch(rule[1], /overflow(-x)?:\s*hidden/);
  assert.doesNotMatch(css, /\.studio-shell \.filter-tabs button[^{]*\{[^}]*display:\s*none/);
});

console.log(`${count} studio shell checks passed.`);

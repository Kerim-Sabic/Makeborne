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

const ts = require("typescript"), vm = require("node:vm");
function load(file) {
  const context = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}
const overlay = load("src/lib/overlay-focus.ts");
const studio = fs.readFileSync("src/components/studio.tsx", "utf8").replace(/\r\n/g, "\n");

check("drawer Tab wraps at both edges and never leaves the drawer", () => {
  const nodes = ["brand", "close", "projects", "backup"];
  assert.equal(overlay.overlayTabTarget(nodes, "backup", false), "brand");
  assert.equal(overlay.overlayTabTarget(nodes, "brand", true), "backup");
  assert.equal(overlay.overlayTabTarget(nodes, "close", false), null, "inner moves are left to the browser");
  assert.equal(overlay.overlayTabTarget(nodes, "close", true), null);
  assert.equal(overlay.overlayTabTarget(nodes, "page-control", false), "brand", "focus behind the drawer is pulled back in");
  assert.equal(overlay.overlayTabTarget(nodes, null, true), "backup");
  assert.equal(overlay.overlayTabTarget([], "x", false), null);
});
check("closing restores focus to the opener only when focus was in the drawer or lost", () => {
  assert.equal(overlay.shouldRestoreOverlayFocus(true, false), true);
  assert.equal(overlay.shouldRestoreOverlayFocus(false, true), true);
  assert.equal(overlay.shouldRestoreOverlayFocus(false, false), false);
});
check("drawer breakpoint matches the stylesheet that turns the rail into a drawer", () => {
  assert.equal(overlay.DRAWER_NAVIGATION_QUERY, "(max-width: 700px)");
  assert.match(css, /@media\(max-width:700px\) \{\n {2}\.sidebar-scrim \{ display: block;/);
});
check("open drawer makes the page behind it inert and closes on Escape and widening", () => {
  assert.match(studio, /<div className="studio-main" inert=\{mobileNav \|\| undefined\}>/);
  const effect = studio.slice(studio.indexOf("const panel = navigationPanel.current"), studio.indexOf("}, [mobileNav]);"));
  assert.match(effect, /event\.key === "Escape"/);
  assert.match(effect, /event\.defaultPrevented\) return/, "a popup inside the drawer handles Escape first");
  assert.match(effect, /drawer\.addEventListener\("change", widened\)/);
  assert.match(effect, /toggle = navigationToggle\.current/);
  assert.match(effect, /toggle\?\.focus\(/);
  assert.doesNotMatch(studio, /window\.addEventListener\("keydown", closeNavigation\)/);
});

const { studioSkipTargets } = load("src/lib/studio-skip-links.ts");
check("skip links follow the visible task", () => {
  assert.deepEqual(studioSkipTargets({ loaded: true, tab: "projects", composerVisible: true }).map(target => target.id).join(), "studio-brief,studio-library");
  assert.deepEqual(studioSkipTargets({ loaded: true, tab: "clients", composerVisible: false }).map(target => target.id).join(), "studio-content");
  assert.deepEqual(studioSkipTargets({ loaded: false, tab: "projects", composerVisible: true }).map(target => target.id).join(), "studio-content", "no link to a composer that is not mounted yet");
});
check("every skip target exists, can take focus, and the shell has one main", () => {
  assert.match(studio, /<textarea\n\s+id="studio-brief"/);
  assert.match(studio, /<div className="list-toolbar" id="studio-library" tabIndex=\{-1\}>/);
  const shell = studio.slice(studio.indexOf("export default function Studio("), studio.indexOf("\nfunction Empty("));
  const mains = shell.match(/<main\b[^>]*>/g) ?? [];
  assert.equal(mains.length, 2, "loading state and loaded tab content are alternatives, never both");
  for (const main of mains) assert.match(main, /id="studio-content"\s+tabIndex=\{-1\}/);
  assert.match(shell, /<main id="studio-content" tabIndex=\{-1\} className="loading-state">/);
  // The device editor is not wrapped: its website preview renders its own main.
  assert.match(shell, /\) : project \? \(\n\s+<ProjectEditor/);
  assert.match(shell, /onClick=\{event => skipTo\(event, target\.id\)\}/);
  assert.match(shell, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(css, /\.studio-skip-link:not\(:focus\) \{[^}]*clip-path: inset\(50%\)/);
  assert.match(css, /\.studio-skip-link:focus \{[^}]*position: fixed;/);
  assert.match(css, /@media \(max-width: 700px\) \{ \.studio-skip-link:focus \{ top: 68px; \} \}/, "on phones the focused link sits below the 60px top bar, not over the menu toggle");
});

console.log(`${count} studio shell checks passed.`);

/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the project library grid: column steps (and that the stylesheet writes the same ones), the card's title mark, and the card's markup guards (one link per card, state chip inside it, the skeleton in the card's shape). Mounted: scripts/check-library-previews-browser.cjs. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const grid = require("./library-grid.ts");
const root = path.join(__dirname, "..", "..", "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
let count = 0;
const check = (name, fn) => { fn(); count++; console.log(`PASS ${name}`); };

check("columns follow the list's own width: 1, 2, 3, 4, then 5 on very wide lists", () => {
  // The app's list widths (CSS px) at common screens: phone 360/390 → 328/358, tablet 820 → 696, laptop 1440 → 1152, 1920 and 2560 (zoomed) → ~1290.
  for (const [width, columns] of [[0, 1], [328, 1], [358, 1], [479, 1], [480, 2], [696, 2], [759, 2], [760, 3], [900, 3], [1039, 3], [1040, 4], [1152, 4], [1290, 4], [1599, 4], [1600, 5], [2400, 5]])
    assert.equal(grid.libraryColumns(width), columns, `${width}px`);
  assert.equal(grid.libraryColumns(Number.NaN), 1);
  const steps = grid.LIBRARY_COLUMN_STEPS.map(([min]) => min);
  assert.deepEqual(steps, [...steps].sort((a, b) => b - a), "steps run from widest to narrowest");
});

check("the stylesheet writes exactly these column steps, for the cards and their loading placeholder alike", () => {
  const css = read("src/app/library-preview.css");
  const rules = [...css.matchAll(/@container library-columns \(min-width: (\d+)px\) \{ \.account-project-grid, \.library-skeleton \{ grid-template-columns: repeat\((\d+), minmax\(0, 1fr\)\); \} \}/g)].map(match => [Number(match[1]), Number(match[2])]);
  assert.deepEqual(rules.sort((a, b) => b[0] - a[0]), grid.LIBRARY_COLUMN_STEPS.map(step => [...step]));
  assert.match(css, /\.library-columns \{ container: library-columns \/ inline-size;/);
  assert.match(css, /\.account-project-grid, \.library-skeleton \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/, "one column below the first step");
  assert.doesNotMatch(css, /auto-fill/, "no second, viewport- or content-driven column rule");
  // The placeholder has the card's shape: 16:10 preview, then 12px + a 20px title row and an 18px meta row (50px).
  assert.match(css, /\.account-project-link \{[^}]*grid-template-rows: 20px 18px;[^}]*padding: 12px 2px 0;/);
  assert.match(css, /\.library-skeleton-card \{[^}]*grid-template-rows: auto 32px 18px;/);
  assert.match(css, /\.library-card-thumb \{[^}]*aspect-ratio: 16 \/ 10;/); assert.match(css, /\.library-skeleton-thumb \{[^}]*aspect-ratio: 16 \/ 10;/);
  // The state chip sits on the preview's bottom edge: the card is a container and 62.5cqw is its 16:10 preview's height.
  assert.match(css, /\.account-project-card \{[^}]*container-type: inline-size;/);
  assert.match(css, /\.account-project-facts \{ position: absolute; top: calc\(62\.5cqw - 10px\);/);
  // The menu appears on hover or focus, and always on touch screens.
  assert.match(css, /\.account-project-card:hover \.account-project-actions, \.account-project-card:focus-within \.account-project-actions, \.account-project-actions\.open \{ opacity: 1; \}/);
  assert.match(css, /@media \(hover: none\) \{ \.account-project-actions \{ opacity: 1; \} \}/);
  assert.doesNotMatch(css, /\d(?:vw|vh|dvh)\b(?! \/ var\(--ui-zoom)/, "viewport units are divided by the interface zoom");
});

check("a card's mark is the first letter or digit of its name; placeholders show the format icon", () => {
  assert.equal(grid.projectInitial("Harbour Dental", false), "H");
  assert.equal(grid.projectInitial("  élan studio", false), "É");
  assert.equal(grid.projectInitial("[e2e] Spoke & Sprocket", false), "E", "punctuation is skipped");
  assert.equal(grid.projectInitial("3 Bridges Bakery", false), "3");
  assert.equal(grid.projectInitial("Ölüdeniz Tours", false), "Ö");
  assert.equal(grid.projectInitial("— · —", false), null);
  assert.equal(grid.projectInitial("Untitled website", true), null);
});

check("one link per card carries the title, time and state; the frame and mark stay out of its name", () => {
  const projects = read("src/components/account-projects.tsx");
  assert.match(projects, /<a className="account-project-link" href=\{projectHref\(inWorkspace, artifact\.id\)\} aria-describedby=\{described\} aria-disabled=\{busy \|\| undefined\}/);
  assert.match(projects, /if \(event\.button !== 0 \|\| event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey\) return; event\.preventDefault\(\); if \(!busy\) open\(\);/, "a modified click opens a new tab; a plain one opens here");
  assert.match(projects, /<span className=\{`account-project-avatar \$\{artifact\.kind\}`\} aria-hidden="true">\{initial \?\? <Mark size=\{14\} \/>\}<\/span>/);
  const link = projects.slice(projects.indexOf('<a className="account-project-link"'), projects.indexOf("</a>", projects.indexOf('<a className="account-project-link"')));
  assert.match(link, /account-project-title/); assert.match(link, /account-project-facts/); assert.match(link, /<time dateTime/);
  assert.doesNotMatch(link, /LibraryCardPreview|<button/, "the preview and buttons are not inside the link");
  assert.match(projects, /useEffect\(\(\) => \{ const timer = setInterval\(\(\) => setNow\(new Date\(\)\), 60_000\); return \(\) => clearInterval\(timer\); \}, \[\]\);/, "one clock for every card, once a minute");
  const studio = read("src/components/studio.tsx");
  assert.match(studio, /<div className="library-pending library-columns" role="status" aria-busy="true">/, "the first-visit placeholder takes the same columns");
  assert.match(projects, /<div className="library-columns"><div className=\{`library-skeleton/);
  assert.match(projects, /<div className="library-columns"><div className=\{`account-project-grid/);
});

console.log(`${count} library grid checks passed.`);

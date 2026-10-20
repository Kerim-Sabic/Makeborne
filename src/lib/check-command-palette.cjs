/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the global command palette's matching (P2): every word must match, label matches rank first, order is stable, results are bounded, and commands only navigate or open composers. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { matchCommands, MAX_PALETTE_RESULTS } = require("./command-palette.ts");

const commands = [
  { label: "Projects", group: "Go to", keywords: ["library"] },
  { label: "Clients", group: "Go to", keywords: ["crm"] },
  { label: "New website", group: "Start", keywords: ["create"] },
  { label: "New book", group: "Start", keywords: ["create"] },
  { label: "Café Lumière site", group: "Projects" },
  { label: "Ask Nova", group: "Advisors", keywords: ["Headlines and website copy"] },
];
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
const labels = (query, list = commands) => matchCommands(list, query).map(command => command.label);

check("an empty query lists commands in their given order", () => assert.deepEqual(labels(""), commands.map(command => command.label)));
check("every word must match; label matches rank above keyword and group matches", () => {
  assert.deepEqual(labels("new book"), ["New book"]);
  assert.deepEqual(labels("website"), ["New website", "Ask Nova"], "a label match outranks a keyword match");
  assert.deepEqual(labels("create"), ["New website", "New book"]);
  assert.deepEqual(labels("go to"), ["Projects", "Clients"]);
  assert.deepEqual(labels("zzz"), []);
});
check("accents and case are ignored", () => { assert.deepEqual(labels("cafe lumiere"), ["Café Lumière site"]); assert.deepEqual(labels("CLIENTS"), ["Clients"]); });
check("results are bounded", () => {
  const many = Array.from({ length: 200 }, (_, index) => ({ label: `Project ${index}`, group: "Projects" }));
  assert.equal(matchCommands(many, "project").length, MAX_PALETTE_RESULTS);
});
check("structure: palette commands only navigate or open composers", () => {
  const root = path.join(__dirname, "..");
  const palette = fs.readFileSync(path.join(root, "components/global-command-palette.tsx"), "utf8");
  assert.doesNotMatch(palette, /fetch\(|\/api\//, "the palette sends nothing");
  assert.match(palette, /event\.defaultPrevented/, "a palette that handles the shortcut first takes precedence");
  for (const file of ["components/studio.tsx", "components/expert-chat.tsx"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const block = source.slice(source.indexOf("const paletteCommands"), source.indexOf("];", source.indexOf("const paletteCommands")));
    assert.ok(block.length > 100, `${file}: commands found`);
    assert.doesNotMatch(block, /fetch\(|\/api\/|send\(|draftBrief|startStudioPrompt|submit/, `${file}: no command sends or starts paid work`);
  }
});
console.log(`${passed} command palette checks passed.`);

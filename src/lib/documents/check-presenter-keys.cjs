/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for presenter keyboard routing (audit F14). Mounted journey: scripts/check-presenter-keys-browser.cjs. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { presenterShortcut, advancesOnClick } = require("./presenter-keys.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

// A fake element whose closest() matches by tag or [role]/[data-*] attribute, enough for the selectors used.
function element(tag, attributes = {}, parent = null) {
  const node = { tagName: tag.toUpperCase(), parent, isContentEditable: attributes.contenteditable === "true",
    getAttribute: name => (name in attributes ? attributes[name] : null) };
  node.closest = selector => {
    for (let current = node; current; current = current.parent) if (matches(current, selector)) return current;
    return null;
  };
  return node;
}
function matches(node, selector) {
  return selector.split(",").map(part => part.trim()).some(part => {
    const role = part.match(/^\[role='([^']+)'\]$/);
    if (role) return node.getAttribute("role") === role[1];
    if (part.startsWith("[contenteditable]")) return node.getAttribute("contenteditable") !== null && node.getAttribute("contenteditable") !== "false";
    if (part === "a[href]") return node.tagName === "A" && node.getAttribute("href") !== null;
    return node.tagName === part.toUpperCase();
  });
}
const root = element("div", { "data-presenter-root": "", role: "dialog" });
const key = (keyName, target = root, extra = {}) => presenterShortcut({ key: keyName, target, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });

check("canvas keys map to slide actions (presenter root and slide content)", () => {
  const slideText = element("h1", {}, element("section"));
  for (const target of [root, slideText]) {
    for (const k of ["ArrowRight", "ArrowDown", "PageDown", "Enter", " "]) assert.equal(key(k, target), "next", k);
    for (const k of ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]) assert.equal(key(k, target), "previous", k);
    assert.equal(key("Home", target), "first"); assert.equal(key("End", target), "last");
  }
  assert.equal(key(" ", root, { shiftKey: true }), "previous", "Shift+Space goes back");
  assert.equal(key("a"), null); assert.equal(key("Tab"), null);
});

check("Enter/Space on a focused button, link or control activates it instead of advancing", () => {
  const icon = element("svg", {}, element("button", { "aria-label": "Previous slide" }, root));
  for (const target of [element("button", {}, root), icon, element("a", { href: "#x" }), element("summary"), element("span", { role: "button" }), element("div", { role: "checkbox" })]) {
    assert.equal(key("Enter", target), null, `${target.tagName} Enter`);
    assert.equal(key(" ", target), null, `${target.tagName} Space`);
  }
  // A focused button still lets arrow keys move the slides (it does not use them itself).
  assert.equal(key("ArrowRight", element("button", {}, root)), "next");
  assert.equal(element("a").closest("a[href]"), null, "an anchor without href is not a link");
  assert.equal(key("Enter", element("a")), "next");
});

check("fields and key widgets keep arrows, Home/End and Backspace", () => {
  for (const target of [element("input"), element("textarea"), element("select"), element("div", { contenteditable: "true" }), element("div", { role: "slider" }), element("li", { role: "option" }, element("ul", { role: "listbox" }))]) {
    for (const k of ["ArrowLeft", "ArrowRight", "Home", "End", "Backspace", " ", "Enter"]) assert.equal(key(k, target), null, `${target.tagName}/${target.getAttribute("role")} ${k}`);
  }
  assert.equal(key("ArrowRight", element("div", { contenteditable: "false" })), "next", "contenteditable=false is not a field");
});

check("Escape always closes; handled, composing and modified keys are left alone", () => {
  assert.equal(key("Escape"), "close"); assert.equal(key("Escape", element("button")), "close");
  assert.equal(key("Escape", root, { defaultPrevented: true }), null);
  assert.equal(key("ArrowRight", root, { defaultPrevented: true }), null);
  assert.equal(key("Enter", root, { isComposing: true }), null);
  assert.equal(key("Enter", root, { keyCode: 229 }), null, "IME process key");
  for (const modifier of ["ctrlKey", "metaKey", "altKey"]) assert.equal(key("ArrowRight", root, { [modifier]: true }), null, modifier);
  assert.equal(key("ArrowRight", root, { shiftKey: true }), null, "Shift+Arrow is text selection");
  assert.equal(key("ArrowRight", null), "next", "no target is the canvas");
  assert.equal(key("ArrowRight", {}), "next", "a target without closest() (e.g. the document) is the canvas");
});

check("click-to-advance skips links, controls and text selections", () => {
  assert.equal(advancesOnClick(element("h1", {}, element("section")), ""), true);
  assert.equal(advancesOnClick(element("span", {}, element("a", { href: "https://example.invalid" })), ""), false);
  assert.equal(advancesOnClick(element("button"), ""), false);
  assert.equal(advancesOnClick(element("p"), "Selected words"), false);
  assert.equal(advancesOnClick(element("p"), "   "), true, "whitespace-only selection is not a selection");
  assert.equal(advancesOnClick(null, ""), true);
});

check("the presenter is wired to the shared helper", () => {
  const source = fs.readFileSync(require("node:path").join(__dirname, "..", "..", "components", "document-preview.tsx"), "utf8");
  assert.ok(source.includes('from "@/lib/documents/presenter-keys"'));
  assert.ok(!/NEXT_KEYS|PREVIOUS_KEYS/.test(source), "the old blanket key lists are gone");
  assert.ok(source.includes("presenterShortcut(") && source.includes("advancesOnClick(") && source.includes('data-presenter-root=""'));
});

console.log(`\n${passed} presenter key checks passed.`);

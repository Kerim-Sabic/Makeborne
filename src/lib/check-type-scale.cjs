/* eslint-disable @typescript-eslint/no-require-imports -- Offline check: the app type-scale and state tokens exist, and every composer people type into uses them (>=15px desktop, 16px on phones so iOS does not zoom). Computed sizes are measured in Chromium by scripts/check-trust-copy-browser.cjs. */
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const css = name => fs.readFileSync(path.join(__dirname, "..", "app", `${name}.css`), "utf8");
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

check("tokens: type scale and one shade per status meaning", () => {
  const root = css("globals").match(/:root \{[\s\S]*?\n\}/)[0];
  for (const [token, value] of [["--type-caption", "12px"], ["--type-control", "14px"], ["--type-body", "15px"], ["--type-input", "15px"], ["--type-input-touch", "16px"],
    ["--state-error", "#9a2f2a"], ["--state-success", "#1f6b45"], ["--state-warning", "#7a5a2e"]])
    assert.match(root, new RegExp(`${token}: ${value};`), token);
});

check("composers use --type-input on desktop and --type-input-touch on phones", () => {
  const rules = [
    ["live-builder", /\.lb-composer textarea \{[^}]*font-size:var\(--type-input\);/, /@media \(max-width:760px\) \{[\s\S]*?\.lb-composer textarea \{[^}]*font-size:var\(--type-input-touch\);/],
    ["build-workspace", /\.build-composer textarea \{[^}]*font-size:var\(--type-input\);/, /@media \(max-width:760px\) \{\r?\n\s*\.build-composer textarea \{ font-size:var\(--type-input-touch\); \}/],
    ["client-review", /\.cr-composer textarea\{[^}]*font-size:var\(--type-input\);/, /@media\(max-width:640px\)\{\.cr-field input,\.cr-field textarea,\.cr-composer textarea\{font-size:var\(--type-input-touch\)\}/],
    ["creation-plan", /\.prompt-source > textarea \{[^}]*font-size:var\(--type-input\);/, /@media \(max-width:760px\) \{ \.studio-shell \.creation-modal \.prompt-source > textarea \{ font-size:var\(--type-input-touch\); \} \}/],
    ["home", /\.mk-composer textarea\{min-height:90px;font-size:16px/, /@media\(max-width:720px\)\{[^\n]*\.mk-composer textarea\{font-size:var\(--type-input-touch\)\}/],
    ["expert-chat", null, /@media\(max-width:600px\)\{\.advisor-composer textarea\{font-size:var\(--type-input-touch\)\}/],
    ["account-clients", null, /@media \(max-width: 760px\) \{ \.mc-sheet input, \.mc-sheet textarea, \.ce-compose input, \.ce-compose textarea \{ font-size: var\(--type-input-touch\); \} \}/],
  ];
  for (const [file, desktop, phone] of rules) {
    const text = css(file);
    if (desktop) assert.match(text, desktop, `${file} desktop`);
    assert.match(text, phone, `${file} phone`);
  }
  assert.doesNotMatch(css("live-builder"), /\.lb-composer textarea \{[^}]*font-size:12\.5px/, "the 12.5px composer is gone");
  // Pressing Send blurs the field; a focus-only height moved Send between press and release (scripts/check-composer-send-browser.cjs).
  assert.doesNotMatch(css("live-builder"), /\.lb-composer textarea:focus \{[^}]*height/, "the phone composer does not resize on blur");
  assert.match(css("live-builder"), /\.lb-composer textarea:not\(:placeholder-shown\) \{ height:88px; \}/, "it grows with content instead");
});

check("status text in the touched surfaces uses the state tokens", () => {
  assert.match(css("client-review"), /\.cr-error\{[^}]*color:var\(--state-error\)\}\.cr-notice\{[^}]*color:var\(--state-success\)\}/);
  assert.match(css("account-clients"), /\.mc-error \{[^}]*color: var\(--state-error\);/);
  assert.match(css("live-builder"), /\.lb-notice \{[^}]*color:var\(--state-warning\);/);
});

console.log(`${passed}/3 type scale checks passed.`);

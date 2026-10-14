/* eslint-disable @typescript-eslint/no-require-imports -- Offline fail-closed qualification regression. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const sentinel = 'DO_NOT_PRINT_OR_SEND_TEST_KEY';
const script = fs.readFileSync('scripts/qualify-image-model.mjs', 'utf8');
assert(!/\bfetch\s*\(|\.images\.generate\s*\(|new\s+OpenAI/.test(script), 'Blocked qualification must not contain a provider call');
const result = spawnSync(process.execPath, ['scripts/qualify-image-model.mjs', '--model', 'gpt-image-2.5-sunburst', '--approved-usd', '0.60', '--remaining-budget-usd', '1.134856'], {
  encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: sentinel }, timeout: 5000,
});
assert.equal(result.status, 1);
assert.match(result.stderr, /IMAGE_QUALIFICATION_BLOCKED/);
assert(!`${result.stdout}${result.stderr}`.includes(sentinel), 'Credential must not appear in diagnostics');
console.log('PASS image qualification refuses before network access and never prints credentials');

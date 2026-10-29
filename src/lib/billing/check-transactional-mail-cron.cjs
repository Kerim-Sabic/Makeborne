/* eslint-disable @typescript-eslint/no-require-imports -- Execute the real route with controlled service failures. */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), assert = require('node:assert/strict');
let authorized = true, calls = 0, result;
const context = { exports: {}, Response, require: name => {
  if (name === '@/lib/billing/purchase-confirmations') return { runConfirmationSweep: async () => { calls++; return result; } };
  if (name === '@/lib/server/cron-auth') return { authorizedCron: () => authorized };
  throw Error('Unexpected route import');
} };
const file = path.resolve(__dirname, '../../app/api/cron/transactional-mail/route.ts');
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const clean = () => ({ confirmations: { created: 0, skipped: 0, failed: 0, enabled: true }, mail: { claimed: 0, sent: 0, failed: 0, enabled: true } });
(async () => {
  result = clean(); result.mail.failed = 1;
  assert.equal((await context.exports.GET({})).status, 503, 'Provider refusal must fail cron monitoring, even though fulfilment stays successful');
  result = clean(); result.confirmations.failed = 1;
  assert.equal((await context.exports.POST({})).status, 503, 'Confirmation storage failure must not report healthy');
  result = clean(); result.confirmations.skipped = 1;
  assert.equal((await context.exports.GET({})).status, 503, 'An unknown paid plan requires operator attention');
  result = { error: 'SWEEP_FAILED' };
  assert.equal((await context.exports.GET({})).status, 503);
  result = clean(); result.confirmations.enabled = false; result.mail.enabled = false;
  assert.equal((await context.exports.GET({})).status, 503, 'Disabled mail is not an operational sender');
  result = clean(); result.mail.enabled = false;
  assert.equal((await context.exports.GET({})).status, 503, 'Recording confirmations without sending them is not healthy delivery');
  result = clean();
  const healthy = await context.exports.GET({}); assert.equal(healthy.status, 200); assert.equal(healthy.headers.get('Cache-Control'), 'no-store');
  authorized = false; const before = calls;
  assert.equal((await context.exports.GET({})).status, 401); assert.equal((await context.exports.POST({})).status, 401); assert.equal(calls, before, 'Unauthorized requests must never claim or send mail');
  console.log('PASS transactional mail cron: provider/record/unknown-plan/disabled failures are visible; healthy 200; unauthorized requests perform no sweep');
})().catch(error => { console.error(error); process.exitCode = 1; });

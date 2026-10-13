/* eslint-disable @typescript-eslint/no-require-imports -- Offline release safety check. */
const assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm');
const context = { exports: {}, Request, Response, URL };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/release-maintenance.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, context);
const guard = context.exports.releaseMaintenanceResponse;
for (const route of ['/api/build','/api/build/plan','/api/generate','/api/generate/prepare','/api/credits','/api/cron/billing-reconcile','/api/cloud/workspaces/a/artifacts/b/publication','/api/billing/checkout','/api/github/callback','/api/unknown-future-route']) {
  for (const method of ['GET','POST','PATCH','DELETE']) {
    const req = new Request(`http://localhost${route}`,{method});
    assert.equal(guard(req,'on').status,503);
    assert.equal(guard(req,'typo').status,503,'Unknown nonempty setting must fail closed');
    assert.equal(guard(req,'off'),null);
    assert.equal(guard(req,undefined),null);
  }
}
for (const route of ['/api/billing/webhook','/api/billing/whop-events']) {
  assert.equal(guard(new Request(`http://localhost${route}`,{method:'POST'}),'on'),null);
  assert.equal(guard(new Request(`http://localhost${route}`),'on').status,503);
  assert.equal(guard(new Request(`http://localhost${route}/spoof`,{method:'POST'}),'on').status,503);
}
assert.equal(guard(new Request('http://localhost/api/auth/providers'),'on'),null);
assert.equal(guard(new Request('http://localhost/'),'on'),null);
assert.equal(guard(new Request('http://localhost/api/build'),'on').headers.get('Retry-After'),'60');
const proxy = fs.readFileSync('src/proxy.ts','utf8');
assert(proxy.includes('"/api/:path*"'));
assert(proxy.indexOf('if (maintenance) return maintenance') < proxy.indexOf('return updateSession(request)'));
console.log('PASS recovery ingress: API reads/mutations/callbacks/cron stopped; exact signed webhook routes preserved; default off; typo fails closed; guard runs before session work');

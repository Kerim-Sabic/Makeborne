/* eslint-disable @typescript-eslint/no-require-imports -- Offline authenticated status boundary checks. */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const userId = '00000000-0000-4000-8000-000000000001';
const orderId = 'abcdef00-0000-4000-8000-000000000002';
const otherId = '00000000-0000-4000-8000-000000000003';
const receipt = { orderId, packId: 'boost_100', credits: 100, priceCents: 1200, currency: 'usd', state: 'pending' };
let user = { id: userId }, authError = null, dbError = null, result = { data: receipt, error: null }, calls = [], groups = 0;
const cache = new Map();
const mocks = {
  'server-only': {},
  '@/lib/billing/access': {
    requireBillingUser: async () => {
      if (authError) throw authError;
      if (!user) throw new (load('lib/server/http.ts').RequestError)('AUTH_REQUIRED', 'Sign in before continuing to payment or your workspace.', 401);
      return user;
    },
    requireCreationAccess: () => { throw Error('Status must not require a plan or call the provider'); },
  },
  '@/lib/billing/database': { billingDatabase: () => {
    if (dbError) throw dbError;
    return { rpc: async (name, args) => { calls.push({ name, args }); return result; } };
  } },
};
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename);
  const context = { exports: {}, Response, Request, Headers, URL, TextDecoder, Uint8Array,
    require: (name) => {
      const absolute = name.startsWith('@/') ? path.resolve(root, name.slice(2) + '.ts')
        : name.startsWith('.') ? path.resolve(path.dirname(filename), name + '.ts') : null;
      const alias = absolute ? '@/' + path.relative(root, absolute).replaceAll('\\', '/').replace(/\.ts$/, '') : name;
      if (Object.hasOwn(mocks, alias)) return mocks[alias];
      if (absolute) return load(absolute);
      if (name === 'zod') return require(name);
      throw Error(`Unexpected import: ${name}`);
    },
    fetch: () => { throw Error('Network forbidden in offline status checks'); },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context, { filename });
  cache.set(filename, context.exports);
  return context.exports;
}
const request = (id = orderId) => load('app/api/billing/topups/[orderId]/route.ts').GET(
  new Request(`https://makeborne.invalid/api/billing/topups/${id}`), { params: Promise.resolve({ orderId: id }) });
async function response(expected, id) {
  const value = await request(id);
  assert.equal(value.status, expected);
  assert.equal(value.headers.get('cache-control'), 'private, no-store');
  assert.equal(value.headers.get('vary'), 'Cookie');
  return value.json();
}
(async () => {
  assert.deepEqual(await response(200), receipt);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ name: 'makeborne_topup_order_status', args: { p_user: userId, p_order: orderId } }]);
  groups++;
  for (const state of ['pending', 'delivered', 'under_review', 'refunded']) {
    result = { data: { ...receipt, state, credits: 117, priceCents: 1375 }, error: null };
    assert.deepEqual(await response(200), result.data, 'Historical snapshot may differ from current catalogue');
  }
  groups++;
  result = { data: receipt, error: null };
  assert.deepEqual(await response(200, orderId.toUpperCase()), receipt);
  groups++;
  const before = calls.length;
  for (const invalid of ['not-an-order', 'ch_Secret', '../other', '', '00000000-0000-0000-0000-000000000001']) await response(400, invalid);
  assert.equal(calls.length, before);
  groups++;
  user = null;
  await response(401); await response(401, 'invalid');
  assert.equal(calls.length, before);
  user = { id: userId }; // No membership attributes: old purchases remain readable.
  await response(200);
  groups++;
  result = { data: null, error: null };
  const missing = await response(404);
  user = { id: otherId };
  assert.deepEqual(await response(404), missing);
  assert.equal(calls.at(-1).args.p_user, otherId);
  user = { id: userId };
  groups++;
  result = { data: null, error: { message: 'secret database detail', code: '42P01' } };
  const unavailable = await response(503);
  dbError = new Error('secret connection URL');
  assert.deepEqual(await response(503), unavailable);
  dbError = new (load('lib/server/http.ts').RequestError)('PRIVATE_CODE', 'private error', 403);
  assert.deepEqual(await response(503), unavailable);
  dbError = null;
  authError = new Error('provider detail');
  assert.deepEqual(await response(503), unavailable);
  authError = null;
  assert.ok(!JSON.stringify(unavailable).includes('secret'));
  groups++;
  for (const patch of [
    { orderId: otherId }, { credits: 0 }, { credits: 1.2 }, { credits: Number.MAX_SAFE_INTEGER + 1 },
    { priceCents: -1 }, { currency: 'eur' }, { state: 'funded' }, { packId: 'unknown' },
    { checkoutId: 'ch_Secret' }, { evidence: { private: true } }, { userId },
  ]) {
    result = { data: { ...receipt, ...patch }, error: null };
    assert.deepEqual(await response(503), unavailable);
  }
  for (const malformed of [undefined, [], 'private', { ...receipt, credits: '100' }]) {
    result = { data: malformed, error: null };
    assert.deepEqual(await response(503), unavailable);
  }
  groups++;
  const contract = load('lib/billing/topup-status-contract.ts');
  assert.equal(contract.CreditTopupStatusSchema.safeParse(receipt).success, true);
  assert.equal(contract.CreditTopupStatusSchema.safeParse({ ...receipt, checkoutUrl: 'https://provider.invalid' }).success, false);
  groups++;
  console.log(`PASS: ${groups} top-up status groups (auth, owner-bound RPC, historical snapshots, validation, generic errors, private caching, no provider or credit writes)`);
})().catch(error => { console.error(error); process.exitCode = 1; });

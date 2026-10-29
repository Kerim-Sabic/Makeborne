/* eslint-disable @typescript-eslint/no-require-imports -- Explicitly approved real-email qualification; never part of npm test. */
// Actual app composers/mailer/outbox + real SQL in a disposable network-none DB.
// Requires --send-real-to admin@makeborne.com and a private sending-only key file.
// No Whop requests, production connection, deployment or AI call is made.
const fs = require('node:fs'), cp = require('node:child_process'), crypto = require('node:crypto');
const vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict');
const out = 'work/launch-prep';
const verifyExisting = process.argv.length === 3 && process.argv[2] === '--verify-existing';
if (!verifyExisting) assert.deepEqual(process.argv.slice(2), ['--send-real-to', 'admin@makeborne.com'], 'Explicit recipient authorization required');
const existing = verifyExisting ? JSON.parse(fs.readFileSync(`${out}/confirmation-mail-qualification.json`, 'utf8')) : null;
const recipient = 'admin@makeborne.com';
const key = verifyExisting ? null : JSON.parse(fs.readFileSync(`${out}/confirmation-resend.private.json`, 'utf8'));
if (!verifyExisting) assert(key.environment === 'staging' && key.permission === 'sending_access' && key.domain === 'makeborne.com', 'Staging sending-only credential required');
const prior = JSON.parse(fs.readFileSync('docs/release-review/staging-overlay-rehearsal-20261028.json', 'utf8'));
assert(prior.passed, 'Qualified staging-shaped database required');
const container = prior.scenarios.full.container;
assert(/^makeborne_candidate_\d{8}_full_\d{14}$/.test(container));
const suffix = crypto.randomBytes(5).toString('hex');
const db = existing?.database ?? `mail_qualification_20261029_${suffix}`;
assert(/^mail_qualification_20261029_[a-f0-9]{10}$/.test(db));
const user = crypto.randomUUID(), request = crypto.randomUUID(), packRequest = crypto.randomUUID();
const planId = `plan_FictionalMail${suffix}`, planPayment = `pay_FictionalPlan${suffix}`, packPayment = `pay_FictionalPack${suffix}`;
const membership = `mem_FictionalMail${suffix}`, checkout = `ch_FictionalMail${suffix}`;
const fixtureCatalog = `mail-fixture-${suffix}`;
const report = existing ?? { startedAt: new Date().toISOString(), code: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  productionTouched: false, realWhopPurchase: false, cloudAppQualified: false, aiCalls: 0, container, database: db,
  recipient, providerRequests: 0, receipts: [], checks: [], passed: false };
const save = () => fs.writeFileSync(`${out}/confirmation-mail-qualification.json`, JSON.stringify(report, null, 2));
function docker(args, input, allow = false) {
  const r = cp.spawnSync('docker', args, { input, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (!allow && r.status !== 0) throw new Error('Isolated Docker/SQL operation failed; diagnostic values suppressed');
  return r;
}
function sql(query, role = 'postgres') {
  return docker(['exec', '-i', container, 'psql', '-U', role, '-d', db, '-qAt', '-v', 'ON_ERROR_STOP=1'], query).stdout.trim();
}
const literal = value => value === null ? 'null' : typeof value === 'boolean' ? String(value) : typeof value === 'number'
  ? (assert(Number.isSafeInteger(value)), String(value)) : `'${String(value).replace(/'/g, "''")}'`;
const allowed = new Set(['makeborne_purchase_confirmation_candidates', 'makeborne_record_purchase_confirmation',
  'makeborne_transactional_mail_claim', 'makeborne_transactional_mail_result', 'makeborne_record_withdrawal_request']);
async function rpc(name, args = {}) {
  assert(allowed.has(name));
  for (const k of Object.keys(args)) assert(/^p_[a-z_]+$/.test(k));
  const params = Object.entries(args).map(([k, v]) => `${k}=>${literal(v)}`).join(',');
  const value = sql(`set standard_conforming_strings=on; set role service_role; select coalesce(to_jsonb(public.${name}(${params})),'null'::jsonb)::text;`);
  return { data: JSON.parse(value), error: null };
}
function load(file, modules = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, Date, Intl, JSON, console: { info() {}, warn() {} }, process: { env: {} }, fetch, AbortSignal,
    require: name => name === 'server-only' ? {} : Object.hasOwn(modules, name) ? modules[name] : (() => { throw Error('Unexpected qualification import'); })() };
  vm.runInNewContext(source, context, { filename: file });
  return context.exports;
}
const plans = load('src/lib/billing/plans.ts');
const legal = load('src/lib/legal/versions.ts', { '../billing/plans': plans });
const texts = load('src/lib/legal/purchase-confirmation.ts');
const mailer = load('src/lib/mail/transactional.ts');
const confirmations = load('src/lib/billing/purchase-confirmations.ts', {
  '@/lib/legal/purchase-confirmation': texts, '@/lib/legal/versions': legal, '@/lib/mail/transactional': mailer,
  './plans': plans, './plan-credits': { creditRuleFor: id => id === planId ? { tier: 'create', interval: 'monthly' } : null },
  './database': { billingDatabase: () => { throw Error('Default external database access prohibited'); } },
});
const deliveredPayloads = [];
async function send(mail, invalid = false) {
  assert.equal(mail.to, recipient, 'Never send qualification mail to another recipient');
  assert(++report.providerRequests <= 8, 'Provider request ceiling reached');
  await new Promise(resolve => setTimeout(resolve, 1100));
  const result = await mailer.sendTransactionalMail(mail, { env: { MAKEBORNE_TRANSACTIONAL_MAIL_ENABLED: 'true', RESEND_API_KEY: invalid ? 're_FICTIONAL_INVALID_QUALIFICATION_KEY' : key.key } });
  if (result.ok) {
    report.receipts.push({ id: result.id, subject: mail.subject, idempotencyKey: mail.idempotencyKey,
      contentSha256: crypto.createHash('sha256').update(mail.subject+'\n'+mail.text).digest('hex') });
    deliveredPayloads.push(mail);
  }
  save();
  return result;
}
const deps = { rpc, since: new Date(Date.now() - 60000).toISOString(), planLabel: confirmations.defaultPlanLabel,
  mailEnabled: true, send: mail => send(mail), log: e => report.checks.push({ diagnostic: e.status, code: e.code ?? null }) };
function passed(name) { report.checks.push({ name, passed: true }); save(); console.log(`PASS ${name}`); }
function verifyPersistedResults() {
  const rows = JSON.parse(sql(`select json_agg(json_build_object('kind',kind,'status',status,'attempts',attempts,'providerId',provider_message_id,'subject',subject,'body',body)) from makeborne_private.transactional_mail where recipient=${literal(recipient)};`));
  assert.equal(rows.length, 4); assert(rows.every(x=>x.status==='sent')); assert.equal(new Set(rows.map(x=>x.providerId)).size,4);
  for (const row of rows) {
    const hash = crypto.createHash('sha256').update(row.subject+'\n'+row.body).digest('hex');
    assert(report.receipts.some(x=>x.id===row.providerId && x.contentSha256===hash), 'Sent content differs from the durable receipt');
  }
  const plan = rows.find(x=>x.subject === 'Your Makeborne purchase confirmation: Create plan, monthly');
  const pack = rows.find(x=>x.subject === 'Your Makeborne purchase confirmation: credit pack, 100 credits');
  assert(plan && pack);
  assert(plan.body.includes('US$20.00') && plan.body.includes('300 credits for each month') && plan.body.includes(legal.WITHDRAWAL_CONSENT_TEXT));
  assert(pack.body.includes('US$12.00') && pack.body.includes('100 credits, a one-time payment that does not renew') && pack.body.includes('no request to start immediately is on record'));
  assert(rows.filter(x=>x.kind==='withdrawal_ack').every(x=>/WD-[A-F0-9]{8}/.test(x.body) && !x.body.includes('{{') && x.body.includes('Fictional staging test only')));
  report.outbox = rows.map(({kind,status,attempts,providerId})=>({kind,status,attempts,providerId}));
  report.distinctProviderEmails = 4; report.passed = true;
  passed('four durable sent rows exactly match provider receipt IDs, content hashes, prices, credits and consent');
}
(async () => {
  const mode = JSON.parse(docker(['inspect', '--format', '{{json .HostConfig.NetworkMode}}', container]).stdout);
  assert.equal(mode, 'none');
  docker(['start', container]);
  if (verifyExisting) {
    assert.equal(report.container, container); assert.equal(report.recipient, recipient);
    assert(report.checks.slice(0,8).length === 8 && report.checks.slice(0,8).every(x=>x.passed), 'Prior sending/retry tests must have completed');
    verifyPersistedResults();
    report.collectorCorrection = 'Read-only completion after correcting provider_id to provider_message_id; no additional email sends';
    delete report.error;
    return;
  }
  docker(['exec', container, 'createdb', '-U', 'supabase_admin', '-T', 'rehearsal', db]);
  report.networkIsolation = 'none'; save();
  // Fresh ordinary user; never borrow a live account or change its billing state.
  sql(`begin;
    insert into auth.users(id,email,email_confirmed_at) values (${literal(user)},${literal(recipient)},now());
    insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status)
      values (${literal(request)},${literal(user)},${literal(planId)},${literal(checkout)},'/studio','ready');
    insert into makeborne_private.checkout_consents(user_id,request_id,kind,version,terms_version,consent_text)
      values (${literal(user)},${literal(request)},'plan',${literal(plans.WITHDRAWAL_CONSENT_VERSION)},${literal(plans.BILLING_TERMS_VERSION)},${literal(legal.WITHDRAWAL_CONSENT_TEXT)});
    insert into public.billing_memberships(membership_id,user_id,checkout_id,whop_user_id,plan_id,status)
      values (${literal(membership)},${literal(user)},${literal(checkout)},'user_FictionalMail',${literal(planId)},'active');
    insert into makeborne_private.plan_payments(payment_id,user_id,membership_id,plan_id,billing_reason,currency,principal_cents,refunded_cents,dispute,paid_at,state,evidence,observed_at)
      values (${literal(planPayment)},${literal(user)},${literal(membership)},${literal(planId)},'subscription_create','usd',2000,0,'none',now(),'funded','{}',now());
    insert into makeborne_private.topup_catalog(version,pack_id,credits,price_cents) values (${literal(fixtureCatalog)},'boost_100',100,1200);
    with lot as (insert into makeborne_private.credit_lots(user_id,source,reference,amount)
      values (${literal(user)},'topup',${literal('fictional-'+suffix)},100) returning id)
    insert into makeborne_private.topup_orders(user_id,request_id,pack_id,catalog_version,credits,price_cents,merchant_id,plan_id,whop_user_id,checkout_id,payment_id,state,granted,lot_id,evidence,observed_at)
      select ${literal(user)},${literal(packRequest)},'boost_100',${literal(fixtureCatalog)},100,1200,'biz_FictionalMail','plan_FictionalPack','user_FictionalMail','ch_FictionalPack',${literal(packPayment)},'funded',true,id,'{"principalCents":"1200"}',now() from lot;
    commit;`);
  const made = await confirmations.ensurePurchaseConfirmations(deps);
  assert.equal(made.created, 2); assert.equal(made.failed, 0); passed('real SQL creates plan and pack confirmations with immutable consent');
  const off = await confirmations.drainTransactionalMail({ ...deps, mailEnabled: false });
  assert.equal(off.claimed, 0); assert.equal(report.providerRequests, 0); passed('disabled sender leaves queued mail untouched');
  const sent = await confirmations.drainTransactionalMail(deps);
  assert.equal(sent.sent, 2); assert.equal(sent.failed, 0); passed('actual app sender and service-role SQL settle both provider receipts');
  const replay = await confirmations.ensurePurchaseConfirmations(deps);
  const empty = await confirmations.drainTransactionalMail(deps);
  assert.equal(replay.created, 0); assert.equal(empty.claimed, 0); assert.equal(report.providerRequests, 2); passed('fulfilment replay creates no second record or email');
  const duplicate = await send(deliveredPayloads[0]);
  assert(duplicate.ok); assert.equal(duplicate.id, report.receipts[0].id); passed('provider idempotency replay returns the identical email ID');
  async function withdrawal(message) {
    const facts = { statement: 'Fictional staging test only: no real purchase, withdrawal or refund is requested.', paymentId: planPayment,
      paymentReference: null, name: 'Makeborne staging qualification', message };
    const template = texts.composeWithdrawalAcknowledgement(facts);
    return (await rpc('makeborne_record_withdrawal_request', { p_user: user, p_email: null, p_name: facts.name,
      p_payment_reference: null, p_payment_id: planPayment, p_statement: facts.statement, p_message: message,
      p_ack_subject: template.subject, p_ack_template: template.template })).data;
  }
  const notice = await withdrawal('Fictional acknowledgement delivery test');
  assert.equal(notice.acknowledgement, 'queued');
  const ack = await confirmations.drainTransactionalMail(deps);
  assert.equal(ack.sent, 1); assert(!deliveredPayloads.at(-1).text.includes('{{reference}}')); passed('withdrawal acknowledgement includes server reference and received timestamp');
  const retry = await withdrawal('Fictional retry recovery test');
  const failed = await confirmations.drainTransactionalMail({ ...deps, send: mail => send(mail, true) });
  assert.equal(failed.sent, 0); assert.equal(failed.failed, 1);
  const pending = JSON.parse(sql(`select json_build_object('status',status,'attempts',attempts,'future',next_attempt_at>now(),'error',last_error) from makeborne_private.transactional_mail where withdrawal_id=${literal(retry.id)};`));
  assert.equal(pending.status, 'pending'); assert.equal(pending.attempts, 1); assert(pending.future); assert.equal(pending.error, 'MAIL_HTTP_401');
  passed('real provider credential refusal records retry/backoff without a false sent receipt');
  // Advance only this disposable fixture's due time; never shorten real retry windows.
  sql(`update makeborne_private.transactional_mail set next_attempt_at=clock_timestamp()-interval '1 second' where withdrawal_id=${literal(retry.id)};`);
  const recovered = await confirmations.drainTransactionalMail(deps);
  assert.equal(recovered.sent, 1); assert.equal(recovered.failed, 0); passed('second fenced attempt recovers using the valid staging sending key');
  verifyPersistedResults();
})().catch(() => { report.passed = false; report.error = 'Qualification stopped; private test inputs and credentials were not logged'; process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save(); docker(['stop', container], undefined, true); console.log(JSON.stringify({passed:report.passed,providerRequests:report.providerRequests,distinctProviderEmails:report.distinctProviderEmails??null,productionTouched:false,report:`${out}/confirmation-mail-qualification.json`})); });

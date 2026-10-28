/* eslint-disable @typescript-eslint/no-require-imports -- Offline check of the transactional mailer; fetch is faked, no mail is sent. */
const fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict");
const output = ts.transpileModule(fs.readFileSync(require.resolve("./transactional.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {}, AbortSignal, JSON, process: { env: {} }, require: name => name === "server-only" ? {} : require(name) };
vm.runInNewContext(output, context);
const { sendTransactionalMail, transactionalMailEnabled, TRANSACTIONAL_FROM } = context.exports;
const key = "re_fixtureKey0123456789";
const on = { MAKEBORNE_TRANSACTIONAL_MAIL_ENABLED: "true", RESEND_API_KEY: key };
const mail = { to: "buyer@example.test", subject: "Subject", text: "Body", idempotencyKey: "purchase-confirmation:pay_X1" };
(async () => {
  assert.equal(transactionalMailEnabled({}), false);
  assert.equal(transactionalMailEnabled({ MAKEBORNE_TRANSACTIONAL_MAIL_ENABLED: "true" }), false, "no key, no mail");
  assert.equal(transactionalMailEnabled({ MAKEBORNE_TRANSACTIONAL_MAIL_ENABLED: "1", RESEND_API_KEY: key }), false, "only the exact flag");
  assert.equal(transactionalMailEnabled({ MAKEBORNE_TRANSACTIONAL_MAIL_ENABLED: "true", RESEND_API_KEY: "sk_wrong" }), false);
  assert.equal(transactionalMailEnabled(on), true);
  let calls = [];
  const fake = (status, body) => async (url, init) => { calls.push({ url, init }); return { ok: status < 300, status, json: async () => body }; };
  assert.deepEqual({ ...(await sendTransactionalMail(mail, { env: {}, fetch: fake(200, { id: "x" }) })) }, { ok: false, code: "MAIL_DISABLED", retry: true });
  assert.equal(calls.length, 0, "disabled mail never calls the provider");
  const sent = await sendTransactionalMail(mail, { env: on, fetch: fake(200, { id: "email_123" }) });
  assert.equal(sent.ok, true); assert.equal(sent.id, "email_123");
  const request = calls[0];
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.init.headers.Authorization, `Bearer ${key}`);
  assert.equal(request.init.headers["Idempotency-Key"], mail.idempotencyKey);
  const body = JSON.parse(request.init.body);
  assert.equal(body.from, TRANSACTIONAL_FROM); assert.equal(TRANSACTIONAL_FROM, "Makeborne <admin@makeborne.com>");
  assert.deepEqual([...body.to], ["buyer@example.test"]); assert.equal(body.reply_to, "admin@makeborne.com"); assert.equal(body.text, "Body");
  assert.equal(body.html, undefined, "plain text only");
  const cases = [[429, "MAIL_RATE_LIMITED", true], [500, "MAIL_HTTP_500", true], [409, "MAIL_HTTP_409", true], [422, "MAIL_HTTP_422", false], [401, "MAIL_HTTP_401", true]];
  for (const [status, code, retry] of cases) {
    const result = await sendTransactionalMail(mail, { env: on, fetch: fake(status, { message: `secret ${key}` }) });
    assert.equal(result.ok, false); assert.equal(result.code, code); assert.equal(result.retry, retry);
    assert.ok(!JSON.stringify(result).includes(key), "results never carry the key or provider text");
  }
  const unconfirmed = await sendTransactionalMail(mail, { env: on, fetch: fake(200, {}) });
  assert.equal(unconfirmed.code, "MAIL_UNCONFIRMED");
  const network = await sendTransactionalMail(mail, { env: on, fetch: async () => { throw new Error(`boom ${key}`); } });
  assert.equal(network.code, "MAIL_NETWORK"); assert.ok(!JSON.stringify(network).includes(key));
  const invalid = await sendTransactionalMail({ ...mail, to: "nobody" }, { env: on, fetch: fake(200, { id: "x" }) });
  assert.equal(invalid.code, "MAIL_INVALID"); assert.equal(invalid.retry, false);
  console.log("PASS transactional mail: off unless flagged with a Resend key; plain text from admin@makeborne.com with an idempotency key; error codes only, never the key");
})().catch(error => { console.error(error); process.exitCode = 1; });

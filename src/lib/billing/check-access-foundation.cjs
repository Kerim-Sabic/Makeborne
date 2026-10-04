/* eslint-disable @typescript-eslint/no-require-imports -- Offline configuration and signature regression checks. */
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { Webhook } = require("standardwebhooks");
class RequestError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
function load(file, env, modules = {}) {
  const output = ts.transpileModule(fs.readFileSync(require.resolve(file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, process: { env }, Buffer, Date, require: name => name === "server-only" ? {} : modules[name] ?? require(name) };
  vm.runInNewContext(output, context);
  return context.exports;
}
const env = { WHOP_API_KEY: "fake-api", WHOP_COMPANY_ID: "biz_CV9cZg1zFX3h7f", SUPABASE_SECRET_KEY: "sb_secret_fake", WHOP_ACCESS_PLAN_IDS: "plan_B7Dgm9ZqM3V0M,plan_unknown", WHOP_CREATION_ENABLED: "true", MAKEBORNE_BILLING_MIGRATIONS_VERIFIED: "true" };
const config = load("./config.ts", env);
assert.equal(config.billingConfig().enabled, false);
assert.equal(config.billingConfig().accessPlanIds.length, 0);
env.WHOP_ACCESS_PLAN_IDS = config.CREATION_CATALOG.create;
assert.equal(config.billingConfig().enabled, true);
env.WHOP_CREATION_ENABLED = "false";
assert.equal(config.billingConfig().enabled, false);
env.WHOP_CREATION_ENABLED = "true";
env.MAKEBORNE_BILLING_MIGRATIONS_VERIFIED = "false";
assert.equal(config.billingConfig().enabled, false);
const secret = "ws_fake_for_offline_signature_verification_only";
const webhook = load("./webhook.ts", { WHOP_WEBHOOK_SECRET: secret }, {
  "@/lib/server/http": { RequestError }, "./config": config, "./database": {}, "./whop": {},
});
const body = JSON.stringify({ id: "msg_test", type: "membership.activated", account_id: "biz_CV9cZg1zFX3h7f", data: { id: "mem_test" } });
const now = new Date();
const signer = new Webhook(Buffer.from(secret).toString("base64"));
const headers = new Headers({ "webhook-id": "msg_test", "webhook-timestamp": String(Math.floor(now.getTime() / 1000)), "webhook-signature": signer.sign("msg_test", now, body) });
assert.equal(webhook.verifyWhopEvent(body, headers).id, "msg_test");
assert.throws(() => webhook.verifyWhopEvent(body + " ", headers), error => error.code === "INVALID_WEBHOOK");
const wrongId = new Headers(headers); wrongId.set("webhook-id", "msg_wrong");
assert.throws(() => webhook.verifyWhopEvent(body, wrongId), error => error.code === "INVALID_WEBHOOK");
const past = new Date(now.getTime() - 600_000);
const oldHeaders = new Headers({ "webhook-id": "msg_test", "webhook-timestamp": String(Math.floor(past.getTime() / 1000)), "webhook-signature": signer.sign("msg_test", past, body) });
assert.throws(() => webhook.verifyWhopEvent(body, oldHeaders), error => error.code === "INVALID_WEBHOOK");
console.log("PASS: coffee/unknown plans cannot grant access, feature and migration flags fail closed, signed webhooks verify, tampered/stale signatures reject. No live services called.");

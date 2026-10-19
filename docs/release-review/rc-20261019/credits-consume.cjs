/* eslint-disable @typescript-eslint/no-require-imports -- Evidence script: disposable rc stack only. */
// Consumes credits for the fixture owner through the same hold -> settle path a builder run uses
// (service role, SIMULATED run: no provider call), retries the settle (duplicate delivery) and
// reconciles the ledger against the wallet. Usage: node docs/release-review/rc-20261019/credits-consume.cjs
const fs = require("node:fs"), assert = require("node:assert/strict");
const { createClient } = require("@supabase/supabase-js");
const status = JSON.parse(fs.readFileSync("work/rc-stack/status.json", "utf8"));
assert.equal(status.API_URL, "http://127.0.0.1:55481");
const owner = JSON.parse(fs.readFileSync("docs/release-review/rc-20261019/fixtures.json", "utf8")).users.find(u => u.label === "owner").id;
const admin = createClient(status.API_URL, status.SECRET_KEY, { auth: { persistSession: false } });
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.code} ${r.error.message}`); return r.data; };
(async () => {
  const before = must(await admin.rpc("makeborne_credit_wallet", { p_user: owner }), "wallet before");
  const reference = `rc-run-${Date.now()}`;
  const reserved = must(await admin.rpc("makeborne_credit_reserve", { p_user: owner, p_amount: 40, p_reference: reference }), "reserve");
  const during = must(await admin.rpc("makeborne_credit_wallet", { p_user: owner }), "wallet during");
  const settled = must(await admin.rpc("makeborne_credit_settle_run", { p_user: owner, p_reference: reference, p_measured: 25, p_exempt: false, p_detail: { kind: "rc-simulated-run" } }), "settle");
  const replay = must(await admin.rpc("makeborne_credit_settle_run", { p_user: owner, p_reference: reference, p_measured: 25, p_exempt: false, p_detail: { kind: "rc-simulated-run" } }), "settle replay");
  const after = must(await admin.rpc("makeborne_credit_wallet", { p_user: owner }), "wallet after");
  const ledger = must(await admin.from("credit_ledger").select("kind,delta,reference,created_at").eq("user_id", owner).order("created_at"), "ledger");
  const sum = ledger.reduce((t, row) => t + Number(row.delta), 0);
  const out = { before: { available: before.available, reserved: before.reserved }, reserved, during: { available: during.available, reserved: during.reserved }, settled, replay,
    after: { available: after.available, reserved: after.reserved, nextExpiry: after.nextExpiry }, ledger: ledger.map(r => ({ kind: r.kind, delta: Number(r.delta) })), ledgerSum: sum, ledgerMatchesWallet: sum === Number(after.available) };
  fs.writeFileSync("docs/release-review/rc-20261019/credits-consume.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error(e); process.exit(1); });

// Creates hidden Whop SANDBOX plans used to observe real provider lifecycle events (gate 2 and
// founding offer). Sandbox only: refuses any other API host. Idempotent per probe name.
// Usage: node scripts/prepare-whop-sandbox-probes.mjs
import fs from "node:fs";
import assert from "node:assert/strict";

const config = JSON.parse(fs.readFileSync("work/release-auth-stack/whop-sandbox.json", "utf8").replace(/^﻿/, ""));
assert.equal(new URL(config.apiBase).host, "sandbox-api.whop.com", "Sandbox only");
const PRODUCT = "prod_CDLOn3W9hruAI"; // "Makeborne Release Test" sandbox product
const VERSION = "2026-10-09-2"; // /variants is documented in the current API version
const probes = [
  // Whop refuses daily billing for this company ("You cannot offer daily subscriptions"), so a 1-day
  // trial makes the first scheduled charge happen after one day; the next renewal follows 7 days later.
  { name: "renewal-probe", body: { plan_type: "renewal", billing_period: 7, initial_price: 0, renewal_price: 1, trial_period_days: 1 },
    purpose: "Real scheduled charges: day 1 (trial end) and day 8 (renewal). Buy with test card 4242 4242 4242 4242." },
  { name: "failed-renewal-probe", body: { plan_type: "renewal", billing_period: 7, initial_price: 0, renewal_price: 1, trial_period_days: 1 },
    purpose: "Failed scheduled charge and recovery. Buy with test card 4000 0000 0000 0341 (saves, later charges decline)." },
  { name: "founding-probe", body: { plan_type: "renewal", billing_period: 30, initial_price: 2, renewal_price: 3, trial_period_days: 1 },
    purpose: "Founding design: initial charge with a trial, extend the trial via API, first renewal at the standard price." },
];
const out = "docs/release-review/whop-sandbox-probes.json";
const existing = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : { probes: [] };
const results = [];
for (const probe of probes) {
  const known = existing.probes.find(p => p.name === probe.name);
  if (known) { results.push(known); continue; }
  const response = await fetch(`${config.apiBase}/variants`, { method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json",
    "Api-Version-Date": VERSION, "Idempotency-Key": `makeborne-${probe.name}-20261013-v2` },
    body: JSON.stringify({ product_id: PRODUCT, visibility: "hidden", release_method: "buy_now", currency: "usd", title: `Makeborne ${probe.name}`, ...probe.body }) });
  const body = await response.json().catch(() => null);
  if (!response.ok) { console.error(probe.name, response.status, JSON.stringify(body).slice(0, 600)); process.exitCode = 1; break; }
  results.push({ name: probe.name, purpose: probe.purpose, planId: body.id, purchaseUrl: body.purchase_url ?? null, requested: probe.body,
    returned: { billing_period: body.billing_period, initial_price: body.initial_price, renewal_price: body.renewal_price, trial_period_days: body.trial_period_days ?? null, visibility: body.visibility }, createdAt: new Date().toISOString() });
}
fs.writeFileSync(out, JSON.stringify({ sandboxOnly: true, productionTouched: false, apiVersion: VERSION, product: PRODUCT, probes: results }, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));

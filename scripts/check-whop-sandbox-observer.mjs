// Entirely offline: synthetic configuration, injected fetch, disposable local evidence.
// Run: node --test scripts/check-whop-sandbox-observer.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { observeSandbox, runObserver, parseArguments, sanitizedError, SANDBOX_BASE, SANDBOX_COMPANY } from "./observe-whop-sandbox.mjs";

const config = { apiBase: SANDBOX_BASE, companyId: SANDBOX_COMPANY, apiKey: "synthetic-never-a-real-key" };
const member = (id = "mem_one", extra = {}) => ({ id, company: { id: SANDBOX_COMPANY }, status: "active", plan: { id: "plan_one" }, ...extra });
const payment = (id = "pay_one", extra = {}) => ({ id, company: { id: SANDBOX_COMPANY }, status: "paid", total: 29,
  refunded_amount: 0, refundable: true, membership: { id: "mem_one" }, ...extra });
const page = (data = [], hasNext = false, cursor = null) => ({ data, page_info: { has_next_page: hasNext, end_cursor: cursor } });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function mock(handler) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    assert.ok(url.startsWith(SANDBOX_BASE + "/"));
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["Api-Version-Date"], "2025-01-01");
    assert.equal(options.headers.Authorization, `Bearer ${config.apiKey}`);
    assert.ok(options.signal instanceof AbortSignal);
    requests.push({ url: new URL(url), options });
    return handler(new URL(url), options, requests.length);
  };
  return { fetchImpl, requests };
}
function baseline(url) {
  if (url.pathname.endsWith("/memberships")) return json(page([member()]));
  if (url.pathname.endsWith("/payments")) return json(page([payment()]));
  if (url.pathname.endsWith("/memberships/mem_one")) return json(member());
  if (url.pathname.endsWith("/payments/pay_one")) return json(payment());
  throw new Error("Unexpected synthetic request");
}
async function noEvidenceFailure(options, expectedCode) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "makeborne-whop-observer-"));
  const out = path.join(directory, "evidence.json");
  const original = JSON.stringify({ sandboxOnly: true, productionTouched: false, realMoneySpent: 0, observations: [{ historical: true }] }) + "\n";
  let emitted = false;
  fs.writeFileSync(out, original);
  try {
    await assert.rejects(runObserver({ args: [], config, out, emit: () => { emitted = true; }, ...options }), error => {
      assert.equal(sanitizedError(error).code, expectedCode);
      if (options.expectedRefundOutcome) {
        assert.equal(sanitizedError(error).refundRequestAttempted, true);
        assert.equal(sanitizedError(error).refundOutcome, options.expectedRefundOutcome);
      }
      assert.ok(!JSON.stringify(sanitizedError(error)).includes(config.apiKey));
      return true;
    });
    assert.equal(fs.readFileSync(out, "utf8"), original, "Failure must leave historical evidence byte-identical");
    assert.equal(emitted, false, "Failure must not emit successful observation");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test("exact base and known merchant refuse unsafe targets before fetch", { timeout: 1000 }, async () => {
  for (const apiBase of ["https://api.whop.com/api/v1", "http://sandbox-api.whop.com/api/v1", SANDBOX_BASE + "/",
    "https://user@sandbox-api.whop.com/api/v1", "https://sandbox-api.whop.com:444/api/v1", SANDBOX_BASE + "?x=1", SANDBOX_BASE + "#x"]) {
    const network = mock(() => assert.fail("Refused target must not fetch"));
    await noEvidenceFailure({ config: { ...config, apiBase }, fetchImpl: network.fetchImpl }, "TARGET");
    assert.equal(network.requests.length, 0);
  }
  await noEvidenceFailure({ config: { ...config, companyId: "biz_other" }, fetchImpl: () => assert.fail("Wrong company must not fetch") }, "TARGET");
});

test("CLI preserves explicit refund and rejects incomplete or extra arguments", () => {
  assert.equal(parseArguments([]), null);
  assert.equal(parseArguments(["--refund", "pay_one"]), "pay_one");
  for (const args of [["--refund"], ["--refund", "pay_one/other"], ["--refund", "pay_one", "--refund", "pay_two"], ["--unknown"]]) {
    assert.throws(() => parseArguments(args), error => sanitizedError(error).code === "ARGUMENT");
  }
});

test("HTTP failures on either list are never empty successful evidence", { timeout: 1000 }, async () => {
  for (const kind of ["memberships", "payments"]) {
    const network = mock(url => url.pathname.endsWith(`/${kind}`) ? json({ error: { message: config.apiKey, email: "private@example.com" } }, 403) : baseline(url));
    await noEvidenceFailure({ fetchImpl: network.fetchImpl }, "HTTP");
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "makeborne-whop-observer-"));
  const out = path.join(directory, "absent-evidence.json");
  try {
    await assert.rejects(runObserver({ args: [], config, out, emit: () => assert.fail("Must not emit success"),
      fetchImpl: mock(() => json({}, 500)).fetchImpl }));
    assert.equal(fs.existsSync(out), false, "Failed first run must not create evidence");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("HTTP errors never consume or expose provider bodies", { timeout: 1000 }, async () => {
  const network = mock(() => ({ ok: false, status: 422, redirected: false,
    json: () => assert.fail("Error body must not be read") }));
  let safe;
  await assert.rejects(observeSandbox({ config, fetchImpl: network.fetchImpl }), error => {
    safe = sanitizedError(error); return true;
  });
  assert.deepEqual(safe, { code: "HTTP", message: "Sandbox request returned an unsuccessful HTTP status.", status: 422 });
  assert.deepEqual(sanitizedError(new Error(`Bearer ${config.apiKey} private@example.com`)), {
    code: "INTERNAL", message: "Sandbox observation failed; no observation was appended." });
});

test("redirect refusal and unexpected redirect responses leave evidence unchanged", { timeout: 1000 }, async () => {
  await noEvidenceFailure({ fetchImpl: mock(() => { throw new TypeError(`Redirect to secret ${config.apiKey}`); }).fetchImpl }, "TRANSPORT");
  await noEvidenceFailure({ fetchImpl: mock(() => ({ ok: true, status: 200, redirected: true, json: () => page() })).fetchImpl }, "TRANSPORT");
  await noEvidenceFailure({ fetchImpl: mock(() => json({}, 302)).fetchImpl }, "HTTP");
});

test("request timeout aborts bounded fetch and body consumption", { timeout: 1000 }, async () => {
  for (const stage of ["fetch", "body"]) {
    const network = mock((_url, options) => {
      const pending = () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("synthetic secret")), { once: true }));
      return stage === "fetch" ? pending() : { ok: true, status: 200, redirected: false, json: pending };
    });
    await noEvidenceFailure({ fetchImpl: network.fetchImpl, timeoutMs: 15 }, "TRANSPORT");
    assert.equal(network.requests.length, 1);
    assert.equal(network.requests[0].options.signal.aborted, true);
  }
});

test("malformed list and resource shapes refuse evidence", { timeout: 1000 }, async () => {
  for (const body of [null, [], {}, { data: [], page_info: { has_next_page: "false", end_cursor: null } },
    { data: [], page_info: { has_next_page: false } }, { data: "bad", page_info: { has_next_page: false, end_cursor: null } },
    page([member("mem_one", { status: "unknown" })]), page([member("mem_one", { plan: null })]),
    page([member("mem_one", { renewal_period_start: config.apiKey })]), page(Array.from({ length: 51 }, () => member()))]) {
    await noEvidenceFailure({ fetchImpl: mock(() => json(body)).fetchImpl }, "SHAPE");
  }
  await noEvidenceFailure({ fetchImpl: mock(() => new Response("not-json", { status: 200 })).fetchImpl }, "SHAPE");
  await noEvidenceFailure({ fetchImpl: mock(url => url.pathname.endsWith("/payments")
    ? json(page([payment("pay_one", { total: "29" })])) : baseline(url)).fetchImpl }, "SHAPE");
});

test("all pages are scanned with escaped cursor and explicit completeness", { timeout: 1000 }, async () => {
  const cursor = "cursor?&/+= value";
  const network = mock(url => {
    assert.equal(url.searchParams.get("company_id"), SANDBOX_COMPANY);
    assert.equal(url.searchParams.get("first"), "50");
    if (url.pathname.endsWith("/memberships")) return json(url.searchParams.has("after")
      ? page([member("mem_two")]) : page([member()], true, cursor));
    assert.equal(url.searchParams.get("include_free"), "true");
    return json(url.searchParams.has("after") ? page([payment("pay_two")]) : page([payment()], true, cursor));
  });
  const entry = await observeSandbox({ config, fetchImpl: network.fetchImpl });
  assert.equal(network.requests.length, 4);
  assert.equal(network.requests[1].url.searchParams.get("after"), cursor);
  assert.equal(network.requests[3].url.searchParams.get("after"), cursor);
  assert.deepEqual(entry.memberships.map(m => m.id), ["mem_one", "mem_two"]);
  assert.deepEqual(entry.payments.map(p => p.id), ["pay_one", "pay_two"]);
  assert.equal(entry.membershipScanComplete, true);
  assert.equal(entry.paymentScanComplete, true);
  assert.deepEqual(entry.scan.payments, { pages: 2, records: 2, complete: true, includeFree: true });
  assert.equal(entry.readOnly, true);
});

test("valid empty lists are explicitly complete", { timeout: 1000 }, async () => {
  const entry = await observeSandbox({ config, fetchImpl: mock(() => json(page())).fetchImpl });
  assert.deepEqual(entry.payments, []);
  assert.equal(entry.scan.payments.complete, true);
});

test("pagination failures and page ceiling never append partial evidence", { timeout: 1000 }, async () => {
  await noEvidenceFailure({ fetchImpl: mock(() => json(page([member()], true, null))).fetchImpl }, "PAGINATION");
  await noEvidenceFailure({ fetchImpl: mock(() => json(page([], true, "cursor"))).fetchImpl }, "PAGINATION");
  await noEvidenceFailure({ fetchImpl: mock((_url, _options, count) => json(page([member(`mem_${count}`)], true, "same"))).fetchImpl }, "PAGINATION");
  await noEvidenceFailure({ fetchImpl: mock(() => json(page([member()], true, "cursor"))).fetchImpl, maxPages: 1 }, "PAGINATION");
  await noEvidenceFailure({ fetchImpl: mock((_url, _options, count) => count === 1
    ? json(page([member()], true, "next")) : json(page([member()]))).fetchImpl }, "PAGINATION");
  await noEvidenceFailure({ fetchImpl: mock((_url, _options, count) => count === 1
    ? json(page([member()], true, "next")) : json({}, 503)).fetchImpl }, "HTTP");
});

test("refund refuses mismatched payment ID, company, missing binding, and membership before POST", { timeout: 1000 }, async () => {
  for (const replacement of [payment("pay_other"), payment("pay_one", { company: { id: "biz_other" } }),
    payment("pay_one", { company: null }), payment("pay_one", { company_id: "biz_other" })]) {
    const network = mock((url, options) => {
      assert.equal(options.method, "GET", "Binding failure must never POST");
      return url.pathname.endsWith("/payments/pay_one") ? json(replacement) : baseline(url);
    });
    await noEvidenceFailure({ args: ["--refund", "pay_one"], fetchImpl: network.fetchImpl }, "BINDING");
  }
  for (const replacement of [member("mem_other"), member("mem_one", { company: { id: "biz_other" } })]) {
    const network = mock((url, options) => {
      assert.equal(options.method, "GET");
      return url.pathname.endsWith("/memberships/mem_one") ? json(replacement) : baseline(url);
    });
    await noEvidenceFailure({ args: ["--refund", "pay_one"], fetchImpl: network.fetchImpl }, "BINDING");
  }
});

test("unconfirmed refundable payment and absent scan membership refuse POST", { timeout: 1000 }, async () => {
  const notRefundable = mock((url, options) => {
    assert.equal(options.method, "GET");
    return url.pathname.endsWith("/payments/pay_one") ? json(payment("pay_one", { refundable: false })) : baseline(url);
  });
  await noEvidenceFailure({ args: ["--refund", "pay_one"], fetchImpl: notRefundable.fetchImpl }, "REFUND");
  const absent = mock((url, options) => {
    assert.equal(options.method, "GET");
    return url.pathname.endsWith("/payments") ? json(page()) : baseline(url);
  });
  await noEvidenceFailure({ args: ["--refund", "pay_one"], fetchImpl: absent.fetchImpl }, "BINDING");
});

test("refund HTTP failure is redacted, never retried, and never recorded as success", { timeout: 1000 }, async () => {
  let posts = 0;
  const network = mock((url, options) => {
    if (options.method === "POST") {
      posts++;
      return { ok: false, status: 422, redirected: false, json: () => assert.fail("Raw refund error must never be read") };
    }
    return baseline(url);
  });
  await noEvidenceFailure({ args: ["--refund", "pay_one"], fetchImpl: network.fetchImpl, expectedRefundOutcome: "unknown" }, "HTTP");
  assert.equal(posts, 1);
  const interrupted = mock((url, options) => {
    if (options.method === "POST") throw new Error(`Ambiguous transport ${config.apiKey}`);
    return baseline(url);
  });
  await noEvidenceFailure({ args: ["--refund", "pay_one"], fetchImpl: interrupted.fetchImpl,
    expectedRefundOutcome: "unknown" }, "TRANSPORT");
  assert.equal(interrupted.requests.filter(request => request.options.method === "POST").length, 1);
});

test("mocked refund success records only bound allowlisted views and rereads lists", { timeout: 1000 }, async () => {
  let posted = false;
  const network = mock((url, options) => {
    if (options.method === "POST") {
      assert.equal(posted, false);
      assert.equal(url.pathname, "/api/v1/payments/pay_one/refund");
      assert.equal(options.body, "{}");
      posted = true;
      return json({ id: "rf_one", client_secret: config.apiKey });
    }
    if (posted && url.pathname.endsWith("/payments/pay_one")) return json(payment("pay_one", { refunded_amount: 29, substatus: "refunded", client_secret: config.apiKey }));
    return baseline(url);
  });
  const entry = await observeSandbox({ config, refundId: "pay_one", fetchImpl: network.fetchImpl });
  assert.equal(entry.actions[0].requestAccepted, true);
  assert.equal(entry.actions[0].fullRefundObserved, true);
  assert.equal(entry.readOnly, false);
  assert.equal(network.requests.filter(r => r.options.method === "POST").length, 1);
  assert.equal(network.requests.filter(r => r.url.pathname.endsWith("/payments")).length, 2);
  assert.ok(!JSON.stringify(entry).includes(config.apiKey));
});

test("post-refund wrong binding or read failure leaves historical evidence unchanged", { timeout: 1000 }, async () => {
  for (const result of [json(payment("pay_other")), json({}, 500)]) {
    let posted = false;
    const network = mock((url, options) => {
      if (options.method === "POST") { posted = true; return json({ id: "rf_one" }); }
      return posted && url.pathname.endsWith("/payments/pay_one") ? result : baseline(url);
    });
    await noEvidenceFailure({ args: ["--refund", "pay_one"], fetchImpl: network.fetchImpl,
      expectedRefundOutcome: "request_accepted_observation_incomplete" }, result.status === 500 ? "HTTP" : "BINDING");
    assert.equal(network.requests.filter(r => r.options.method === "POST").length, 1);
  }
});

test("successful run appends one complete observation to a disposable file", { timeout: 1000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "makeborne-whop-observer-"));
  const out = path.join(directory, "evidence.json");
  try {
    let emitted;
    const entry = await runObserver({ args: [], config, out, fetchImpl: mock(baseline).fetchImpl, emit: value => { emitted = value; } });
    const saved = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.deepEqual(saved.observations, [entry]);
    assert.deepEqual(JSON.parse(emitted), entry);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

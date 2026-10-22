/* eslint-disable @typescript-eslint/no-require-imports -- Behavioural checks for /api/build/enhance (optional, free prompt help) with its durable action store
 * (an in-memory model of the SQL; check-enhance-durable.cjs also runs against the real SQL). The route runs with authentication, capacity and the
 * provider replaced by recording fakes, so refusals, holds, Stop, recovery and isolation are observed, not read from the source. Offline, no network. */
const assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
const { memoryStore, provider, loadRoute, offlineEnvironment, client } = require("./enhance-route-fixture.cjs");

offlineEnvironment();
const ids = { user: randomUUID(), other: randomUUID(), reviewer: randomUUID(), rich: randomUUID(), workspace: randomUUID(), artifact: randomUUID(), deck: randomUUID(), otherWorkspace: randomUUID(), otherArtifact: randomUUID() };
const store = memoryStore();
store.seed({ owner: ids.user, workspace: ids.workspace, artifact: ids.artifact, credits: 10, members: { [ids.other]: "editor", [ids.reviewer]: "reviewer", [ids.rich]: "editor" }, unlimited: [ids.rich] });
store.seed({ owner: ids.other, workspace: ids.otherWorkspace, artifact: ids.otherArtifact, members: { [ids.user]: "editor" } });
store.state.artifacts.set(ids.deck, { workspace: ids.workspace, kind: "presentation" });
const p = provider();
const context = { user: ids.user, contexts: [], roles: { [`${ids.reviewer}:${ids.workspace}`]: "reviewer" },
  artifacts: { [ids.artifact]: { workspace: ids.workspace, kind: "website" }, [ids.deck]: { workspace: ids.workspace, kind: "presentation" }, [ids.otherArtifact]: { workspace: ids.otherWorkspace, kind: "website" } } };
const holder = { route: loadRoute({ store, provider: p, context }) };
const api = client(holder, { workspace: ids.workspace, artifact: ids.artifact });
const short = "Website for my bakery", detailed = "word ".repeat(80).trim();
const as = async (user, fn) => { const previous = context.user; context.user = user; try { return await fn(); } finally { context.user = previous; } };
const quiet = async fn => { const logged = [], error = console.error; console.error = line => logged.push(String(line)); try { return { value: await fn(), logged }; } finally { console.error = error; } };
const claims = () => store.state.rpcLog.filter(name => name === "makeborne_brief_enhance_claim").length;
const waitFor = async test => { for (let i = 0; i < 400 && !test(); i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(test(), "timed out"); };

let passed = 0;
async function check(name, fn) { p.behaviour = "ok"; p.during = null; context.capacityError = null; await fn(); passed++; console.log(`PASS ${name}`); }

(async () => {
  await check("a detailed brief is read (analyze), a short one improved (enhance): one held credit, released and verified, never settled; charged 0 from the durable record", async () => {
    for (const [brief, mode] of [[detailed, "analyze"], [short, "enhance"]]) {
      const key = randomUUID(), before = store.available(ids.user), calls = p.calls;
      const reply = await api.post(key, brief);
      assert.equal(reply.status, 200); assert.equal(reply.body.mode, mode); assert.equal(reply.body.charged, 0);
      assert.equal(reply.body.action.status, "completed"); assert.equal(reply.body.action.billing, "released"); assert.equal(reply.body.action.chargedCredits, 0); assert.equal(reply.body.action.holdCredits, 1);
      assert.equal(p.calls - calls, 1); assert.equal(store.available(ids.user), before);
      assert.equal(store.action(key).hold, 1); assert.equal(store.releases(store.action(key).reference), 1);
      assert.ok(!store.state.outcomes.some(item => item.reference === store.action(key).reference && item.outcome === "settled"), "never settled");
      assert.ok(!("reference" in reply.body.action) && !("id" in reply.body.action) && !("fence" in reply.body.action), "no internal identifiers in the reply");
    }
  });
  await check("an unusable or failed reading: 503 ENHANCE_UNAVAILABLE, 'Nothing was charged' only because the release was verified; logged without the client's text", async () => {
    for (const behaviour of ["null", "throw"]) {
      p.behaviour = behaviour;
      const key = randomUUID();
      const { value: reply, logged } = await quiet(() => api.post(key));
      assert.equal(reply.status, 503); assert.equal(reply.body.error.code, "ENHANCE_UNAVAILABLE"); assert.match(reply.body.error.message, /Nothing was charged/);
      assert.equal(reply.body.action.chargedCredits, 0); assert.equal(reply.body.action.billing, "released");
      assert.ok(logged.some(line => behaviour === "null" ? /brief_enhance_unusable/.test(line) && /invalid JSON/.test(line) : /brief_enhance_failed/.test(line) && /provider overloaded/.test(line)), logged.join("\n"));
      assert.ok(!logged.some(line => /SECRET-CLIENT-TEXT/.test(line)), "no reply content in the log");
    }
  });
  await check("no room for the hold (no credits): 402 with the reason, no provider call and no action left behind", async () => {
    const user = store.state.users.get(ids.user), saved = user.available;
    user.available = 0;
    const key = randomUUID(), calls = p.calls;
    try {
      const reply = await api.post(key);
      assert.equal(reply.status, 402); assert.equal(reply.body.error.code, "INSUFFICIENT_CREDITS");
      assert.match(reply.body.error.message, /wasn't improved: improving it is free[\s\S]*no credits left[\s\S]*Nothing was charged/);
      assert.equal(p.calls, calls); assert.equal(store.action(key), undefined);
    } finally { user.available = saved; }
  });
  await check("a paused provider refuses before any claim or hold, with the server's own code", async () => {
    const { RequestError } = require("../server/http.ts");
    context.capacityError = () => new RequestError("AI_PAUSED", "AI is paused right now.", 503);
    const before = claims();
    const reply = await api.post(randomUUID());
    assert.equal(reply.body.error.code, "AI_PAUSED"); assert.equal(claims(), before);
  });
  await check("reviewers, decks/books and unauthenticated requests are refused before any claim; a missing Idempotency-Key too", async () => {
    const before = claims(), calls = p.calls;
    assert.equal((await as(ids.reviewer, () => api.post(randomUUID()))).body.error.code, "EDITOR_REQUIRED");
    const deck = await holder.route.POST(new Request("http://127.0.0.1:3000/api/build/enhance", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ workspaceId: ids.workspace, artifactId: ids.deck, brief: short }) }));
    assert.equal(deck.status, 404);
    assert.equal((await as(null, () => api.post(randomUUID()))).status, 401);
    const keyless = await api.post(undefined);
    assert.equal(keyless.status, 400); assert.equal(keyless.body.error.code, "IDEMPOTENCY_KEY_REQUIRED");
    assert.equal(claims(), before); assert.equal(p.calls, calls);
  });
  await check("Stop before the request arrived: recorded; the late request never starts (409 ENHANCE_CANCELLED, no hold, no provider call)", async () => {
    const key = randomUUID(), calls = p.calls, holds = store.holds(ids.user).length;
    const stopped = await api.stop(key);
    assert.equal(stopped.body.action.status, "cancelled"); assert.equal(stopped.body.action.chargedCredits, 0); assert.equal(stopped.body.action.billing, "none");
    const late = await api.post(key);
    assert.equal(late.status, 409); assert.equal(late.body.error.code, "ENHANCE_CANCELLED"); assert.equal(late.body.replayed, true);
    assert.equal(p.calls, calls); assert.equal(store.holds(ids.user).length, holds);
  });
  await check("Stop between the claim and the provider: no provider contact; the hold is returned (charged 0)", async () => {
    const key = randomUUID(), calls = p.calls, before = store.available(ids.user);
    store.after("makeborne_brief_enhance_claim", async () => { await api.stop(key); });
    const reply = await api.post(key);
    assert.equal(reply.status, 409); assert.equal(reply.body.action.status, "cancelled"); assert.equal(reply.body.action.chargedCredits, 0);
    assert.equal(p.calls, calls, "the provider was never contacted"); assert.equal(store.available(ids.user), before);
  });
  await check("Stop during the provider's work: the durable Stop interrupts it; cancelled, no result, charged 0; a disconnect alone would not have stopped it", async () => {
    const key = randomUUID(), before = store.available(ids.user);
    p.behaviour = "wait";
    const pending = api.post(key);
    await waitFor(() => p.waiting.length > 0);
    const stopping = await api.stop(key);
    assert.equal(stopping.status, 202); assert.equal(stopping.body.action.cancelRequested, true);
    const reply = await pending;
    p.waiting.length = 0;
    assert.equal(reply.status, 409); assert.equal(reply.body.error.code, "ENHANCE_CANCELLED"); assert.equal(reply.body.text, undefined);
    assert.equal(reply.body.action.chargedCredits, 0); assert.equal(store.available(ids.user), before);
    assert.equal(store.releases(store.action(key).reference), 1);
  });
  await check("a browser disconnect is not a Stop: the reading finishes and its result is recoverable by key", async () => {
    const key = randomUUID(), disconnect = new AbortController();
    p.behaviour = "wait";
    const pending = holder.route.POST(new Request("http://127.0.0.1:3000/api/build/enhance", { method: "POST", signal: disconnect.signal,
      headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ workspaceId: ids.workspace, artifactId: ids.artifact, brief: short }) }));
    await waitFor(() => p.waiting.length > 0);
    disconnect.abort();
    await new Promise(resolve => setTimeout(resolve, 60));
    p.behaviour = "ok"; p.release();
    await pending;
    const status = await api.get(key);
    assert.equal(status.body.action.status, "completed"); assert.match(status.body.text, /Ovenbird/);
  });
  await check("Stop after completion keeps the result and its receipt", async () => {
    const key = randomUUID();
    assert.equal((await api.post(key)).status, 200);
    const stopped = await api.stop(key);
    assert.equal(stopped.status, 200); assert.equal(stopped.body.action.status, "completed"); assert.match(stopped.body.text, /Ovenbird/); assert.equal(stopped.body.charged, 0);
  });
  await check("status endpoint: authenticated, scoped to the account and project; reviewers refused; unknown keys are not found; reading never runs anything", async () => {
    const key = randomUUID();
    await api.post(key);
    const calls = p.calls;
    const mine = await api.get(key);
    assert.equal(mine.status, 200); assert.equal(mine.body.action.status, "completed"); assert.match(mine.body.text, /Ovenbird/);
    assert.equal((await as(ids.other, () => api.get(key))).status, 404, "another account in the same workspace cannot read it");
    assert.equal((await api.get(key, { workspaceId: ids.otherWorkspace, artifactId: ids.otherArtifact })).status, 404, "nor through another project");
    assert.equal((await as(ids.reviewer, () => api.get(key))).body.error.code, "EDITOR_REQUIRED");
    assert.equal((await as(null, () => api.get(key))).status, 401);
    assert.equal((await as(ids.other, () => api.stop(key))).body.action.status, "cancelled", "another account's Stop is its own (empty) action");
    assert.equal((await api.get(key)).body.action.status, "completed", "and leaves this one untouched");
    assert.equal((await api.recover(randomUUID())).body.error.code, "ENHANCE_NOT_FOUND");
    assert.equal((await api.get(randomUUID())).body.error.code, "ENHANCE_NOT_FOUND");
    assert.equal(p.calls, calls); assert.ok(context.contexts.slice(-3).every(item => item.write === false), "status, Stop and recovery need no paid membership");
  });
  await check("a worker that vanished (its outcome could not be saved): the reply says it couldn't be saved; after the lease the hold is returned once (expired, charged 0); no second run", async () => {
    const key = randomUUID(), before = store.available(ids.user), calls = p.calls;
    store.fail("makeborne_brief_enhance_record", "before", 1);
    const { value: reply } = await quiet(() => api.post(key));
    assert.equal(reply.status, 503); assert.equal(reply.body.error.code, "ENHANCE_STATUS_UNAVAILABLE"); assert.doesNotMatch(reply.body.error.message, /Nothing was charged/);
    assert.equal((await api.get(key)).body.action.status, "running");
    assert.equal((await api.post(key)).status, 202, "a retry replays the running action");
    store.tamper.ageLease(key, 181_000);
    const expired = await api.get(key);
    assert.equal(expired.body.action.status, "expired"); assert.equal(expired.body.action.chargedCredits, 0); assert.match(expired.body.error.message, /hold was returned and nothing was charged/);
    assert.equal(store.available(ids.user), before); assert.equal(store.releases(store.action(key).reference), 1); assert.equal(p.calls - calls, 1);
  });
  await check("an unlimited account holds nothing (exempt) and still gets one durable action", async () => {
    const key = randomUUID();
    const reply = await as(ids.rich, () => api.post(key));
    assert.equal(reply.status, 200); assert.equal(reply.body.action.billing, "exempt"); assert.equal(reply.body.action.holdCredits, 0); assert.equal(reply.body.charged, 0);
    assert.equal((await as(ids.rich, () => api.post(key))).body.replayed, true);
  });
  await check("the provider gate is the action's: every provider call in these checks went through it, bounded by the one-credit cap", async () => {
    assert.ok(store.state.calls.length > 0);
    for (const call of store.state.calls) {
      const owner = [...store.state.actions.values()].find(item => item.reference === call.reference);
      assert.ok(owner && call.bound <= owner.cap, "each call belongs to one action and fits its cap");
    }
    assert.ok(store.state.rpcLog.includes("makeborne_brief_enhance_provider_begin"));
  });
  console.log(`${passed} enhance route checks passed (durable store model, fakes only, no network).`);
})().catch(error => { console.error(error); process.exit(1); });

/* eslint-disable @typescript-eslint/no-require-imports -- Codex's 22 October probe (E1-E3), adapted to the durable /api/build/enhance: the real route runs with
 * authentication and the provider mocked, against its durable action store. Every finding the probe reproduced must now be fixed:
 *   E1 a repeated, parallel or post-restart request with the same Idempotency-Key makes one provider call and one hold; changed input conflicts;
 *   E2 a missing, released or lapsed hold, or a failed or lost settlement reply, never yields a usable 200, and is resolved without regenerating;
 *   E3 a failed release is recorded and reported (never "Nothing was charged"), and recovery returns the hold exactly once.
 * Store: an in-memory model of the SQL by default (offline, part of npm test); with MAKEBORNE_VERIFY_ENHANCE_DB=postgres://postgres:…@127.0.0.1:<port>/postgres
 * the ACTUAL SQL functions on the isolated local database (fixtures are committed and removed at the end). No network, no provider, no key. */
const assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
const { memoryStore, pgStore, provider, loadRoute, offlineEnvironment, client } = require("./enhance-route-fixture.cjs");

offlineEnvironment();
const database = process.env.MAKEBORNE_VERIFY_ENHANCE_DB;
const ids = { user: randomUUID(), workspace: randomUUID(), project: randomUUID(), artifact: randomUUID() };
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

async function environment() {
  if (!database) {
    const store = memoryStore();
    store.seed({ owner: ids.user, workspace: ids.workspace, artifact: ids.artifact, credits: 10 });
    const reference = key => store.action(key).reference;
    return { store, label: "in-memory model of the SQL", reference, available: async () => store.available(ids.user), releases: async key => store.releases(reference(key)),
      holds: async () => store.holds(ids.user).length, tamper: store.tamper, cleanup: async () => undefined };
  }
  const store = pgStore(database);
  await store.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`, [ids.user, `${ids.user}@enhance-durable.invalid`]);
  await store.query(`insert into public.workspaces(id,name,owner_id) values($1,'Enhance durable fixture',$2)`, [ids.workspace, ids.user]);
  await store.query(`insert into public.projects(id,workspace_id,title,kind) values($1,$2,'Fixture','website')`, [ids.project, ids.workspace]);
  await store.query(`insert into public.artifacts(id,workspace_id,project_id,title,kind) values($1,$2,$3,'Fixture','website')`, [ids.artifact, ids.workspace, ids.project]);
  await store.query(`select public.makeborne_credit_grant($1,10,'topup','enhance-durable-fixture','{}')`, [ids.user]);
  const reference = async key => (await store.query("select reference from makeborne_private.brief_enhancements where actor=$1 and action_key=$2", [ids.user, key])).rows[0].reference;
  return { store, label: "real SQL on the isolated local database", reference,
    available: async () => Number((await store.query("select public.makeborne_credit_wallet($1)->>'available' n", [ids.user])).rows[0].n),
    releases: async key => Number((await store.query("select count(*) n from public.credit_ledger where user_id=$1 and kind='release' and reference=$2", [ids.user, await reference(key)])).rows[0].n),
    holds: async () => Number((await store.query("select count(*) n from makeborne_private.credit_reservations where user_id=$1 and reference like 'brief_enhance:%'", [ids.user])).rows[0].n),
    tamper: {
      releaseHold: ref => store.query("select makeborne_private.credit_release($1,$2)", [ids.user, ref]),
      dropHold: async ref => { await store.query("select makeborne_private.credit_release($1,$2)", [ids.user, ref]); await store.query("update makeborne_private.brief_enhancements set reference='brief_enhance:missing:'||id where reference=$1", [ref]); },
      ageHold: (ref, ms) => store.query("update makeborne_private.credit_reservations set created_at=created_at-($3::int * interval '1 millisecond') where user_id=$1 and reference=$2", [ids.user, ref, ms]),
    },
    cleanup: async () => {
      const refs = (await store.query("select reference from makeborne_private.brief_enhancements where actor=$1", [ids.user])).rows.map(row => row.reference);
      await store.query("delete from public.workspaces where id=$1", [ids.workspace]);
      await store.query("delete from makeborne_private.ai_run_outcomes where user_id=$1", [ids.user]);
      await store.query("delete from auth.users where id=$1", [ids.user]);
      const left = Number((await store.query("select count(*) n from makeborne_private.brief_enhancements where actor=$1", [ids.user])).rows[0].n);
      assert.equal(left, 0, "fixture actions removed");
      await store.end();
      return refs.length;
    } };
}

(async () => {
  const env = await environment();
  const p = provider(); p.gate = env.store.kind === "memory";
  const context = { user: ids.user, artifacts: { [ids.artifact]: { workspace: ids.workspace, kind: "website" } }, contexts: [] };
  const holder = { route: loadRoute({ store: env.store, provider: p, context }) };
  const api = client(holder, ids);
  const restart = () => { holder.route = loadRoute({ store: env.store, provider: p, context }); };
  try {
    // ---- E1: durable replay
    await check("E1 sequential replay: the same Idempotency-Key and body makes ONE provider call and ONE hold; the repeat returns the stored result and receipt", async () => {
      const key = randomUUID(), before = await env.available(), calls = p.calls, holds = await env.holds();
      const first = await api.post(key), second = await api.post(key);
      assert.equal(first.status, 200); assert.equal(second.status, 200);
      assert.equal(second.body.replayed, true); assert.equal(second.body.text, first.body.text); assert.equal(second.body.charged, 0);
      assert.equal(p.calls - calls, 1, "one provider call"); assert.equal(await env.holds() - holds, 1, "one hold");
      assert.equal(await env.available(), before, "the hold was returned; nothing charged");
      assert.equal(await env.releases(key), 1, "released exactly once");
    });
    await check("E1 parallel identical claims (one instance or several): one winner, one provider call, one hold; the rest see it running or completed", async () => {
      const key = randomUUID(), calls = p.calls, holds = await env.holds();
      p.behaviour = "wait";
      const instances = [holder.route, ...[1, 2].map(() => loadRoute({ store: env.store, provider: p, context }))];
      const replies = Promise.all(instances.flatMap(route => [0, 1].map(() => client({ route }, ids).post(key))));
      while (p.waiting.length === 0) await new Promise(resolve => setTimeout(resolve, 5));
      await new Promise(resolve => setTimeout(resolve, 50));
      p.behaviour = "ok"; p.release();
      const results = await replies;
      assert.equal(p.calls - calls, 1, "one provider call"); assert.equal(await env.holds() - holds, 1, "one hold");
      assert.equal(results.filter(item => item.status === 200 && item.body.replayed === false).length, 1, "one winner");
      assert.ok(results.every(item => item.body.action.key === key && (item.status === 200 || item.status === 202)), JSON.stringify(results.map(item => item.status)));
      assert.equal((await api.get(key)).body.action.status, "completed");
    });
    await check("E1 same key, different input: 409 conflict, no provider call and no hold", async () => {
      const key = randomUUID();
      await api.post(key);
      const calls = p.calls, holds = await env.holds();
      const changed = await api.post(key, "Website for my florist");
      assert.equal(changed.status, 409); assert.equal(changed.body.error.code, "ENHANCE_KEY_CONFLICT");
      assert.equal(p.calls, calls); assert.equal(await env.holds(), holds);
    });
    await check("E1 process restart: a fresh module instance on the same durable store sees the running action (202, no call), then the stored result; still one call", async () => {
      const key = randomUUID(), calls = p.calls;
      p.behaviour = "wait";
      const original = api.post(key);
      while (p.waiting.length === 0) await new Promise(resolve => setTimeout(resolve, 5));
      restart();
      const during = await api.post(key);
      assert.equal(during.status, 202); assert.equal(during.body.action.status, "running"); assert.equal(during.body.text, undefined, "no usable result while running");
      p.behaviour = "ok"; p.release();
      assert.equal((await original).status, 200);
      restart();
      const after = await api.post(key);
      assert.equal(after.status, 200); assert.equal(after.body.replayed, true); assert.match(after.body.text, /Ovenbird/);
      assert.equal(p.calls - calls, 1, "one provider call across the restart");
    });

    // ---- E2: settlement outcomes
    for (const [name, tamper, billing] of [["released", ref => env.tamper.releaseHold(ref), "released_hold"], ["missing", ref => env.tamper.dropHold(ref), "missing_hold"], ["lapsed (expired)", ref => env.tamper.ageHold(ref, 20 * 60_000), "expired_hold"]]) {
      await check(`E2 ${name} hold at settlement: no usable 200, result kept for review, never re-charged; a replay does not regenerate`, async () => {
        const key = randomUUID(), calls = p.calls, before = await env.available();
        p.during = async () => { await tamper(await env.reference(key)); };
        const reply = await api.post(key);
        p.during = null;
        assert.equal(reply.status, 409); assert.equal(reply.body.error.code, "ENHANCE_BILLING_REVIEW");
        assert.equal(reply.body.text, undefined); assert.equal(reply.body.enhanced, undefined); assert.equal(reply.body.action.result, null);
        assert.equal(reply.body.action.status, "needs_review"); assert.equal(reply.body.action.billing, billing); assert.equal(reply.body.action.chargedCredits, 0);
        assert.equal(await env.available(), before, "nothing charged, nothing re-held");
        const again = await api.post(key);
        assert.equal(again.status, 409); assert.equal(again.body.action.status, "needs_review");
        assert.equal(p.calls - calls, 1, "the replay did not call the provider again");
      });
    }
    await check("E2 settlement (release) RPC failure: 503 ENHANCE_BILLING_PENDING, no result, no 'Nothing was charged'; recovery completes it once, without regenerating", async () => {
      const key = randomUUID(), calls = p.calls;
      env.store.fail("makeborne_brief_enhance_release", "before", 2);
      const reply = await api.post(key);
      assert.equal(reply.status, 503); assert.equal(reply.body.error.code, "ENHANCE_BILLING_PENDING");
      assert.equal(reply.body.text, undefined); assert.equal(reply.body.action.status, "releasing"); assert.equal(reply.body.action.chargedCredits, null);
      assert.doesNotMatch(reply.body.error.message, /Nothing was charged/);
      const status = await api.get(key);
      assert.equal(status.body.action.status, "releasing", "the unresolved billing state is durable and visible");
      // Two recoveries race (two tabs, two instances): the database returns the hold once; both see the completed result.
      const raced = await Promise.all([api.recover(key), api.recover(key), api.recover(key)]);
      for (const recovered of raced) { assert.equal(recovered.status, 200); assert.equal(recovered.body.charged, 0); assert.match(recovered.body.text, /Ovenbird/); }
      assert.equal(raced.filter(item => item.body.replayed === false).length, 1, "exactly one recovery returned the hold");
      assert.equal((await api.recover(key)).body.replayed, true);
      assert.equal(await env.releases(key), 1, "released exactly once"); assert.equal(p.calls - calls, 1, "not regenerated");
    });
    await check("E2 replay after a LOST settlement reply (committed, reply lost twice): the status shows completed; released exactly once", async () => {
      const key = randomUUID();
      env.store.fail("makeborne_brief_enhance_release", "after", 2);
      const reply = await api.post(key);
      assert.equal(reply.status, 503); assert.equal(reply.body.text, undefined);
      const status = await api.get(key);
      assert.equal(status.status, 200); assert.equal(status.body.action.status, "completed"); assert.equal(status.body.charged, 0);
      assert.equal(await env.releases(key), 1);
    });

    // ---- E3: release failure after an unusable reading
    await check("E3 unusable reading + failing release: recorded and reported (not 'Nothing was charged'); status endpoint shows the held hold; recovery releases exactly once", async () => {
      const key = randomUUID(), before = await env.available();
      p.behaviour = "null";
      env.store.fail("makeborne_brief_enhance_release", "before", 2);
      const errors = console.error; console.error = () => undefined;
      let reply;
      try { reply = await api.post(key); } finally { console.error = errors; p.behaviour = "ok"; }
      assert.equal(reply.status, 503); assert.equal(reply.body.error.code, "ENHANCE_BILLING_PENDING");
      assert.doesNotMatch(reply.body.error.message, /Nothing was charged/);
      const status = await api.get(key);
      assert.equal(status.body.action.status, "releasing"); assert.equal(status.body.action.billing, "held"); assert.equal(status.body.action.outcome, "failed");
      assert.equal(await env.available(), before - 1, "the hold is still reserved until recovery");
      const recovered = await api.recover(key);
      assert.equal(recovered.status, 503); assert.equal(recovered.body.error.code, "ENHANCE_UNAVAILABLE"); assert.match(recovered.body.error.message, /Nothing was charged/);
      assert.equal(recovered.body.action.chargedCredits, 0);
      await api.recover(key);
      assert.equal(await env.available(), before); assert.equal(await env.releases(key), 1, "released exactly once");
    });
  } finally {
    const removed = await env.cleanup();
    if (removed !== undefined) console.log(`cleanup: ${removed} fixture actions and the fixture account removed`);
  }
  console.log(`${passed} durable enhance checks passed (${env.label}; provider mocked, no network).`);
})().catch(error => { console.error(error); process.exit(1); });

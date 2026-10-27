/* eslint-disable @typescript-eslint/no-require-imports -- Offline launch waitlist checks: validation, honeypot, idempotent answers, rate-limit mapping, hashing, unsubscribe signatures and the migration's boundary. No network or database. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict"), Module = require("node:module");
const root = path.resolve(__dirname, "../../..");
require.extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
// The route's database is replaced by a recorder; `@/` resolves into src/ and `server-only` is a no-op.
const calls = [];
let reply = { error: null };
const mocks = { "@/lib/billing/database": { billingDatabase: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return reply; } }) }, "server-only": {} };
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (mocks[request]) return request;
  if (request.startsWith("@/")) { const base = path.join(root, "src", request.slice(2)); return resolve.call(this, fs.existsSync(base + ".ts") ? base + ".ts" : base, parent, ...rest); }
  return resolve.call(this, request, parent, ...rest);
};
for (const [name, exports] of Object.entries(mocks)) require.cache[name] = { id: name, filename: name, loaded: true, exports };

const waitlist = require("./waitlist.ts"), shared = require("./waitlist-shared.ts");
const { POST } = require("../../app/api/waitlist/route.ts");
let count = 0;
const check = async (name, fn) => { await fn(); count++; console.log("PASS " + name); };
const SECRET = "s".repeat(40);
const post = (body, headers = {}) => POST(new Request("https://makeborne.com/api/waitlist", { method: "POST", headers: { "content-type": "application/json", origin: "https://makeborne.com", "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Mozilla/5.0 test", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const valid = { email: "  Ana.Reed@Example.COM ", company: "", source: "utm_source=instagram;ref=story", consent: shared.WAITLIST_CONSENT_VERSION };

(async () => {
  await check("email validation: trimmed, lower-cased, strict shape and lengths", () => {
    assert.equal(waitlist.normalizeWaitlistEmail("  Ana.Reed@Example.COM "), "ana.reed@example.com");
    for (const bad of ["", "ana", "ana@", "@example.com", "a@b", "ana@example", "ana@@example.com", "ana reed@example.com", "ana@exa mple.com", "ana@-example..com", "ana@example.com.", `${"a".repeat(65)}@example.com`, `a@${"b".repeat(250)}.com`, 42, null, "ana@exämple.com", "<script>@example.com"])
      assert.equal(waitlist.normalizeWaitlistEmail(bad), null, String(bad));
    assert.equal(waitlist.normalizeWaitlistEmail("first.last+launch@sub.studio.co.uk"), "first.last+launch@sub.studio.co.uk");
  });

  await check("input schema is strict: exact consent version, no extra fields, bounded sizes", () => {
    assert.equal(waitlist.WaitlistInput.safeParse(valid).success, true);
    assert.equal(waitlist.WaitlistInput.safeParse({ ...valid, consent: "waitlist-2020-01-01" }).success, false);
    assert.equal(waitlist.WaitlistInput.safeParse({ ...valid, admin: true }).success, false);
    assert.equal(waitlist.WaitlistInput.safeParse({ ...valid, email: "a".repeat(400) }).success, false);
  });

  await check("campaign source: only utm/ref tags with safe values survive, on both sides", () => {
    assert.equal(shared.waitlistSourceFromSearch("?utm_source=instagram&utm_campaign=launch&x=1&ref=story"), "utm_source=instagram;utm_campaign=launch;ref=story");
    assert.equal(shared.waitlistSourceFromSearch("?utm_source=<script>"), null);
    assert.equal(shared.waitlistSourceFromSearch(""), null);
    assert.equal(shared.cleanWaitlistSource("utm_source=instagram;ref=story"), "utm_source=instagram;ref=story");
    for (const bad of ["utm_source=a;utm_source=b", "evil=1", "utm_source=a=b", "utm_source=<x>", "x".repeat(201), 7, ""]) assert.equal(shared.cleanWaitlistSource(bad), null, String(bad));
  });

  await check("keyed hashes: 64 hex, purpose-separated, never the raw value; unsubscribe links verify in constant time", () => {
    const ip = waitlist.keyedHash(SECRET, "ip", "203.0.113.7");
    assert.match(ip, /^[0-9a-f]{64}$/);
    assert.notEqual(ip, waitlist.keyedHash(SECRET, "user-agent", "203.0.113.7"));
    assert.notEqual(ip, waitlist.keyedHash("t".repeat(40), "ip", "203.0.113.7"));
    assert.equal(waitlist.requestIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
    const id = "6f1c1e7a-3b0e-4c1a-9a51-0d6d8d3e2b10", sig = waitlist.unsubscribeSignature(SECRET, id);
    assert.equal(waitlist.validUnsubscribe(SECRET, id, sig), true);
    assert.equal(waitlist.validUnsubscribe(SECRET, id.toUpperCase(), sig), true);
    assert.equal(waitlist.validUnsubscribe(SECRET, id, sig.replace(/^./, c => c === "0" ? "1" : "0")), false);
    assert.equal(waitlist.validUnsubscribe(SECRET, "not-a-uuid", sig), false);
    assert.equal(waitlist.validUnsubscribe(SECRET, id, "short"), false);
    assert.equal(waitlist.waitlistSecret({ MAKEBORNE_WAITLIST_SALT: "short" }), null);
    assert.equal(waitlist.waitlistSecret({ MAKEBORNE_WAITLIST_SALT: SECRET }), SECRET);
    // No new production secret: derived from the existing service key with a fixed label, never the key itself.
    const key = "sb_secret_" + "k".repeat(40), derived = waitlist.waitlistSecret({ SUPABASE_SECRET_KEY: key });
    assert.match(derived, /^[0-9a-f]{64}$/);
    assert.equal(derived, waitlist.waitlistSecret({ SUPABASE_SECRET_KEY: key }), "stable");
    assert.notEqual(derived, key);
    assert.equal(waitlist.waitlistSecret({ SUPABASE_SECRET_KEY: "not-a-service-key" }), null);
    assert.equal(waitlist.waitlistSecret({}), null);
    assert.match(fs.readFileSync(path.join(root, "scripts/waitlist-invite.mjs"), "utf8"), /update\("makeborne-launch-waitlist-salt-v1"\)/, "the invite script derives the same salt");
    // The invite script signs links exactly as the app verifies them.
    const script = fs.readFileSync(path.join(root, "scripts/waitlist-invite.mjs"), "utf8");
    assert.match(script, /createHmac\("sha256", secret\)\.update\("makeborne-waitlist:unsubscribe:"\)\.update\(id\.toLowerCase\(\)\)/);
    assert.match(fs.readFileSync(path.join(__dirname, "waitlist.ts"), "utf8"), /update\(`makeborne-waitlist:\$\{purpose\}:`\)/);
  });

  process.env.MAKEBORNE_WAITLIST_SALT = SECRET;
  await check("join: same-origin JSON only; the database gets a lower-cased email and hashes, never the raw IP or browser string", async () => {
    calls.length = 0;
    const response = await post(valid);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "makeborne_join_launch_waitlist");
    const args = calls[0].args;
    assert.equal(args.p_email, "ana.reed@example.com");
    assert.equal(args.p_source, "utm_source=instagram;ref=story");
    assert.equal(args.p_consent, "waitlist-2026-10-27");
    assert.equal(args.p_ip_hash, waitlist.keyedHash(SECRET, "ip", "203.0.113.7"));
    assert.match(args.p_user_agent_hash, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(args), /203\.0\.113\.7|Mozilla/);
    assert.equal((await post(valid, { origin: "https://evil.example" })).status, 403);
    assert.equal((await post(JSON.stringify(valid), { "content-type": "text/plain" })).status, 415);
    assert.equal((await post("x".repeat(5000))).status, 413);
  });

  await check("idempotent and non-enumerating: a repeat answers exactly like the first join", async () => {
    calls.length = 0;
    const first = await post(valid), again = await post({ ...valid, email: "ana.reed@example.com" });
    assert.equal(first.status, again.status);
    assert.deepEqual(await first.json(), await again.json());
    assert.equal(calls.length, 2, "the database decides (insert once, on conflict do nothing)");
  });

  await check("honeypot: a filled hidden field gets the same success answer and stores nothing", async () => {
    calls.length = 0;
    const response = await post({ ...valid, company: "Acme Bots Ltd" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.length, 0);
  });

  await check("invalid input, rate limit and outages map to plain answers; logs carry no address", async () => {
    calls.length = 0;
    assert.equal((await post({ ...valid, email: "not-an-email" })).status, 400);
    assert.equal((await post({ ...valid, consent: "old" })).status, 400);
    assert.equal(calls.length, 0);
    const logged = [], original = console.error;
    console.error = (...items) => logged.push(items.join(" "));
    try {
      reply = { error: { code: "MB429", message: "Waitlist limit" } };
      const limited = await post(valid);
      assert.equal(limited.status, 429);
      assert.match((await limited.json()).error.message, /Too many attempts/);
      reply = { error: { code: "XX000", message: "boom ana.reed@example.com" } };
      assert.equal((await post(valid)).status, 503);
      reply = { error: null };
      delete process.env.MAKEBORNE_WAITLIST_SALT;
      assert.equal((await post(valid)).status, 503, "no salt and no service key: closed, nothing stored");
      process.env.MAKEBORNE_WAITLIST_SALT = SECRET;
      // The migration isn't applied yet (PostgREST: function not found): a friendly 503, never a 500 or a stack trace.
      for (const code of ["PGRST202", "42883", "42P01"]) {
        reply = { error: { code, message: "Could not find the function public.makeborne_join_launch_waitlist" } };
        const missing = await post(valid);
        assert.equal(missing.status, 503, code);
        const body = await missing.json();
        assert.deepEqual(body, { error: { code: "WAITLIST_UNAVAILABLE", message: "The waitlist isn't available right now. Try again shortly." } });
      }
      reply = { error: null };
    } finally { console.error = original; }
    assert(logged.length >= 1);
    for (const line of logged) assert.doesNotMatch(line, /@|203\.0\.113/);
  });

  await check("migration boundary: private table, RLS on, no grants, definer functions with empty search_path, limit before insert", () => {
    const sql = fs.readFileSync(path.join(root, "supabase/migrations/20261027020420_launch_waitlist.sql"), "utf8");
    assert.match(sql, /create table makeborne_private\.launch_waitlist/);
    assert.match(sql, /alter table makeborne_private\.launch_waitlist enable row level security;/);
    assert.match(sql, /revoke all on table makeborne_private\.launch_waitlist from public, anon, authenticated, service_role;/);
    assert.doesNotMatch(sql, /create policy/);
    assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/);
    assert.equal((sql.match(/security definer set search_path = ''/g) || []).length, 5);
    assert.equal((sql.match(/security invoker set search_path = ''/g) || []).length, 5);
    assert.equal((sql.match(/grant execute on function [^;]+ to service_role;/g) || []).length, 10);
    const body = sql.slice(sql.indexOf("create function makeborne_private.join_launch_waitlist"), sql.indexOf("create function makeborne_private.launch_waitlist_pending"));
    assert(body.indexOf("errcode = 'MB429'") < body.indexOf("insert into"), "rate limit is checked before the insert, for every address");
    assert.match(body, /interval '10 minutes'\) >= 5/);
    assert.match(body, /on conflict \(email\) do nothing/);
    assert.match(sql, /email = lower\(btrim\(email\)\)/);
    assert.doesNotMatch(sql, /\bip_address\b|\binet\b/);
  });

  await check("social proof is real or absent: from 50 only, rounded down to tens, cached, never blocking the page", async () => {
    const proof = require("./waitlist-count.ts");
    for (const [count, shown] of [[0, null], [49, null], [50, 50], [59, 50], [137, 130], [1000, 1000], [-5, null], [NaN, null], ["120", null], [null, null]]) assert.equal(proof.waitlistProof(count), shown, String(count));
    calls.length = 0;
    reply = { data: 4321, error: null };
    assert.equal(await proof.waitlistProofCount(1_000_000), 4320);
    assert.equal(await proof.waitlistProofCount(1_030_000), 4320, "served from the 60 s cache");
    assert.equal(calls.filter(call => call.name === "makeborne_launch_waitlist_count").length, 1);
    reply = { data: null, error: { code: "XX000" } };
    assert.equal(await proof.waitlistProofCount(1_100_000), null, "an error shows no count");
    reply = { error: null };
    const page = fs.readFileSync(path.join(root, "src/app/page.tsx"), "utf8");
    assert.match(page, /const forcedCount = launch\.testOverrides && /, "the preview override is non-production only");
  });

  await check("the consent line, the privacy notice and the form agree", () => {
    const form = fs.readFileSync(path.join(root, "src/components/launch/waitlist-form.tsx"), "utf8");
    assert.match(form, /We&rsquo;ll only use your email to send your launch invite and launch news\. Unsubscribe any time\. See our <Link href="\/privacy" prefetch=\{false\}>Privacy Policy<\/Link>\./);
    assert.match(shared.WAITLIST_CONSENT_TEXT, /^We'll only use your email to send your launch invite and launch news\. Unsubscribe any time\./);
    const privacy = fs.readFileSync(path.join(root, "src/app/privacy/page.tsx"), "utf8");
    assert.match(privacy, /\["Launch waitlist", "If you join the launch waitlist/);
    assert.match(privacy, /deleted 90 days after launch, or sooner on request/);
    assert.match(privacy, /admin@makeborne\.com/);
    assert.match(form, /tabIndex=\{-1\} autoComplete="off"/);
  });

  console.log(count + " launch waitlist groups passed; no network or database");
})().catch(error => { console.error(error); process.exit(1); });

/* eslint-disable @typescript-eslint/no-require-imports -- Offline GitHub connection renewal qualification with a mocked GitHub and an in-memory database. */
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module"), ts = require("typescript");
const {createDecipheriv, randomBytes} = require("node:crypto");

const src = path.resolve(__dirname, "../..");
// Any request that escapes the mocks fails the harness.
const blocked = () => { throw new Error("Network access is not allowed in this offline check."); };
globalThis.fetch = blocked;

// Test-only configuration generated per run; never a real credential.
process.env.MAKEBORNE_GITHUB_CLIENT_ID = "Iv1.offline-check-client";
process.env.MAKEBORNE_GITHUB_CLIENT_SECRET = `offline-check-secret-${randomBytes(8).toString("hex")}`;
process.env.MAKEBORNE_GITHUB_APP_SLUG = "makeborne-offline-check";
process.env.MAKEBORNE_GITHUB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

// In-memory stand-in for public.github_connections behind the Supabase service client.
function fakeDatabase() {
  const rows = new Map(), log = [];
  const pick = (row, columns) => columns === "*" ? {...row} : Object.fromEntries(columns.split(",").map(c => [c, row[c] ?? null]));
  const check = row => { if ((row.refresh_ciphertext == null) !== (row.refresh_expires_at == null)) return {code: "23514", message: "github_connections_refresh_pair"}; return null; };
  // Every query settles a macrotask later so concurrent callers interleave like real requests.
  const later = value => new Promise(resolve => setImmediate(() => resolve(value)));
  const db = {
    rows, log, failNext: null,
    from(table) {
      assert.equal(table, "github_connections");
      return {
        select(columns) {
          return {eq(column, value) {
            assert.equal(column, "user_id");
            return {maybeSingle: () => later(null).then(() => {
              log.push({op: "select", columns});
              if (db.failNext) { const error = db.failNext; db.failNext = null; return {data: null, error}; }
              const row = rows.get(value);
              return {data: row ? pick(row, columns) : null, error: null};
            })};
          }};
        },
        update(values) {
          const filters = [];
          const query = {
            eq(column, value) { filters.push([column, value]); return query; },
            select(columns) {
              return later(null).then(() => {
                // Read-and-write in one step, like a single UPDATE ... WHERE statement.
                const matched = [...rows.values()].filter(row => filters.every(([c, v]) => row[c] === v));
                for (const row of matched) { const next = {...row, ...values}; const error = check(next); if (error) return {data: null, error}; }
                for (const row of matched) rows.set(row.user_id, {...row, ...values});
                log.push({op: "update", filters, values, changed: matched.length});
                return {data: matched.map(row => pick(row, columns)), error: null};
              });
            },
          };
          return query;
        },
        upsert(row) {
          return later(null).then(() => {
            const next = {...(rows.get(row.user_id) ?? {}), ...row};
            const error = check(next); if (error) return {data: null, error};
            rows.set(row.user_id, next); log.push({op: "upsert", row});
            return {data: null, error: null};
          });
        },
      };
    },
  };
  return db;
}

// Mock GitHub: token endpoint with single-use refresh tokens plus GET /user.
function mockGitHub({githubUserId = 4242, login = "octo", singleUse = true} = {}) {
  const state = {calls: [], valid: new Set(), issued: [], respond: null, gate: null, serial: 0};
  const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});
  state.issue = () => {
    const n = ++state.serial;
    const grant = {access_token: `ghu_offlineAccess${String(n).padStart(4, "0")}xxxxxxxxxxxx`, expires_in: 28800, refresh_token: `ghr_offlineRefresh${String(n).padStart(4, "0")}xxxxxxxxxxxxxxxxxxxx`, refresh_token_expires_in: 15811200, token_type: "bearer", scope: ""};
    state.valid.add(grant.refresh_token); state.issued.push(grant); return grant;
  };
  state.fetch = async (url, init) => {
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    if (url === "https://github.com/login/oauth/access_token") {
      assert.equal(init.method, "POST");
      assert(init.signal instanceof AbortSignal, "token requests need a timeout signal");
      const body = JSON.parse(init.body);
      state.calls.push({url, body});
      if (state.gate) await state.gate(body);
      if (state.respond) { const custom = await state.respond(body); if (custom) return custom; }
      if (body.grant_type === "refresh_token") {
        assert.equal(body.client_id, process.env.MAKEBORNE_GITHUB_CLIENT_ID);
        assert.equal(body.client_secret, process.env.MAKEBORNE_GITHUB_CLIENT_SECRET);
        if (!state.valid.has(body.refresh_token)) return json(200, {error: "bad_refresh_token", error_description: "The refresh token passed is incorrect or expired.", error_uri: "https://docs.github.com"});
        if (singleUse) state.valid.delete(body.refresh_token);
        return json(200, state.issue());
      }
      assert(body.code && body.code_verifier, "authorization code exchange");
      return json(200, state.issue());
    }
    if (url === "https://api.github.com/user") {
      state.calls.push({url, authorization: init.headers.Authorization});
      const token = init.headers.Authorization.replace(/^Bearer /, "");
      if (!state.issued.some(grant => grant.access_token === token) && !token.startsWith("ghu_seeded")) return json(401, {message: "Bad credentials"});
      return json(200, {id: githubUserId, login});
    }
    return blocked();
  };
  state.refreshCalls = () => state.calls.filter(call => call.body?.grant_type === "refresh_token");
  return state;
}

// Module loading: transpile TypeScript, resolve "@/..." to src, and stub framework/database edges.
let currentDb = fakeDatabase();
const stubs = {
  "server-only": {},
  "@/lib/billing/database": {billingDatabase: () => currentDb},
  "@/lib/cloud/server": {
    databaseError(error) { if (error) throw Object.assign(new Error("database"), {code: error.code}); },
    async cloudContext() { return {user: {id: callbackUser}}; },
  },
  "next/headers": {async cookies() { return jar; }},
  "next/server": {NextResponse: {redirect: (url, init) => ({redirect: String(url), init})}},
};
const load = Module._load, resolve = Module._resolveFilename;
Module._load = function(name, parent, main) { return Object.hasOwn(stubs, name) ? stubs[name] : load.call(this, name, parent, main); };
Module._resolveFilename = function(name, parent, ...rest) {
  if (name.startsWith("@/")) { const base = path.join(src, name.slice(2)); for (const ext of [".ts", ".tsx", "/index.ts"]) if (fs.existsSync(base + ext)) return base + ext; }
  return resolve.call(this, name, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText, filename);
let callbackUser = "70000000-0000-4000-8000-000000000001", jar = null;

const connection = require("./connection.ts");
const server = require("./server.ts");
const callback = require("../../app/api/github/callback/route.ts");
const {activeGitHubToken, parseTokenGrant, tokenColumns} = connection;

const key = Buffer.from(process.env.MAKEBORNE_GITHUB_ENCRYPTION_KEY, "hex");
function open(value, userId) {
  const [iv, tag, data] = value.split(".").map(v => Buffer.from(v, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv); decipher.setAAD(Buffer.from(userId)); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
const userId = "70000000-0000-4000-8000-000000000002";
const RECONNECT = "Your GitHub connection has ended. Reconnect GitHub to push again.";
const iso = ms => new Date(Date.now() + ms).toISOString();

/** Store a connection row exactly as the callback does, with chosen expiries. */
function seed(db, github, {accessIn = -60_000, refreshIn = 180 * 86_400_000, refresh = true, user = userId} = {}) {
  const grant = github.issue();
  if (!refresh) github.valid.delete(grant.refresh_token);
  db.rows.set(user, {user_id: user, github_user_id: 4242, login: "octo", token_ciphertext: server.sealToken(grant.access_token, user), expires_at: iso(accessIn),
    refresh_ciphertext: refresh ? server.sealToken(grant.refresh_token, user) : null, refresh_expires_at: refresh ? iso(refreshIn) : null, updated_at: iso(-3_600_000)});
  return grant;
}
function deps(db, github, extra = {}) {
  return {db, fetch: github.fetch, config: {clientId: process.env.MAKEBORNE_GITHUB_CLIENT_ID, secret: process.env.MAKEBORNE_GITHUB_CLIENT_SECRET},
    seal: value => server.sealToken(value, userId), open: value => open(value, userId), sleep: () => new Promise(resolve => setImmediate(resolve)), ...extra};
}

// Every token or secret seen in the run; none may appear in errors or console output.
const secrets = new Set([process.env.MAKEBORNE_GITHUB_CLIENT_SECRET, process.env.MAKEBORNE_GITHUB_ENCRYPTION_KEY]);
const output = [];
for (const method of ["log", "error", "warn", "info", "debug"]) { const original = console[method]; console[method] = (...args) => { output.push(args.map(String).join(" ")); if (method === "log") original(...args); }; }
function remember(github) { for (const grant of github.issued) { secrets.add(grant.access_token); secrets.add(grant.refresh_token); } }
async function rejects(promise, code) {
  try { await promise; } catch (error) {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  assert.fail(`expected ${code}`);
}
function assertNoSecrets(text, label) { for (const secret of secrets) assert(!String(text).includes(secret), `${label} exposes a token or secret`); }
const thrown = [];

let count = 0;
async function check(name, run) { await run(); count++; console.log(`PASS ${name}`); }

(async () => {
  await check("callback stores the access and refresh tokens sealed to the account", async () => {
    const github = mockGitHub(); currentDb = fakeDatabase(); globalThis.fetch = github.fetch;
    const flow = {state: "s".repeat(43), verifier: "v".repeat(43), userId: callbackUser, workspaceId: "80000000-0000-4000-8000-000000000001", artifactId: "60000000-0000-4000-8000-000000000001"};
    jar = {get: () => ({value: JSON.stringify(flow)}), delete: () => {}};
    const started = Date.now();
    const response = await callback.GET(new Request(`https://makeborne.com/api/github/callback?state=${flow.state}&code=offline-code`));
    globalThis.fetch = blocked;
    remember(github);
    assert.match(response.redirect, /github=connected/);
    const row = currentDb.rows.get(callbackUser), grant = github.issued[0];
    assert.equal(row.github_user_id, 4242);
    assert.equal(open(row.token_ciphertext, callbackUser), grant.access_token);
    assert.equal(open(row.refresh_ciphertext, callbackUser), grant.refresh_token);
    assert(!row.token_ciphertext.includes(grant.access_token) && !row.refresh_ciphertext.includes(grant.refresh_token), "tokens are stored sealed");
    assert.throws(() => open(row.refresh_ciphertext, userId), "sealed to the connecting account only");
    assert(Math.abs(Date.parse(row.expires_at) - (started + 28_800_000)) < 5_000);
    assert(Math.abs(Date.parse(row.refresh_expires_at) - (started + 15_811_200_000)) < 5_000);
    assert.equal(github.calls.filter(call => call.url.endsWith("/access_token")).length, 1);
  });

  await check("callback without a refresh token stores null refresh columns (expiring tokens disabled)", async () => {
    const github = mockGitHub(); currentDb = fakeDatabase();
    // A previous connection's refresh token must not survive a reconnect without one.
    currentDb.rows.set(callbackUser, {user_id: callbackUser, refresh_ciphertext: "stale", refresh_expires_at: iso(86_400_000)});
    github.respond = body => body.code ? new Response(JSON.stringify({access_token: `ghu_seededNoRefresh${"x".repeat(20)}`, expires_in: 28800, token_type: "bearer"}), {status: 200}) : null;
    globalThis.fetch = github.fetch;
    const flow = {state: "t".repeat(43), verifier: "w".repeat(43), userId: callbackUser, workspaceId: "80000000-0000-4000-8000-000000000001", artifactId: "60000000-0000-4000-8000-000000000001"};
    jar = {get: () => ({value: JSON.stringify(flow)}), delete: () => {}};
    const response = await callback.GET(new Request(`https://makeborne.com/api/github/callback?state=${flow.state}&code=offline-code`));
    globalThis.fetch = blocked;
    assert.match(response.redirect, /github=connected/);
    const row = currentDb.rows.get(callbackUser);
    assert.equal(row.refresh_ciphertext, null); assert.equal(row.refresh_expires_at, null);
    assert.equal(open(row.token_ciphertext, callbackUser), `ghu_seededNoRefresh${"x".repeat(20)}`);
  });

  await check("token grant validation rejects malformed bodies and pairs refresh token with expiry", async () => {
    assert.throws(() => parseTokenGrant({error: "bad_verification_code"}), /Invalid GitHub token response/);
    assert.throws(() => parseTokenGrant({access_token: "short", expires_in: 1}));
    const columns = tokenColumns({access_token: "a".repeat(20), expires_in: 99999, refresh_token: "r".repeat(20)}, value => `sealed:${value.length}`, 0);
    assert.equal(columns.refresh_ciphertext, null, "no expiry, no stored refresh token");
    assert.equal(columns.expires_at, new Date(28_800_000).toISOString(), "access lifetime stays capped at eight hours");
  });

  await check("a fresh access token is used without contacting the token endpoint", async () => {
    const db = fakeDatabase(), github = mockGitHub();
    const grant = seed(db, github, {accessIn: 3_600_000}); remember(github);
    const active = await activeGitHubToken(userId, deps(db, github));
    assert.equal(active.token, grant.access_token); assert.equal(active.githubUserId, 4242); assert.equal(active.login, "octo");
    assert.equal(github.refreshCalls().length, 0);
    assert.equal(db.log.filter(entry => entry.op === "update").length, 0);
  });

  await check("an expired access token renews once and persists both new tokens", async () => {
    const db = fakeDatabase(), github = mockGitHub();
    const old = seed(db, github); const before = db.rows.get(userId);
    const active = await activeGitHubToken(userId, deps(db, github)); remember(github);
    const calls = github.refreshCalls();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.grant_type, "refresh_token"); assert.equal(calls[0].body.refresh_token, old.refresh_token);
    const next = github.issued[1], row = db.rows.get(userId);
    assert.equal(active.token, next.access_token);
    assert.equal(open(row.token_ciphertext, userId), next.access_token);
    assert.equal(open(row.refresh_ciphertext, userId), next.refresh_token);
    assert(Date.parse(row.expires_at) > Date.now() + 28_000_000 && Date.parse(row.refresh_expires_at) > Date.now() + 15_000_000_000);
    const update = db.log.find(entry => entry.op === "update");
    assert.deepEqual(update.filters, [["user_id", userId], ["refresh_ciphertext", before.refresh_ciphertext]], "renewal is a compare-and-swap on the spent refresh token");
    assert.equal(update.changed, 1);
    // A second call uses the renewed token without another refresh.
    await activeGitHubToken(userId, deps(db, github));
    assert.equal(github.refreshCalls().length, 1);
  });

  await check("access tokens inside the 60s margin renew; a token just outside it does not", async () => {
    const db = fakeDatabase(), github = mockGitHub();
    seed(db, github, {accessIn: 30_000});
    await activeGitHubToken(userId, deps(db, github)); remember(github);
    assert.equal(github.refreshCalls().length, 1);
    const db2 = fakeDatabase(), github2 = mockGitHub();
    seed(db2, github2, {accessIn: 120_000}); remember(github2);
    await activeGitHubToken(userId, deps(db2, github2));
    assert.equal(github2.refreshCalls().length, 0);
  });

  await check("concurrent renewals on separate instances: one GitHub refresh wins, the loser uses the stored winner", async () => {
    const db = fakeDatabase(), github = mockGitHub();
    seed(db, github);
    // Hold both refresh requests until both reached GitHub, so the race is real.
    let arrived = 0, release; const both = new Promise(resolve => { release = resolve; });
    github.gate = async () => { if (++arrived === 2) release(); await both; };
    const [a, b] = await Promise.all([activeGitHubToken(userId, deps(db, github)), activeGitHubToken(userId, deps(db, github))]);
    remember(github);
    const calls = github.refreshCalls();
    assert.equal(calls.length, 2, "both instances reached GitHub");
    assert.equal(github.issued.length, 2, "exactly one refresh call succeeded at GitHub (single-use token)");
    const winner = github.issued[1], row = db.rows.get(userId);
    assert.equal(a.token, winner.access_token); assert.equal(b.token, winner.access_token);
    assert.equal(open(row.refresh_ciphertext, userId), winner.refresh_token);
    assert(github.valid.has(winner.refresh_token), "the stored refresh token is the one GitHub still accepts");
    assert.equal(db.log.filter(entry => entry.op === "update" && entry.changed === 1).length, 1, "exactly one stored renewal");
    assert(db.log.every(entry => !(entry.op === "update" && entry.values.refresh_ciphertext === null)), "the loser never clears the winner's refresh token");
  });

  await check("concurrent renewals that both succeed at GitHub: compare-and-swap keeps one, the loser adopts it", async () => {
    const db = fakeDatabase(), github = mockGitHub({singleUse: false});
    seed(db, github);
    let arrived = 0, release; const both = new Promise(resolve => { release = resolve; });
    github.gate = async () => { if (++arrived === 2) release(); await both; };
    const [a, b] = await Promise.all([activeGitHubToken(userId, deps(db, github)), activeGitHubToken(userId, deps(db, github))]);
    remember(github);
    const updates = db.log.filter(entry => entry.op === "update");
    assert.deepEqual(updates.map(entry => entry.changed).sort(), [0, 1], "one compare-and-swap wins, one loses");
    const stored = open(db.rows.get(userId).token_ciphertext, userId);
    assert.equal(a.token, stored); assert.equal(b.token, stored);
  });

  await check("same-instance callers share one renewal (single flight)", async () => {
    const db = fakeDatabase(), github = mockGitHub(), renewals = new Map();
    seed(db, github);
    const results = await Promise.all([1, 2, 3].map(() => activeGitHubToken(userId, deps(db, github, {renewals}))));
    remember(github);
    assert.equal(github.refreshCalls().length, 1);
    assert(results.every(result => result.token === github.issued[1].access_token));
    assert.equal(renewals.size, 0, "single-flight entries are released");
  });

  await check("a revoked refresh token clears the refresh columns and asks to reconnect", async () => {
    const db = fakeDatabase(), github = mockGitHub();
    const grant = seed(db, github); github.valid.delete(grant.refresh_token); remember(github);
    const error = await rejects(activeGitHubToken(userId, deps(db, github)), "GITHUB_RECONNECT"); thrown.push(error);
    assert.equal(error.message, RECONNECT); assert.equal(error.status, 401);
    const row = db.rows.get(userId);
    assert.equal(row.refresh_ciphertext, null); assert.equal(row.refresh_expires_at, null);
    assert.equal(github.refreshCalls().length, 1);
    for (const code of ["invalid_grant", "unauthorized_client"]) {
      const db2 = fakeDatabase(), github2 = mockGitHub(); seed(db2, github2); remember(github2);
      github2.respond = body => body.grant_type === "refresh_token" ? new Response(JSON.stringify({error: code}), {status: 400}) : null;
      thrown.push(await rejects(activeGitHubToken(userId, deps(db2, github2)), "GITHUB_RECONNECT"));
      assert.equal(db2.rows.get(userId).refresh_ciphertext, null, `${code} clears the refresh token`);
    }
  });

  await check("an expired refresh token is cleared without contacting GitHub", async () => {
    const db = fakeDatabase(), github = mockGitHub();
    seed(db, github, {refreshIn: -1000}); remember(github);
    const error = await rejects(activeGitHubToken(userId, deps(db, github)), "GITHUB_RECONNECT"); thrown.push(error);
    assert.equal(error.message, RECONNECT);
    assert.equal(github.refreshCalls().length, 0);
    assert.equal(db.rows.get(userId).refresh_ciphertext, null);
  });

  await check("no refresh token keeps today's behaviour: GITHUB_RECONNECT with the same wording, no GitHub call", async () => {
    const db = fakeDatabase(), github = mockGitHub();
    seed(db, github, {refresh: false}); remember(github);
    const error = await rejects(activeGitHubToken(userId, deps(db, github)), "GITHUB_RECONNECT"); thrown.push(error);
    assert.equal(error.message, RECONNECT); assert.equal(error.status, 401);
    assert.equal(github.calls.length, 0);
    assert.equal(db.log.filter(entry => entry.op === "update").length, 0);
    thrown.push(await rejects(activeGitHubToken("70000000-0000-4000-8000-0000000000ff", deps(fakeDatabase(), github)), "GITHUB_RECONNECT"));
  });

  await check("transient GitHub or network failures keep the stored refresh token", async () => {
    for (const respond of [() => new Response("<html>bad gateway</html>", {status: 502}), () => { throw new TypeError("fetch failed"); }, () => new Response(JSON.stringify({error: "incorrect_client_credentials"}), {status: 200})]) {
      const db = fakeDatabase(), github = mockGitHub(); seed(db, github); remember(github);
      const before = db.rows.get(userId).refresh_ciphertext;
      github.respond = body => body.grant_type === "refresh_token" ? respond() : null;
      const error = await rejects(activeGitHubToken(userId, deps(db, github)), "GITHUB_RENEWAL_FAILED"); thrown.push(error);
      assert.equal(error.status, 503);
      assert.equal(db.rows.get(userId).refresh_ciphertext, before);
    }
  });

  await check("database failures surface a generic error", async () => {
    const db = fakeDatabase(), github = mockGitHub(); seed(db, github); remember(github);
    db.failNext = {code: "XX000", message: "connection reset"};
    thrown.push(await rejects(activeGitHubToken(userId, deps(db, github)), "GITHUB_CONNECTION_UNAVAILABLE"));
  });

  await check("server githubConnection renews through the real seal/open and keeps the identity check", async () => {
    const github = mockGitHub(); currentDb = fakeDatabase(); seed(currentDb, github);
    globalThis.fetch = github.fetch;
    try {
      const [a, b] = await Promise.all([server.githubConnection(userId), server.githubConnection(userId)]);
      remember(github);
      assert.equal(github.refreshCalls().length, 1, "module-level single flight");
      assert.equal(a.token, github.issued[1].access_token); assert.equal(b.token, a.token); assert.equal(a.login, "octo");
      assert.equal(github.calls.filter(call => call.url === "https://api.github.com/user" && call.authorization === `Bearer ${a.token}`).length, 2, "identity checked with the renewed token");
      // Wrong GitHub account on the stored connection still fails closed.
      currentDb.rows.set(userId, {...currentDb.rows.get(userId), github_user_id: 1});
      thrown.push(await rejects(server.githubConnection(userId), "GITHUB_IDENTITY"));
      // No refresh token: same reconnect error as before this change.
      const plain = mockGitHub(); currentDb = fakeDatabase(); seed(currentDb, plain, {refresh: false}); remember(plain);
      globalThis.fetch = plain.fetch;
      const error = await rejects(server.githubConnection(userId), "GITHUB_RECONNECT"); thrown.push(error);
      assert.equal(error.message, RECONNECT);
    } finally { globalThis.fetch = blocked; }
  });

  await check("callback and server wiring", async () => {
    const route = fs.readFileSync(path.join(src, "app/api/github/callback/route.ts"), "utf8");
    assert(/tokenColumns\(token,value=>sealToken\(value,user\.id\)\)/.test(route), "callback seals both tokens with the account as associated data");
    const serverSource = fs.readFileSync(path.join(__dirname, "server.ts"), "utf8");
    assert(/activeGitHubToken\(userId/.test(serverSource) && /GITHUB_IDENTITY/.test(serverSource));
  });

  await check("tokens and secrets never appear in thrown errors or console output", async () => {
    assert(thrown.length >= 10);
    for (const error of thrown) assertNoSecrets(`${error.message} ${error.stack} ${JSON.stringify(error)}`, `error ${error.code}`);
    assertNoSecrets(output.join("\n"), "console output");
    const source = fs.readFileSync(path.join(__dirname, "connection.ts"), "utf8");
    assert(!/console\./.test(source), "renewal code never logs");
  });

  console.log(`${count} GitHub connection renewal check groups passed against a mocked GitHub and an in-memory database. No network or database access.`);
})().catch(error => { process.exitCode = 1; console.error(error); process.stderr.write(`${error?.stack ?? error}\n`); });

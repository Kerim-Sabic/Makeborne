/* eslint-disable @typescript-eslint/no-require-imports -- Offline callback checks with real Supabase query serialization and mocked auth/provider/database I/O. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { AsyncLocalStorage } = require("node:async_hooks");
const ts = require("typescript");
const { createClient } = require("@supabase/supabase-js");

// This harness never reads environment files or contacts an external service.
global.fetch = async () => { throw new Error("Network access is forbidden in this harness"); };
const scope = new AsyncLocalStorage();
const syntheticSecret = "SYNTHETIC_PRIVATE_RESPONSE_DO_NOT_REDIRECT";
const fixtureEnv = {
  MAKEBORNE_MAIL_ENCRYPTION_KEY: "ab".repeat(32),
  MAKEBORNE_GOOGLE_MAIL_CLIENT_ID: "fixture-google-id",
  MAKEBORNE_GOOGLE_MAIL_CLIENT_SECRET: "fixture-google-secret",
  MAKEBORNE_MICROSOFT_MAIL_CLIENT_ID: "fixture-microsoft-id",
  MAKEBORNE_MICROSOFT_MAIL_CLIENT_SECRET: "fixture-microsoft-secret",
};
function load(relative, dependencies) {
  const filename = path.resolve(__dirname, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(source, {
    module: loadedModule, exports: loadedModule.exports, Buffer, Request, Response, URL, Date,
    process: { env: fixtureEnv },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return loadedModule.exports;
}
const config = load("config.ts", { "server-only": {}, "node:crypto": require("node:crypto") });
class RequestError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}
const mailServer = load("server.ts", {
  "server-only": {}, "../server/http": { RequestError },
  "../billing/database": { billingDatabase: () => scope.getStore().database.client },
  "../cloud/server": {
    async cloudContext(workspaceId, write) {
      const current = scope.getStore();
      current.authCalls++;
      assert.equal(write, true, "callback must require write access");
      assert.equal(workspaceId, current.stateWorkspace);
      if (!current.userId || current.authFailure || workspaceId !== current.allowedWorkspace) {
        throw new RequestError("NOT_FOUND", syntheticSecret, 403);
      }
      return { user: { id: current.userId }, workspace: { id: workspaceId, role: current.role } };
    },
  },
});
const { GET } = load("../../app/api/mail/callback/[provider]/route.ts", {
  "@/lib/mail/config": config,
  "@/lib/mail/server": mailServer,
  "@/lib/mail/providers": {
    providerClient(provider) {
      const current = scope.getStore();
      assert.equal(provider, current.provider);
      return {
        async exchange(input) {
          current.exchangeCalls++;
          assert.equal(input.code, "fixture-code");
          assert.equal(input.redirectUri, `https://app.test/api/mail/callback/${provider}`);
          if (current.exchangeFailure) throw new Error(syntheticSecret);
          return { refreshToken: `refresh-${current.userId}`, accessToken: `access-${current.userId}`, expiresAt: new Date("2026-10-14T00:00:00Z"), grantedScopes: current.grantedScopes };
        },
        async profile() {
          if (current.profileFailure) throw new Error(syntheticSecret);
          return { email: current.email, name: current.name };
        },
      };
    },
  },
  "@/lib/mail/engine": {
    async storeTokens({ db }, id, refresh, access) {
      const current = scope.getStore();
      assert.equal(db, current.database.client);
      const row = current.database.rows.find(row => row.id === id);
      assert.ok(row);
      assert.equal(row.user_id, current.userId, "token writes require the stored owner");
      assert.equal(row.workspace_id, current.stateWorkspace);
      current.database.tokens.push({ id, userId: current.userId, refresh, access });
      if (current.tokenFailure) throw new Error(syntheticSecret);
    },
  },
});
const key = row => [row.workspace_id, row.provider, row.email].join("|");
function database({ rows = [], simultaneousInserts = 0, insertError, updateError, noInsertRow = false } = {}) {
  const state = { rows: rows.map(row => ({ ...row })), tokens: [], requests: [], client: null };
  let arrivals = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  state.client = createClient("https://database.invalid", "fixture-service-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input);
      assert.equal(url.pathname, "/rest/v1/mail_accounts");
      const method = init.method;
      const body = JSON.parse(init.body);
      state.requests.push({ method, body, filters: Object.fromEntries(url.searchParams) });
      const headers = new Headers(init.headers);
      assert.doesNotMatch(headers.get("Prefer") ?? "", /resolution=merge-duplicates/, "ownership cannot be upserted");
      if (method === "POST") {
        if (simultaneousInserts) {
          if (++arrivals === simultaneousInserts) release();
          await gate;
        }
        if (insertError) return reply({ code: insertError, message: syntheticSecret }, 400);
        // Simulates the database unique constraint at the write boundary.
        if (state.rows.some(row => key(row) === key(body))) return reply({ code: "23505", message: syntheticSecret }, 409);
        const row = { ...body, id: `mail-${state.rows.length + 1}` };
        state.rows.push(row);
        return reply(noInsertRow ? null : { id: row.id, user_id: row.user_id }, 201);
      }
      assert.equal(method, "PATCH");
      assert.ok(!Object.hasOwn(body, "user_id"), "reconnect must not rewrite ownership");
      for (const name of ["workspace_id", "provider", "email", "user_id"]) assert.ok(url.searchParams.has(name), `Missing update filter ${name}`);
      if (updateError) return reply({ code: updateError, message: syntheticSecret }, 400);
      const matches = state.rows.filter(row => ["workspace_id", "provider", "email", "user_id"].every(name => url.searchParams.get(name) === `eq.${row[name]}`));
      matches.forEach(row => Object.assign(row, body));
      return reply(matches.map(row => ({ id: row.id, user_id: row.user_id })));
    } },
  });
  return state;
}
function connected(provider, userId = "owner") {
  return { id: "existing-mail", workspace_id: "workspace", provider, email: "shared@mail.test", user_id: userId, display_name: "Original", status: "disconnected", last_error: "Reconnect needed", daily_limit: 25 };
}
async function callback(db, overrides = {}) {
  const current = {
    database: db, provider: "google", userId: "owner", stateUser: "owner", stateWorkspace: "workspace", allowedWorkspace: "workspace", role: "editor",
    name: "Updated name", email: "Shared@Mail.test", exchangeCalls: 0, authCalls: 0, grantedScopes: [config.GMAIL_SEND_SCOPE, config.GMAIL_READ_SCOPE], ...overrides,
  };
  return scope.run(current, async () => {
    const signed = config.signState({ userId: current.stateUser, workspaceId: current.stateWorkspace, provider: current.provider, nonce: "fixture-nonce" });
    const state = current.invalidState ? `${signed}x` : signed;
    const request = new Request(`https://app.test/api/mail/callback/${current.provider}?code=fixture-code&state=${encodeURIComponent(state)}`);
    const response = await GET(request, { params: Promise.resolve({ provider: current.provider }) });
    assert.equal(response.status, 302);
    const result = new URL(response.headers.get("Location"));
    assert.equal(result.origin, "https://app.test");
    assert.doesNotMatch(result.toString(), new RegExp(syntheticSecret));
    return { ...current, result: result.searchParams.get("mail"), detail: result.searchParams.get("mailDetail") };
  });
}
let passed = 0;
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
(async () => {
  for (const provider of ["google", "microsoft"]) {
    await check(`${provider}: first connection and own reconnect`, async () => {
      const db = database();
      assert.equal((await callback(db, { provider })).result, "connected");
      assert.equal(db.rows[0].email, "shared@mail.test");
      assert.equal(db.tokens.length, 1);
      db.rows[0].daily_limit = 25;
      db.rows[0].status = "disconnected";
      assert.equal((await callback(db, { provider, name: "Reconnected" })).result, "connected");
      assert.equal(db.rows[0].display_name, "Reconnected");
      assert.equal(db.rows[0].status, "active");
      assert.equal(db.rows[0].daily_limit, 25);
      assert.equal(db.tokens.length, 2);
    });
    await check(`${provider}: another member cannot overwrite an existing mailbox or its tokens`, async () => {
      const row = connected(provider, "other-owner"), db = database({ rows: [row] });
      assert.equal((await callback(db, { provider })).result, "error");
      assert.deepEqual(db.rows, [row]);
      assert.equal(db.tokens.length, 0);
    });
    await check(`${provider}: simultaneous different owners connect exactly one owner`, async () => {
      const db = database({ simultaneousInserts: 2 });
      const results = await Promise.all([callback(db, { provider }), callback(db, { provider, userId: "other-owner", stateUser: "other-owner" })]);
      assert.deepEqual(results.map(item => item.result).sort(), ["connected", "error"]);
      assert.equal(db.rows.length, 1);
      assert.equal(db.tokens.length, 1);
      assert.equal(db.rows[0].user_id, results.find(item => item.result === "connected").userId);
    });
    await check(`${provider}: simultaneous same-owner connects can both reconnect`, async () => {
      const db = database({ simultaneousInserts: 2 });
      const results = await Promise.all([callback(db, { provider }), callback(db, { provider })]);
      assert.ok(results.every(item => item.result === "connected"));
      assert.equal(db.rows.length, 1);
      assert.equal(db.tokens.length, 2);
    });
  }
  await check("invalid signed state, wrong session, missing session, inaccessible workspace and reviewer stop before exchange", async () => {
    for (const overrides of [{ invalidState: true }, { userId: "different-user" }, { userId: null }, { stateWorkspace: "other-workspace" }, { role: "reviewer" }, { authFailure: true }]) {
      const db = database(), result = await callback(db, overrides);
      assert.equal(result.result, "error");
      assert.equal(result.exchangeCalls, 0);
      assert.equal(db.requests.length, 0);
      assert.equal(db.tokens.length, 0);
    }
  });
  await check("Google persists only returned permissions and requires confirmed send grant on first connection and reconnect", async () => {
    const db = database();
    assert.equal((await callback(db, { grantedScopes: [config.GMAIL_SEND_SCOPE] })).result, "connected");
    assert.deepEqual(db.rows[0].granted_scopes, [config.GMAIL_SEND_SCOPE]);
    assert.equal((await callback(db, { grantedScopes: [config.GMAIL_SEND_SCOPE, config.GMAIL_READ_SCOPE] })).result, "connected");
    assert.deepEqual(db.rows[0].granted_scopes, [config.GMAIL_SEND_SCOPE, config.GMAIL_READ_SCOPE]);
    for (const grantedScopes of [undefined, [], [config.GMAIL_READ_SCOPE]]) {
      const refused = database();
      assert.equal((await callback(refused, { grantedScopes })).result, "error");
      assert.equal(refused.requests.length, 0); assert.equal(refused.tokens.length, 0);
    }
  });
  await check("database failures and missing insert result stop token persistence", async () => {
    for (const options of [{ insertError: "42501" }, { noInsertRow: true }, { rows: [connected("google")], updateError: "42501" }]) {
      const db = database(options);
      assert.equal((await callback(db)).result, "error");
      assert.equal(db.tokens.length, 0);
      if (options.insertError) assert.equal(db.requests.length, 1, "only unique conflicts permit reconnect updates");
    }
  });
  await check("provider errors and missing email stop writes; token failures report a safe error", async () => {
    for (const overrides of [{ exchangeFailure: true }, { profileFailure: true }, { email: "" }]) {
      const db = database();
      assert.equal((await callback(db, overrides)).result, "error");
      assert.equal(db.requests.length, 0);
      assert.equal(db.tokens.length, 0);
    }
    assert.equal((await callback(database(), { tokenFailure: true })).result, "error");
  });
  console.log(`${passed} callback groups passed (offline; no credentials or live services).`);
})().catch(error => { console.error(error); process.exitCode = 1; });

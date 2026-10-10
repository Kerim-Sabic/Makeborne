/* eslint-disable @typescript-eslint/no-require-imports -- Runs real server policy with deterministic boundary fixtures. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const zod = require("zod");

function load(file, modules = {}) {
  const source = fs.readFileSync(file, "utf8");
  const compiled = ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  const context = {exports: {}, Request, Response, Headers, URL,
    TextDecoder, TextEncoder, Uint8Array, process: {env: {}}, require(name) {
      if (name === "server-only") return {};
      if (Object.hasOwn(modules, name)) return modules[name];
      throw new Error(`Unexpected server-boundary dependency: ${name}`);
    }};
  vm.runInNewContext(compiled, context, {filename: file});
  return context.exports;
}

const http = load("src/lib/server/http.ts");
const accounts = load("src/lib/cloud/request-account.ts");
const actor = "a1111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";
const workspace = "33333333-3333-4333-8333-333333333333";
const schema = "20261003_cloud_v2";
let checks = 0;

function fixture(options = {}) {
  const state = {events: [], options: {
    enabled: true, authenticated: true, expectedAccount: null, schema,
    workspace: {id: workspace, name: "Fixture workspace", owner_id: actor},
    member: null, ...options,
  }};
  const client = {
    auth: {async getUser() {
      state.events.push("identity");
      return {data: {user: state.options.authenticated ? {id: actor,
        user_metadata: {is_admin: true, role: "owner"}} : null},
      error: state.options.authError ?? null};
    }},
    async rpc(name) {
      assert.equal(name, "makeborne_cloud_schema_version");
      state.events.push("schema");
      return {data: state.options.schema, error: state.options.schemaError ?? null};
    },
    from(table) {
      assert(["workspaces", "workspace_members"].includes(table));
      const predicates = {};
      return {
        select(columns) {
          assert.equal(columns, table === "workspaces" ? "id,name,owner_id" : "role");
          return this;
        },
        eq(key, value) {predicates[key] = value; return this;},
        async maybeSingle() {
          assert.deepEqual(predicates, table === "workspaces"
            ? {id: workspace} : {workspace_id: workspace, user_id: actor});
          state.events.push(table);
          return {data: state.options[table === "workspaces" ? "workspace" : "member"],
            error: state.options[`${table}Error`] ?? null};
        },
      };
    },
  };
  const server = load("src/lib/cloud/server.ts", {
    "next/headers": {headers: async () => new Headers(state.options.expectedAccount === null
      ? {} : {"X-Makeborne-Account": state.options.expectedAccount})},
    zod,
    "@/lib/supabase/server": {createClient: async () => {
      state.events.push("client"); return client;
    }},
    "@/lib/server/http": http,
    "./config": {CLOUD_SCHEMA_VERSION: schema, getCloudStatus: () => ({
      enabled: state.options.enabled, reason: "Fixture cloud unavailable",
    })},
    "./request-account": accounts,
    "@/lib/billing/access": {requireCreationAccess: async user => {
      assert.equal(user.id, actor);
      state.events.push("entitlement");
      if (state.options.entitlementError) throw state.options.entitlementError;
    }},
  });
  return {state, server, client};
}

async function check(name, run) {await run(); checks++; console.log(`PASS ${name}`);}
async function denied(promise, code, status) {
  await assert.rejects(promise, error => error instanceof http.RequestError
    && error.code === code && error.status === status);
}

async function main() {
  await check("disabled cloud denies before client or identity access", async () => {
    const {server, state} = fixture({enabled: false});
    await denied(server.cloudContext(workspace, true), "CLOUD_DISABLED", 503);
    assert.equal(state.events.length, 0);
  });
  for (const options of [{authenticated: false}, {authError: {status: 401}}]) {
    await check("missing or invalid verified identity stops before schema and entitlement", async () => {
      const {server, state} = fixture(options);
      await denied(server.cloudContext(workspace, true), "AUTH_REQUIRED", 401);
      assert.deepEqual(state.events, ["client", "identity"]);
    });
  }
  for (const expectedAccount of [owner, "not-a-uuid", "", `${actor}x`]) {
    await check(`account constraint rejects stale/malformed identity: ${expectedAccount || "empty"}`, async () => {
      const {server, state} = fixture({expectedAccount});
      await denied(server.cloudContext(workspace, true), "ACCOUNT_CHANGED", 409);
      assert.deepEqual(state.events, ["client", "identity"]);
    });
  }
  for (const expectedAccount of [null, actor, actor.toUpperCase()]) {
    await check("matching or absent account header retains verified identity", async () => {
      const {server, state} = fixture({expectedAccount});
      const result = await server.cloudContext();
      assert.equal(result.user.id, actor);
      assert.equal(result.workspace, null);
      assert.deepEqual(state.events, ["client", "identity", "schema"]);
    });
  }
  await check("write entitlement uses verified subject and fails before record access", async () => {
    const {server, state} = fixture({entitlementError:
      new http.RequestError("MEMBERSHIP_REQUIRED", "Fixture membership denied", 402)});
    await denied(server.cloudContext(workspace, true), "MEMBERSHIP_REQUIRED", 402);
    assert.deepEqual(state.events, ["client", "identity", "entitlement"]);
  });
  for (const options of [{schema: "old"}, {schema: null}, {schemaError: {code: "PGRST202"}}]) {
    await check("schema mismatch or failure stops before workspace reads", async () => {
      const {server, state} = fixture(options);
      await denied(server.cloudContext(workspace), "CLOUD_SCHEMA_UNVERIFIED", 503);
      assert.deepEqual(state.events, ["client", "identity", "schema"]);
    });
  }
  await check("invalid workspace is rejected before query construction", async () => {
    const {server, state} = fixture();
    await denied(server.cloudContext("invalid"), "INVALID_ID", 400);
    assert(!state.events.includes("workspaces"));
  });
  for (const write of [false, true]) {
    await check(`verified owner has ${write ? "write" : "read"} context without inherited membership`, async () => {
      const {server, state} = fixture();
      const result = await server.cloudContext(workspace, write);
      assert.equal(result.workspace.role, "owner");
      assert.equal(result.client.auth !== undefined, true);
      assert.equal(state.events.includes("entitlement"), write);
      assert(!state.events.includes("workspace_members"));
    });
  }
  for (const role of ["editor", "reviewer", "owner", "admin", "unknown", null]) {
    for (const write of [false, true]) {
      await check(`non-owner ${role ?? "missing membership"} ${write ? "write" : "read"} boundary`, async () => {
        const {server} = fixture({workspace: {id: workspace, name: "Member fixture", owner_id: owner},
          member: role === null ? null : {role}});
        const allowed = role === "editor" || (role === "reviewer" && !write);
        if (allowed) assert.equal((await server.cloudContext(workspace, write)).workspace.role, role);
        else await denied(server.cloudContext(workspace, write), role === "reviewer"
          ? "ACCESS_DENIED" : "NOT_FOUND", role === "reviewer" ? 403 : 404);
      });
    }
  }
  await check("missing workspace conceals existence without consulting membership", async () => {
    const {server, state} = fixture({workspace: null});
    await denied(server.cloudContext(workspace), "NOT_FOUND", 404);
    assert(!state.events.includes("workspace_members"));
  });
  await check("membership revocation is checked on every request", async () => {
    const {server, state} = fixture({workspace: {id: workspace, name: "Revocation fixture", owner_id: owner},
      member: {role: "editor"}});
    assert.equal((await server.cloudContext(workspace)).workspace.role, "editor");
    state.options.member = null;
    await denied(server.cloudContext(workspace), "NOT_FOUND", 404);
    assert.equal(state.events.filter(event => event === "workspace_members").length, 2);
  });
  for (const table of ["workspaces", "workspace_members"]) {
    await check(`${table} database outage cannot grant access`, async () => {
      const {server} = fixture({workspace: {id: workspace, name: "Error fixture", owner_id: owner},
        member: {role: "editor"}, [`${table}Error`]: {code: "XX000", message: "secret fixture value"}});
      await denied(server.cloudContext(workspace), "CLOUD_OUTCOME_UNKNOWN", 503);
    });
  }
  await check("private success and failure responses never cache account data", async () => {
    const {server} = fixture();
    for (const response of [server.cloudJson({id: workspace}),
      server.cloudError(new http.RequestError("ACCESS_DENIED", "Fixture", 403)),
      server.cloudError(new Error("private upstream credential"))]) {
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      assert.equal(response.headers.get("Vary"), "Cookie");
      assert(!(await response.text()).includes("private upstream credential"));
    }
  });
  console.log(`${checks} server-boundary checks passed. Real database/storage and production sessions remain separate evidence. No network or paid calls.`);
}
main().catch(error => {console.error(error); process.exitCode = 1;});

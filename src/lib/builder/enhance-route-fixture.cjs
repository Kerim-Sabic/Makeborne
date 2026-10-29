/* eslint-disable @typescript-eslint/no-require-imports -- Test fixture (not a check): loads the real /api/build/enhance route (TypeScript, transpiled) with
 * authentication, provider and capacity modules replaced, and its durable action store either
 *   - in memory: a faithful model of supabase/migrations/20261022100000_brief_enhancement_actions.sql (one row per actor+key, the claim and
 *     its hold in one step, verified release exactly once, anomalies, Stop, lease expiry), shared across fresh module instances; or
 *   - real PostgreSQL: the actual SQL functions, executed as service_role on the isolated local database.
 * Network is forbidden in both. Used by check-enhance-route.cjs and check-enhance-durable.cjs. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), { randomUUID } = require("node:crypto");

const src = path.join(__dirname, "..", "..");
const routeFile = path.join(src, "app", "api", "build", "enhance", "route.ts");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fault = code => ({ data: null, error: { code, message: `fixture ${code}` } });
const sqlError = (code, message) => { const error = new Error(message); error.sqlstate = code; return error; };

/** In-memory model of the SQL functions (same inputs, outputs, SQLSTATEs). */
function memoryStore() {
  let clock = Date.now();
  const s = { users: new Map(), workspaces: new Map(), artifacts: new Map(), actions: new Map(), reservations: new Map(), ledger: [], outcomes: [], calls: [], rpcLog: [],
    faults: [], hooks: {}, now: () => clock, advance(ms) { clock += ms; } };
  const iso = ms => new Date(ms).toISOString();
  const permission = (actor, workspace, artifact) => {
    const a = s.artifacts.get(artifact), w = s.workspaces.get(workspace);
    if (!a || a.workspace !== workspace || !w || !(w.owner === actor || w.members[actor] === "editor")) throw sqlError("42501", "Editor permission required");
  };
  const snapshot = e => ({ id: e.id, key: e.key, status: e.status, mode: e.mode, outcome: e.outcome, cancelRequested: e.cancelAt !== null, billing: e.billing, holdCredits: e.hold,
    chargedCredits: e.charged, createdAt: iso(e.createdAt), updatedAt: iso(e.updatedAt), resolvedAt: e.resolvedAt === null ? null : iso(e.resolvedAt), failure: e.failure, result: e.status === "completed" ? e.result : null });
  const hold = (user, reference) => s.reservations.get(`${user}:${reference}`);
  const lapse = user => { for (const r of s.reservations.values()) if (r.user === user && r.status === "reserved" && r.createdAt <= s.now() - 15 * 60_000) { r.status = "released"; r.resolvedAt = s.now(); s.users.get(user).available += r.amount; s.ledger.push({ user, kind: "release", reference: r.reference, reason: "hold timeout" }); } };
  const creditRelease = (user, reference) => {
    lapse(user);
    const r = hold(user, reference);
    if (!r || r.status !== "reserved") return { released: 0, replayed: true };
    r.status = "released"; r.resolvedAt = s.now(); s.users.get(user).available += r.amount; s.ledger.push({ user, kind: "release", reference });
    return { released: r.amount, lapsed: 0, replayed: false };
  };
  const record = (user, reference, outcome, measured, detail) => { if (!s.outcomes.some(o => o.user === user && o.reference === reference)) s.outcomes.push({ user, reference, outcome, measured, charged: 0, detail }); };
  const returnHold = (e, reason) => {
    const detail = { kind: "brief_enhance", reason };
    if (e.billing === "exempt") { record(e.actor, e.reference, "exempt", e.measured, detail); return { billing: "exempt", charged: 0, anomaly: false }; }
    const res = creditRelease(e.actor, e.reference);
    if (res.replayed) {
      const r = hold(e.actor, e.reference);
      const billing = !r ? "missing_hold" : r.status === "settled" ? "settled_hold" : r.resolvedAt >= r.createdAt + 15 * 60_000 ? "expired_hold" : "released_hold";
      record(e.actor, e.reference, billing === "missing_hold" ? "missing_hold" : "released_hold", e.measured, detail);
      return { billing, charged: r?.status === "settled" ? r.charged : 0, anomaly: true };
    }
    if (res.released !== e.hold) throw sqlError("XX000", "out of balance");
    record(e.actor, e.reference, "released", e.measured, detail);
    return { billing: "released", charged: 0, anomaly: false };
  };
  const expire = e => {
    if (e.status !== "running" || e.leaseExpiresAt > s.now()) return;
    const h = returnHold(e, "brief_enhance_expired");
    Object.assign(e, { status: ["released", "exempt", "expired_hold"].includes(h.billing) ? "expired" : "needs_review", outcome: "expired", billing: h.billing, charged: h.charged, updatedAt: s.now(), resolvedAt: s.now() });
  };
  const lock = (actor, workspace, artifact, key) => {
    const e = s.actions.get(`${actor}:${key}`);
    if (!e || e.workspace !== workspace || e.artifact !== artifact) throw sqlError("P0002", "Brief enhancement not found");
    return e;
  };
  const byId = (actor, id) => { const e = [...s.actions.values()].find(item => item.id === id && item.actor === actor); if (!e) throw sqlError("P0002", "not found"); return e; };
  const fns = {
    makeborne_brief_enhance_claim(a) {
      if (!UUID.test(a.p_action) || !/^[a-f0-9]{64}$/.test(a.p_input_hash) || !["enhance", "analyze"].includes(a.p_mode) || !(a.p_hold_credits >= 1 && a.p_hold_credits <= 10) || !(a.p_provider_cap_microusd >= 1)) throw sqlError("22023", "Invalid brief enhancement");
      permission(a.p_actor, a.p_workspace, a.p_artifact);
      if (s.artifacts.get(a.p_artifact).kind !== "website") throw sqlError("P0002", "Website unavailable");
      const existing = s.actions.get(`${a.p_actor}:${a.p_action}`);
      if (existing) {
        if (existing.workspace !== a.p_workspace || existing.artifact !== a.p_artifact || (existing.hash !== null && existing.hash !== a.p_input_hash)) throw sqlError("PT409", "input conflict");
        expire(existing);
        return { replayed: true, action: snapshot(existing) };
      }
      const user = s.users.get(a.p_actor), id = randomUUID(), reference = `brief_enhance:${id}`;
      lapse(a.p_actor);
      if (!user.unlimited && user.available < a.p_hold_credits) throw sqlError("MB402", "Insufficient credits");
      const e = { id, actor: a.p_actor, workspace: a.p_workspace, artifact: a.p_artifact, key: a.p_action, hash: a.p_input_hash, mode: a.p_mode, status: "running", outcome: null, reference,
        hold: user.unlimited ? 0 : a.p_hold_credits, exempt: user.unlimited, cap: a.p_provider_cap_microusd, fence: randomUUID(), cancelAt: null, result: null, failure: null, measured: 0, provider: 0,
        billing: user.unlimited ? "exempt" : "held", charged: null, createdAt: s.now(), updatedAt: s.now(), leaseExpiresAt: s.now() + 180_000, resolvedAt: null };
      if (!user.unlimited) { user.available -= a.p_hold_credits; s.reservations.set(`${a.p_actor}:${reference}`, { user: a.p_actor, reference, amount: a.p_hold_credits, status: "reserved", createdAt: s.now(), resolvedAt: null, charged: null }); s.ledger.push({ user: a.p_actor, kind: "reserve", reference }); }
      s.actions.set(`${a.p_actor}:${a.p_action}`, e);
      return { replayed: false, action: snapshot(e), run: { id, fence: e.fence, reference, amount: e.hold, exempt: e.exempt, reservedAt: iso(e.createdAt), leaseExpiresAt: iso(e.leaseExpiresAt) } };
    },
    makeborne_brief_enhance_read(a) { permission(a.p_actor, a.p_workspace, a.p_artifact); const e = lock(a.p_actor, a.p_workspace, a.p_artifact, a.p_action); expire(e); return { action: snapshot(e) }; },
    makeborne_brief_enhance_cancel(a) {
      permission(a.p_actor, a.p_workspace, a.p_artifact);
      if (!s.actions.has(`${a.p_actor}:${a.p_action}`)) {
        const e = { id: randomUUID(), actor: a.p_actor, workspace: a.p_workspace, artifact: a.p_artifact, key: a.p_action, hash: null, mode: null, status: "cancelled", outcome: "cancelled", reference: null, hold: 0, exempt: false, cap: 0,
          fence: randomUUID(), cancelAt: null, result: null, failure: null, measured: 0, provider: 0, billing: "none", charged: 0, createdAt: s.now(), updatedAt: s.now(), leaseExpiresAt: s.now(), resolvedAt: s.now() };
        s.actions.set(`${a.p_actor}:${a.p_action}`, e);
        return { action: snapshot(e) };
      }
      const e = lock(a.p_actor, a.p_workspace, a.p_artifact, a.p_action);
      if (e.status === "running" && e.cancelAt === null) { e.cancelAt = s.now(); e.updatedAt = s.now(); }
      expire(e);
      return { action: snapshot(e) };
    },
    makeborne_brief_enhance_provider_begin(a) {
      const e = byId(a.p_actor, a.p_id);
      if (e.cancelAt !== null) throw sqlError("MB499", "stopped");
      permission(a.p_actor, e.workspace, e.artifact);
      if (a.p_fence !== e.fence) throw sqlError("PT409", "fence");
      if (e.status !== "running" || e.leaseExpiresAt <= s.now()) throw sqlError("PT409", "lease");
      if (!e.exempt && !(hold(e.actor, e.reference)?.status === "reserved" && hold(e.actor, e.reference).createdAt > s.now() - 15 * 60_000)) throw sqlError("PT409", "hold");
      const used = s.calls.filter(c => c.reference === e.reference).reduce((sum, c) => sum + c.bound, 0);
      if (used + a.p_bound > e.cap) return { error: { code: "RUN_BUDGET" } };
      s.calls.push({ id: a.p_call, reference: e.reference, bound: a.p_bound });
      return { started: true, replayed: false };
    },
    makeborne_brief_enhance_record(a) {
      if (!["completed", "failed", "cancelled"].includes(a.p_outcome) || (a.p_outcome === "completed" && !a.p_result) || (a.p_outcome === "failed" && !a.p_failure)) throw sqlError("22023", "Invalid outcome");
      const e = byId(a.p_actor, a.p_id);
      if (a.p_fence !== e.fence) throw sqlError("PT409", "fence");
      if (e.status !== "running") {
        if (e.outcome === a.p_outcome || (e.outcome === "cancelled" && e.cancelAt !== null && a.p_outcome === "completed")) return { replayed: true, action: snapshot(e) };
        throw sqlError("PT409", "resolved");
      }
      const outcome = e.cancelAt !== null && a.p_outcome === "completed" ? "cancelled" : a.p_outcome;
      Object.assign(e, { status: "releasing", outcome, result: outcome === "completed" ? a.p_result : null, failure: outcome === "failed" ? a.p_failure : null, measured: a.p_measured, provider: a.p_provider_microusd, updatedAt: s.now() });
      return { replayed: false, action: snapshot(e) };
    },
    makeborne_brief_enhance_release(a) {
      permission(a.p_actor, a.p_workspace, a.p_artifact);
      const e = lock(a.p_actor, a.p_workspace, a.p_artifact, a.p_action);
      expire(e);
      if (e.status !== "releasing") return { replayed: true, action: snapshot(e) };
      const h = returnHold(e, e.outcome === "completed" ? (e.mode === "analyze" ? "brief_analysis" : "brief_enhance") : e.outcome === "cancelled" ? "brief_enhance_cancelled" : "brief_enhance_unusable");
      Object.assign(e, { status: h.anomaly ? "needs_review" : e.outcome, billing: h.billing, charged: h.charged, updatedAt: s.now(), resolvedAt: s.now() });
      return { replayed: false, action: snapshot(e) };
    },
  };
  return {
    kind: "memory", state: s,
    /** Runs `fn` once, after the next `name` call commits and before its reply returns. */
    after(name, fn) { s.hooks[name] = fn; },
    /** Next calls of `name` fail: "before" (nothing happened) or "after" (it committed, the reply was lost). */
    fail(name, when = "before", times = 1) { for (let i = 0; i < times; i++) s.faults.push({ name, when }); },
    async rpc(name, args) {
      await new Promise(resolve => setImmediate(resolve));
      s.rpcLog.push(name);
      const index = s.faults.findIndex(item => item.name === name);
      const injected = index >= 0 ? s.faults.splice(index, 1)[0] : null;
      if (injected?.when === "before") return fault("08006");
      const fn = fns[name];
      if (!fn) return fault("42883");
      let data;
      try { data = fn(JSON.parse(JSON.stringify(args))); }
      catch (error) { if (error.sqlstate) return fault(error.sqlstate); throw error; }
      // A one-shot hook runs after the call committed, before its reply arrives (e.g. a Stop landing right after the claim).
      const hook = s.hooks[name]; if (hook) { delete s.hooks[name]; await hook(); }
      return injected ? fault("08006") : { data, error: null };
    },
    seed({ owner, workspace, artifact, kind = "website", members = {}, credits = 10, unlimited = [] }) {
      s.workspaces.set(workspace, { owner, members });
      s.artifacts.set(artifact, { workspace, kind });
      for (const user of [owner, ...Object.keys(members)]) if (!s.users.has(user)) s.users.set(user, { available: user === owner ? credits : 10, unlimited: unlimited.includes(user) });
    },
    available: user => s.users.get(user).available,
    holds: user => [...s.reservations.values()].filter(r => r.user === user),
    releases: reference => s.ledger.filter(item => item.kind === "release" && item.reference === reference).length,
    tamper: {
      releaseHold: reference => { const r = [...s.reservations.values()].find(item => item.reference === reference); r.status = "released"; r.resolvedAt = s.now(); s.users.get(r.user).available += r.amount; },
      dropHold: reference => { const key = [...s.reservations.keys()].find(k => k.endsWith(`:${reference}`)); const r = s.reservations.get(key); s.users.get(r.user).available += r.amount; s.reservations.delete(key); },
      ageHold: (reference, ms) => { [...s.reservations.values()].find(item => item.reference === reference).createdAt -= ms; },
      ageLease: (key, ms) => { [...s.actions.values()].find(item => item.key === key).leaseExpiresAt -= ms; },
    },
    action: key => [...s.actions.values()].find(item => item.key === key),
  };
}

/** The real SQL functions on the isolated local database, called as service_role (as the app's secret key does). */
function pgStore(url) {
  const { Pool } = require("pg");
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("Local database only");
  const pool = new Pool({ connectionString: url, max: 12 });
  const faults = [], rpcLog = [];
  const run = async (name, args) => {
    const names = Object.keys(args), values = names.map(key => args[key] === null || args[key] === undefined ? null : typeof args[key] === "object" ? JSON.stringify(args[key]) : String(args[key]));
    const client = await pool.connect();
    try {
      await client.query("begin"); await client.query("set local role service_role");
      const { rows } = await client.query(`select public.${name}(${names.map((key, i) => `${key} => $${i + 1}`).join(", ")}) as r`, values);
      await client.query("commit");
      return { data: rows[0].r, error: null };
    } catch (error) { await client.query("rollback").catch(() => undefined); if (error.code) return fault(error.code); throw error; }
    finally { client.release(); }
  };
  return {
    kind: "postgres", pool,
    fail(name, when = "before", times = 1) { for (let i = 0; i < times; i++) faults.push({ name, when }); },
    async rpc(name, args) {
      if (!/^makeborne_[a-z_]+$/.test(name)) throw new Error("Unexpected function");
      rpcLog.push(name);
      const index = faults.findIndex(item => item.name === name);
      const injected = index >= 0 ? faults.splice(index, 1)[0] : null;
      if (injected?.when === "before") return fault("08006");
      const result = await run(name, args);
      return injected ? fault("08006") : result;
    },
    rpcLog,
    query: (text, values) => pool.query(text, values),
    end: () => pool.end(),
  };
}

/** A recording stand-in for the provider: one "call" per enhanceBrief, optionally through the real spend gate. */
function provider() {
  const p = { calls: 0, behaviour: "ok", gate: true, waiting: [], during: null };
  p.brief = {
    business: "Ovenbird, a bakery.", workingName: null, goal: "Sell bread.", primaryAction: { label: "Pre-order", kind: "buy" }, audience: "Locals.",
    sections: [{ name: "Bakes", anchor: "bakes", purpose: "The bread.", include: [] }, { name: "Visit", anchor: "visit", purpose: "Find us.", include: [] }], tone: "loud", toneWhy: "Food.",
    imagery: { plan: "illustration", notes: "Drawn loaves.", textInImage: null }, factsGiven: [], factsMissing: [], conflicts: [], constraints: [], answersUsed: [],
  };
  p.enhanceBrief = async input => {
    p.calls++;
    if (p.gate) { const ticket = await input.spend.begin("anthropic", "claude-haiku-5-5", 1000); await input.spend.finish(ticket, { actualMicrousd: 600, partialMicrousd: 600 }); }
    if (p.during) await p.during(input);
    if (p.behaviour === "wait") await new Promise((resolve, reject) => {
      p.waiting.push(resolve);
      input.signal.addEventListener("abort", () => reject(input.signal.reason ?? new Error("aborted")), { once: true });
    });
    if (p.behaviour === "throw") throw new Error("provider overloaded");
    if (p.behaviour === "null") { input.onReply?.('{"business":"SECRET-CLIENT-TEXT"', "max_tokens"); return null; }
    return p.brief;
  };
  p.release = () => { for (const resolve of p.waiting.splice(0)) resolve(); };
  return p;
}

/** Loads a FRESH instance of the route and every app module it uses (a new process, as after a restart or on another instance). */
function loadRoute({ store, provider: p, context }) {
  for (const file of Object.keys(require.cache)) if (file.startsWith(src)) delete require.cache[file];
  const fake = {
    "lib/cloud/server": {
      validId: id => { if (!UUID.test(id)) throw new Error("invalid id"); }, databaseError: error => { if (error) throw error; },
      cloudContext: async (workspaceId, write) => {
        context.contexts.push({ workspaceId, write, user: context.user });
        const { RequestError } = require(path.join(src, "lib", "server", "http.ts"));
        if (!context.user) throw new RequestError("AUTH_REQUIRED", "Sign in to access your workspace.", 401);
        const role = context.roles?.[`${context.user}:${workspaceId}`] ?? "owner";
        return { user: { id: context.user }, workspace: { role }, client: { from: () => ({ select: () => ({ eq: (_c1, ws) => ({ eq: (_c2, id) => ({ maybeSingle: async () => {
          const artifact = context.artifacts[id];
          return { data: artifact && artifact.workspace === ws ? { id, kind: artifact.kind, title: "Fixture" } : null, error: null };
        } }) }) }) }) } };
      },
    },
    "lib/billing/database": { billingDatabase: () => ({ rpc: (name, args) => { const promise = store.rpc(name, args); promise.abortSignal = () => promise; return promise; } }) },
    "lib/credits/server": { HOLD_LIFETIME_MS: 15 * 60_000 },
    "lib/ai/live-run": {
      CLOCK_SKEW_MS: 30_000, SETTLEMENT_WINDOW_MS: 60_000,
      databaseGate: () => ({ begin: async () => undefined, finish: async () => { context.finished = (context.finished ?? 0) + 1; } }),
      requireProviderCapacity: async () => { context.capacity = (context.capacity ?? 0) + 1; if (context.capacityError) throw context.capacityError(); },
    },
    "lib/ai/model-check": { requirePricedModel: () => undefined },
    "lib/builder/website-run": { logAiStop: () => null },
    "lib/builder/brief-enhancer": { ENHANCER_MODEL: "claude-haiku-5-5", enhanceBrief: input => p.enhanceBrief(input), unusableReason: text => (text.endsWith("}") ? "fields" : "invalid JSON") },
  };
  const load = Module._load;
  Module._load = function(name, parent, main) {
    if (name === "server-only") return {};
    let target = null;
    if (name.startsWith("@/")) target = path.join(src, name.slice(2));
    else if (name.startsWith(".") && parent?.filename?.startsWith(src)) target = path.resolve(path.dirname(parent.filename), name);
    if (target) {
      const id = path.relative(src, target).replace(/\.(ts|tsx)$/, "").split(path.sep).join("/");
      if (fake[id]) return fake[id];
      const file = fs.existsSync(`${target}.ts`) ? `${target}.ts` : fs.existsSync(`${target}.tsx`) ? `${target}.tsx` : target;
      return load.call(this, file, parent, main);
    }
    return load.call(this, name, parent, main);
  };
  try { return require(routeFile); } finally { Module._load = load; }
}
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);

/** The route's environment for every check: live builder and brief enhancer on, no key ever used, network forbidden, fast Stop polling. */
function offlineEnvironment() {
  globalThis.fetch = async () => { throw new Error("Network forbidden"); };
  process.env.MAKEBORNE_LIVE_BUILDER_ENABLED = "true";
  process.env.ANTHROPIC_API_KEY = "sk-offline-never-sent";
  process.env.MAKEBORNE_ENHANCE_STOP_POLL_MS = "25";
  // The enhancer is not yet qualified for production and is off by default (lib/builder/features.ts); these checks run it on.
  process.env.MAKEBORNE_BRIEF_ENHANCER = "on";
}

/** HTTP helpers bound to one project. */
function client(routeHolder, ids) {
  const json = (method, body, key) => new Request("http://127.0.0.1:3000/api/build/enhance", { method, headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });
  const read = async response => ({ status: response.status, body: await response.json() });
  const scope = (key, over = {}) => ({ workspaceId: ids.workspace, artifactId: ids.artifact, key, ...over });
  return {
    post: (key, brief = "Website for my bakery", over = {}) => routeHolder.route.POST(json("POST", { workspaceId: ids.workspace, artifactId: ids.artifact, brief, original: brief, ...over }, key)).then(read),
    get: (key, over = {}) => routeHolder.route.GET(new Request(`http://127.0.0.1:3000/api/build/enhance?${new URLSearchParams(scope(key, over))}`)).then(read),
    stop: (key, over = {}) => routeHolder.route.DELETE(json("DELETE", scope(key, over))).then(read),
    recover: (key, over = {}) => routeHolder.route.PATCH(json("PATCH", scope(key, over))).then(read),
  };
}

module.exports = { memoryStore, pgStore, provider, loadRoute, offlineEnvironment, client };

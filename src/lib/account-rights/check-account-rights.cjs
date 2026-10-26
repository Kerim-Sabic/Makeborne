/* eslint-disable @typescript-eslint/no-require-imports -- Offline account data rights checks: data map completeness, export contents and scoping helpers, deletion job ordering/resume/idempotency, fresh-session rule and customer copy. No network, database or browser. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const JSZip = require("jszip");
const root = path.join(__dirname, "../../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const { DATA_MAP } = require("./data-map.ts");
const { EXPORT_SOURCES } = require("./export-sources.ts");
const { buildAccountExport, withoutSecrets, exportFilePath } = require("./export-builder.ts");
const { runAccountDeletion, DELETION_STEPS, APP_STEPS } = require("./deletion-job.ts");
const { recentlyAuthenticated, lastAuthenticatedAt } = require("./session.ts");
const contracts = require("./contracts.ts");

let passed = 0;
const pending = [];
function check(name, fn) { pending.push([name, fn]); }

const migrationsDir = path.join(root, "supabase/migrations");
const migrationSql = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).map(f => fs.readFileSync(path.join(migrationsDir, f), "utf8")).join("\n");
const rightsSql = read("supabase/migrations/20261026100000_account_data_rights.sql");
const tables = new Set([...migrationSql.matchAll(/create table (?:if not exists )?([a-z_."]+)/gi)].map(m => m[1].replace(/"/g, "").replace(/^public\./, "")));
const exportRowsSql = rightsSql.slice(rightsSql.indexOf("create function public.makeborne_account_export_rows"), rightsSql.indexOf("-- 6. Grants"));

check("every table created by a migration has an export and deletion decision", () => {
  const mapped = new Map(DATA_MAP.map(entry => [entry.table, entry]));
  assert.equal(mapped.size, DATA_MAP.length, "duplicate data map entry");
  const missing = [...tables].filter(table => !mapped.has(table));
  assert.deepEqual(missing, [], `unmapped tables: ${missing.join(", ")}`);
  const stale = DATA_MAP.filter(entry => !entry.optional && !tables.has(entry.table)).map(entry => entry.table);
  assert.deepEqual(stale, [], `data map lists tables no migration creates: ${stale.join(", ")}`);
  for (const entry of DATA_MAP) {
    assert.ok(["delete", "retain", "pseudonymize", "detach", "system"].includes(entry.deletion), entry.table);
    assert.ok(entry.reason.length > 10, `${entry.table} needs a reason`);
    if (entry.deletion === "retain") assert.ok(entry.period, `${entry.table} retention needs a period`);
  }
});

check("export sources, the SQL branches and the data map agree", () => {
  const sqlSources = new Set([...exportRowsSql.matchAll(/when ((?:'[a-z_]+',?\s*)+) then/g)].flatMap(m => [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1])));
  const tsSources = new Set(EXPORT_SOURCES.map(source => source.source));
  assert.deepEqual([...tsSources].sort(), [...sqlSources].sort());
  const mapSources = new Set(DATA_MAP.flatMap(entry => entry.export ? [entry.export] : []));
  for (const source of tsSources) assert.ok(mapSources.has(source) || source === "account", `${source} missing from the data map`);
  for (const source of mapSources) assert.ok(tsSources.has(source), `${source} in the data map has no export source`);
  for (const source of EXPORT_SOURCES) if (source.optional) assert.match(exportRowsSql, new RegExp(`'${source.source}'`));
});

check("retained tables in SQL match the data map", () => {
  const block = rightsSql.slice(rightsSql.indexOf("elsif p_step = 'retain'"), rightsSql.indexOf("elsif p_step = 'erase'"));
  const sqlRetained = new Set([...block.matchAll(/select '([a-z_]+)'(?: src)?,/g)].map(m => m[1]));
  const mapRetained = new Set(DATA_MAP.filter(entry => entry.deletion === "retain").map(entry => entry.table.replace(/^makeborne_private\./, "")));
  assert.deepEqual([...sqlRetained].sort(), [...mapRetained].sort());
});

check("SQL never selects secrets for export and is server-key only", () => {
  for (const secret of ["token_ciphertext", "refresh_ciphertext", "mail_tokens", "refresh_token", "access_token", "cookie_hash"])
    assert.doesNotMatch(exportRowsSql, new RegExp(`select [^;]*\\b${secret}\\b`), secret);
  for (const [source, excluded] of [["client_review_links", "token_hash"], ["client_portal_access", "token_hash"], ["billing_checkouts", "purchase_url"], ["custom_domains", "cloudflare_id"], ["plan_payments", "evidence"]]) {
    const branch = exportRowsSql.slice(exportRowsSql.indexOf(`when '${source}'`), exportRowsSql.indexOf("\n", exportRowsSql.indexOf(`when '${source}'`)));
    assert.match(branch, new RegExp(excluded), `${source} must exclude ${excluded}`);
  }
  const functions = [...rightsSql.matchAll(/create function (public\.makeborne_account_[a-z_]+)/g)].map(m => m[1]);
  assert.ok(functions.length >= 15);
  for (const fn of functions) assert.match(rightsSql, new RegExp(`'${fn.replace(".", "\\.")}\\(`), `${fn} missing from the grant list`);
  assert.match(rightsSql, /revoke all on function %s from public, anon, authenticated, service_role/);
  assert.doesNotMatch(rightsSql, /grant [a-z, ]+ on [^;]* to (anon|authenticated)/i);
});

check("withoutSecrets drops secret-looking keys at any depth", () => {
  const cleaned = withoutSecrets({ id: 1, token_hash: "x", nested: [{ refresh_token: "r", access_token: "a", password: "p", ok: true, granted_scopes: ["mail"], session_id: "kept", evidence_hash: "kept" }], cookie_hash: "c", token_ciphertext: "t" });
  assert.deepEqual(cleaned, { id: 1, nested: [{ ok: true, granted_scopes: ["mail"], session_id: "kept", evidence_hash: "kept" }] });
});

check("uploaded file paths stay inside their folder", () => {
  const p = exportFilePath({ id: "a1", workspace_id: "w/../..", project_id: "..", object_path: "w/p/artwork/../../etc/passwd" });
  assert.ok(p.startsWith("files/") && !p.includes(".."), p);
  assert.equal(exportFilePath({ id: "id1", workspace_id: "w1", project_id: "p1", object_path: "w1/p1/artwork/hero image.png" }), "files/w1/p1/id1-hero-image.png");
});

const fixtureRows = {
  account: [{ id: "u1", email: "owner@fixture.invalid", signInMethods: [{ provider: "email" }] }],
  workspaces: [{ id: "w1", name: "Studio", relationship: "owner" }],
  clients: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, workspace_id: "w1", name: i === 0 ? "=HYPERLINK(\"x\")" : `Client ${i}`, email: `c${i}@fixture.invalid`, notes: "note, with comma", tags: ["a"], token_hash: "leak" })),
  assets: [
    { id: "a1", workspace_id: "w1", project_id: "p1", object_path: "w1/p1/artwork/one.png" },
    { id: "a2", workspace_id: "w1", project_id: "p1", object_path: "w1/p1/artwork/two.png" },
    { id: "a3", workspace_id: "w1", project_id: "p1", object_path: "w1/p1/artwork/missing.png" },
    { id: "a4", workspace_id: "w1", project_id: "p1", object_path: "w1/p1/artwork/huge.png" },
  ],
  github_connection: [{ login: "owner", token_ciphertext: "never" }],
  credit_ledger: [{ id: "l1", created_at: "2026-10-01T00:00:00Z", kind: "trial", delta: 300, balance_after: 300, reference: "trial" }],
};
const files = { "w1/p1/artwork/one.png": new Uint8Array(600).fill(1), "w1/p1/artwork/two.png": new Uint8Array(600).fill(2), "w1/p1/artwork/huge.png": new Uint8Array(5000).fill(3) };
const calls = [];
const exportDeps = {
  now: () => new Date("2026-10-26T10:00:00Z"),
  rows: async (source, offset, limit) => { calls.push([source, offset, limit]); return (fixtureRows[source] ?? []).slice(offset, offset + limit); },
  download: async objectPath => files[objectPath] ?? null,
  websiteSources: async () => [{ name: "My site-v3.zip", bytes: new Uint8Array(10) }],
};

check("export: every source read with paging, files split into parts, secrets and budgets honoured", async () => {
  const sources = EXPORT_SOURCES.map(source => source.source === "clients" ? { ...source, page: 3 } : source);
  const built = await buildAccountExport(exportDeps, { sources, partBytes: 1000, fileBudgetBytes: 2000 });
  assert.deepEqual(calls.filter(c => c[0] === "clients").map(c => c[1]), [0, 3, 6], "clients paged until a short page");
  for (const source of EXPORT_SOURCES) assert.ok(calls.some(c => c[0] === source.source), `${source.source} not read`);
  assert.equal(built.summary.clients, 7);
  assert.equal(built.parts.length, 2, "two 600-byte files with a 1000-byte part size need two parts");
  assert.deepEqual(built.files, { included: 2, skipped: 1, missing: 1, bytes: 1200 });
  const first = await JSZip.loadAsync(built.parts[0].bytes), second = await JSZip.loadAsync(built.parts[1].bytes);
  const names = Object.keys(first.files);
  for (const name of ["README.txt", "manifest.json", "data/clients/clients.json", "spreadsheets/clients.csv", "data/account/account.json", "website-sources/My-site-v3.zip", "files/w1/p1/a1-one.png"]) assert.ok(names.includes(name), name);
  assert.ok(Object.keys(second.files).includes("files/w1/p1/a2-two.png"));
  assert.ok(!names.some(name => name.startsWith("data/") && name.includes("crm-next-steps")), "empty optional source omitted");
  const all = (await Promise.all(Object.values(first.files).filter(f => !f.dir && !f.name.endsWith(".png") && !f.name.endsWith(".zip")).map(f => f.async("string")))).join("\n");
  assert.doesNotMatch(all, /token_hash|token_ciphertext|"leak"|"never"/);
  const csv = await first.file("spreadsheets/clients.csv").async("string");
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/, "formula cell neutralised");
  assert.match(csv, /"note, with comma"/);
  const manifest = JSON.parse(await first.file("manifest.json").async("string"));
  assert.equal(manifest.parts, 2);
  assert.deepEqual(manifest.files.map(f => [f.status, f.part]), [["included", 1], ["included", 2], ["missing", null], ["skipped", null]]);
  assert.match(manifest.files[0].sha256, /^[0-9a-f]{64}$/);
  const readme = await first.file("README.txt").async("string");
  assert.match(readme, /1 uploaded file\(s\) exceeded/); assert.match(readme, /could not be read/); assert.match(readme, /2 parts/);
  for (const part of built.parts) assert.match(part.sha256, /^[0-9a-f]{64}$/);
});

check("export: a source that doesn't return rows fails closed", async () => {
  await assert.rejects(buildAccountExport({ ...exportDeps, rows: async () => null }, { sources: EXPORT_SOURCES.slice(0, 2) }), /EXPORT_SOURCE_INVALID/);
});

// ---- Deletion job against an in-memory model of the database contract ----
function fakeDeletion({ failOnce = null, busyOnce = false, blockAt = null, leaseLostAt = null } = {}) {
  const state = { steps: {}, lease: null, state: "scheduled", events: [], domainsRemoved: [], storage: [], authDeleted: 0, locked: 0, released: [] };
  let failed = false, busy = busyOnce, leases = 0;
  const deps = {
    newLease: () => `lease-${++leases}`,
    claim: async lease => {
      if (!["scheduled", "processing"].includes(state.state)) return null;
      state.state = "processing"; state.lease = lease;
      return { id: "req-1", userId: "user-1", subjectRef: "subject-1", steps: { ...state.steps }, attempts: leases, workspaceIds: state.steps.recheck ? ["w1", "w2"] : [] };
    },
    step: async (id, lease, step) => {
      assert.equal(lease, state.lease, "stale lease used");
      if (leaseLostAt === step) throw Object.assign(new Error("lost"), { code: "MBD10" });
      if (step === "recheck" && busy) { busy = false; return { step, outcome: "busy" }; }
      if (blockAt === step) { state.state = "blocked"; return { step, outcome: "blocked" }; }
      if (!state.steps[step]) state.steps[step] = true;
      if (step === "finish") { state.state = "completed"; state.lease = null; }
      return { step, outcome: "done", workspaceIds: step === "recheck" ? ["w1", "w2"] : undefined };
    },
    mark: async (id, lease, step) => { assert.equal(lease, state.lease); state.steps[step] = true; },
    release: async (id, lease, code) => { state.released.push(code); state.lease = null; },
    domains: async () => [{ id: "d1", providerId: "cf-1" }, { id: "d2", providerId: "cf-2" }],
    removeDomain: async providerId => { state.domainsRemoved.push(providerId); },
    lockSignIn: async () => { state.locked++; },
    removeStorage: async (bucket, prefix) => {
      if (failOnce === "storage" && !failed) { failed = true; throw Object.assign(new Error("x"), { code: "STORAGE_REMOVE_FAILED" }); }
      state.storage.push(`${bucket}:${prefix}`); return 1;
    },
    deleteAuthUser: async () => { state.authDeleted++; },
    log: entry => { assert.deepEqual(Object.keys(entry).filter(k => !["request", "step", "outcome", "code"].includes(k)), []); state.events.push(entry); },
  };
  return { state, deps };
}

check("deletion: steps run once, in order, and a failed run resumes where it stopped", async () => {
  const { state, deps } = fakeDeletion({ failOnce: "storage" });
  const first = await runAccountDeletion(deps);
  assert.deepEqual(first, { status: "failed", requestId: "req-1", step: "storage", code: "STORAGE_REMOVE_FAILED" });
  assert.deepEqual(state.released, ["STORAGE_REMOVE_FAILED"]);
  assert.equal(state.authDeleted, 0, "sign-in removed before files");
  const second = await runAccountDeletion(deps);
  assert.equal(second.status, "completed");
  assert.equal(state.locked, 1, "lock repeated on resume");
  assert.deepEqual(state.domainsRemoved, ["cf-1", "cf-2"]);
  assert.deepEqual(state.storage, ["project-assets:w1/", "project-assets:w2/", "account-exports:user-1/"]);
  assert.equal(state.authDeleted, 1);
  assert.deepEqual(Object.keys(state.steps).sort(), [...DELETION_STEPS].sort());
  const order = state.events.filter(e => e.outcome === "done").map(e => e.step);
  assert.deepEqual(order, [...DELETION_STEPS]);
  assert.equal(await runAccountDeletion(deps).then(r => r.status), "none", "completed request claimed again");
});

check("deletion: busy waits, blocked stops, a lost lease is not released", async () => {
  const busy = fakeDeletion({ busyOnce: true });
  assert.equal((await runAccountDeletion(busy.deps)).status, "busy");
  assert.deepEqual(busy.state.released, ["BUSY"]);
  assert.equal(busy.state.locked, 0, "locked while busy");
  assert.equal((await runAccountDeletion(busy.deps)).status, "completed");
  const blocked = fakeDeletion({ blockAt: "recheck" });
  assert.equal((await runAccountDeletion(blocked.deps)).status, "blocked");
  assert.equal(blocked.state.locked + blocked.state.authDeleted + blocked.state.storage.length, 0, "blocked request touched data");
  const lost = fakeDeletion({ leaseLostAt: "retain" });
  const result = await runAccountDeletion(lost.deps);
  assert.equal(result.code, "MBD10"); assert.deepEqual(lost.state.released, []);
  assert.deepEqual(APP_STEPS, ["lock", "domains", "storage", "auth"]);
  assert.ok(DELETION_STEPS.indexOf("recheck") < DELETION_STEPS.indexOf("lock") && DELETION_STEPS.indexOf("unpublish") < DELETION_STEPS.indexOf("erase")
    && DELETION_STEPS.indexOf("retain") < DELETION_STEPS.indexOf("erase") && DELETION_STEPS.indexOf("erase") < DELETION_STEPS.indexOf("auth"));
});

check("fresh sign-in: only a real authentication inside the window counts", () => {
  const now = 1_800_000_000;
  assert.equal(recentlyAuthenticated({ amr: [{ method: "otp", timestamp: now - 120 }] }, 600, now), true);
  assert.equal(recentlyAuthenticated({ amr: [{ method: "otp", timestamp: now - 601 }] }, 600, now), false);
  assert.equal(recentlyAuthenticated({ amr: [{ method: "otp", timestamp: now - 5000 }, { method: "password", timestamp: now - 30 }] }, 600, now), true);
  assert.equal(recentlyAuthenticated({ iat: now }, 600, now), false, "token issue time is not a sign-in");
  assert.equal(recentlyAuthenticated({ amr: [{ timestamp: now + 3600 }] }, 600, now), false, "future sign-in");
  assert.equal(recentlyAuthenticated(null, 600, now), false);
  assert.equal(lastAuthenticatedAt({ amr: [{ timestamp: "1" }] }), null);
});

check("status contract parses the database shape and fails closed", () => {
  const status = contracts.accountDataStatus({
    deletion: { id: "11111111-1111-4111-8111-111111111111", state: "scheduled", requestedAt: "2026-10-26T10:00:00+00:00", scheduledFor: "2026-11-02T10:00:00+00:00", blockedCodes: ["NOPE"], cancellable: true, started: false },
    exports: [{ id: "22222222-2222-4222-8222-222222222222", state: "ready", requestedAt: "2026-10-26T10:00:00Z", completedAt: "2026-10-26T10:05:00Z", expiresAt: "2026-10-29T10:05:00Z", parts: [{ part: 1, bytes: 1200 }, { part: "x" }] }, { id: "bad", state: "ready" }],
    nextExportAt: "2026-10-27T10:00:00Z", checks: { blockers: ["ACTIVE_SUBSCRIPTION", "<script>"], warnings: { liveSites: 2, credits: "40", github: true } },
  }, { exportEnabled: true, deletionEnabled: false, email: "a@b.invalid" });
  assert.equal(status.graceDays, 7);
  assert.equal(status.exports.length, 1); assert.deepEqual(status.exports[0].parts, [{ part: 1, bytes: 1200 }]);
  assert.deepEqual(status.blockers, ["ACTIVE_SUBSCRIPTION"]); assert.deepEqual(status.deletion.blockedCodes, []);
  assert.equal(status.warnings.credits, 40); assert.equal(status.warnings.github, true);
  assert.equal(contracts.accountDataStatus("nonsense", { exportEnabled: false, deletionEnabled: false, email: null }).deletion, null);
  assert.equal(contracts.confirmationMatches("  Owner@Fixture.invalid ", "owner@fixture.invalid"), true);
  assert.equal(contracts.confirmationMatches("owner@fixture", "owner@fixture.invalid"), false);
  assert.equal(contracts.confirmationMatches("", null), false);
});

check("one grace-period constant (7 days), used by the server", () => {
  assert.equal(contracts.ACCOUNT_DELETION_GRACE_DAYS, 7);
  const server = read("src/lib/account-rights/server.ts");
  assert.match(server, /accountDeletionGraceDays = \(\) => ACCOUNT_DELETION_GRACE_DAYS/);
  assert.match(server, /p_grace_days: accountDeletionGraceDays\(\)/);
  assert.doesNotMatch(read("src/components/account-data-rights.tsx"), /\b7 days\b/, "UI must read the grace period from the server");
  assert.match(rightsSql, /least\(greatest\(p_grace_days, 1\), 30\)/);
});

check("routes: same origin, confirmation, fresh sign-in, request keys, owner-only downloads, cron secret", () => {
  const deletion = read("src/app/api/account/data/deletion/route.ts");
  const post = deletion.slice(deletion.indexOf("export async function POST"), deletion.indexOf("export async function DELETE"));
  const order = ["requestKey(request)", "cloudBody(request", "requireRightsUser()", "confirmationMatches(", "requireRecentSignIn(user)", "requestAccountDeletion("].map(token => post.indexOf(token));
  assert.ok(order.every(i => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]), `deletion POST order ${order}`);
  assert.match(deletion.slice(deletion.indexOf("export async function DELETE")), /sameOrigin\(request\)[\s\S]*requireRightsUser\(\)[\s\S]*cancelAccountDeletion\(user\.id\)/);
  const exp = read("src/app/api/account/data/export/route.ts");
  assert.match(exp, /sameOrigin\(request\)[\s\S]*accountExportEnabled\(\)[\s\S]*requestKey\(request\)[\s\S]*requireRightsUser\(\)[\s\S]*after\(/);
  const part = read("src/app/api/account/data/export/[requestId]/parts/[part]/route.ts");
  assert.match(part, /exportPartUrl\(user\.id, requestId, Number\(part\)\)/);
  assert.match(part, /status: 303/); assert.match(part, /"Referrer-Policy": "no-referrer"/);
  const server = read("src/lib/account-rights/server.ts");
  assert.match(server, /path\.startsWith\(`\$\{userId\}\/\$\{requestId\}\/`\)/, "signed path bound to the owner and request");
  assert.match(server, /createSignedUrl\(path, EXPORT_LINK_SECONDS/);
  assert.equal(contracts.EXPORT_LINK_SECONDS <= 300, true);
  const cron = read("src/app/api/cron/account-rights/route.ts");
  assert.ok(cron.indexOf("authorizedCron(request)") < cron.indexOf("expireAccountExports()"));
  assert.doesNotMatch(read("vercel.json"), /account-rights/, "schedule is Codex's decision, not wired here");
  // No route takes an account id from the browser.
  for (const file of [deletion, exp, part, read("src/app/api/account/data/route.ts")]) assert.doesNotMatch(file, /p_user|userId\s*:\s*body|searchParams\.get\("user/);
});

check("customer copy names no providers or models and keeps support reachable", () => {
  const names = /\b(anthropic|openai|claude|gpt|whop|supabase|cloudflare|vercel|github|gmail|outlook|google|microsoft|resend)\b/i;
  const copy = [...contracts.DELETION_EXPLAINED.deleted, ...contracts.DELETION_EXPLAINED.retained, contracts.DELETION_EXPLAINED.shared, contracts.DELETION_EXPLAINED.credits,
    ...Object.values(contracts.BLOCKER_COPY).flatMap(item => [item.title, item.action, item.label ?? ""]), contracts.exportFailureMessage(null), contracts.exportFailureMessage("ATTEMPTS_EXHAUSTED")];
  for (const line of copy) assert.doesNotMatch(line, names, line);
  const component = read("src/components/account-data-rights.tsx").split(/\r?\n/).filter(line => !/^\s*import /.test(line)).join("\n").replace(/\.github\b/g, ".connection");
  const visible = [...component.matchAll(/>([^<>{}]{3,})</g), ...component.matchAll(/"([^"]*\s[^"]*)"/g), ...component.matchAll(/`([^`]*\s[^`]*)`/g)].map(m => m[1]);
  for (const text of visible) assert.doesNotMatch(text, names, text);
  for (const file of ["src/app/api/account/data/deletion/route.ts", "src/app/api/account/data/export/route.ts", "src/app/api/account/data/export/[requestId]/parts/[part]/route.ts"])
    for (const message of [...read(file).matchAll(/"([^"]{20,})"/g)].map(m => m[1])) assert.doesNotMatch(message, names, message);
  assert.ok(Object.keys(contracts.BLOCKER_COPY).length === 8);
});

(async () => {
  for (const [name, fn] of pending) { await fn(); passed++; console.log(`PASS ${name}`); }
  console.log(`${passed}/${pending.length} account data rights checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });

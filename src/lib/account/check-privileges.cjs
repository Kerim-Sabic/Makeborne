/* eslint-disable @typescript-eslint/no-require-imports -- Offline server authorization checks. */
const fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript"), assert = require("node:assert/strict");
const source = ts.transpileModule(fs.readFileSync(require.resolve("./privileges.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const knownUser = { id: "fixture-account", email: "fixture@example.invalid", email_confirmed_at: "2026-10-05T00:00:00Z", is_anonymous: false };
let enabled = true, user = knownUser, authError = null, dbError = null, data = null, rpcCalls = 0, throwRead = false;
const client = {
  auth: { getUser: async () => { if (throwRead) throw new Error("offline"); return { data: { user }, error: authError }; } },
  rpc: async name => { assert.equal(name, "makeborne_my_account_privileges"); rpcCalls++; return { data, error: dbError }; },
};
const modules = { "server-only": {}, "@/lib/supabase/auth-server": { accountsEnabled: () => enabled }, "@/lib/supabase/server": { createClient: async () => client } };
const context = { exports: {}, require: name => { if (!(name in modules)) throw new Error("Unexpected dependency " + name); return modules[name]; } };
vm.runInNewContext(source, context);
const { getAccountPrivileges } = context.exports;
async function flags(admin, unlimited, expectedUserId) {
  const actual = await getAccountPrivileges(expectedUserId);
  assert.equal(actual.isAdmin, admin); assert.equal(actual.unlimitedCredits, unlimited);
}
async function run() {
  data = { userId: knownUser.id, isAdmin: true, unlimitedCredits: true };
  await flags(true, true, knownUser.id);
  // Revocation is fresh, not cached in JWT metadata or a previous request.
  data = { userId: knownUser.id, isAdmin: false, unlimitedCredits: false };
  user = { ...knownUser, user_metadata: { is_admin: true }, app_metadata: { is_admin: true } };
  await flags(false, false);
  data = { userId: "another-account", isAdmin: true, unlimitedCredits: true };
  await flags(false, false);
  data = { userId: knownUser.id, isAdmin: "true", unlimitedCredits: 1 };
  await flags(false, false);
  data = { userId: knownUser.id, isAdmin: true, unlimitedCredits: true };
  dbError = new Error("missing migration"); await flags(false, false); dbError = null;
  const before = rpcCalls;
  for (const invalid of [null, { ...knownUser, is_anonymous: true }, { ...knownUser, email: null }, { ...knownUser, email_confirmed_at: null }]) { user = invalid; await flags(false, false); }
  user = knownUser;
  await flags(false, false, "different-session");
  authError = new Error("invalid session"); await flags(false, false); authError = null;
  enabled = false; await flags(false, false); enabled = true;
  throwRead = true; await flags(false, false); throwRead = false;
  assert.equal(rpcCalls, before, "Unverified identities reached privilege RPC");
  await flags(true, true);
  console.log("PASS: verified identity, exact account binding, confirmed email, strict flags, fresh revocation, metadata forgery, outages and closed configuration. No live services called.");
}
void run().catch(error => { console.error(error); process.exitCode = 1; });

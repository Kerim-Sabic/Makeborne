/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks: connection cards say where a mailbox is used, its last send, how to stop automation, and that disconnecting leaves the provider grant until revoked there (mail and GitHub). No network. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
globalThis.fetch = async () => { throw new Error("Network forbidden"); };
const load = file => {
  const compiled = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(src, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", js)(require, compiled, compiled.exports);
  return compiled.exports;
};
const read = file => fs.readFileSync(path.join(src, file), "utf8");
const copy = load("lib/mail/connection-copy.ts"), github = load("lib/github/disconnect-copy.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const account = extra => ({ email: "owner@example.test", provider: "google", status: "active", lastSentAt: null, sequences: [], ...extra });

check("mailbox use: sequences, last send and a stop instruction only when something runs", () => {
  const busy = copy.mailboxUse(account({ lastSentAt: "2026-10-19T09:30:00Z", sequences: [{ sequenceId: "s", name: "Spring", active: 2, paused: 1 }] }));
  assert.equal(busy.lastSentAt, "2026-10-19T09:30:00Z");
  assert.equal(copy.sequenceUseCounts(busy.sequences[0]), "2 running, 1 paused");
  assert.match(busy.stop, /pause or stop those clients under Sequences → Clients, or disconnect this mailbox/);
  const paused = copy.mailboxUse(account({ sequences: [{ sequenceId: "s", name: "Spring", active: 0, paused: 3 }] }));
  assert.equal(paused.stop, null, "paused clients send nothing, so there is nothing to stop");
  assert.equal(copy.mailboxUse(account({ sequences: undefined })).unused, "No sequence uses it. It sends only the emails you send from a client.");
  assert.equal(copy.mailboxUse(account({ status: "disconnected" })), null);
});

check("disconnect copy names what pauses and that the provider grant stays", () => {
  assert.equal(copy.disconnectQuestion(account({ sequences: [{ sequenceId: "s", name: "A", active: 1, paused: 0 }] })),
    "Disconnect owner@example.test? Makeborne deletes its stored access to this mailbox and pauses 1 running sequence client. Nothing queued is sent, and sent history is kept. Google keeps listing Makeborne until you remove it in your Google account.");
  assert.match(copy.disconnectQuestion(account({ provider: "microsoft" })), /^Disconnect owner@example\.test\? Makeborne deletes its stored access to this mailbox\. Nothing queued is sent.*Microsoft keeps listing Makeborne/);
  assert.match(copy.disconnectedMessage({ provider: "microsoft" }), /Microsoft still lists Makeborne until you remove it there/);
  assert.deepEqual({ ...copy.PROVIDER_PERMISSION_PAGES }, { google: "https://myaccount.google.com/connections", microsoftPersonal: "https://account.live.com/consent/Manage", microsoftWork: "https://myapps.microsoft.com" });
});

check("the copy matches what the server does", () => {
  const disconnect = read("app/api/cloud/workspaces/[workspaceId]/mail/accounts/route.ts");
  assert.match(disconnect, /makeborne_mail_token_write", \{ p_account: body\.id, p_refresh: "revoked", p_access: null/, "stored access is replaced");
  assert.match(disconnect, /mail_enrollments"\)\.update\(\{ status: "paused"[^)]*\)\.eq\("account_id", body\.id\)\.eq\("status", "active"\)/, "running enrollments pause");
  assert.doesNotMatch(disconnect, /fetch\(/, "no provider revocation call, so the grant stays at the provider");
  const overview = read("app/api/cloud/workspaces/[workspaceId]/mail/route.ts");
  assert.match(overview, /select\("sequence_id,account_id,status"\)/);
  assert.match(overview, /lastSentAt: account\.last_sent_at/);
  assert.match(overview, /sequences: \[\.\.\.\(usage\.get\(account\.id\)\?\.values\(\) \?\? \[\]\)\]/);
  assert.match(read("lib/mail/engine.ts"), /update\(\{ last_sent_at: now\.toISOString\(\)/, "last_sent_at is written only after a confirmed provider send");
  const center = read("components/mail/mail-center.tsx");
  assert.match(center, /<MailboxUse account=\{account\} \/>/); assert.match(center, /window\.confirm\(disconnectQuestion\(account\)\)/);
  assert.match(center, /PROVIDER_PERMISSION_PAGES\.google/);
});

check("GitHub disconnect: confirmed first; says the grant stays at GitHub; links to GitHub's settings; route deletes only local tokens", () => {
  assert.match(github.GITHUB_DISCONNECT_CONFIRM, /stays authorized there until you revoke it in your GitHub settings/);
  assert.match(github.GITHUB_DISCONNECTED, /stays authorized in GitHub until you revoke it there/);
  assert.equal(github.GITHUB_AUTHORIZATIONS_URL, "https://github.com/settings/apps/authorizations");
  assert.equal(github.GITHUB_INSTALLATIONS_URL, "https://github.com/settings/installations");
  const component = read("components/website-github.tsx");
  assert.match(component, /if\(action==="disconnect"&&!window\.confirm\(GITHUB_DISCONNECT_CONFIRM\)\)return;/);
  assert.match(component, /href=\{GITHUB_AUTHORIZATIONS_URL\}/); assert.match(component, /href=\{GITHUB_INSTALLATIONS_URL\}/);
  assert.doesNotMatch(component, /Your repository and exported code stay in GitHub\."/);
  const route = read("app/api/github/connection/route.ts");
  const remove = route.slice(route.indexOf("export async function DELETE"));
  assert.match(remove, /from\("github_connections"\)\.delete\(\)\.eq\("user_id",user\.id\)/);
  assert.doesNotMatch(remove, /fetch\(|api\.github\.com/, "no revocation at GitHub, so the copy must say the grant stays");
});

console.log(`${passed}/4 connection copy checks passed.`);

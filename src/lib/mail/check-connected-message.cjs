/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks: the mailbox "connected" message claims only confirmed capabilities (audit capability states). */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { connectedMessage } = require("./connected-message.ts");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const account = (extra = {}) => ({ id: "a1", provider: "google", email: "owner@example.test", displayName: "Owner", status: "active", lastError: null, mine: true, dailyLimit: 50, lastSyncedAt: null, todayQuota: 20, sentToday: 0, canSend: true, canTrackReplies: true, canAutomate: true, ...extra });
const overview = (accounts, extra = {}) => ({ availability: { google: true, microsoft: true }, automation: true, googleMode: "full", accounts, templates: [], sequences: [], replies: [], ...extra });
const say = (accounts, extra, email = "owner@example.test") => connectedMessage(email, overview(accounts, extra), false);

check("the connection is acknowledged before capabilities are known, and after a failed check", () => {
  assert.equal(connectedMessage("owner@example.test", null, false), "Connected owner@example.test. Checking what it can do…");
  assert.equal(connectedMessage("owner@example.test", null, true), "Connected owner@example.test. We couldn't confirm what it can do yet.");
  for (const text of [connectedMessage("x@example.test", null, false), connectedMessage("x@example.test", null, true)]) assert.doesNotMatch(text, /automat|sequence|track/i);
});

check("send-only Gmail: send reviewed emails, read replies in Gmail; no automation promised", () => {
  const text = say([account({ canTrackReplies: false, canAutomate: false })], { googleMode: "send_only" });
  assert.equal(text, "Connected owner@example.test. You can send reviewed emails; read replies in Gmail and update client stages yourself.");
  assert.doesNotMatch(text, /automat|sequence/i);
});

check("reply tracking does not imply background sending while the schedule is off", () => {
  const off = say([account()], { automation: false });
  assert.match(off, /Until automatic sending is enabled, due follow-ups go out when you press Check now\./);
  const on = say([account({ provider: "microsoft" })], { automation: true });
  assert.equal(on, "Connected owner@example.test. You can send reviewed emails, track replies and run follow-up sequences.");
  assert.match(say([account({ canAutomate: false })]), /follow-up sequences are unavailable for this mailbox/);
});

check("a mailbox that cannot send, is in error, or is not found makes no capability claim", () => {
  assert.match(say([account({ status: "error" })]), /needs reconnecting before it can send/);
  assert.match(say([account({ canSend: false, canTrackReplies: false, canAutomate: false })]), /needs reconnecting/);
  assert.equal(say([account({ mine: false })]), "Connected owner@example.test.", "a teammate's mailbox with the same address is not this connection");
  assert.equal(say([account({ status: "disconnected" })]), "Connected owner@example.test.");
  assert.equal(say([], {}), "Connected owner@example.test.");
  assert.match(say([account()], {}, "  OWNER@Example.test "), /You can send reviewed emails/, "addresses match case-insensitively");
  assert.match(say([account({ status: "error", id: "old" }), account({ id: "new" })]), /You can send reviewed emails/, "an active row wins over a stale one");
});

check("MailCenter uses the helper instead of the unconditional automation claim", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "components", "mail", "mail-center.tsx"), "utf8");
  assert.ok(!source.includes("You can now send and automate emails"), "old copy removed");
  assert.ok(source.includes("connectedMessage(justConnected, overview, loadFailed)") && source.includes("connectedMessage(justConnected, null, true)"));
});

console.log(`\n${passed} connected-mailbox message checks passed.`);

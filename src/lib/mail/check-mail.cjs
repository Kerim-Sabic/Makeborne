/* eslint-disable @typescript-eslint/no-require-imports -- Offline email automation checks. Providers are faked; the database part runs only against the isolated local stack when MAKEBORNE_VERIFY_MAIL_LOCAL=1. */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(src, `${name.slice(2)}.ts`), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
process.env.MAKEBORNE_MAIL_ENCRYPTION_KEY = "ab".repeat(32);
process.env.MAKEBORNE_GOOGLE_MAIL_MODE = "full";
if (process.env.MAKEBORNE_VERIFY_MAIL_LOCAL !== "1") globalThis.fetch = async () => { throw new Error("Network access is forbidden in offline mail checks."); };

const { renderTemplate, mailVariables, buildMime, SequenceStepsSchema, replySubject } = require("./compose.ts");
const { dailyQuota, sendAllowed, MIN_GAP_MS } = require("./throttle.ts");
const { sealSecret, openSecret, signState, verifyState } = require("./config.ts");
const { googleClient, microsoftClient, MailAuthError, MailRejectedError, MailUncertainError } = require("./providers.ts");

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function fakeFetch(routes) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body });
    const route = routes.find(item => (item.method ?? "GET") === (init.method ?? "GET") && item.match.test(url));
    if (!route) throw new Error(`Unexpected request ${init.method ?? "GET"} ${url}`);
    return typeof route.reply === "function" ? route.reply(url, init) : route.reply;
  };
  return { fetcher, calls };
}

(async () => {
  await check("templates fill tokens, honour fallbacks and report anything missing", () => {
    const vars = mailVariables({ name: "Ana Kovač", company: "", website: "https://ana.test" }, { name: "Kerim Sabić" });
    assert.equal(vars.first_name, "Ana"); assert.equal(vars.sender_first_name, "Kerim");
    assert.deepEqual(renderTemplate("Hi {{first_name}}, {{ company | your team }} — {{sender_name}}", vars), { text: "Hi Ana, your team — Kerim Sabić", missing: [] });
    assert.deepEqual(renderTemplate("About {{company}} and {{unknown_token}}", vars).missing.sort(), ["company", "unknown_token"]);
    assert.equal(replySubject("Quick idea"), "Re: Quick idea"); assert.equal(replySubject("RE: Quick idea"), "RE: Quick idea");
  });

  await check("sequences: first email needs a subject, follow-ups wait at least a day, at most 8 steps", () => {
    assert.ok(SequenceStepsSchema.safeParse([{ delayDays: 0, subject: "Hi", body: "One" }, { delayDays: 3, subject: "", body: "Two" }]).success);
    assert.ok(!SequenceStepsSchema.safeParse([{ delayDays: 0, subject: "", body: "One" }]).success);
    assert.ok(!SequenceStepsSchema.safeParse([{ delayDays: 0, subject: "Hi", body: "One" }, { delayDays: 0, subject: "", body: "Two" }]).success);
    assert.ok(!SequenceStepsSchema.safeParse(Array.from({ length: 9 }, (_, i) => ({ delayDays: i ? 1 : 0, subject: "S", body: "B" }))).success);
  });

  await check("MIME: encoded non-ASCII headers, base64 body, reply threading headers, no header injection", () => {
    const raw = Buffer.from(buildMime({ from: "me@studio.test", fromName: "Kerim Sabić", to: "ana@client.test", toName: "Ana", subject: "Ideja za vaš sajt", text: "Zdravo Ana,\nKratko pitanje.", inReplyTo: "<a@b>", references: null }), "base64url").toString("utf8");
    assert.match(raw, /^From: =\?UTF-8\?B\?[^?]+\?= <me@studio\.test>\r\nTo: Ana <ana@client\.test>\r\nSubject: =\?UTF-8\?B\?/);
    assert.match(raw, /In-Reply-To: <a@b>\r\nReferences: <a@b>/);
    const body = raw.split("\r\n\r\n")[1];
    assert.equal(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8"), "Zdravo Ana,\r\nKratko pitanje.");
    const injected = Buffer.from(buildMime({ from: "me@studio.test", to: "ana@client.test", subject: "Hi\r\nBcc: evil@x.test", text: "x" }), "base64url").toString("utf8");
    assert.doesNotMatch(injected, /\r\nBcc:/);
    assert.throws(() => buildMime({ from: "me@studio.test", to: "ana@client.test>\r\nBcc: x@y.z", subject: "Hi", text: "x" }), /Invalid email/);
  });

  await check("warm-up pace: 10/day, then 15, then +5 a day up to the limit; automated sends are spaced", () => {
    const start = new Date("2026-10-01T00:00:00Z"), at = days => new Date(start.getTime() + days * 86_400_000 + 3600_000);
    assert.deepEqual([0, 2, 3, 6, 7, 8, 20, 60].map(day => dailyQuota(start, 50, at(day))), [10, 10, 15, 15, 20, 25, 50, 50]);
    assert.equal(dailyQuota(start, 12, at(30)), 12, "the mailbox limit caps the ramp");
    const now = new Date();
    assert.deepEqual(sendAllowed({ sentToday: 10, quota: 10, lastSentAt: null, now, automated: false }), { ok: false, reason: "daily_limit" });
    assert.deepEqual(sendAllowed({ sentToday: 1, quota: 10, lastSentAt: new Date(now.getTime() - MIN_GAP_MS + 1000), now, automated: true }), { ok: false, reason: "spacing" });
    assert.deepEqual(sendAllowed({ sentToday: 1, quota: 10, lastSentAt: new Date(now.getTime() - 1000), now, automated: false }), { ok: true }, "a person sending by hand isn't spaced");
  });

  await check("tokens are sealed per mailbox; OAuth state is signed, bound and expiring", () => {
    const sealed = sealSecret("refresh-token-value", "acct-1");
    assert.equal(openSecret(sealed, "acct-1"), "refresh-token-value");
    assert.throws(() => openSecret(sealed, "acct-2"), "a token moved to another mailbox cannot be opened");
    const state = signState({ userId: "u", workspaceId: "w", provider: "google", nonce: "n" });
    assert.equal(verifyState(state).workspaceId, "w");
    const [body, signature] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), workspaceId: "other" })).toString("base64url");
    assert.equal(verifyState(`${forged}.${signature}`), null);
    assert.equal(verifyState(state, Date.now() + 11 * 60_000), null, "expires after 10 minutes");
  });

  await check("Gmail: send and thread with local Message-ID, no metadata reads, full-capability reply checks, errors classified", async () => {
    const { fetcher, calls } = fakeFetch([
      { method: "POST", match: /messages\/send$/, reply: () => json(200, { id: "m1", threadId: "t1" }) },
      { match: /threads\/t1\?format=metadata/, reply: json(200, { messages: [
        { id: "m1", internalDate: "1760000000000", snippet: "our email", payload: { headers: [{ name: "From", value: "Me <me@studio.test>" }] } },
        { id: "m2", internalDate: "1760000100000", snippet: "Yes, let's talk", payload: { headers: [{ name: "From", value: "Ana <ana@client.test>" }, { name: "Subject", value: "Re: Idea" }] } }] }) },
    ]);
    const gmail = googleClient(fetcher, { allowRead: true });
    const sent = await gmail.send("token", { from: "me@studio.test", fromName: "Me", to: "ana@client.test", toName: "Ana", subject: "Idea", text: "Hello", replyTo: null });
    assert.equal(sent.providerMessageId, "m1"); assert.equal(sent.threadId, "t1"); assert.match(sent.rfcMessageId, /^<[0-9a-f-]{36}@makeborne\.com>$/);
    const firstRaw = Buffer.from(JSON.parse(calls[0].body).raw, "base64url").toString();
    assert.ok(firstRaw.includes(`Message-ID: ${sent.rfcMessageId}\r\n`));
    await gmail.send("token", { from: "me@studio.test", fromName: "Me", to: "ana@client.test", toName: "Ana", subject: "", text: "Following up", replyTo: { threadId: "t1", rfcMessageId: sent.rfcMessageId, subject: "Idea" } });
    const second = JSON.parse(calls.filter(call => /send$/.test(call.url))[1].body);
    assert.equal(second.threadId, "t1");
    assert.ok(Buffer.from(second.raw, "base64url").toString().includes(`In-Reply-To: ${sent.rfcMessageId}`));
    assert.equal(calls.length, 2, "sending requires no metadata/profile/thread read");
    const replies = await gmail.replies("token", "t1", "me@studio.test");
    assert.deepEqual(replies.map(item => [item.providerMessageId, item.from, item.snippet]), [["m2", "ana@client.test", "Yes, let's talk"]]);
    const fail = status => googleClient(async () => json(status, { error: "x" })).send("t", { from: "me@studio.test", fromName: "", to: "a@b.co", toName: "", subject: "S", text: "x", replyTo: null });
    await assert.rejects(fail(401), MailAuthError); await assert.rejects(fail(400), MailRejectedError); await assert.rejects(fail(503), MailUncertainError);
    await assert.rejects(googleClient(async () => { throw new Error("socket hang up"); }).send("t", { from: "me@studio.test", fromName: "", to: "a@b.co", toName: "", subject: "S", text: "x", replyTo: null }), MailUncertainError, "a dropped connection during send is uncertain, never retried as unsent");
  });

  await check("Outlook: draft then send, threaded reply via the original Internet Message-ID, replies by conversation", async () => {
    const { fetcher, calls } = fakeFetch([
      { method: "POST", match: /\/me\/messages$/, reply: json(201, { id: "d1", conversationId: "c1", internetMessageId: "<d1@outlook>" }) },
      { method: "POST", match: /\/me\/messages\/d1\/send$/, reply: json(202) },
      { match: /internetMessageId%20eq/, reply: json(200, { value: [{ id: "sent1", conversationId: "c1" }] }) },
      { method: "POST", match: /\/me\/messages\/sent1\/createReply$/, reply: json(201, { id: "r1", conversationId: "c1", internetMessageId: "<r1@outlook>" }) },
      { method: "PATCH", match: /\/me\/messages\/r1$/, reply: json(200, {}) },
      { method: "POST", match: /\/me\/messages\/r1\/send$/, reply: json(202) },
      { match: /conversationId%20eq/, reply: json(200, { value: [{ id: "x1", conversationId: "c1", from: { emailAddress: { address: "me@studio.test" } } },
        { id: "x2", conversationId: "c1", subject: "RE: Idea", bodyPreview: "Sounds good", receivedDateTime: "2026-10-13T10:00:00Z", from: { emailAddress: { address: "ana@client.test" } } }] }) },
    ]);
    const outlook = microsoftClient(fetcher, { allowRead: true });
    assert.deepEqual(await outlook.send("token", { from: "me@studio.test", fromName: "Me", to: "ana@client.test", toName: "Ana", subject: "Idea", text: "Hello", replyTo: null }),
      { providerMessageId: "d1", threadId: "c1", rfcMessageId: "<d1@outlook>" });
    const reply = await outlook.send("token", { from: "me@studio.test", fromName: "Me", to: "ana@client.test", toName: "Ana", subject: "", text: "Following up", replyTo: { threadId: "c1", rfcMessageId: "<d1@outlook>", subject: "Idea" } });
    assert.equal(reply.threadId, "c1");
    assert.deepEqual(JSON.parse(calls.find(call => call.method === "PATCH").body), { body: { contentType: "Text", content: "Following up" } });
    assert.deepEqual((await outlook.replies("token", "c1", "me@studio.test")).map(item => [item.providerMessageId, item.from]), [["x2", "ana@client.test"]]);
  });

  await check("Outlook send-only: Mail.Send and identity scopes only, one sendMail call, no drafts or mailbox reads", async () => {
    const { mailCapabilities } = require("./config.ts");
    const { microsoftScopes } = require("./providers.ts");
    const full = new URL(microsoftClient().authUrl({ clientId: "id", redirectUri: "https://app.test/callback", state: "state" }));
    assert.deepEqual(full.searchParams.get("scope").split(" "), ["openid", "email", "profile", "offline_access", "User.Read", "Mail.Send", "Mail.ReadWrite"], "full mode keeps the draft/read scope it uses");
    process.env.MAKEBORNE_MICROSOFT_MAIL_MODE = "send_only";
    try {
      const minimal = ["openid", "email", "profile", "offline_access", "User.Read", "Mail.Send"];
      assert.deepEqual(microsoftScopes(), minimal);
      const { fetcher, calls } = fakeFetch([
        { method: "POST", match: /login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/token$/, reply: () => json(200, { access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: "openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send" }) },
        { method: "POST", match: /\/me\/sendMail$/, reply: () => json(202) },
      ]);
      const outlook = microsoftClient(fetcher, { allowRead: true }); // A stale read-capable client must still respect the server mode.
      const auth = new URL(outlook.authUrl({ clientId: "id", redirectUri: "https://app.test/callback", state: "state" }));
      assert.deepEqual(auth.searchParams.get("scope").split(" "), minimal);
      const tokens = await outlook.exchange({ clientId: "id", clientSecret: "secret", redirectUri: "https://app.test/callback", code: "code" });
      assert.equal(new URLSearchParams(calls[0].body).get("scope"), minimal.join(" "), "the token request asks for the same minimal scopes");
      assert.ok(tokens.grantedScopes.includes("https://graph.microsoft.com/Mail.Send"));
      const sent = await outlook.send(tokens.accessToken, { from: "me@studio.test", fromName: "Me", to: "ana@client.test", toName: "Ana", subject: "", text: "Following up", replyTo: { threadId: "c1", rfcMessageId: "<d1@outlook>", subject: "Idea" } });
      assert.deepEqual(sent, { providerMessageId: null, threadId: null, rfcMessageId: null });
      const mail = JSON.parse(calls.at(-1).body);
      assert.deepEqual(mail, { saveToSentItems: true, message: { subject: "Re: Idea", body: { contentType: "Text", content: "Following up" }, toRecipients: [{ emailAddress: { address: "ana@client.test", name: "Ana" } }] } });
      const before = calls.length;
      await assert.rejects(outlook.replies(tokens.accessToken, "c1", "me@studio.test"), /unavailable/);
      assert.equal(calls.length, before, "no conversation read");
      assert.ok(calls.every(call => /\/token$|\/me\/sendMail$/.test(call.url)), "no draft, no message search, no mailbox read");
      const sendOnly = ["openid", "https://graph.microsoft.com/Mail.Send"], both = ["Mail.Send", "Mail.ReadWrite"];
      assert.deepEqual(mailCapabilities({ provider: "microsoft", granted_scopes: sendOnly }), { canSend: true, canTrackReplies: false, canAutomate: false });
      assert.deepEqual(mailCapabilities({ provider: "microsoft", granted_scopes: both }), { canSend: true, canTrackReplies: false, canAutomate: false }, "send-only mode never tracks, whatever was granted");
      assert.deepEqual(mailCapabilities({ provider: "microsoft", granted_scopes: [] }), { canSend: true, canTrackReplies: false, canAutomate: false }, "legacy connection in send-only mode");
      const refused = microsoftClient(async () => json(200, { access_token: "a", refresh_token: "r", expires_in: 3600, scope: "openid User.Read" }));
      await assert.rejects(refused.exchange({ clientId: "id", clientSecret: "secret", redirectUri: "https://app.test/callback", code: "code" }), /permission to send/);
      const unstated = microsoftClient(async () => json(200, { access_token: "a", refresh_token: "r", expires_in: 3600 }));
      await assert.rejects(unstated.exchange({ clientId: "id", clientSecret: "secret", redirectUri: "https://app.test/callback", code: "code" }), /permission to send/, "an unstated grant fails closed");
    } finally { delete process.env.MAKEBORNE_MICROSOFT_MAIL_MODE; }
    assert.deepEqual(mailCapabilities({ provider: "microsoft", granted_scopes: ["Mail.Send"] }), { canSend: true, canTrackReplies: false, canAutomate: false }, "full mode without the read/write grant is send-only");
    assert.deepEqual(mailCapabilities({ provider: "microsoft", granted_scopes: ["https://graph.microsoft.com/Mail.Send", "https://graph.microsoft.com/Mail.ReadWrite"] }), { canSend: true, canTrackReplies: true, canAutomate: true });
    assert.deepEqual(mailCapabilities({ provider: "microsoft", granted_scopes: ["Mail.ReadWrite"] }), { canSend: false, canTrackReplies: false, canAutomate: false });
    assert.deepEqual(mailCapabilities({ provider: "microsoft", granted_scopes: [] }), { canSend: true, canTrackReplies: true, canAutomate: true }, "legacy connections keep what they were granted until the next refresh records it");
    process.env.MAKEBORNE_MICROSOFT_MAIL_MODE = "nonsense";
    try { assert.deepEqual(microsoftScopes(), ["openid", "email", "profile", "offline_access", "User.Read", "Mail.Send"], "unknown mode fails closed to send-only"); }
    finally { delete process.env.MAKEBORNE_MICROSOFT_MAIL_MODE; }
  });

  await check("Gmail send-only: minimal scopes, verified OpenID identity, local Message-ID and zero inbox-read requests", async () => {
    const { GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE, mailCapabilities } = require("./config.ts");
    process.env.MAKEBORNE_GOOGLE_MAIL_MODE = "send_only";
    try {
      const { fetcher, calls } = fakeFetch([
        { method: "POST", match: /oauth2\.googleapis\.com\/token$/, reply: () => json(200, { access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: `openid email profile ${GMAIL_SEND_SCOPE} ${GMAIL_SEND_SCOPE}` }) },
        { match: /openidconnect\.googleapis\.com\/v1\/userinfo$/, reply: () => json(200, { email: "owner@example.test", email_verified: true, name: "Owner" }) },
        { method: "POST", match: /messages\/send$/, reply: () => json(200, { id: "sent", threadId: "thread" }) },
      ]);
      const gmail = googleClient(fetcher, { allowRead: true }); // Even a stale read-capable client must respect the server mode.
      const auth = new URL(gmail.authUrl({ clientId: "id", redirectUri: "https://app.test/callback", state: "state" }));
      assert.deepEqual(auth.searchParams.get("scope").split(" "), ["openid", "email", "profile", GMAIL_SEND_SCOPE]);
      assert.equal(auth.searchParams.get("include_granted_scopes"), "false");
      const tokens = await gmail.exchange({ clientId: "id", clientSecret: "secret", redirectUri: "https://app.test/callback", code: "code" });
      assert.deepEqual(tokens.grantedScopes, ["openid", "email", "profile", GMAIL_SEND_SCOPE]);
      assert.deepEqual(await gmail.profile(tokens.accessToken), { email: "owner@example.test", name: "Owner" });
      const sent = await gmail.send(tokens.accessToken, { from: "owner@example.test", fromName: "Owner", to: "client@example.test", toName: "Client", subject: "Hello", text: "Hi" });
      assert.ok(Buffer.from(JSON.parse(calls.at(-1).body).raw, "base64url").toString().includes(`Message-ID: ${sent.rfcMessageId}`));
      const before = calls.length;
      await assert.rejects(gmail.replies(tokens.accessToken, "thread", "owner@example.test"), /unavailable/);
      assert.equal(calls.length, before, "no thread request even when allowRead was true");
      assert.ok(calls.every(call => /\/token$|\/userinfo$|\/messages\/send$/.test(call.url)), "no Gmail profile, sent metadata or inbox reads");
      assert.deepEqual(mailCapabilities({ provider: "google", granted_scopes: [GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE] }), { canSend: true, canTrackReplies: false, canAutomate: false });
    } finally { process.env.MAKEBORNE_GOOGLE_MAIL_MODE = "full"; }
  });

  await check("Gmail grants and verified identity fail closed; omitted refresh scope preserves the caller's recorded grant", async () => {
    const { GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE, parseGrantedScopes, mailCapabilities } = require("./config.ts");
    const input = { clientId: "id", clientSecret: "secret", redirectUri: "https://app.test/callback", code: "code" };
    for (const scope of [undefined, GMAIL_READ_SCOPE, "openid", "bad+scope", Array(33).fill(0).map((_, index) => `scope${index}`).join(" ")]) {
      const gmail = googleClient(async () => json(200, { access_token: "access", refresh_token: "refresh", expires_in: 3600, scope }));
      await assert.rejects(gmail.exchange(input));
    }
    for (const profile of [{ email: "owner@example.test" }, { email: "owner@example.test", email_verified: false }, { email: "owner@example.test", email_verified: "true" }, { email: "invalid", email_verified: true }])
      await assert.rejects(googleClient(async () => json(200, profile)).profile("token"), /verified email/);
    const refreshed = await googleClient(async () => json(200, { access_token: "new", expires_in: 3600 })).refresh({ clientId: "id", clientSecret: "secret", refreshToken: "refresh" });
    assert.equal(refreshed.grantedScopes, undefined);
    assert.deepEqual(parseGrantedScopes(`openid\t${GMAIL_SEND_SCOPE} openid`), ["openid", GMAIL_SEND_SCOPE]);
    assert.throws(() => parseGrantedScopes("a".repeat(201)));
    assert.deepEqual(mailCapabilities({ provider: "google", granted_scopes: [] }), { canSend: false, canTrackReplies: false, canAutomate: false });
    assert.deepEqual(mailCapabilities({ provider: "google", granted_scopes: [GMAIL_SEND_SCOPE] }), { canSend: true, canTrackReplies: false, canAutomate: false });
    assert.equal(mailCapabilities({ provider: "microsoft" }).canAutomate, true);
    const auth = new URL(googleClient().authUrl({ clientId: "id", redirectUri: "https://app.test/callback", state: "state" }));
    assert.ok(auth.searchParams.get("scope").split(" ").includes(GMAIL_READ_SCOPE), "full mode still requests read scope");
  });

  await check("AI email drafts parse into subject, body and research notes (also with markdown or no blank line)", () => {
    const { parseEmailDraft, visibleDraft } = require("../../components/mail/ai-draft.ts");
    assert.deepEqual(parseEmailDraft("Subject: Your booking page\n\nHi Lejla,\nQuick idea.\n\nKerim"), { subject: "Your booking page", body: "Hi Lejla,\nQuick idea.\n\nKerim", notes: null });
    assert.deepEqual(parseEmailDraft("**Subject:** \"Idea for Green Bikes\"\nHi Lejla").subject, "Idea for Green Bikes");
    assert.deepEqual(parseEmailDraft("Hi Lejla, no subject here."), { subject: "", body: "Hi Lejla, no subject here.", notes: null });
    const full = "Subject: Your 48k plant parents\n\nHey Maya,\nBody.\n\nKerim\n---NOTES---\nNiche: Indoor plant care\nAudience: 48K followers, beginners\nAngle: Paid care guide\nConfidence: High\nCheck: none";
    const parsed = parseEmailDraft(full);
    assert.equal(parsed.body, "Hey Maya,\nBody.\n\nKerim");
    assert.deepEqual(parsed.notes, { niche: "Indoor plant care", audience: "48K followers, beginners", angle: "Paid care guide", confidence: "high", check: "" });
    assert.equal(visibleDraft(full), "Subject: Your 48k plant parents\n\nHey Maya,\nBody.\n\nKerim", "notes are hidden while streaming");
  });

  await check("research only reads public web pages: private, local, odd ports, credentials and redirects to private hosts are refused", async () => {
    const { assertPublicUrl, readPublicPage, publicAddress } = require("./research.ts");
    const resolve = async host => [{ address: { "creator.test": "93.184.216.34", "evil.test": "10.0.0.5", "rebind.test": "169.254.169.254" }[host] ?? "93.184.216.35", family: 4 }];
    for (const bad of ["http://127.0.0.1/", "http://localhost/x", "http://evil.test/", "http://rebind.test/latest/meta-data", "file:///etc/passwd", "http://user:pw@creator.test/", "http://creator.test:8080/", "http://[::1]/", "http://192.168.1.4/"])
      await assert.rejects(assertPublicUrl(bad, resolve), undefined, bad);
    await assertPublicUrl("https://creator.test/@maya", resolve);
    assert.ok(publicAddress("8.8.8.8") && !publicAddress("100.64.0.1") && !publicAddress("::ffff:10.0.0.1") && !publicAddress("fd00::1"));
    for (const privateIp of ["0:0:0:0:0:0:0:1", "::127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:0:4136:e378:8000:63bf:3fff:fdd2"])
      assert.equal(publicAddress(privateIp), false, privateIp);
    const redirecting = async url => url.includes("creator.test") ? new Response(null, { status: 302, headers: { location: "http://evil.test/admin" } }) : new Response("<html></html>", { headers: { "content-type": "text/html" } });
    await assert.rejects(readPublicPage("https://creator.test/", { fetcher: redirecting, resolve }), /Private addresses/);
    const huge = async () => new Response("<title>Big</title>" + "x".repeat(2_000_000), { headers: { "content-type": "text/html" } });
    assert.equal((await readPublicPage("https://creator.test/", { fetcher: huge, resolve })).title, "Big", "large pages are cut at 600 KB, not loaded whole");
  });

  await check("research pins vetted DNS answers to the native socket and revalidates each redirect without a second lookup", async () => {
    const https = require("node:https"), { EventEmitter } = require("node:events"), { Readable } = require("node:stream");
    const { readPublicPage, pinnedPageFetch } = require("./research.ts");
    const original = https.request, requests = [], dnsCalls = [];
    const resolve = async host => {
      dnsCalls.push(host);
      // A second resolution of the first host would rebind to loopback.
      return [{ address: dnsCalls.filter(value => value === host).length > 1 ? "127.0.0.1" : host === "creator.test" ? "93.184.216.34" : "93.184.216.35", family: 4 }];
    };
    https.request = (url, options, receive) => {
      requests.push({ url, options });
      assert.equal(options.agent, false, "never reuse a socket from a different validation");
      assert.ok(options.signal instanceof AbortSignal);
      const expected = url.hostname === "creator.test" ? "93.184.216.34" : "93.184.216.35";
      options.lookup(url.hostname, {}, (error, address, family) => {
        assert.equal(error, null); assert.equal(address, expected); assert.equal(family, 4);
      });
      options.lookup(url.hostname, { all: true }, (error, addresses) => {
        assert.equal(error, null); assert.deepEqual(addresses, [{ address: expected, family: 4 }]);
      });
      const request = new EventEmitter();
      request.end = () => {
        const redirect = url.hostname === "creator.test";
        const response = Readable.from(redirect ? [] : [Buffer.from("<title>Pinned public page</title>" + "x".repeat(700_000) + "TAIL-MUST-BE-CUT")]);
        response.statusCode = redirect ? 302 : 200;
        response.headers = redirect ? { location: "https://next.test/profile" } : { "content-type": "text/html" };
        receive(response);
      };
      return request;
    };
    try {
      const facts = await readPublicPage("https://creator.test/profile", { resolve });
      assert.equal(facts.title, "Pinned public page");
      assert.deepEqual(dnsCalls, ["creator.test", "next.test"]);
      assert.deepEqual(requests.map(item => item.url.hostname), ["creator.test", "next.test"], "original host retained for Host and TLS identity");
      const response = await pinnedPageFetch("https://next.test/profile", { signal: AbortSignal.timeout(6000) }, [{ address: "93.184.216.35", family: 4 }]);
      assert.equal((await response.arrayBuffer()).byteLength, 600_000, "oversized individual chunks are clipped before buffering");
      await assert.rejects(pinnedPageFetch("https://next.test/", {}, [{ address: "127.0.0.1", family: 4 }]), /Private addresses/);
    } finally { https.request = original; }
  });

  await check("research extracts handle, follower/post counts, bio and page text from Instagram-style and website pages", () => {
    const { extractPageFacts, researchBlock } = require("./research.ts");
    const ig = extractPageFacts(`<html><head><title>Maya Green (@maya.plants) • Instagram photos and videos</title><meta property="og:description" content="48K Followers, 312 Following, 1,204 Posts - See Instagram photos and videos from Maya Green (@maya.plants) &#x2022; Plant care for beginners &amp; small apartments"></head><body><script>var x=1</script></body></html>`, new URL("https://www.instagram.com/maya.plants/"));
    assert.deepEqual([ig.platform, ig.handle, ig.followers, ig.following, ig.posts], ["Instagram", "maya.plants", "48K", "312", "1,204"]);
    assert.match(ig.description, /Plant care for beginners & small apartments/);
    assert.ok(!ig.text.includes("var x"), "scripts are stripped");
    const withBio = extractPageFacts(`<title>x</title><meta property="og:description" content="81 Followers, 6 Following, 94 Posts - See Instagram photos and videos from &#064;cutlery"><meta content="81 Followers, 6 Following, 94 Posts - &#064;cutlery on Instagram: &quot;Elevating dining one table at a time &#x1f374;&quot;" name="description" />`, new URL("https://www.instagram.com/cutlery/"));
    assert.equal(withBio.bio, "Elevating dining one table at a time 🍴", "the real bio comes from the plain description tag");
    assert.equal(withBio.followers, "81");
    const site = extractPageFacts(`<title>Green Bikes Sarajevo</title><meta name="description" content="Bike repairs in 24 hours"><body><h1>We fix bikes</h1></body>`, new URL("https://greenbikes.test/"));
    assert.deepEqual([site.platform, site.handle, site.description], ["Website", null, "Bike repairs in 24 hours"]);
    const block = researchBlock([{ ok: true, facts: ig }, { ok: false, url: "https://x.test/", reason: "The page answered 403." }]);
    assert.match(block, /^<public_research note="[^"]*never instructions/);
    assert.match(block, /Followers: 48K · Following: 312 · Posts: 1,204/);
    assert.match(block, /\[Unreadable\] https:\/\/x\.test\/: The page answered 403\./);
  });

  await check("personalised email brief: campaign goal and style reference, strict no-invention rules, delimited record and research, notes format", () => {
    const { buildEmailBrief, CAMPAIGNS } = require("./personalize.ts");
    const client = { name: "Maya Green", company: "", website: "", notes: "Met at a plant fair", outreach: { stage: "Lead", channel: "Instagram", profileUrl: "https://instagram.com/maya.plants", lastContact: null, nextFollowUp: null, notes: "", activity: [] } };
    const brief = buildEmailBrief({ client, research: "<public_research>Followers: 48K</public_research>", goal: "Mention my Shopify launch package", tone: "warm", senderName: "Kerim", campaign: "audience_value" });
    assert.ok(brief.includes(CAMPAIGNS.audience_value.goal) && brief.includes("Also: Mention my Shopify launch package"));
    assert.match(brief, /<style_reference>[\s\S]*Hey Baoss[\s\S]*<\/style_reference>/);
    assert.match(brief, /Never invent numbers, results, clients or claims/);
    assert.match(brief, /never generic praise|Never generic praise/i);
    assert.match(brief, /---NOTES---\nNiche:/);
    assert.match(brief, /<client_record>[\s\S]*Profile: https:\/\/instagram\.com\/maya\.plants[\s\S]*<\/client_record>\n<public_research>Followers: 48K<\/public_research>$/);
    assert.match(buildEmailBrief({ client, research: "", goal: "", tone: "direct", senderName: "", campaign: "custom" }), /No public pages were linked or readable/);
  });

  await check("bulk personalisation always uses the fast model on the server", () => {
    const route = fs.readFileSync(path.join(src, "app/api/cloud/workspaces/[workspaceId]/clients/[clientId]/follow-up-draft/route.ts"), "utf8");
    assert.match(route, /if \(body\.format === "email"\) \{[\s\S]*?expert: "rex", mode: "standard"/);
    assert.doesNotMatch(fs.readFileSync(path.join(src, "components/mail/personalize-queue.tsx"), "utf8"), /genius/i);
  });

  await require("./mail-engine-offline.cjs")(check);
  if (process.env.MAKEBORNE_VERIFY_MAIL_LOCAL === "1") await require("./mail-engine-local.cjs")(check);
  else console.log("skip engine database checks (set MAKEBORNE_VERIFY_MAIL_LOCAL=1 with the isolated local stack)");
  console.log(`${passed} email automation checks passed (tokens, sequences, MIME, warm-up, sealing, Gmail, Outlook${process.env.MAKEBORNE_VERIFY_MAIL_LOCAL === "1" ? ", engine on the local database" : ""}). No real mailbox or network.`);
})().catch(error => { console.error(error); process.exit(1); });

/* eslint-disable @typescript-eslint/no-require-imports -- Fault injection with in-memory database and provider fakes; no sockets or mailboxes. */
const assert = require("node:assert/strict"), Module = require("node:module"), path = require("node:path");
const engine = require("./engine.ts"), config = require("./config.ts");
const { MailAuthError, MailUncertainError } = require("./providers.ts");
const { apiError } = require("../server/http.ts");
const at = new Date("2026-10-13T12:00:00Z");

function fixture(fault = () => null) {
  const accounts = ["blocked", "healthy"].map(id => ({ id, workspace_id: "workspace", user_id: "owner", provider: "google", granted_scopes: [config.GMAIL_SEND_SCOPE, config.GMAIL_READ_SCOPE], email: `${id}@sender.test`, display_name: "Owner",
    status: "active", daily_limit: 50, warmup_started_at: "2026-01-01T00:00:00Z", last_sent_at: null, last_synced_at: null }));
  const clients = accounts.map(account => ({ id: `client-${account.id}`, workspace_id: "workspace", name: account.id, email: `${account.id}@client.test`, company: "", website: "", outreach: null, updated_at: at.toISOString() }));
  const tables = { crm_suppressions: [], mail_accounts: accounts, clients, mail_messages: [], mail_sequences: [{ id: "sequence", stop_on_reply: true, archived: false, steps: [{ delayDays: 0, subject: "Hello", body: "Hi {{first_name}}" }] }],
    mail_enrollments: accounts.map(account => ({ id: `enrollment-${account.id}`, workspace_id: "workspace", account_id: account.id, client_id: `client-${account.id}`, sequence_id: "sequence", status: "active", next_step: 0, next_send_at: at.toISOString(), created_at: at.toISOString(), created_by: "owner" })) };
  let nextId = 0;
  const queries = [];
  const db = {
    async rpc(name, args) {
      assert.equal(name, "makeborne_mail_token_read");
      return { data: { refresh_token: "stored", access_token: config.sealSecret("token", args.p_account), access_expires_at: "2030-01-01T00:00:00Z" }, error: null };
    },
    from(table) {
      assert.ok(tables[table], table);
      let op = "select", values, single = false, head = false, limit = Infinity;
      const filters = [];
      const queryInfo = { table, fields: "", lowerBounds: [] };
      queries.push(queryInfo);
      const query = {
        select(fields, options) { queryInfo.fields = fields; head = options?.head ?? false; return query; },
        insert(value) { op = "insert"; values = value; return query; },
        update(value) { op = "update"; values = value; return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); return query; },
        gte(key, value) { queryInfo.lowerBounds.push({ key, value }); filters.push(row => row[key] >= value); return query; },
        lte(key, value) { filters.push(row => row[key] <= value); return query; },
        not(key, _op, value) { filters.push(row => row[key] !== value); return query; },
        order() { return query; },
        limit(value) { limit = value; return query; },
        single() { single = true; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            const error = fault({ table, op, values });
            if (error) return { data: null, count: null, error };
            let rows = tables[table].filter(row => filters.every(filter => filter(row))).slice(0, limit);
            if (op === "insert") {
              if (table === "mail_messages" && values.enrollment_id && tables[table].some(row => row.enrollment_id === values.enrollment_id && row.step === values.step))
                return { data: null, error: { code: "23505" } };
              if (table === "mail_messages" && values.provider_message_id && tables[table].some(row => row.account_id === values.account_id && row.provider_message_id === values.provider_message_id))
                return { data: null, error: { code: "23505" } };
              const row = { id: `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`, created_at: at.toISOString(), ...values };
              tables[table].push(row); rows = [row];
            }
            if (op === "update") rows.forEach(row => Object.assign(row, values));
            return { data: head ? null : single ? rows[0] ?? null : rows.map(row => ({ ...row })), count: rows.length, error: null };
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const sent = [];
  const provider = {
    async send(_token, email) { sent.push(email); return { providerMessageId: `provider-${sent.length}`, threadId: `thread-${sent.length}`, rfcMessageId: `<sent-${sent.length}@test>` }; },
    async replies() { return []; },
  };
  return { tables, db, sent, provider, queries, deps: { db, clients: { google: provider }, now: () => at },
    request: { account: accounts[0], client: clients[0], subject: "Hello", text: "Hi", createdBy: "owner", automated: false, enrollmentId: "enrollment-blocked", step: 0 } };
}

async function routeWithMocks(relative, f, extra, run) {
  const file = path.join(__dirname, "..", "..", "app", relative);
  const original = Module._load;
  const mocks = {
    "@/lib/billing/database": { billingDatabase: () => f.db },
    "@/lib/mail/config": { ...config, automationEnabled: () => true },
    "@/lib/server/cron-auth": { authorizedCron: () => true },
    "@/lib/mail/engine": { ...engine, sendEmail: (_deps, request) => engine.sendEmail(f.deps, request), syncReplies: (_deps, options) => engine.syncReplies(f.deps, options), processDueEnrollments: (_deps, options) => engine.processDueEnrollments(f.deps, options) },
    "@/lib/mail/server": { mailContext: async () => ({ db: f.db, user: { id: "owner" } }), ownMailbox: async () => f.tables.mail_accounts[0] },
    "@/lib/cloud/server": { cloudBody: async request => request.json(), validId: value => value, databaseError: error => { if (error) throw error; }, cloudJson: (body, status = 200) => Response.json(body, { status }), cloudError: apiError },
    ...extra,
  };
  Module._load = function(name, parent, main) { return Object.hasOwn(mocks, name) ? mocks[name] : original.call(this, name, parent, main); };
  delete require.cache[file];
  try { return await run(require(file)); }
  finally { Module._load = original; delete require.cache[file]; }
}

module.exports = async function offlineEngineChecks(check) {
  const keys = ["MAKEBORNE_GOOGLE_MAIL_CLIENT_ID", "MAKEBORNE_GOOGLE_MAIL_CLIENT_SECRET", "MAKEBORNE_MICROSOFT_MAIL_CLIENT_ID", "MAKEBORNE_MICROSOFT_MAIL_CLIENT_SECRET"], saved = keys.map(key => process.env[key]);
  keys.forEach(key => { process.env[key] = "offline-fixture"; });
  try {
    await check("do-not-contact is workspace scoped, covers domain descendants and rechecks after token access", async () => {
      const isolated=fixture();isolated.tables.crm_suppressions.push({workspace_id:"other",kind:"email",value:"blocked@client.test"});
      assert.equal((await engine.sendEmail(isolated.deps,isolated.request)).status,"sent");
      const descendant=fixture();descendant.request.client.email="BLOCKED@sub.client.test";descendant.tables.crm_suppressions.push({workspace_id:"workspace",kind:"domain",value:"client.test"});
      assert.equal((await engine.sendEmail(descendant.deps,descendant.request)).status,"failed");assert.equal(descendant.sent.length,0);
      const changed=fixture(),rpc=changed.db.rpc;changed.db.rpc=async(...args)=>{changed.tables.crm_suppressions.push({workspace_id:"workspace",kind:"email",value:"blocked@client.test"});return rpc(...args);};
      assert.equal((await engine.sendEmail(changed.deps,changed.request)).status,"failed");assert.equal(changed.sent.length,0);
      const sequence=fixture();sequence.tables.crm_suppressions.push({workspace_id:"workspace",kind:"domain",value:"client.test"});
      const result=await engine.processDueEnrollments(sequence.deps,{accountIds:["blocked"]});assert.equal(result.sent,0);assert.equal(sequence.tables.mail_enrollments[0].status,"stopped");
    });
    await check("engine do-not-contact blocks manual and sequence sends before provider access", async () => {
      for (const automated of [false,true]) for (const entry of [{kind:"email",value:"blocked@client.test"},{kind:"domain",value:"client.test"}]) {
        const f=fixture();f.tables.crm_suppressions.push({...entry,workspace_id:"workspace"});
        const result=await engine.sendEmail(f.deps,{...f.request,automated});assert.equal(result.status,"failed");assert.match(result.error,/do-not-contact/);assert.equal(f.sent.length,0);assert.equal(f.tables.mail_messages.length,0);
      }
      const f=fixture(({table})=>table==="crm_suppressions"?{message:"unavailable"}:null);
      const result=await engine.sendEmail(f.deps,f.request);assert.equal(result.status,"failed");assert.equal(f.sent.length,0);
    });
    await check("engine offline: provider success then receipt/history failure stays unknown, retains IDs, never resends the claimed step", async () => {
      for (const failAt of ["receipt", "history", "recovery"]) {
        const f = fixture(({ table, op, values }) => {
          if (op !== "update") return null;
          if (failAt === "history" && table === "clients") return { message: "private database detail" };
          if (failAt !== "history" && table === "mail_messages" && values.status === "sent") return { message: "private database detail" };
          if (failAt === "recovery" && table === "mail_messages" && values.status === "unknown") throw new Error("storage unreachable");
          return null;
        });
        const result = await engine.sendEmail(f.deps, f.request);
        assert.equal(result.status, "unknown", failAt); assert.match(result.error, /Do not resend/); assert.doesNotMatch(result.error, /private database detail|storage unreachable/);
        if (failAt !== "recovery") {
          const receipt = f.tables.mail_messages[0];
          assert.equal(receipt.status, "unknown"); assert.equal(receipt.provider_message_id, "provider-1"); assert.equal(receipt.thread_id, "thread-1"); assert.equal(receipt.rfc_message_id, "<sent-1@test>");
        }
        assert.deepEqual(await engine.sendEmail(f.deps, f.request), { status: "skipped", reason: "claimed" });
        assert.equal(f.sent.length, 1);
      }
    });
    await check("engine offline: uncertain provider outcome survives a second storage failure and pauses the sequence", async () => {
      const f = fixture(({ table, op, values }) => { if (table === "mail_messages" && op === "update" && values.status === "unknown") throw new Error("storage unreachable"); });
      f.provider.send = async () => { throw new MailUncertainError("Provider connection dropped; this email may have been sent."); };
      const result = await engine.processDueEnrollments(f.deps, { accountIds: ["blocked"] });
      assert.equal(result.paused, 1); assert.equal(f.tables.mail_enrollments[0].status, "paused");
      assert.match(f.tables.mail_enrollments[0].last_error, /Check your Sent folder/);
      assert.equal((await engine.processDueEnrollments(f.deps, { accountIds: ["blocked"] })).sent, 0);
    });
    await check("client send route returns SEND_UNCERTAIN with Sent-folder guidance after provider success and storage failure", async () => {
      const f = fixture(({ table, op, values }) => table === "mail_messages" && op === "update" && values.status === "sent" ? { message: "private detail" } : null);
      await routeWithMocks("api/cloud/workspaces/[workspaceId]/clients/[clientId]/mail/route.ts", f, {}, async route => {
        const response = await route.POST(new Request("https://app.test/mail", { method: "POST", body: JSON.stringify({ accountId: "blocked", subject: "Hello", body: "Hi", reply: false }) }), { params: Promise.resolve({ workspaceId: "workspace", clientId: "client-blocked" }) });
        const body = await response.json();
        assert.equal(response.status, 502); assert.equal(body.error.code, "SEND_UNCERTAIN"); assert.match(body.error.message, /Sent folder/); assert.match(body.error.message, /Do not resend/);
        assert.equal(f.sent.length, 1);
      });
    });
    await check("cron and manual Check-now execute reply checks first and skip only mailboxes whose check failed", async () => {
      for (const manual of [false, true]) {
        const f = fixture();
        f.tables.mail_messages.push({ id: "prior", account_id: "blocked", client_id: "client-blocked", workspace_id: "workspace", direction: "out", status: "sent", sent_at: at.toISOString(), created_at: at.toISOString(), thread_id: "existing-thread" });
        f.provider.replies = async () => { throw new MailAuthError("Read permission denied"); };
        const relative = manual ? "api/cloud/workspaces/[workspaceId]/mail/run/route.ts" : "api/cron/mail/route.ts";
        await routeWithMocks(relative, f, {}, async route => {
          const response = manual ? await route.POST(new Request("https://app.test/run", { method: "POST", body: "{}" }), { params: Promise.resolve({ workspaceId: "workspace" }) })
            : await route.GET(new Request("https://app.test/cron"));
          assert.equal(response.status, 200);
          const body = await response.json();
          assert.equal(manual ? body.sent : body.sends.sent, 1);
          assert.equal(manual ? body.waiting : body.sends.skipped, 1);
          assert.equal(manual ? body.replyCheckErrors : body.replies.errors, 1);
          assert.deepEqual(f.sent.map(email => email.from), ["healthy@sender.test"]);
          assert.equal(f.tables.mail_enrollments[0].status, "active", "blocked mailbox waits for the next successful sync");
          assert.equal(f.tables.mail_enrollments[1].status, "completed");
        });
      }
    });
    await check("reply sync retries a stored reply after stop/history failures without duplicating history or stopping later enrollments", async () => {
      for (const failAt of ["stop", "history"]) {
        let failures = 0;
        const f = fixture(({ table, op, values }) => {
          if (op === "update" && ((failAt === "stop" && table === "mail_enrollments" && values.status === "replied") || (failAt === "history" && table === "clients")) && failures++ === 0)
            return { message: "injected storage interruption" };
          return null;
        });
        f.tables.mail_messages.push({ id: "prior", account_id: "blocked", client_id: "client-blocked", workspace_id: "workspace", direction: "out", status: "sent", sent_at: at.toISOString(), created_at: at.toISOString(), thread_id: "existing-thread" });
        f.provider.replies = async () => [{ providerMessageId: "incoming", threadId: "existing-thread", from: "blocked@client.test", subject: "Re: Hello", snippet: "Please stop", receivedAt: at }];
        const first = await engine.syncReplies(f.deps);
        assert.deepEqual(first.failedAccountIds, ["blocked"]); assert.equal(first.replies, 1);
        const second = await engine.syncReplies(f.deps);
        assert.equal(second.errors, 0); assert.equal(second.replies, 0, "stored reply is not inserted twice");
        assert.equal(f.tables.mail_enrollments[0].status, "replied");
        assert.equal(f.tables.clients[0].outreach.activity.length, 1); assert.equal(f.tables.clients[0].outreach.stage, "Conversation");
        await engine.syncReplies(f.deps);
        assert.equal(f.tables.clients[0].outreach.activity.length, 1, "history replay is idempotent");
        f.tables.mail_enrollments[0].status = "active";
        f.tables.mail_enrollments[0].created_at = "2026-10-13T12:01:00Z";
        await engine.syncReplies(f.deps);
        assert.equal(f.tables.mail_enrollments[0].status, "active", "an old reply cannot stop an enrollment started afterwards");
      }
    });
    await check("truncated reply checks fail closed at both message and thread limits without unbounded requests", async () => {
      for (const [messageCount, distinctThreads, expectedCalls] of [[61, 61, 60], [201, 1, 1]]) {
        const f = fixture();
        for (let index = 0; index < messageCount; index++) f.tables.mail_messages.push({ id: `prior-${index}`, account_id: "blocked", client_id: "client-blocked", workspace_id: "workspace", direction: "out", status: "sent", sent_at: at.toISOString(), created_at: at.toISOString(), thread_id: `thread-${index % distinctThreads}` });
        let calls = 0;
        f.provider.replies = async () => { calls++; return []; };
        const replies = await engine.syncReplies(f.deps);
        assert.deepEqual(replies.failedAccountIds, ["blocked"]); assert.equal(calls, expectedCalls); assert.equal(f.tables.mail_accounts[0].last_synced_at, null);
        const sends = await engine.processDueEnrollments(f.deps, { failedReplySyncSet: new Set(replies.failedAccountIds) });
        assert.equal(sends.sent, 1); assert.deepEqual(f.sent.map(email => email.from), ["healthy@sender.test"]);
      }
    });
    await check("reply sync inspects a 61-day-old thread and stops its due enrollment without a date cutoff", async () => {
      const f = fixture(), old = new Date(at.getTime() - 61 * 86_400_000).toISOString();
      f.tables.mail_enrollments[0].created_at = old;
      f.tables.mail_messages.push({ id: "old-sent", account_id: "blocked", client_id: "client-blocked", workspace_id: "workspace", direction: "out", status: "sent", sent_at: old, created_at: old, thread_id: "old-thread" });
      const inspected = [];
      f.provider.replies = async (_token, threadId) => {
        inspected.push(threadId);
        return [{ providerMessageId: "late-reply", threadId, from: "blocked@client.test", subject: "Re: Hello", snippet: "Please stop", receivedAt: at }];
      };
      const replies = await engine.syncReplies(f.deps);
      assert.equal(replies.errors, 0); assert.equal(replies.replies, 1); assert.deepEqual(inspected, ["old-thread"]);
      const threadQueries = f.queries.filter(query => query.table === "mail_messages" && query.fields === "thread_id,client_id,workspace_id");
      assert.equal(threadQueries.length, 2); assert.ok(threadQueries.every(query => query.lowerBounds.length === 0), "thread lookup has no sent/created date lower bound");
      assert.equal(f.tables.mail_enrollments[0].status, "replied");
      const sends = await engine.processDueEnrollments(f.deps, { failedReplySyncSet: new Set(replies.failedAccountIds) });
      assert.equal(sends.sent, 1); assert.deepEqual(f.sent.map(email => email.from), ["healthy@sender.test"]);
    });
    await check("send-only engine permits manual Gmail sends, skips reads without auth errors, pauses Gmail sequences and preserves Outlook automation", async () => {
      process.env.MAKEBORNE_GOOGLE_MAIL_MODE = "send_only";
      try {
        const f = fixture();
        f.tables.mail_accounts[1].provider = "microsoft";
        f.tables.mail_accounts[1].granted_scopes = ["Mail.Send", "Mail.ReadWrite"];
        f.deps.clients.microsoft = f.provider;
        f.tables.mail_messages.push({ id: "prior", account_id: "blocked", client_id: "client-blocked", workspace_id: "workspace", direction: "out", status: "sent", sent_at: at.toISOString(), created_at: at.toISOString(), thread_id: "private-thread" });
        let replyCalls = 0;
        f.provider.replies = async () => { replyCalls++; throw new Error("Gmail read is forbidden"); };
        const replies = await engine.syncReplies(f.deps);
        assert.equal(replyCalls, 0); assert.equal(replies.errors, 0); assert.deepEqual(replies.unavailableAccountIds, ["blocked"]);
        assert.equal(f.tables.mail_accounts[0].status, "active", "lack of read capability is not an expired connection");
        const manual = await engine.sendEmail(f.deps, { ...f.request, enrollmentId: undefined, step: undefined });
        assert.equal(manual.status, "sent"); assert.equal(f.sent.length, 1);
        const directAuto = await engine.sendEmail(f.deps, { ...f.request, automated: true });
        assert.equal(directAuto.status, "failed"); assert.match(directAuto.error, /manual sending only/); assert.equal(f.sent.length, 1);
        const automatic = await engine.processDueEnrollments(f.deps);
        assert.equal(automatic.paused, 1); assert.equal(automatic.sent, 1);
        assert.equal(f.tables.mail_enrollments[0].status, "paused"); assert.equal(f.tables.mail_enrollments[1].status, "completed");
        assert.deepEqual(f.sent.map(item => item.from), ["blocked@sender.test", "healthy@sender.test"]);
      } finally { process.env.MAKEBORNE_GOOGLE_MAIL_MODE = "full"; }
    });
    await check("enrollment and resume routes refuse send-only or unconfirmed Gmail while pause/stop remain available", async () => {
      for (const variant of ["send_only", "missing_read", "legacy"]) {
        const f = fixture();
        process.env.MAKEBORNE_GOOGLE_MAIL_MODE = variant === "send_only" ? "send_only" : "full";
        if (variant === "missing_read") f.tables.mail_accounts[0].granted_scopes = [config.GMAIL_SEND_SCOPE];
        if (variant === "legacy") f.tables.mail_accounts[0].granted_scopes = [];
        try {
          await routeWithMocks("api/cloud/workspaces/[workspaceId]/mail/enrollments/route.ts", f, {}, async route => {
            const context = { params: Promise.resolve({ workspaceId: "workspace" }) };
            const post = await route.POST(new Request("https://app.test/enroll", { method: "POST", body: JSON.stringify({ accountId: "blocked", sequenceId: "sequence", clientIds: ["client-blocked"] }) }), context);
            assert.equal(post.status, 409); assert.equal((await post.json()).error.code, "MAIL_AUTOMATION_UNAVAILABLE");
            f.tables.mail_enrollments[0].status = "paused";
            const resume = await route.PATCH(new Request("https://app.test/enroll", { method: "PATCH", body: JSON.stringify({ id: "enrollment-blocked", action: "resume" }) }), context);
            assert.equal(resume.status, 409); assert.equal(f.tables.mail_enrollments[0].status, "paused");
            const stop = await route.PATCH(new Request("https://app.test/enroll", { method: "PATCH", body: JSON.stringify({ id: "enrollment-blocked", action: "stop" }) }), context);
            assert.equal(stop.status, 200); assert.equal(f.tables.mail_enrollments[0].status, "stopped");
          });
          if (variant === "legacy") { assert.equal((await engine.sendEmail(f.deps, f.request)).status, "auth"); assert.equal(f.sent.length, 0); }
        } finally { process.env.MAKEBORNE_GOOGLE_MAIL_MODE = "full"; }
      }
    });
    await check("send-only Check-now returns a manual notice and makes no read or send provider calls", async () => {
      process.env.MAKEBORNE_GOOGLE_MAIL_MODE = "send_only";
      try {
        const f = fixture();
        f.provider.replies = f.provider.send = async () => { throw new Error("No provider call is allowed from send-only Check-now"); };
        await routeWithMocks("api/cloud/workspaces/[workspaceId]/mail/run/route.ts", f, {}, async route => {
          const response = await route.POST(new Request("https://app.test/run", { method: "POST", body: "{}" }), { params: Promise.resolve({ workspaceId: "workspace" }) });
          const result = await response.json();
          assert.equal(response.status, 200); assert.equal(result.sent, 0); assert.equal(result.replyCheckErrors, 0); assert.equal(result.paused, 2); assert.match(result.note, /manual sending only/);
        });
      } finally { process.env.MAKEBORNE_GOOGLE_MAIL_MODE = "full"; }
    });
    await check("Google refresh retains omitted grants and persists reduced grants before deciding whether to send", async () => {
      for (const grantedScopes of [undefined, [config.GMAIL_SEND_SCOPE], []]) {
        const f = fixture(), writes = [];
        f.db.rpc = async (name, args) => {
          if (name === "makeborne_mail_token_write") { writes.push(args); return { error: null }; }
          assert.equal(name, "makeborne_mail_token_read");
          return { data: { refresh_token: config.sealSecret("refresh", args.p_account), access_token: null, access_expires_at: null }, error: null };
        };
        f.provider.refresh = async () => ({ accessToken: "refreshed", expiresAt: new Date(at.getTime() + 3600_000), ...(grantedScopes === undefined ? {} : { grantedScopes }) });
        const result = await engine.sendEmail(f.deps, { ...f.request, automated: true });
        assert.equal(writes.length, 1);
        if (grantedScopes === undefined) {
          assert.equal(result.status, "sent"); assert.deepEqual(f.tables.mail_accounts[0].granted_scopes, [config.GMAIL_SEND_SCOPE, config.GMAIL_READ_SCOPE]);
        } else {
          assert.notEqual(result.status, "sent"); assert.equal(f.sent.length, 0); assert.deepEqual(f.tables.mail_accounts[0].granted_scopes, grantedScopes);
        }
      }
    });
  } finally { keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }); }
};

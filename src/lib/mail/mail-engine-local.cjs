/* eslint-disable @typescript-eslint/no-require-imports -- Engine checks on the isolated local Supabase stack (never production). Loaded by check-mail.cjs when MAKEBORNE_VERIFY_MAIL_LOCAL=1. */
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createClient } = require("@supabase/supabase-js");

module.exports = async function engineChecks(check) {
  const root = path.join(__dirname, "..", "..", "..");
  const stack = JSON.parse(fs.readFileSync(path.join(root, "work/release-auth-stack/status.json"), "utf8").replace(/^﻿/, ""));
  if (stack.API_URL !== "http://127.0.0.1:55435") throw new Error("Refusing to run: not the isolated local stack.");
  const db = createClient(stack.API_URL, stack.SECRET_KEY, { auth: { persistSession: false }, global: { headers: { "x-makeborne-crm-protocol": "2" } } });
  process.env.MAKEBORNE_GOOGLE_MAIL_CLIENT_ID = "local-test-client"; process.env.MAKEBORNE_GOOGLE_MAIL_CLIENT_SECRET = "local-test-secret";
  const { sendEmail, processDueEnrollments, syncReplies, storeTokens, accessToken } = require("./engine.ts");
  // During the CRM transition the database may store the previous vocabulary; the app reads it through this.
  const { normalizeOutreachStage: stageOf } = require("../client-outreach.ts");

  const log = { sent: [], refreshed: 0 };
  let replyScript = [];
  const fakeGoogle = {
    async refresh() { log.refreshed++; return { accessToken: "fresh-access", expiresAt: new Date(Date.now() + 3600_000) }; },
    async send(token, email) { log.sent.push({ token, ...email }); const n = log.sent.length; return { providerMessageId: `gm-${Date.now()}-${n}`, threadId: email.replyTo?.threadId ?? `thread-${n}`, rfcMessageId: `<gm-${n}@test>` }; },
    async replies(_token, threadId) { return replyScript.filter(item => item.threadId === threadId); },
  };
  const { data: workspace } = await db.from("workspaces").select("id,owner_id").eq("owner_id", "825d5207-3137-41c4-8898-a086a331756b").single();
  const created = { clients: [], accounts: [], sequences: [] };
  let clock = new Date();
  const deps = { db, clients: { google: fakeGoogle }, now: () => clock };
  const newClient = async (name, email) => {
    const { data, error } = await db.from("clients").insert({ workspace_id: workspace.id, name, company: "Engine Test Co", email, website: "", notes: "" }).select("*").single();
    if (error) throw error; created.clients.push(data.id); return data;
  };
  try {
    const { data: account, error: accountError } = await db.from("mail_accounts").insert({ workspace_id: workspace.id, user_id: workspace.owner_id, provider: "google",
      email: `engine-${Date.now()}@studio.test`, display_name: "Kerim Test", granted_scopes: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"], warmup_started_at: new Date(Date.now() - 40 * 86_400_000).toISOString() }).select("*").single();
    if (accountError) throw accountError;
    created.accounts.push(account.id);

    await check("engine: expired access tokens refresh once and are stored sealed", async () => {
      await storeTokens({ db }, account.id, "refresh-1", "stale-access", new Date(Date.now() - 1000));
      assert.equal(await accessToken(deps, account), "fresh-access");
      assert.equal(log.refreshed, 1);
      assert.equal(await accessToken(deps, account), "fresh-access", "a valid stored token is reused");
      assert.equal(log.refreshed, 1);
      const { data } = await db.rpc("makeborne_mail_token_read", { p_account: account.id });
      assert.ok(!JSON.stringify(data).includes("fresh-access") && !JSON.stringify(data).includes("refresh-1"), "tokens are never stored in plain text");
    });

    const first = await newClient("Lejla Engine", "lejla.engine@client.test");
    const { data: sequence } = await db.from("mail_sequences").insert({ workspace_id: workspace.id, name: "Engine test", created_by: workspace.owner_id, steps: [
      { delayDays: 0, subject: "Idea for {{company|your team}}", body: "Hi {{first_name}},\nQuick idea.\n{{sender_first_name}}" },
      { delayDays: 2, subject: "", body: "Following up, {{first_name}}." },
      { delayDays: 3, subject: "", body: "Last note." }] }).select("id").single();
    created.sequences.push(sequence.id);
    const { data: enrollment } = await db.from("mail_enrollments").insert({ workspace_id: workspace.id, sequence_id: sequence.id, client_id: first.id, account_id: account.id,
      next_send_at: clock.toISOString(), created_by: workspace.owner_id }).select("id").single();

    await check("engine: a due step sends once, fills tokens, logs the contact in the CRM and schedules the next step", async () => {
      const result = await processDueEnrollments(deps, { accountIds: [account.id] });
      assert.equal(result.sent, 1);
      assert.equal(log.sent.at(-1).subject, "Idea for Engine Test Co");
      assert.equal(log.sent.at(-1).text, "Hi Lejla,\nQuick idea.\nKerim");
      const { data: row } = await db.from("mail_enrollments").select("status,next_step,next_send_at").eq("id", enrollment.id).single();
      assert.deepEqual([row.status, row.next_step], ["active", 1]);
      assert.ok(Math.abs(Date.parse(row.next_send_at) - (clock.getTime() + 2 * 86_400_000)) < 5000);
      const { data: client } = await db.from("clients").select("outreach").eq("id", first.id).single();
      assert.equal(client.outreach.stage, "Contacted"); assert.equal(client.outreach.channel, "Email");
      assert.match(client.outreach.activity.at(-1).text, /^Email sent \(sequence\): Idea for Engine Test Co$/);
      assert.equal((await processDueEnrollments(deps, { accountIds: [account.id] })).sent, 0, "nothing more is due");
    });

    await check("engine: the same sequence step can never be sent twice, even by concurrent workers", async () => {
      const other = await newClient("Concurrent Client", "concurrent@client.test");
      const { data: enr } = await db.from("mail_enrollments").insert({ workspace_id: workspace.id, sequence_id: sequence.id, client_id: other.id, account_id: account.id, status: "paused", created_by: workspace.owner_id }).select("id").single();
      const before = log.sent.length;
      const request = { account: { ...account, status: "active" }, client: other, subject: "Hi", text: "Once", createdBy: null, automated: false, enrollmentId: enr.id, step: 0 };
      const outcomes = await Promise.all([sendEmail(deps, request), sendEmail(deps, request), sendEmail(deps, request)]);
      assert.equal(outcomes.filter(item => item.status === "sent").length, 1);
      assert.equal(outcomes.filter(item => item.status === "skipped" && item.reason === "claimed").length, 2);
      assert.equal(log.sent.length - before, 1);
    });

    await check("engine: a follow-up without a subject replies in the same thread", async () => {
      clock = new Date(clock.getTime() + 2 * 86_400_000 + 60_000);
      const result = await processDueEnrollments(deps, { accountIds: [account.id] });
      assert.equal(result.sent, 1);
      const last = log.sent.at(-1);
      assert.equal(last.text, "Following up, Lejla.");
      assert.equal(last.replyTo.threadId, log.sent.find(item => item.subject === "Idea for Engine Test Co").replyTo?.threadId ?? "thread-1");
      assert.equal(last.replyTo.subject, "Idea for Engine Test Co");
    });

    await check("engine: a reply is recorded once, stops the sequence and moves the client into a conversation", async () => {
      const { data: thread } = await db.from("mail_messages").select("thread_id").eq("enrollment_id", enrollment.id).eq("step", 0).single();
      replyScript = [{ providerMessageId: `reply-${Date.now()}`, threadId: thread.thread_id, from: "lejla.engine@client.test", subject: "Re: Idea", snippet: "Yes, call me Tuesday.", receivedAt: clock }];
      const result = await syncReplies(deps, { accountIds: [account.id] });
      assert.equal(result.replies, 1);
      assert.equal((await syncReplies(deps, { accountIds: [account.id] })).replies, 0, "the same reply is never recorded twice");
      const { data: row } = await db.from("mail_enrollments").select("status").eq("id", enrollment.id).single();
      assert.equal(row.status, "replied");
      const { data: client } = await db.from("clients").select("outreach").eq("id", first.id).single();
      assert.equal(stageOf(client.outreach.stage), "Conversation");
      assert.match(client.outreach.activity.at(-1).text, /Replied by email: Yes, call me Tuesday\./);
      clock = new Date(clock.getTime() + 4 * 86_400_000);
      assert.equal((await processDueEnrollments(deps, { accountIds: [account.id] })).sent, 0, "no more steps after a reply");
    });

    await check("engine: the daily limit holds and clients marked Won are never emailed", async () => {
      // Sends are stamped with the database clock, so count today in real time.
      clock = new Date();
      await db.from("mail_accounts").update({ daily_limit: 1 }).eq("id", account.id);
      const limited = { ...account, daily_limit: 1 };
      const target = await newClient("Limit Client", "limit@client.test");
      const outcome = await sendEmail(deps, { account: limited, client: target, subject: "Hi", text: "x", createdBy: null, automated: false });
      assert.deepEqual(outcome, { status: "skipped", reason: "daily_limit" });
      await db.from("mail_accounts").update({ daily_limit: 50 }).eq("id", account.id);
      const won = await newClient("Won Client", "won@client.test");
      await db.from("clients").update({ outreach: { stage: "Won", channel: "Email", profileUrl: "", lastContact: null, nextFollowUp: null, notes: "", activity: [] } }).eq("id", won.id);
      const { data: wonEnrollment } = await db.from("mail_enrollments").insert({ workspace_id: workspace.id, sequence_id: sequence.id, client_id: won.id, account_id: account.id, next_send_at: clock.toISOString() }).select("id").single();
      clock = new Date(clock.getTime() + 10 * 60_000);
      await processDueEnrollments(deps, { accountIds: [account.id] });
      const { data: row } = await db.from("mail_enrollments").select("status,last_error").eq("id", wonEnrollment.id).single();
      assert.deepEqual([row.status, row.last_error], ["stopped", "Client marked Won."]);
    });
  } finally {
    for (const id of created.accounts) await db.from("mail_accounts").delete().eq("id", id);
    for (const id of created.sequences) await db.from("mail_sequences").delete().eq("id", id);
    for (const id of created.clients) await db.from("clients").delete().eq("id", id);
  }
};

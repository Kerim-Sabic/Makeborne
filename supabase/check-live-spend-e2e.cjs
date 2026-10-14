/* eslint-disable @typescript-eslint/no-require-imports -- Live builder spending end to end. ISOLATED DATABASE ONLY. */
// Runs the real website run module, the real credit server functions and the
// real provider gate against the real SQL in a disposable database. Only the
// AI providers and the artifact save are mocked; nothing paid is called.
// It commits fixtures and temporarily enables provider limits, so it refuses to
// run against `postgres` or a database holding credit, call or limit data.
// Cleanup restores the limits to disabled and deletes its fixtures.
// Run: node supabase/check-live-spend-e2e.cjs postgresql://postgres:postgres@127.0.0.1:55322/makeborne_crm_isolated
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const { Client } = require("pg");
const url = process.argv[2];
if (!url || /\/postgres(\?|$)/.test(url)) { console.error("Refusing to run: pass the URL of a disposable database (not /postgres)."); process.exit(2); }

const src = path.join(__dirname, "..", "src");
let rpc = null;
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith("@/")) request = path.join(src, request.slice(2));
  return resolve.call(this, request, parent, ...rest);
};
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  if (/billing\/database$/.test(name)) return { billingDatabase: () => ({ rpc }) };
  if (/account\/privileges$/.test(name)) return { getAccountPrivileges: async () => ({ isAdmin: false, unlimitedCredits: false }) };
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const resolveTs = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  try { return resolveTs.call(this, request, parent, ...rest); }
  catch (error) { if (!request.endsWith(".ts")) return resolveTs.call(this, `${request}.ts`, parent, ...rest); throw error; }
};

(async () => {
  const db = new Client({ connectionString: url });
  await db.connect();
  const { rows: [guard] } = await db.query(`select current_database() as name,
    (select count(*) from public.credit_ledger)::int as ledger, (select count(*) from makeborne_private.live_provider_calls)::int as calls,
    (select count(*) from makeborne_private.live_provider_limits where enabled or daily_limit_microusd > 0)::int as limits`);
  if (guard.name === "postgres" || guard.ledger || guard.calls || guard.limits) { console.error(`Refusing to run in ${guard.name}: it holds data.`); process.exit(2); }

  rpc = async (name, args = {}) => {
    const keys = Object.keys(args);
    try {
      const values = keys.map(key => args[key] !== null && typeof args[key] === "object" ? JSON.stringify(args[key]) : args[key]);
      return { data: (await db.query(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(", ")}) as result`, values)).rows[0].result, error: null };
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  };
  const credits = require("../src/lib/credits/server.ts");
  const { createRunSpend } = require("../src/lib/ai/live-run.ts");
  const { websiteBuildResponse } = require("../src/lib/builder/website-run.ts");
  const { ProjectFiles } = require("../src/lib/builder/files.ts");

  const user = "33333333-3333-4333-8333-333333333333";
  const app = 'export default function App() { return <main><h1>Updated</h1></main>; }';
  const toolUse = (name, input) => ({ type: "tool_use", id: `tu_${Math.random().toString(36).slice(2, 10)}`, name, input });
  const finishing = () => ({ usage: { input_tokens: 5000, output_tokens: 900 }, content: [toolUse("write_file", { path: "src/App.tsx", content: app }), toolUse("finish", { summary: "Done.", title: "T" })] });
  function fakeAnthropic(steps, delayMs = 0) {
    const log = { streams: 0 };
    return { log, client: { beta: { messages: {
      async countTokens() { return { input_tokens: 5000 }; },
      stream(params) {
        log.streams++;
        const step = steps.shift();
        const stream = { currentMessage: undefined, on() { return stream; },
          async finalMessage() { await new Promise(r => setTimeout(r, delayMs)); const message = { model: params.model, usage: step.usage, content: step.content, stop_reason: "tool_use" }; stream.currentMessage = message; return message; } };
        return stream;
      } } } } };
  }
  function baseFiles() {
    const files = new ProjectFiles();
    files.write("index.html", '<!doctype html><html><head><title>T</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
    files.write("src/main.tsx", 'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\ncreateRoot(document.getElementById("root")!).render(<App />);');
    files.write("src/App.tsx", 'export default function App() { return <main><h1>Hello</h1></main>; }');
    files.write("src/styles.css", "body { margin: 0 }");
    return new ProjectFiles(files.toSource());
  }
  const saves = [];
  const supabase = { async rpc(name, args) { saves.push(args.p_request_key); return { data: { version: { version_number: args.p_expected_version + 1 } }, error: null }; } };
  const run = async (hold, anthropic) => {
    const spend = createRunSpend({ hold, providerCapCredits: 50, platformDeadline: Date.now() + 280_000 });
    const response = websiteBuildResponse({ client: supabase, hold, spend, workspaceId: "22222222-2222-4222-8222-222222222222",
      artifact: { id: "44444444-4444-4444-8444-444444444444", project_id: "55555555-5555-4555-8555-555555555555", title: "T", current_version: 1 },
      current: { assetIds: [], content: { title: "T" }, style: {} }, files: baseFiles(), reviewing: false, message: "Update", effort: "medium",
      request: "Update", context: "<project/>", attachments: [], maxDuration: 300, anthropic });
    const text = await new Response(response.body).text();
    return text.split("\n\n").filter(chunk => chunk.startsWith("data: ")).map(chunk => JSON.parse(chunk.slice(6)));
  };
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const credit = microusd => Math.ceil(microusd / 1e6 / 0.03 - 1e-9);

  try {
    await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`, [user, `${user}@live-e2e.example.invalid`]);
    await db.query(`select public.makeborne_credit_grant($1, 200, 'topup', 'live-e2e-topup', '{}')`, [user]);

    // Fail closed: limits ship disabled, so the run stops before any provider call and nothing is charged.
    let hold = await credits.reserveCredits(user, 50, "e2e-disabled");
    let fake = fakeAnthropic([finishing()]);
    let events = await run(hold, fake.client);
    assert.equal(fake.log.streams, 0);
    assert.match(events.at(-1).message, /paused/);
    assert.equal((await one(`select outcome, charged_credits from makeborne_private.ai_run_outcomes where reference = 'e2e-disabled'`)).outcome, "released");

    for (const scope of ["global", "anthropic", "openai"]) await db.query(`select makeborne_private.set_live_provider_limit($1, true, 2000000, false, 'Live spend e2e fixture')`, [scope]);

    // 1. A normal run: real hold, real gate, settled with the full measured usage.
    hold = await credits.reserveCredits(user, 50, "e2e-ok");
    fake = fakeAnthropic([finishing()]);
    events = await run(hold, fake.client);
    assert.equal(events.at(-1).type, "done", JSON.stringify(events.at(-1)));
    const cost = 5000 * 4 + 900 * 20;
    let outcome = await one(`select * from makeborne_private.ai_run_outcomes where reference = 'e2e-ok'`);
    assert.deepEqual([outcome.outcome, Number(outcome.measured_credits), Number(outcome.charged_credits), Number(outcome.provider_microusd)], ["settled", credit(cost), credit(cost), cost]);
    const call = await one(`select status, actual_microusd, bound_microusd from makeborne_private.live_provider_calls where run_reference = 'e2e-ok'`);
    assert.equal(call.status, "settled"); assert.equal(Number(call.actual_microusd), cost); assert.ok(Number(call.bound_microusd) >= cost);

    // 2. Interrupted build: the process dies after opening a call and holding credits.
    hold = await credits.reserveCredits(user, 40, "e2e-killed");
    const killed = createRunSpend({ hold, providerCapCredits: 50, platformDeadline: Date.now() + 280_000 });
    await killed.begin("anthropic", "claude-opus-5-5", 250_000); // never finished: the process "dies"
    const before = Number((await one(`select public.makeborne_credit_wallet($1) as w`, [user])).w.available);
    await db.query(`update makeborne_private.credit_reservations set created_at = now() - interval '16 minutes' where reference = 'e2e-killed'`);
    await db.query(`update makeborne_private.live_provider_calls set created_at = clock_timestamp() - interval '21 minutes' where run_reference = 'e2e-killed'`);
    await db.query(`select public.makeborne_credit_expire_due(100)`);
    await db.query(`select public.makeborne_provider_calls_expire(100)`);
    assert.equal(Number((await one(`select public.makeborne_credit_wallet($1) as w`, [user])).w.available), before + 40, "timed-out hold returned");
    assert.deepEqual(await one(`select status, charged_microusd::int as charged from makeborne_private.live_provider_calls where run_reference = 'e2e-killed'`), { status: "expired", charged: 250000 });
    const late = await credits.settleRun(hold, 10, {});
    assert.equal(late.outcome, "released_hold"); assert.equal(late.charged, 0);
    assert.equal(Number((await one(`select provider_microusd from makeborne_private.ai_run_outcomes where reference = 'e2e-killed'`)).provider_microusd), 250000);

    // 3. A hold reclaimed while the run was still working: nothing saved or charged.
    hold = await credits.reserveCredits(user, 50, "e2e-expired");
    fake = fakeAnthropic([finishing()]);
    const slow = { client: { beta: { messages: { countTokens: fake.client.beta.messages.countTokens, stream(params, options) {
      const stream = fake.client.beta.messages.stream(params, options);
      const final = stream.finalMessage.bind(stream);
      stream.finalMessage = async () => { await db.query(`update makeborne_private.credit_reservations set created_at = now() - interval '16 minutes' where reference = 'e2e-expired'`); return final(); };
      return stream;
    } } } } };
    const savesBefore = saves.length;
    events = await run(hold, slow.client);
    assert.equal(events.at(-1).code, "HOLD_EXPIRED");
    assert.equal(saves.length, savesBefore);
    outcome = await one(`select outcome, charged_credits, absorbed_credits from makeborne_private.ai_run_outcomes where reference = 'e2e-expired'`);
    assert.deepEqual([outcome.outcome, Number(outcome.charged_credits), Number(outcome.absorbed_credits)], ["released", 0, credit(cost)]);

    // 4. Concurrent runs against a daily limit that fits one call's bound.
    for (const scope of ["global", "anthropic"]) await db.query(`select makeborne_private.set_live_provider_limit($1::text, true, ((select coalesce(sum(charged_microusd),0) from makeborne_private.live_provider_calls) + 400000)::bigint, false, 'Live spend e2e fixture: one call')`, [scope]);
    const holds = await Promise.all(["e2e-c1", "e2e-c2", "e2e-c3"].map(reference => credits.reserveCredits(user, 30, reference)));
    const fakes = holds.map(() => fakeAnthropic([finishing()], 150));
    const results = await Promise.all(holds.map((item, index) => run(item, fakes[index].client)));
    const done = results.filter(list => list.at(-1).type === "done").length;
    assert.equal(done, 1, `exactly one concurrent run admitted (${done})`);
    assert.equal(fakes.reduce((total, item) => total + item.log.streams, 0), 1, "refused runs never reached the provider");
    const day = await one(`select spent_microusd::bigint as spent, reserved_microusd::bigint as reserved, (select daily_limit_microusd from makeborne_private.live_provider_limits where scope='global') as limit from makeborne_private.live_provider_days where scope='global'`);
    assert.ok(Number(day.spent) <= Number(day.limit) && Number(day.reserved) === 0);
    const ledger = await one(`select coalesce(sum(delta),0)::int as sum, (public.makeborne_credit_wallet($1)->>'available')::int as available from public.credit_ledger where user_id = $1`, [user]);
    assert.equal(ledger.sum, ledger.available);
    console.log("PASS end-to-end live spend: disabled gate fails closed; real hold + real gate settle full measured usage; killed run's hold and call recovered by the sweepers and a late settle is refused; a hold reclaimed mid-run saves and charges nothing; concurrent runs admitted only within the daily limit");
  } finally {
    await db.query(`delete from makeborne_private.live_provider_calls; delete from makeborne_private.live_provider_days;
      update makeborne_private.live_provider_limits set enabled = false, emergency_stop = false, daily_limit_microusd = 0, note = null`);
    await db.query(`delete from makeborne_private.ai_run_outcomes where user_id = $1`, [user]);
    await db.query(`delete from auth.users where id = $1`, [user]);
    await db.end();
  }
})().catch(error => { console.error(error); process.exit(1); });

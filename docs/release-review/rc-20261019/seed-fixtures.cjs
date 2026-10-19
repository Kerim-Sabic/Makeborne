/* eslint-disable @typescript-eslint/no-require-imports -- Evidence script: seeds the DISPOSABLE rc stack only. */
// Seeds representative fixtures into the disposable stack makeborne-rc-20261019 through the
// same RPCs the application routes call (create workspace, create studio project, save
// version), as the signed-in owner. Nothing is generated: website/book/deck content is
// reused from the 2026-10-18 golden run (outputs/eval/runs/live-20261018T161405Z), and the
// legacy records reproduce the production shapes the launch audit found (kind, title,
// sections, schemaVersion only).
//
// Entitlement is SIMULATED: a Studio monthly plan observation + payment recorded with the
// service role (the path a verified provider event takes), then reconciled. No provider,
// no payment, no network beyond 127.0.0.1.
//
// Writes: work/rc-stack/fixtures.private.json (passwords, ignored folder) and
// docs/release-review/rc-20261019/fixtures.json (ids only).
// Usage (worktree root): node docs/release-review/rc-20261019/seed-fixtures.cjs
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const ROOT = process.cwd();
const load = Module._load;
Module._load = function (name, parent, main) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) return load.call(this, path.join(ROOT, "src", name.slice(2)), parent, main);
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const { createClient } = require("@supabase/supabase-js");
const { ArtifactContentSchema, StyleProfileSchema } = require(path.join(ROOT, "src/lib/domain.ts"));
const { projectDocument } = require(path.join(ROOT, "src/lib/documents/project.ts"));

const status = JSON.parse(fs.readFileSync("work/rc-stack/status.json", "utf8"));
assert.equal(status.API_URL, "http://127.0.0.1:55481", "Refusing: not the disposable rc stack");
const GOLDEN = path.resolve(ROOT, "../../../outputs/eval/runs/live-20261018T161405Z");
assert(fs.existsSync(GOLDEN), `golden run missing: ${GOLDEN}`);
const admin = createClient(status.API_URL, status.SECRET_KEY, { auth: { persistSession: false } });
const must = (result, what) => { if (result.error) throw new Error(`${what}: ${result.error.code ?? ""} ${result.error.message}`); return result.data; };
const style = StyleProfileSchema.parse({ id: "automatic", name: "Automatic", version: 1, typography: { headingFont: "Inter", bodyFont: "Inter" }, colors: { background: "#ffffff", text: "#1d1b22", accent: "#5b4bd6" }, description: "Fixture style" });
const id = () => crypto.randomUUID();
const block = (type, text) => ({ id: id(), type, text, assetId: null, locked: false, sourceIds: [] });
const section = (title, blocks) => ({ id: id(), title, blocks });

async function user(label) {
  const email = `${label}-${Date.now().toString(36)}@rc.example.invalid`, password = crypto.randomBytes(18).toString("base64url");
  const created = must(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `create ${label}`);
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY, { auth: { persistSession: false } });
  must(await client.auth.signInWithPassword({ email, password }), `sign in ${label}`);
  return { label, id: created.user.id, email, password, client };
}

async function project(owner, workspaceId, kind, title, versions) {
  const content0 = ArtifactContentSchema.parse({ schemaVersion: 1, kind, title, sections: [section(title, [block("heading", title)])] });
  const created = must(await owner.client.rpc("makeborne_create_studio_project", { p_workspace_id: workspaceId, p_request_key: id(),
    p_project: { title, kind, status: "draft", client_id: null, style_id: style.id, brief: `Fixture: ${title}`, audience: "", purpose: "", wording: "preserve", effort: "medium" }, p_content: content0, p_style: style }), `create ${title}`);
  let artifact = created.artifact, number = created.version.version_number;
  for (const [summary, content] of versions) {
    const saved = must(await owner.client.rpc("makeborne_save_artifact_version", { p_workspace_id: workspaceId, p_artifact_id: artifact.id, p_expected_version: number,
      p_content: ArtifactContentSchema.parse(content), p_style: style, p_asset_ids: [], p_change_summary: summary, p_request_key: id() }), `save ${title}`);
    number = saved.version.version_number; artifact = saved.artifact;
  }
  return { title, kind, projectId: created.project.id, artifactId: artifact.id, version: number };
}

(async () => {
  const owner = await user("owner"), client = await user("client"), outsider = await user("outsider");
  // Simulated verified purchase: Studio monthly, current period.
  const start = new Date(Date.now() - 3 * 86400_000), end = new Date(start.getTime() + 30 * 86400_000);
  must(await admin.rpc("makeborne_record_plan_observation", { p_user: owner.id, p_membership: "mem_rcowner", p_whop_plan_id: "plan_rcstudio", p_tier: "studio", p_interval: "monthly", p_monthly_credits: 850, p_status: "active", p_paid: true, p_period_start: start.toISOString(), p_period_end: end.toISOString(), p_source: "webhook" }), "plan observation");
  must(await admin.rpc("makeborne_record_plan_payment", { p_user: owner.id, p_membership: "mem_rcowner", p_payment_id: "pay_rcowner1", p_whop_plan_id: "plan_rcstudio", p_tier: "studio", p_interval: "monthly", p_monthly_credits: 850, p_billing_reason: "subscription_create", p_paid_at: start.toISOString(), p_refunded: false }), "plan payment");
  const reconciled = must(await admin.rpc("makeborne_reconcile_plan_credits", { p_limit: 10 }), "reconcile");
  // Launched state, SIMULATED in this disposable database only (production keeps creation_enabled=false):
  // the creation switch, one enabled access plan, and the verified membership a signed Whop event records.
  const sql = `update makeborne_private.billing_settings set creation_enabled=true where singleton;
    insert into makeborne_private.billing_access_plans(plan_id,enabled) values('plan_rcstudio',true) on conflict (plan_id) do update set enabled=true;
    insert into public.billing_checkouts(request_id,user_id,plan_id,checkout_id,return_path,status) values(gen_random_uuid(),'${owner.id}','plan_rcstudio','ch_rcowner','/studio','ready'),
      (gen_random_uuid(),'${outsider.id}','plan_rcstudio','ch_rcoutsider','/studio','ready');`;
  const switched = require("node:child_process").spawnSync("docker", ["exec", "-i", "supabase_db_makeborne-rc-20261019", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql, encoding: "utf8" });
  assert.equal(switched.status, 0, switched.stderr);
  must(await admin.rpc("makeborne_record_whop_membership", { p_event_id: "evt_rcowner1", p_user_id: owner.id, p_membership_id: "mem_rcowner", p_checkout_id: "ch_rcowner", p_whop_user_id: "user_rcowner", p_plan_id: "plan_rcstudio", p_status: "active", p_period_end: end.toISOString(), p_verified_until: end.toISOString() }), "membership");
  must(await admin.rpc("makeborne_record_whop_membership", { p_event_id: "evt_rcoutsider1", p_user_id: outsider.id, p_membership_id: "mem_rcoutsider", p_checkout_id: "ch_rcoutsider", p_whop_user_id: "user_rcoutsider", p_plan_id: "plan_rcstudio", p_status: "active", p_period_end: end.toISOString(), p_verified_until: end.toISOString() }), "outsider membership");
  const wallet = must(await admin.rpc("makeborne_credit_wallet", { p_user: owner.id }), "wallet");

  const ws = must(await owner.client.rpc("makeborne_create_workspace", { p_request_key: id(), p_name: "RC fixture agency" }), "workspace");
  const workspaceId = ws.workspace?.id ?? ws.id;
  const outsiderWs = must(await outsider.client.rpc("makeborne_create_workspace", { p_request_key: id(), p_name: "Outsider workspace" }), "outsider workspace");

  const legacyBook = (n) => ({ schemaVersion: 1, kind: "book", title: "The Lantern Keeper", sections: [section("Chapter 1", [block("heading", "Chapter 1"), block("paragraph", `The lamp was lit at dusk. (revision ${n})`), block("paragraph", "Nobody came.")]), section("Chapter 2", [block("heading", "Chapter 2"), block("paragraph", "Morning brought the boats.")])] });
  const legacyDeck = { schemaVersion: 1, kind: "presentation", title: "Quarterly", sections: Array.from({ length: 8 }, (_, i) => section(`Slide ${i + 1}`, [block(i ? "paragraph" : "heading", `Point ${i + 1}`)].concat(i === 7 ? [block("callout", "Speaker notes: thank them")] : []))) };
  const legacySite = { schemaVersion: 1, kind: "website", title: "Harbour Bakery", sections: [section("Hero", [block("heading", "Fresh every morning"), block("paragraph", "Sourdough and rye.")]), section("Visit", [block("paragraph", "Open 7–2")])] };
  const staticSite = { schemaVersion: 1, kind: "website", title: "Old site", sections: [], website: { html: `<main><h1>Old site</h1>${"<p>Saved copy.</p>".repeat(8)}</main>`, css: `main{font-family:serif;max-width:60ch;margin:auto}${"p{line-height:1.6}".repeat(6)}`, description: "Static design", designNotes: "Kept as saved" } };
  const source = JSON.parse(fs.readFileSync(path.join(GOLDEN, "w02-saas-relay-operations/source.json"), "utf8"));
  const websiteSource = source.websiteSource ?? source;
  const book = JSON.parse(fs.readFileSync(path.join(GOLDEN, "b02-repair-table/document.json"), "utf8"));
  const deck = JSON.parse(fs.readFileSync(path.join(GOLDEN, "d02-tidewater-seed-pitch/document.json"), "utf8"));

  const projects = [];
  projects.push(await project(owner, workspaceId, "book", "The Lantern Keeper", [1, 2, 3, 4, 5].map(n => [`Legacy outline revision ${n}`, legacyBook(n)])));
  projects.push(await project(owner, workspaceId, "presentation", "Quarterly", [["Legacy outline", legacyDeck], ["Legacy outline, again", legacyDeck]]));
  projects.push(await project(owner, workspaceId, "website", "Harbour Bakery", [["Legacy outline", legacySite]]));
  projects.push(await project(owner, workspaceId, "website", "Old site", [["Legacy static design", staticSite]]));
  projects.push(await project(owner, workspaceId, "website", "Relay Operations", [["Golden run w02 (reused, not regenerated)", { schemaVersion: 1, kind: "website", title: "Relay Operations", sections: [], websiteSource }]]));
  projects.push(await project(owner, workspaceId, "book", book.title.slice(0, 160), [["Golden run b02 (reused)", { schemaVersion: 1, kind: "book", title: book.title.slice(0, 200), sections: projectDocument(book), document: book }]]));
  projects.push(await project(owner, workspaceId, "presentation", deck.title.slice(0, 160), [["Golden run d02 (reused)", { schemaVersion: 1, kind: "presentation", title: deck.title.slice(0, 200), sections: projectDocument(deck), document: deck }]]));

  const privateOut = { at: new Date().toISOString(), users: [owner, client, outsider].map(({ label, id, email, password }) => ({ label, id, email, password })) };
  fs.writeFileSync("work/rc-stack/fixtures.private.json", JSON.stringify(privateOut, null, 2));
  const publicOut = { at: privateOut.at, stack: "makeborne-rc-20261019", entitlement: { simulated: true, tier: "studio", interval: "monthly", monthlyCredits: 850, periodStart: start.toISOString(), periodEnd: end.toISOString(), reconciled, wallet },
    users: privateOut.users.map(({ label, id }) => ({ label, id })), workspaceId, outsiderWorkspaceId: outsiderWs.workspace?.id ?? outsiderWs.id, projects };
  fs.writeFileSync("docs/release-review/rc-20261019/fixtures.json", JSON.stringify(publicOut, null, 2));
  console.log(JSON.stringify({ ...publicOut, wallet: { available: wallet?.available, nextExpiry: wallet?.nextExpiry ?? wallet?.next_expiry ?? null } }, null, 2));
})().catch(error => { console.error(error); process.exit(1); });

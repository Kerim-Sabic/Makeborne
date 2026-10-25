/* eslint-disable @typescript-eslint/no-require-imports -- Offline paying-workspace publishing entitlement checks (no network, no database). */
// Drives the real publication server functions and route with session, plan
// access and database mocked. The database authority itself is covered by
// supabase/check-paying-workspace-publication.sql on a local stack.
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const root = path.join(__dirname, "..", "..", "..");
const src = path.join(root, "src");
const http = () => require(path.join(src, "lib", "server", "http.ts"));
const rpcCalls = [];
let rpcResult = () => ({ data: null, error: null }), accessDenied = false, role = "owner", sourceWebsite = false;
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith("@/")) request = path.join(src, request.slice(2));
  try { return resolve.call(this, request, parent, ...rest); }
  catch (error) { if (!/\.(ts|js|json)$/.test(request)) return resolve.call(this, `${request}.ts`, parent, ...rest); throw error; }
};
const membershipRequired = () => new (http().RequestError)("MEMBERSHIP_REQUIRED", "Creation access is not available for this account right now. Choose a plan to continue; support purchases do not unlock creation.", 402);
const stubs = {
  "cloud/server": () => ({
    cloudBody: async (request, schema) => schema.parse(await request.json()),
    cloudContext: async () => ({ client: fakeClient(), user: { id: "11111111-1111-4111-8111-111111111111" }, workspace: { role } }),
    cloudError: error => Response.json({ error: { code: error.code ?? "ERROR", message: error.message } }, { status: error.status ?? 500 }),
    cloudJson: (value, status = 200) => Response.json(value, { status }),
    // Shared mapping, reduced to the codes this check distinguishes.
    databaseError: error => {
      if (!error) return;
      const { RequestError } = http();
      if (error.code === "MB402") throw new RequestError("MEMBERSHIP_REQUIRED", "A verified creation membership is required before changing this workspace.", 402);
      if (error.code === "MB429") throw new RequestError("WRITE_LIMIT", "This workspace has reached its safe write limit.", 429);
      if (error.code === "42501") throw new RequestError("ACCESS_DENIED", "You do not have permission to change this work.", 403);
      throw new RequestError("DATABASE_ERROR", "database", 500);
    },
    requestKey: () => randomUUID(),
    validId: id => id,
  }),
  "generation/submission-server": () => ({ submissionContext: async (_request, write) => {
    if (write && accessDenied) throw membershipRequired();
    return { trusted: { p_actor: "11111111-1111-4111-8111-111111111111", p_session: randomUUID(), p_expires: new Date(Date.now() + 60_000).toISOString() } };
  } }),
  "billing/database": () => ({ billingDatabase: () => ({ rpc: (name, args) => {
    rpcCalls.push({ name, args });
    const response = Promise.resolve(rpcResult(name, args)); response.abortSignal = () => response; return response;
  } }) }),
  "billing/access": () => ({ requireCreationAccess: async user => { if (accessDenied) throw membershipRequired(); return user; } }),
  "cloud/image-preview": () => ({ MAX_PREVIEW_SOURCE_BYTES: 8 * 1024 * 1024, renderAssetPreview: async bytes => Buffer.from(bytes) }),
};
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  for (const [suffix, stub] of Object.entries(stubs)) if (name.endsWith(suffix) && !name.includes("check-")) return stub();
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);

const workspaceId = "22222222-2222-4222-8222-222222222222", artifactId = "33333333-3333-4333-8333-333333333333", prepId = "66666666-6666-4666-8666-666666666666";
function chain(result) {
  const builder = { select: () => builder, eq: () => builder, in: () => builder, maybeSingle: async () => result, single: async () => result, then: (ok, fail) => Promise.resolve(result).then(ok, fail) };
  return builder;
}
function fakeClient() {
  const content = sourceWebsite ? { schemaVersion: 1, kind: "website", title: "Bakery", sections: [], websiteSource: { schemaVersion: 1 } }
    : { schemaVersion: 1, kind: "website", title: "Bakery", sections: [{ id: randomUUID(), title: "Bread", blocks: [{ id: "77777777-7777-4777-8777-777777777777", type: "paragraph", text: "Fresh bread every morning.", sourceIds: [] }] }] };
  return { from: table => chain(table === "artifacts" ? { data: { project_id: "55555555-5555-4555-8555-555555555555", kind: "website", current_version: 1 }, error: null }
    : table === "artifact_versions" ? { data: { content, style_snapshot: { id: "editorial", name: "Editorial", version: 1, typography: { headingFont: "Arial", bodyFont: "Arial" }, colors: { ink: "#111111", paper: "#ffffff", accent: "#445566" }, description: "Simple" } }, error: null }
    : table === "hosted_sites" ? { data: { slug: "bakery", live: true, version_number: 1, revision: 2, updated_at: "2026-10-12T00:00:00Z", interactive: false, entry_script: "/assets/app.js" }, error: null }
    : { data: [], error: null }) };
}
const ISOLATED = { NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING: "isolated", NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE: "https://{slug}.makeborne.site/", NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED: "makeborne.site" };
function fresh(env = {}) {
  for (const key of ["NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING", "NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE", "NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED", "MAKEBORNE_HOSTING_NAMESPACE", "MAKEBORNE_STAGING_QA_WORKSPACE_ID", "NEXT_PUBLIC_SUPABASE_URL"]) delete process.env[key];
  Object.assign(process.env, { MAKEBORNE_TRUSTED_PUBLICATION_ENABLED: "true" }, env);
  for (const key of Object.keys(require.cache)) if (key.startsWith(src)) delete require.cache[key];
  return { server: require(path.join(src, "lib", "projects", "publication-server.ts")),
    route: require(path.join(src, "app", "api", "cloud", "workspaces", "[workspaceId]", "artifacts", "[artifactId]", "publication", "route.ts")) };
}
const context = { params: Promise.resolve({ workspaceId, artifactId }) };
const json = (method, body) => new Request("http://localhost/x", { method, headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify(body) });
const prepare = () => json("POST", { version: 1, revision: 0, slug: "bakery", interactive: false });
const prep = () => ({ id: prepId, state: "ready", scope: { workspaceId, artifactId, projectId: "55555555-5555-4555-8555-555555555555" }, versionNumber: 1, publicationRevision: 1, slug: "bakery", interactive: false,
  expiresAt: "2026-10-14T00:00:00Z", output: { html: "<html><body>Trusted</body></html>", routes: [{ path: "/", html: "<html><body>Trusted</body></html>" }] } });
const UNCHANGED = /already live are unchanged|current live site is unchanged/;

let passed = 0;
async function check(name, fn) { rpcCalls.length = 0; rpcResult = () => ({ data: null, error: null }); accessDenied = false; role = "owner"; sourceWebsite = false; await fn(); passed++; console.log(`PASS ${name}`); }
async function rejects(promise, code, status, message) {
  await assert.rejects(promise, error => { assert.equal(error.code, code); assert.equal(error.status, status); if (message) assert.match(error.message, message); return true; });
}

(async () => {
  await check("database refusals are reported in publishing terms; other errors keep the shared mapping", async () => {
    const { server } = fresh();
    const map = (error, stage) => { try { server.publicationDatabaseError(error, stage); return null; } catch (e) { return e; } };
    assert.equal(map(null, "request"), null);
    let e = map({ code: "MB402", message: "Creation membership required" }, "request");
    assert.equal(e.code, "PUBLISHING_PLAN_REQUIRED"); assert.equal(e.status, 402); assert.match(e.message, /active Makeborne plan/); assert.match(e.message, UNCHANGED);
    e = map({ code: "42501", message: "Trusted publication workspace not enabled" }, "promote");
    assert.equal(e.code, "PUBLISHING_NOT_ENABLED"); assert.equal(e.status, 403); assert.match(e.message, /not switched on for this workspace/);
    e = map({ code: "42501", message: "Owner required" }, "request");
    assert.equal(e.code, "ACCESS_DENIED", "ownership refusals keep the shared wording");
    e = map({ code: "MB429", message: "Preparation limit reached" }, "request"); assert.equal(e.code, "PREPARATION_LIMIT"); assert.match(e.message, /30 publications an hour/);
    e = map({ code: "MB429", message: "Daily publishing limit reached" }, "promote"); assert.equal(e.code, "PUBLISHING_LIMIT"); assert.match(e.message, /50 new websites a day, or 1,000 live websites/);
    assert.equal(map({ code: "PT409" }, "read").code, "DATABASE_ERROR");
  });

  await check("non-paying account is refused before any preparation RPC with an honest plan message", async () => {
    const { server } = fresh(); accessDenied = true;
    await rejects(server.requestPublicationPreparation(prepare(), workspaceId, artifactId), "PUBLISHING_PLAN_REQUIRED", 402, /Choose a plan to publish/);
    await rejects(server.promotePublicationPreparation(json("POST", {}), workspaceId, artifactId, prepId), "PUBLISHING_PLAN_REQUIRED", 402);
    assert.equal(rpcCalls.length, 0);
  });

  await check("paying account reaches the database authority; refunded/lapsed refusal and unlisted scope surface honestly", async () => {
    const { server } = fresh();
    rpcResult = name => name === "makeborne_request_publication_preparation" ? { data: { ...prep(), state: "queued", output: null }, error: null } : { data: null, error: null };
    assert.equal((await server.requestPublicationPreparation(prepare(), workspaceId, artifactId)).state, "queued");
    assert.deepEqual(rpcCalls.map(c => c.name), ["makeborne_request_publication_preparation"]);
    rpcResult = () => ({ data: null, error: { code: "MB402", message: "Creation membership required" } });
    await rejects(server.requestPublicationPreparation(prepare(), workspaceId, artifactId), "PUBLISHING_PLAN_REQUIRED", 402, UNCHANGED);
    rpcResult = () => ({ data: null, error: { code: "42501", message: "Trusted publication workspace not enabled" } });
    await rejects(server.requestPublicationPreparation(prepare(), workspaceId, artifactId), "PUBLISHING_NOT_ENABLED", 403, UNCHANGED);
    await rejects(server.readPublicationPreparation(new Request("http://localhost/x"), workspaceId, artifactId), "PUBLISHING_NOT_ENABLED", 403);
  });

  await check("promotion maps a lapsed plan and fair-use limits; the live site is described as unchanged", async () => {
    const { server } = fresh();
    rpcResult = name => name === "makeborne_publication_preparation_status" ? { data: prep(), error: null } : { data: null, error: { code: "MB402", message: "Creation membership required" } };
    await rejects(server.promotePublicationPreparation(json("POST", {}), workspaceId, artifactId, prepId), "PUBLISHING_PLAN_REQUIRED", 402, UNCHANGED);
    rpcResult = name => name === "makeborne_publication_preparation_status" ? { data: prep(), error: null } : { data: null, error: { code: "MB429", message: "Fair-use limit of 1,000 live websites reached; contact support" } };
    await rejects(server.promotePublicationPreparation(json("POST", {}), workspaceId, artifactId, prepId), "PUBLISHING_LIMIT", 429, /current live site is unchanged/);
  });

  await check("legacy static publish needs plan access; taking a site offline never does", async () => {
    let { route } = fresh(); accessDenied = true;
    const publish = live => route.POST(json("POST", { live, slug: "bakery", version: 1, revision: 1, acknowledged: true, interactive: false }), context);
    let response = await publish(true); let body = await response.json();
    assert.equal(response.status, 402); assert.equal(body.error.code, "PUBLISHING_PLAN_REQUIRED"); assert.equal(rpcCalls.length, 0);
    rpcResult = () => ({ data: { slug: "bakery", live: false, version_number: 1, revision: 3, updated_at: "2026-10-25T00:00:00Z", interactive: false, entry_script: null }, error: null });
    response = await publish(false); assert.equal(response.status, 200); assert.equal(rpcCalls.at(-1).args.p_live, false);
    accessDenied = false; rpcCalls.length = 0;
    rpcResult = () => ({ data: null, error: { code: "MB402", message: "Creation membership required" } });
    ({ route } = fresh());
    response = await route.POST(json("POST", { live: true, slug: "bakery", version: 1, revision: 1, acknowledged: true, interactive: false }), context); body = await response.json();
    assert.equal(response.status, 402); assert.equal(body.error.code, "PUBLISHING_PLAN_REQUIRED", "refunded period refused by SQL is reported as a plan issue");
  });

  await check("turning customer JavaScript on needs plan access; turning it off does not; editors stay refused", async () => {
    const { route } = fresh(ISOLATED); accessDenied = true;
    rpcResult = () => ({ data: { slug: "bakery", live: true, version_number: 1, revision: 3, updated_at: "2026-10-25T00:00:00Z", interactive: false, entry_script: "/assets/app.js" }, error: null });
    const toggle = interactive => route.PATCH(json("PATCH", { interactive, revision: 2 }), context);
    let response = await toggle(true); assert.equal(response.status, 402); assert.equal((await response.json()).error.code, "PUBLISHING_PLAN_REQUIRED"); assert.equal(rpcCalls.length, 0);
    response = await toggle(false); assert.equal(response.status, 200);
    accessDenied = false; rpcCalls.length = 0; response = await toggle(true); assert.equal(response.status, 200);
    role = "editor"; rpcCalls.length = 0; response = await toggle(true); assert.equal(response.status, 403); assert.equal(rpcCalls.length, 0);
  });

  console.log(`${passed} paying-workspace publishing entitlement groups passed; no network or database.`);
})().catch(error => { console.error(error); process.exitCode = 1; });

/* eslint-disable @typescript-eslint/no-require-imports -- Offline checks for the client portal routes (mocked Supabase, no network, no database). */
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const src = path.join(__dirname, "..", "..");
const root = path.join(src, "..");
const rel = file => path.join(root, file);

// ---------------------------------------------------------------- recorded fakes
const SCHEMA = "20261003_cloud_v2";
const USER = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222", SESSION = "33333333-3333-4333-8333-333333333333";
const WS = "44444444-4444-4444-8444-444444444444", CLIENT = "55555555-5555-4555-8555-555555555555", SITE = "66666666-6666-4666-8666-666666666666";
const ASSET = "77777777-7777-4777-8777-777777777777", ACCESS = "88888888-8888-4888-8888-888888888888", CHANGE = "99999999-9999-4999-8999-999999999999";
const ORIGIN = "https://app.makeborne.test";
let state;
function reset(overrides = {}) {
  state = { calls: [], tables: [], creationChecks: 0, headers: {}, role: "owner", user: { id: USER, email: "client@example.com" },
    claims: { sub: USER, session_id: SESSION, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", is_anonymous: false },
    rpc: () => ({ data: null, error: null }), accessClient: CLIENT, downloads: [], uploads: [], removed: [], filters: {}, uploadRows: { data: [], error: null }, ...overrides };
}
const respond = (via, name, args) => { state.calls.push({ via, name, args }); return state.rpc(name, args, via); };
function builder(table) {
  state.tables.push(table);
  const query = { select: () => query, eq: (column, value) => { (state.filters[table] ??= []).push([column, value]); return query; },
    limit: async () => table === "client_portal_uploads" ? state.uploadRows : { data: null, error: { code: "42501" } }, maybeSingle: async () => {
    if (table === "workspaces") return { data: { id: WS, name: "Studio", owner_id: state.role === "owner" ? USER : OTHER }, error: null };
    if (table === "workspace_members") return { data: state.role === "owner" ? null : { role: state.role }, error: null };
    if (table === "client_portal_access") return { data: { id: ACCESS, client_id: state.accessClient }, error: null };
    return { data: null, error: { code: "42501" } };
  } };
  return query;
}
const cookieClient = () => ({
  auth: { getUser: async () => state.user ? { data: { user: state.user }, error: null } : { data: { user: null }, error: { message: "signed out" } },
    getClaims: async () => ({ data: { claims: state.claims }, error: null }) },
  rpc: async (name, args) => name === "makeborne_cloud_schema_version" ? { data: SCHEMA, error: null } : respond("cookie", name, args),
  from: table => builder(table),
});
const serviceClient = () => ({
  rpc: async (name, args) => respond("service", name, args),
  from: table => { state.tables.push(`service:${table}`); throw new Error("service client must not read tables"); },
  storage: { from: bucket => ({ download: async objectPath => { state.downloads.push({ bucket, objectPath }); return { data: new Blob([Buffer.from("png")]), error: null }; },
    upload: async (objectPath, bytes, options) => { state.uploads.push({ bucket, objectPath, bytes, options }); return state.uploadResult ?? { data: { path: objectPath }, error: null }; },
    remove: async paths => { state.removed.push({ bucket, paths }); return state.removeResult ?? { data: paths.map(name => ({ name })), error: null }; } }) },
});
const anonClient = () => ({ rpc: async (name, args) => respond("anon", name, args), from: table => { state.tables.push(`anon:${table}`); throw new Error("anon tables"); } });

const stubs = {
  "server-only": {},
  "next/headers": { headers: async () => new Headers(state.headers), cookies: async () => ({ getAll: () => [], set() {} }) },
  "@/lib/supabase/server": { createClient: async () => cookieClient() },
  "@/lib/billing/database": { billingDatabase: () => serviceClient() },
  "@/lib/billing/access": { requireCreationAccess: async () => { state.creationChecks++; } },
  "@/lib/client-review/server": {
    newReviewToken: () => { const token = crypto.randomBytes(32).toString("base64url"); return { token, hash: `\\x${crypto.createHash("sha256").update(token, "utf8").digest("hex")}` }; },
    anonymousReviewDatabase: () => anonClient(),
  },
  "@/lib/cloud/image-preview": { MAX_PREVIEW_SOURCE_BYTES: 8 * 1024 * 1024, renderAssetPreview: async () => Buffer.from("webp-preview") },
};
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_offline";
process.env.MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED = "true";
process.env.MAKEBORNE_CLOUD_ENABLED = "true";
globalThis.fetch = async () => { throw new Error("Network forbidden"); };

const cache = {};
function load(file) {
  if (Object.prototype.hasOwnProperty.call(stubs, file)) return stubs[file];
  if (cache[file]) return cache[file].exports;
  const compiled = { exports: {} };
  cache[file] = compiled;
  const localRequire = id => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    if (!id.startsWith(".") && !id.startsWith("@/")) return require(id);
    const base = id.startsWith("@/") ? path.join(src, id.slice(2)) : path.resolve(path.dirname(file), id);
    const resolved = [base, `${base}.ts`, `${base}.js`].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!resolved) throw new Error(`Cannot resolve ${id} from ${file}`);
    return load(resolved);
  };
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function("require", "module", "exports", js)(localRequire, compiled, compiled.exports);
  return compiled.exports;
}

// Every console line is captured: invite tokens must never be logged.
const logged = [];
for (const level of ["log", "info", "warn", "error", "debug"]) { const original = console[level]; console[level] = (...args) => { logged.push(args.map(String).join(" ")); if (level === "log") original(...args); }; }

const PORTAL_ROUTES = ["src/app/api/portal/route.ts", "src/app/api/portal/invites/[token]/route.ts", "src/app/api/portal/invites/[token]/accept/route.ts",
  "src/app/api/portal/sites/[artifactId]/route.ts", "src/app/api/portal/sites/[artifactId]/draft/route.ts", "src/app/api/portal/sites/[artifactId]/changes/route.ts",
  "src/app/api/portal/sites/[artifactId]/images/[assetId]/route.ts", "src/app/api/portal/sites/[artifactId]/images/route.ts"];
// Cleanup RPCs answer like an idle queue unless a check says otherwise.
const CLEANUP = { makeborne_portal_sweep_unused_uploads: { removed: 0 }, makeborne_portal_take_upload_trash: { paths: [], waiting: 0 }, makeborne_portal_clear_upload_trash: { cleared: 0 } };
const withCleanup = rpc => (name, args, via) => name in CLEANUP ? { data: CLEANUP[name], error: null } : rpc(name, args, via);
const AGENCY_ROUTES = ["src/app/api/cloud/workspaces/[workspaceId]/clients/[clientId]/portal/route.ts", "src/app/api/cloud/workspaces/[workspaceId]/clients/[clientId]/portal/[accessId]/route.ts",
  "src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/portal/route.ts", "src/app/api/cloud/workspaces/[workspaceId]/artifacts/[artifactId]/portal/changes/[changeId]/route.ts"];
const route = file => load(rel(file));
const { checkCollection, parseManifest, serialiseContent } = load(rel("src/lib/portal/content-model.ts"));

// ---------------------------------------------------------------- fixtures
const MANIFEST = JSON.stringify({ version: 1, collections: {
  menu: { label: "Menu", kind: "list", fields: { name: { type: "text", required: true }, price: { type: "price" }, link: { type: "url" }, image: { type: "image" } } },
  hours: { label: "Opening hours", kind: "single", fields: { note: { type: "text" } } } } });
const menuCollection = parseManifest(MANIFEST).manifest.collections.menu;
const canonical = value => checkCollection(menuCollection, JSON.stringify(value), { assets: new Set(["/images/dish.webp"]), routes: ["/", "/menu"] }).text;
const MENU = canonical({ items: [{ id: "m1", name: "Margherita", price: "9.50", link: null, image: null }] });
const BRAND = { name: "Studio", logo: null, colors: { primary: "#1f6f5b", background: "#ffffff", text: "#1a1a1a" } };
const CHANGE_ROW = (files, status = "draft") => ({ id: CHANGE, status, baseVersion: 3, files, summary: "", decisionNote: null, resultVersion: null,
  updatedAt: "2026-10-15T10:00:00+00:00", submittedAt: null, decidedAt: null });
const SITE_ROW = { site: { artifactId: SITE, title: "Saffron", slug: "saffron-table" }, agency: BRAND, client: { name: "Saffron Table" }, baseVersion: 3, manifest: MANIFEST,
  collections: [{ key: "menu", path: "src/content/menu.json", sha256: "a".repeat(64), text: MENU }], images: [{ path: "/images/dish.webp", assetId: ASSET }], routes: ["/", "/menu"], change: null };
const ACCESS_ROW = { id: ACCESS, clientId: CLIENT, email: "client@example.com", displayName: "Ana", status: "invited", invitedAt: "2026-10-15T10:00:00+00:00",
  inviteExpiresAt: "2026-10-29T10:00:00+00:00", acceptedAt: null, lastSeenAt: null, planLabel: "", paidThrough: null };
const SETTINGS_ROW = (pendingFiles) => ({ clientId: CLIENT, enabled: true, collections: null, version: 3, manifest: MANIFEST, images: ["/images/dish.webp"], routes: ["/", "/menu"],
  pending: pendingFiles ? [{ ...CHANGE_ROW(pendingFiles, "pending"), submittedAt: "2026-10-15T10:00:00+00:00", authorName: "Ana", authorEmail: "client@example.com",
    currentFiles: { "src/content/menu.json": MENU } }] : [] });

const request = (url, { method = "GET", body, headers = {} } = {}) => new Request(`${ORIGIN}${url}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
  body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const params = value => ({ params: Promise.resolve(value) });
const json = async response => ({ status: response.status, body: await response.json(), headers: response.headers });
const trustedArgs = args => args.p_actor === USER && args.p_session === SESSION && typeof args.p_expires === "string" && Date.parse(args.p_expires) > Date.now();
const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check("portal routes and portal/server.ts never use cloudContext, creation access or tenant tables", () => {
  for (const file of [...PORTAL_ROUTES, "src/lib/portal/server.ts", "src/lib/portal/mappers.ts"]) {
    // Code only: comments may explain what the file must never do.
    const text = fs.readFileSync(rel(file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(text, /cloudContext|requireCreationAccess|@\/lib\/cloud\/server|@\/lib\/portal\/agency/, file);
    const tables = [...text.matchAll(/(\w+)\.from\(\s*["'`]([^"'`]+)/g)].filter(match => !(match[1] === "storage" && match[2] === "project-assets"));
    assert.deepEqual(tables.map(match => match[0]), [], `${file} reads a table directly`);
  }
  for (const file of AGENCY_ROUTES) {
    const text = fs.readFileSync(rel(file), "utf8");
    assert.match(text, /from "@\/lib\/portal\/agency"/, file);
    assert.doesNotMatch(text, /\bcloudContext\(/, `${file} must use agencyContext/agencyTrusted (reviewer refusal)`);
  }
  assert.match(fs.readFileSync(rel("src/lib/portal/agency.ts"), "utf8"), /role === "reviewer"/);
});

check("home: service-role RPC with actor and session; no tables, no cookie-client RPC, no creation check; liveUrl from the slug", async () => {
  reset({ rpc: name => name === "makeborne_portal_home" ? { data: { email: "client@example.com", grants: [{ accessId: ACCESS, agency: BRAND, client: { name: "Saffron Table" },
    sites: [{ artifactId: SITE, title: "Saffron", slug: "saffron-table", change: null }] }] }, error: null } : { data: null, error: { code: "XX000" } } });
  const result = await json(await route(PORTAL_ROUTES[0]).GET(request("/api/portal")));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(state.calls.map(call => `${call.via}:${call.name}`), ["service:makeborne_portal_home"]);
  assert.ok(trustedArgs(state.calls[0].args));
  assert.deepEqual(state.tables, []);
  assert.equal(state.creationChecks, 0);
  assert.equal(result.body.grants[0].sites[0].liveUrl, "https://sites.makeborne.com/saffron-table");
  assert.equal(result.body.grants[0].sites[0].slug, undefined, "slug is not part of the contract");
});

check("account header mismatch → 409; signed out → 401; a JWT without a session or with another subject → 401", async () => {
  reset({ headers: { "X-Makeborne-Account": OTHER } });
  let result = await json(await route(PORTAL_ROUTES[0]).GET(request("/api/portal", { headers: { "X-Makeborne-Account": OTHER } })));
  assert.equal(result.status, 409); assert.equal(result.body.error.code, "ACCOUNT_CHANGED"); assert.equal(state.calls.length, 0);
  result = await json(await route(AGENCY_ROUTES[0]).GET(request(`/api/cloud/workspaces/${WS}/clients/${CLIENT}/portal`), params({ workspaceId: WS, clientId: CLIENT })));
  assert.equal(result.status, 409, "agency routes check the header too"); assert.equal(state.calls.length, 0);
  reset({ user: null });
  assert.equal((await route(PORTAL_ROUTES[3]).GET(request(`/api/portal/sites/${SITE}`), params({ artifactId: SITE }))).status, 401);
  for (const claims of [{ sub: USER, exp: 9999999999, role: "authenticated", is_anonymous: false }, { sub: OTHER, session_id: SESSION, exp: 9999999999, role: "authenticated", is_anonymous: false },
    { sub: USER, session_id: SESSION, exp: 1, role: "authenticated", is_anonymous: false }, { sub: USER, session_id: SESSION, exp: 9999999999, role: "authenticated", is_anonymous: true }]) {
    reset({ claims });
    assert.equal((await route(PORTAL_ROUTES[0]).GET(request("/api/portal"))).status, 401, JSON.stringify(claims));
    assert.equal(state.calls.length, 0);
  }
});

check("site read maps images to portal thumbnails and never exposes asset ids beyond the preview URL", async () => {
  reset({ rpc: () => ({ data: SITE_ROW, error: null }) });
  const result = await json(await route(PORTAL_ROUTES[3]).GET(request(`/api/portal/sites/${SITE}`), params({ artifactId: SITE })));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.images, [{ path: "/images/dish.webp", previewUrl: `/api/portal/sites/${SITE}/images/${ASSET}` }]);
  assert.equal(result.body.site.liveUrl, "https://sites.makeborne.com/saffron-table");
  assert.ok(trustedArgs(state.calls[0].args) && state.calls[0].args.p_artifact === SITE);
  reset();
  assert.equal((await route(PORTAL_ROUTES[3]).GET(request("/api/portal/sites/nope"), params({ artifactId: "nope" }))).status, 404);
  assert.equal(state.calls.length, 0);
});

const draftRequest = (body, headers = { "Idempotency-Key": KEY }) => request(`/api/portal/sites/${SITE}/draft`, { method: "PUT", body, headers });
const draft = async (body, headers) => json(await route(PORTAL_ROUTES[4]).PUT(draftRequest(body, headers), params({ artifactId: SITE })));
const siteThenSave = () => (name, args) => name === "makeborne_portal_read_site" ? { data: SITE_ROW, error: null }
  : name === "makeborne_portal_save_draft" ? { data: CHANGE_ROW(args.p_files), error: null } : { data: null, error: { code: "XX000" } };

check("draft writes need an Idempotency-Key, the same origin and a body under 700 KB", async () => {
  const body = { baseVersion: 3, files: { "src/content/menu.json": MENU } };
  reset({ rpc: siteThenSave() });
  let result = await draft(body, {});
  assert.equal(result.status, 400); assert.equal(result.body.error.code, "REQUEST_KEY_REQUIRED");
  result = await draft(body, { "Idempotency-Key": KEY, Origin: "https://evil.example" });
  assert.equal(result.status, 403); assert.equal(result.body.error.code, "ORIGIN_DENIED");
  result = await draft({ baseVersion: 3, files: { "src/content/menu.json": "x".repeat(150_000), "src/content/hours.json": "x".repeat(150_000), "src/content/a.json": "x".repeat(150_000),
    "src/content/b.json": "x".repeat(150_000), "src/content/c.json": "x".repeat(150_000) } });
  assert.equal(result.status, 413);
  assert.equal(state.calls.length, 0, "nothing reaches the database before these checks");
  for (const [method, file, url, extra] of [["POST", PORTAL_ROUTES[5], `/api/portal/sites/${SITE}/changes`, { action: "submit", changeId: CHANGE }]]) {
    assert.equal((await route(file)[method](request(url, { method, body: extra }), params({ artifactId: SITE }))).status, 400, "changes need a key");
    assert.equal((await route(file)[method](request(url, { method, body: extra, headers: { "Idempotency-Key": KEY, Origin: "https://evil.example" } }), params({ artifactId: SITE }))).status, 403);
  }
  assert.equal((await route(PORTAL_ROUTES[2]).POST(request(`/api/portal/invites/${"a".repeat(43)}/accept`, { method: "POST", headers: { Origin: "https://evil.example" } }),
    params({ token: "a".repeat(43) }))).status, 403, "accept checks the origin");
  assert.equal(state.calls.length, 0);
});

check("draft files are validated with the content model: bad links, disallowed paths and invalid values never reach the save RPC", async () => {
  const item = extra => ({ items: [{ id: "m1", name: "Margherita", price: "9.50", link: null, image: null, ...extra }] });
  for (const [files, status, code] of [
    [{ "src/content/menu.json": JSON.stringify(item({ link: "javascript:alert(1)" })) }, 422, "INVALID_CONTENT"],
    [{ "src/content/menu.json": JSON.stringify(item({ link: "https://user@evil.example" })) }, 422, "INVALID_CONTENT"],
    [{ "src/content/menu.json": JSON.stringify(item({ image: { src: "https://evil.example/x.png", alt: "" } })) }, 422, "INVALID_CONTENT"],
    [{ "src/content/menu.json": JSON.stringify(item({ price: "free" })) }, 422, "INVALID_CONTENT"],
    [{ "src/content/menu.json": "{not json" }, 422, "INVALID_CONTENT"],
    [{ "src/content/hours.json": JSON.stringify({ note: "Open" }) }, 403, "NOT_EDITABLE"],
    [{ "src/App.tsx": "export default 1" }, 400, "INVALID_CONTENT"],
    [{ "src/content/collections.json": MANIFEST }, 400, "INVALID_CONTENT"],
    [{ "src/content/../App.tsx": "{}" }, 400, "INVALID_CONTENT"],
  ]) {
    reset({ rpc: siteThenSave() });
    const result = await draft({ baseVersion: 3, files });
    assert.equal(result.status, status, `${JSON.stringify(files).slice(0, 80)} → ${JSON.stringify(result.body)}`);
    assert.equal(result.body.error.code, code);
    assert.ok(!state.calls.some(call => call.name === "makeborne_portal_save_draft"), "save RPC called with invalid content");
  }
  reset({ rpc: siteThenSave() });
  const raw = JSON.stringify({ items: [{ id: "m1", name: " Marg\u202Eherita ", price: "10.50", link: "/menu", image: { src: "/images/dish.webp", alt: "Dish" } }, { id: "m2", name: "Marinara", price: "8.00", link: "tel:+44 117 496 0000", image: null }] });
  const result = await draft({ baseVersion: 3, files: { "src/content/menu.json": raw } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const save = state.calls.find(call => call.name === "makeborne_portal_save_draft");
  assert.ok(trustedArgs(save.args) && save.args.p_artifact === SITE && save.args.p_base_version === 3 && save.args.p_request === KEY);
  const stored = save.args.p_files["src/content/menu.json"];
  assert.notEqual(stored, raw, "raw text is never stored");
  assert.ok(!stored.includes("\u202E") && stored.includes('"name": "Margherita"') && stored.endsWith("}\n"), stored);
  assert.equal(save.args.p_summary, "Menu: 1 changed, 1 added");
  assert.equal(result.body.change.files["src/content/menu.json"], stored);
  reset({ rpc: siteThenSave() });
  await draft({ baseVersion: 3, files: { "src/content/menu.json": JSON.stringify(JSON.parse(MENU)) } });
  assert.equal(state.calls.find(call => call.name === "makeborne_portal_save_draft").args.p_files["src/content/menu.json"], MENU, "an unchanged value keeps the current text exactly");
});

check("database errors map to friendly portal responses; missing portal tables say it is being set up", async () => {
  for (const [code, status, expected] of [["PT409", 409, "CHANGE_CONFLICT"], ["MB429", 429, "TOO_MANY"], ["P0002", 404, "NOT_AVAILABLE"], ["42501", 401, "AUTH_REQUIRED"],
    ["PP422", 403, "NOT_EDITABLE"], ["42P01", 503, "PORTAL_SETUP"], ["PGRST202", 503, "PORTAL_SETUP"], ["PGRST205", 503, "PORTAL_SETUP"], ["XX000", 503, "PORTAL_FAILED"]]) {
    reset({ rpc: () => ({ data: null, error: { code, message: code === "XX000" ? "relation \"secret_table\" does not exist <internal>" : undefined } }) });
    const result = await json(await route(PORTAL_ROUTES[0]).GET(request("/api/portal")));
    assert.equal(result.status, status, code); assert.equal(result.body.error.code, expected, code);
    if (status === 503 && expected === "PORTAL_SETUP") assert.match(result.body.error.message, /Client editing is being set up/);
    assert.doesNotMatch(result.body.error.message, /secret_table|internal/);
  }
});

check("changes and accept pass the trusted actor and session; the public invite read uses only the anonymous client", async () => {
  reset({ rpc: (name, args) => ({ data: CHANGE_ROW({}, args.p_action === "submit" ? "pending" : "withdrawn"), error: null }) });
  let result = await json(await route(PORTAL_ROUTES[5]).POST(request(`/api/portal/sites/${SITE}/changes`, { method: "POST", body: { action: "submit", changeId: CHANGE }, headers: { "Idempotency-Key": KEY } }), params({ artifactId: SITE })));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(trustedArgs(state.calls[0].args) && state.calls[0].args.p_change === CHANGE && state.calls[0].args.p_action === "submit");
  const token = crypto.randomBytes(32).toString("base64url");
  reset({ rpc: () => ({ data: { accessId: ACCESS, replayed: false }, error: null }) });
  result = await json(await route(PORTAL_ROUTES[2]).POST(request(`/api/portal/invites/${token}/accept`, { method: "POST" }), params({ token })));
  assert.deepEqual(result.body, { accessId: ACCESS });
  assert.ok(trustedArgs(state.calls[0].args) && state.calls[0].args.p_token === token && state.calls[0].via === "service");
  reset({ rpc: () => ({ data: { status: "open", agency: BRAND, client: { name: "Saffron Table" }, maskedEmail: "c***@example.com" }, error: null }) });
  result = await json(await route(PORTAL_ROUTES[1]).GET(request(`/api/portal/invites/${token}`), params({ token })));
  assert.equal(result.status, 200); assert.equal(result.body.maskedEmail, "c***@example.com");
  assert.deepEqual(state.calls.map(call => `${call.via}:${call.name}`), ["anon:makeborne_read_portal_invite"]);
  assert.equal(result.headers.get("referrer-policy"), "no-referrer");
  reset();
  assert.equal((await route(PORTAL_ROUTES[1]).GET(request("/api/portal/invites/short"), params({ token: "short" }))).status, 404);
  reset({ rpc: () => ({ data: null, error: null }) });
  assert.equal((await route(PORTAL_ROUTES[1]).GET(request(`/api/portal/invites/${token}`), params({ token }))).status, 404, "unknown token");
});

check("thumbnails: only the object the grant RPC returns is downloaded and re-rendered as WebP", async () => {
  reset({ rpc: () => ({ data: { objectPath: `${WS}/p/artwork/${ASSET}.webp`, contentType: "image/webp" }, error: null }) });
  const response = await route(PORTAL_ROUTES[6]).GET(request(`/api/portal/sites/${SITE}/images/${ASSET}`), params({ artifactId: SITE, assetId: ASSET }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "webp-preview");
  assert.ok(trustedArgs(state.calls[0].args) && state.calls[0].args.p_asset === ASSET);
  assert.deepEqual(state.downloads, [{ bucket: "project-assets", objectPath: `${WS}/p/artwork/${ASSET}.webp` }]);
  reset({ rpc: () => ({ data: null, error: { code: "P0002" } }) });
  assert.equal((await route(PORTAL_ROUTES[6]).GET(request(`/api/portal/sites/${SITE}/images/${ASSET}`), params({ artifactId: SITE, assetId: ASSET }))).status, 404);
  assert.deepEqual(state.downloads, []);
});

check("photo uploads: same origin, photo types only, re-encoded to WebP without metadata, stored under the scope's project, registered with the trusted actor", async () => {
  const sharp = require("sharp");
  const { assetId } = load(rel("src/lib/builder/images.ts"));
  const PROJECT = "abababab-abab-4bab-8bab-abababababab";
  const photo = await sharp({ create: { width: 3200, height: 1800, channels: 3, background: "#c0503a" } }).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Artist: "Ana" } } }).toBuffer();
  const upload = (body, type = "image/jpeg", headers = {}) => route(PORTAL_ROUTES[7]).POST(new Request(`${ORIGIN}/api/portal/sites/${SITE}/images`, { method: "POST",
    headers: { "content-type": type, origin: ORIGIN, ...headers }, body }), params({ artifactId: SITE }));
  const rpc = withCleanup((name, args) => name === "makeborne_portal_upload_scope" ? { data: { workspaceId: WS, projectId: PROJECT }, error: null }
    : name === "makeborne_portal_register_upload" ? { data: { assetId: args.p_asset, path: "/images/client-0123456789ab.webp" }, error: null } : { data: null, error: { code: "XX000" } });

  reset({ rpc });
  const result = await json(await upload(photo));
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.deepEqual(state.calls.map(call => [call.via, call.name]), [["service", "makeborne_portal_upload_scope"], ["service", "makeborne_portal_register_upload"],
    ["service", "makeborne_portal_sweep_unused_uploads"], ["service", "makeborne_portal_take_upload_trash"]]);
  assert.ok(state.calls.slice(0, 2).every(call => trustedArgs(call.args) && call.args.p_artifact === SITE));
  assert.deepEqual(state.calls[2].args, { p_artifact: SITE, p_limit: 10 }, "opportunistic cleanup of this site only");
  assert.deepEqual(state.removed, [], "nothing queued, nothing removed");
  const [stored] = state.uploads, registered = state.calls[1].args;
  const meta = await sharp(stored.bytes).metadata();
  assert.equal(meta.format, "webp"); assert.deepEqual([meta.width, meta.height], [1350, 2400], "rotated by EXIF orientation, longest edge 2400");
  assert.equal(meta.exif, undefined, "EXIF stripped");
  const sha = crypto.createHash("sha256").update(stored.bytes).digest("hex");
  assert.deepEqual([registered.p_sha256, registered.p_bytes, registered.p_width, registered.p_height], [sha, stored.bytes.length, 1350, 2400]);
  assert.equal(registered.p_asset, assetId(WS, PROJECT, sha));
  assert.deepEqual([stored.bucket, stored.objectPath, stored.options.contentType, stored.options.upsert], ["project-assets", `${WS}/${PROJECT}/portal/${registered.p_asset}.webp`, "image/webp", false]);
  assert.deepEqual(result.body.image, { path: "/images/client-0123456789ab.webp", previewUrl: `/api/portal/sites/${SITE}/images/${registered.p_asset}`, removable: true });

  reset({ rpc, uploadResult: { data: null, error: { message: "The resource already exists" } } });
  assert.equal((await upload(photo)).status, 201, "re-uploading the same photo is idempotent");

  for (const [body, type, status, headers] of [[photo, "image/gif", 415], [photo, "application/octet-stream", 415], [Buffer.from("not an image"), "image/png", 415],
    [await sharp({ create: { width: 120, height: 90, channels: 3, background: "#fff" } }).png().toBuffer(), "image/png", 400], [photo, "image/jpeg", 403, { origin: "https://evil.example" }]]) {
    reset({ rpc });
    const response = await upload(body, type, headers);
    assert.equal(response.status, status, `${type} ${status}`);
    assert.deepEqual(state.uploads, [], "nothing stored");
    assert.ok(!state.calls.some(call => call.name === "makeborne_portal_register_upload"), "nothing registered");
  }
  reset({ rpc: () => ({ data: null, error: { code: "P0002" } }) });
  assert.equal((await upload(photo)).status, 404, "no grant for this site: nothing read or stored");
  assert.deepEqual(state.uploads, []);
  reset({ rpc: (name, args) => name === "makeborne_portal_register_upload" ? { data: null, error: { code: "MB429" } } : rpc(name, args) });
  assert.equal((await upload(photo)).status, 429, "daily photo quota");
  assert.deepEqual(state.removed.map(entry => entry.paths), [[state.uploads[0].objectPath]], "an object this request stored but could not register is removed");
  reset({ uploadResult: { data: null, error: { message: "The resource already exists" } }, rpc: (name, args) => name === "makeborne_portal_register_upload" ? { data: null, error: { code: "MB429" } } : rpc(name, args) });
  assert.equal((await upload(photo)).status, 429);
  assert.deepEqual(state.removed, [], "an object that already existed is never removed");
  reset({ rpc: (name, args) => name === "makeborne_portal_sweep_unused_uploads" ? { data: null, error: { code: "XX000" } } : rpc(name, args) });
  assert.equal((await upload(photo)).status, 201, "a cleanup failure never fails the upload");
});

check("photo delete and cleanup: same origin and trusted session; storage removal only for leased portal objects, cleared only after it succeeds", async () => {
  const { purgePortalUploads } = load(rel("src/lib/portal/upload-cleanup.ts"));
  const OBJ = `${WS}/${SITE}/portal/${ASSET}.webp`;
  const del = (headers = { origin: ORIGIN }) => route(PORTAL_ROUTES[6]).DELETE(new Request(`${ORIGIN}/api/portal/sites/${SITE}/images/${ASSET}`, { method: "DELETE", headers }), params({ artifactId: SITE, assetId: ASSET }));
  const queue = paths => (name, args) => name === "makeborne_portal_delete_upload" ? { data: { deleted: true }, error: null }
    : name === "makeborne_portal_take_upload_trash" ? { data: { paths, waiting: paths.length }, error: null }
    : name === "makeborne_portal_clear_upload_trash" ? { data: { cleared: args.p_paths.length }, error: null }
    : name === "makeborne_portal_sweep_unused_uploads" ? { data: { removed: 0 }, error: null } : { data: null, error: { code: "XX000" } };

  reset({ rpc: queue([OBJ, "../../etc/passwd", "other/bucket/file.png"]) });
  const result = await json(await del());
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.deepEqual(result.body, { deleted: true });
  const call = state.calls.find(item => item.name === "makeborne_portal_delete_upload");
  assert.equal(call.via, "service"); assert.ok(trustedArgs(call.args)); assert.deepEqual([call.args.p_artifact, call.args.p_asset], [SITE, ASSET]);
  assert.deepEqual(state.removed, [{ bucket: "project-assets", paths: [OBJ] }], "only well-formed portal object paths are removed");
  assert.deepEqual(state.calls.find(item => item.name === "makeborne_portal_clear_upload_trash").args, { p_paths: [OBJ] });

  reset({ rpc: queue([OBJ]) });
  assert.equal((await del({ origin: "https://evil.example" })).status, 403);
  assert.deepEqual(state.calls, [], "cross-site delete never reaches the database");
  reset({ rpc: (name, args) => name === "makeborne_portal_delete_upload" ? { data: null, error: { code: "PT409", message: "This photo is part of your website, so it stays. You can stop using it in your content instead." } } : queue([])(name, args) });
  const refused = await json(await del());
  assert.equal(refused.status, 409); assert.match(refused.body.error.message, /part of your website/);
  assert.deepEqual(state.removed, []);

  reset({ rpc: queue([OBJ]), removeResult: { data: null, error: { message: "storage down" } } });
  const kept = await purgePortalUploads(serviceClient(), null, 50);
  assert.deepEqual(kept, { swept: 0, removed: 0, failed: 1, waiting: 1 });
  assert.ok(!state.calls.some(item => item.name === "makeborne_portal_clear_upload_trash"), "a failed removal stays queued");

  const cron = load(rel("src/app/api/cron/portal-uploads/route.ts"));
  process.env.CRON_SECRET = "c".repeat(40);
  reset({ rpc: queue([]) });
  assert.equal((await cron.GET(new Request(`${ORIGIN}/api/cron/portal-uploads`))).status, 401);
  assert.equal((await cron.GET(new Request(`${ORIGIN}/api/cron/portal-uploads`, { headers: { authorization: `Bearer ${"x".repeat(40)}` } }))).status, 401);
  assert.deepEqual(state.calls, []);
  let batches = 0;
  reset({ rpc: (name, args) => name === "makeborne_portal_take_upload_trash" ? (batches++ < 2 ? { data: { paths: [OBJ], waiting: 1 }, error: null } : { data: { paths: [], waiting: 0 }, error: null }) : queue([])(name, args) });
  const ran = await json(await cron.GET(new Request(`${ORIGIN}/api/cron/portal-uploads`, { headers: { authorization: `Bearer ${"c".repeat(40)}` } })));
  assert.equal(ran.status, 200); assert.deepEqual([ran.body.batches, ran.body.removed], [3, 2], "runs batches until the queue is idle");
  assert.ok(state.calls.filter(item => item.name === "makeborne_portal_sweep_unused_uploads").every(item => item.args.p_artifact === null && item.args.p_limit === 100), "the job sweeps every site");
  delete process.env.CRON_SECRET;
});

const agencyCall = async (index, method, url, value, body, headers = {}) => json(await route(AGENCY_ROUTES[index])[method](request(url, { method, body, headers }), params(value)));
const clientUrl = `/api/cloud/workspaces/${WS}/clients/${CLIENT}/portal`, siteUrl = `/api/cloud/workspaces/${WS}/artifacts/${SITE}/portal`;

check("agency routes refuse reviewers (reads and writes) before any portal RPC", async () => {
  for (const [index, method, url, value, body] of [
    [0, "GET", clientUrl, { workspaceId: WS, clientId: CLIENT }], [0, "POST", clientUrl, { workspaceId: WS, clientId: CLIENT }, { email: "client@example.com" }],
    [1, "PATCH", `${clientUrl}/${ACCESS}`, { workspaceId: WS, clientId: CLIENT, accessId: ACCESS }, { action: "resend" }],
    [1, "DELETE", `${clientUrl}/${ACCESS}`, { workspaceId: WS, clientId: CLIENT, accessId: ACCESS }],
    [2, "GET", siteUrl, { workspaceId: WS, artifactId: SITE }], [2, "PUT", siteUrl, { workspaceId: WS, artifactId: SITE }, { enabled: true, collections: null }],
    [3, "POST", `${siteUrl}/changes/${CHANGE}`, { workspaceId: WS, artifactId: SITE, changeId: CHANGE }, { decision: "approve" }]]) {
    reset({ role: "reviewer" });
    const result = await agencyCall(index, method, url, value, body);
    assert.equal(result.status, 403, `${method} ${url}`);
    assert.equal(state.calls.length, 0, `${method} ${url} reached the database`);
  }
  reset({ role: "editor", rpc: () => ({ data: { access: [], sites: [] }, error: null }) });
  assert.equal((await agencyCall(0, "GET", clientUrl, { workspaceId: WS, clientId: CLIENT })).status, 200, "editors read the overview");
});

check("invite: the link is returned once, only the hash reaches the database, nothing is logged; writes need creation access", async () => {
  reset({ rpc: () => ({ data: ACCESS_ROW, error: null }) });
  const before = logged.length;
  const result = await agencyCall(0, "POST", clientUrl, { workspaceId: WS, clientId: CLIENT }, { email: " Client@Example.com ", displayName: "Ana" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const match = /^https:\/\/app\.makeborne\.test\/portal\/join\/([A-Za-z0-9_-]{43})$/.exec(result.body.inviteUrl);
  assert.ok(match, result.body.inviteUrl);
  const call = state.calls.find(item => item.name === "makeborne_create_portal_invite");
  assert.equal(call.via, "service"); assert.ok(trustedArgs(call.args));
  assert.equal(call.args.p_email, "client@example.com"); assert.equal(call.args.p_days, 14);
  assert.equal(call.args.p_token_hash, `\\x${crypto.createHash("sha256").update(match[1], "utf8").digest("hex")}`);
  assert.ok(!JSON.stringify(state.calls).includes(match[1]), "token reached the database");
  assert.ok(!logged.slice(before).some(line => line.includes(match[1])), "token logged");
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal(state.creationChecks, 1, "invites need creation access");
  assert.deepEqual(Object.keys(result.body), ["access", "inviteUrl"]);
  reset({ rpc: () => ({ data: ACCESS_ROW, error: null }) });
  const resent = await agencyCall(1, "PATCH", `${clientUrl}/${ACCESS}`, { workspaceId: WS, clientId: CLIENT, accessId: ACCESS }, { action: "resend" });
  assert.equal(resent.status, 200); assert.match(resent.body.inviteUrl, /\/portal\/join\/[A-Za-z0-9_-]{43}$/);
  assert.equal(state.calls[0].name, "makeborne_resend_portal_invite");
  reset({ rpc: () => ({ data: null, error: { code: "PP409", message: "This email already has portal access for this client. Resend the invite instead." } }) });
  const duplicate = await agencyCall(0, "POST", clientUrl, { workspaceId: WS, clientId: CLIENT }, { email: "client@example.com" });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.body.error.code, "ALREADY_INVITED");
});

check("revoke works without creation access, as service role with the trusted actor; the access must belong to the URL's client", async () => {
  reset({ rpc: () => ({ data: { ...ACCESS_ROW, status: "revoked" }, error: null }) });
  const result = await agencyCall(1, "DELETE", `${clientUrl}/${ACCESS}`, { workspaceId: WS, clientId: CLIENT, accessId: ACCESS });
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.access.status, "revoked");
  assert.equal(state.creationChecks, 0, "revocation must not need a membership");
  assert.equal(state.calls[0].via, "service"); assert.equal(state.calls[0].name, "makeborne_revoke_portal_access"); assert.ok(trustedArgs(state.calls[0].args));
  reset({ accessClient: OTHER });
  assert.equal((await agencyCall(1, "DELETE", `${clientUrl}/${ACCESS}`, { workspaceId: WS, clientId: CLIENT, accessId: ACCESS })).status, 404);
  assert.equal(state.calls.length, 0);
  reset({ rpc: () => ({ data: ACCESS_ROW, error: null }) });
  await agencyCall(1, "PATCH", `${clientUrl}/${ACCESS}`, { workspaceId: WS, clientId: CLIENT, accessId: ACCESS }, { action: "update", planLabel: "Care", paidThrough: "2026-12-31" });
  assert.deepEqual([state.calls[0].via, state.calls[0].name, state.creationChecks], ["cookie", "makeborne_update_portal_access", 1]);
});

check("missing portal tables: agency reads degrade to available:false, writes say it is being set up", async () => {
  reset({ rpc: () => ({ data: null, error: { code: "42P01" } }) });
  assert.deepEqual((await agencyCall(0, "GET", clientUrl, { workspaceId: WS, clientId: CLIENT })).body, { available: false, access: [], sites: [] });
  reset({ rpc: () => ({ data: null, error: { code: "PGRST202" } }) });
  assert.deepEqual((await agencyCall(2, "GET", siteUrl, { workspaceId: WS, artifactId: SITE })).body, { available: false, clientId: null, enabled: false, collections: null, declared: [], pending: [] });
  const put = await agencyCall(2, "PUT", siteUrl, { workspaceId: WS, artifactId: SITE }, { enabled: true, collections: null });
  assert.equal(put.status, 503); assert.match(put.body.error.message, /being set up/);
});

check("settings map declared collections and change summaries; approval re-validates files and sends a version summary", async () => {
  const proposed = canonical({ items: [{ id: "m1", name: "Margherita", price: "10.50", link: null, image: null }, { id: "m2", name: "Marinara", price: "8.00", link: null, image: null }] });
  reset({ rpc: () => ({ data: SETTINGS_ROW({ "src/content/menu.json": proposed }), error: null }) });
  const settings = await agencyCall(2, "GET", siteUrl, { workspaceId: WS, artifactId: SITE });
  assert.deepEqual(settings.body.declared, [{ key: "menu", label: "Menu" }, { key: "hours", label: "Opening hours" }]);
  assert.deepEqual(settings.body.uploads, []);
  reset({ rpc: () => ({ data: SETTINGS_ROW(null), error: null }), uploadRows: { data: [{ id: ASSET, path_key: "0123456789ab" }], error: null } });
  const withPhotos = await agencyCall(2, "GET", siteUrl, { workspaceId: WS, artifactId: SITE });
  assert.deepEqual(withPhotos.body.uploads, [{ path: "/images/client-0123456789ab.webp", previewUrl: `/api/cloud/workspaces/${WS}/artifacts/${SITE}/assets/${ASSET}` }]);
  assert.deepEqual(state.filters.client_portal_uploads, [["workspace_id", WS], ["artifact_id", SITE]], "photos are read for this site only, through RLS");
  reset({ rpc: () => ({ data: SETTINGS_ROW(null), error: null }), uploadRows: { data: null, error: { code: "42P01", message: "relation \"public.client_portal_uploads\" does not exist" } } });
  assert.deepEqual((await agencyCall(2, "GET", siteUrl, { workspaceId: WS, artifactId: SITE })).body.uploads, [], "before the uploads migration: no photos, no error");
  reset({ rpc: () => ({ data: SETTINGS_ROW({ "src/content/menu.json": proposed }), error: null }) });
  await agencyCall(2, "GET", siteUrl, { workspaceId: WS, artifactId: SITE });
  assert.deepEqual(settings.body.pending[0].summaryLines, ["Menu: 1 changed, 1 added"]);
  assert.equal(settings.body.pending[0].authorName, "Ana"); assert.equal(settings.body.pending[0].currentFiles, undefined, "current file text is not part of the contract");
  reset({ rpc: (name, args) => name === "makeborne_portal_site_settings" ? { data: SETTINGS_ROW({ "src/content/menu.json": proposed }), error: null }
    : { data: { ...CHANGE_ROW(args.p_files ?? {}, "approved"), resultVersion: 4, decidedAt: "2026-10-15T11:00:00+00:00", submittedAt: "2026-10-15T10:00:00+00:00" }, error: null } });
  const approved = await agencyCall(3, "POST", `${siteUrl}/changes/${CHANGE}`, { workspaceId: WS, artifactId: SITE, changeId: CHANGE }, { decision: "approve" });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const decide = state.calls.find(call => call.name === "makeborne_decide_portal_change");
  assert.equal(decide.via, "cookie", "the version is created as the approving agency user");
  assert.deepEqual([decide.args.p_decision, decide.args.p_overwrite, decide.args.p_summary], ["approve", false, "Client edit by Ana: Menu (1 changed, 1 added)"]);
  assert.equal(state.creationChecks, 1);
  const unsafe = canonical({ items: [{ id: "m1", name: "Margherita", price: "9.50", link: null, image: null }] }).replace('"link": null', '"link": "javascript:alert(1)"');
  reset({ rpc: name => name === "makeborne_portal_site_settings" ? { data: SETTINGS_ROW({ "src/content/menu.json": unsafe }), error: null } : { data: null, error: { code: "XX000" } } });
  const refused = await agencyCall(3, "POST", `${siteUrl}/changes/${CHANGE}`, { workspaceId: WS, artifactId: SITE, changeId: CHANGE }, { decision: "approve" });
  assert.equal(refused.status, 409); assert.equal(refused.body.error.code, "CHANGE_OUTDATED");
  assert.ok(!state.calls.some(call => call.name === "makeborne_decide_portal_change"), "invalid content reached the decision RPC");
  reset({ rpc: name => name === "makeborne_portal_site_settings" ? { data: SETTINGS_ROW({ "src/content/menu.json": proposed }), error: null }
    : { data: null, error: { code: "PT409", message: "The site changed since the client started editing" } } });
  const conflict = await agencyCall(3, "POST", `${siteUrl}/changes/${CHANGE}`, { workspaceId: WS, artifactId: SITE, changeId: CHANGE }, { decision: "approve" });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, "CHANGE_CONFLICT");
  reset({ rpc: () => ({ data: { ...CHANGE_ROW({}, "rejected"), decisionNote: "No", decidedAt: "2026-10-15T11:00:00+00:00", submittedAt: "2026-10-15T10:00:00+00:00" }, error: null }) });
  const rejected = await agencyCall(3, "POST", `${siteUrl}/changes/${CHANGE}`, { workspaceId: WS, artifactId: SITE, changeId: CHANGE }, { decision: "reject", note: "No" });
  assert.equal(rejected.body.change.status, "rejected");
  assert.deepEqual(state.calls.map(call => call.name), ["makeborne_decide_portal_change"], "reject needs no re-validation");
});

check("the proxy refreshes sessions on portal pages and APIs", () => {
  const proxy = fs.readFileSync(rel("src/proxy.ts"), "utf8");
  assert.match(proxy, /"\/portal", "\/portal\/:path\*"/);
  assert.match(proxy, /portal\(\?:\\\/\|\$\)/);
  assert.equal(serialiseContent({ ok: true }), '{\n  "ok": true\n}\n');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.log(`FAIL ${name}\n${error.stack}`); }
  }
  console.log(`${checks.length - failed}/${checks.length} portal route checks passed.`);
  if (failed) process.exitCode = 1;
})();

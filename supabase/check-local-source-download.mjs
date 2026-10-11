/** Real HTTP route against disposable local Auth/Postgres fixtures. No cloud URLs or paid calls. */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomUUID, randomBytes, createHash} from "node:crypto";
import {spawn} from "node:child_process";
import {createClient} from "@supabase/supabase-js";
import {createServerClient} from "@supabase/ssr";
import JSZip from "jszip";
import sharp from "sharp";

if (process.env.MAKEBORNE_VERIFY_LOCAL_SOURCE !== "true" || !process.env.MAKEBORNE_LOCAL_STATUS_FILE) {
  console.log("NOT RUN: enable MAKEBORNE_VERIFY_LOCAL_SOURCE and provide the ignored local status file.");
  process.exit(2);
}
const dbOrigin = "http://127.0.0.1:55321", appOrigin = "http://localhost:3041";
let stage = "read local configuration", ownerId, app;
const clients = [];
function data(result) {if (result.error || !result.data) {
  const code = String(result.error?.code ?? result.error?.statusCode ?? "NO_DATA");
  throw new Error(`LOCAL_OPERATION_${/^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "REDACTED"}`);
} return result.data;}
const dbFetch = (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== dbOrigin) throw new Error("REMOTE_DATABASE_DENIED");
  return fetch(input, {...init, redirect: "error", signal: AbortSignal.timeout(15000)});
};
async function grant(enabled) {
  if (!ownerId) return;
  assert.match(ownerId, /^[a-f0-9-]{36}$/);
  const sql = enabled
    ? `insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values('${ownerId}'::uuid,true,false,'Disposable local source-download fixture');`
    : `delete from makeborne_private.account_privileges where user_id='${ownerId}'::uuid and reason='Disposable local source-download fixture';`;
  await new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", "supabase_db_makeborne-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
      {windowsHide: true, timeout: 15000, stdio: ["pipe", "ignore", "ignore"]});
    child.once("error", () => reject(new Error("LOCAL_GRANT_FAILED")));
    child.once("exit", code => code === 0 ? resolve() : reject(new Error("LOCAL_GRANT_FAILED")));
    child.stdin.on("error", () => reject(new Error("LOCAL_GRANT_FAILED"))); child.stdin.end(sql);
  });
}
async function main() {
  const config = JSON.parse((await readFile(process.env.MAKEBORNE_LOCAL_STATUS_FILE, "utf8")).replace(/^\uFEFF/, ""));
  assert.equal(config.API_URL, dbOrigin);
  const publicKey = config.PUBLISHABLE_KEY, secretKey = config.SECRET_KEY || config.SERVICE_ROLE_KEY;
  assert(publicKey?.startsWith("sb_publishable_") && secretKey);
  const admin = createClient(dbOrigin, secretKey, {auth: {persistSession: false, autoRefreshToken: false}, global: {fetch: dbFetch}});
  clients.push(admin);
  const runId = randomUUID(), actors = {};
  stage = "create local fixture accounts";
  for (const role of ["owner", "editor", "reviewer", "outsider"]) {
    const email = `makeborne-source-${runId}-${role}@example.com`, password = randomBytes(32).toString("base64url");
    const account = data(await admin.auth.admin.createUser({email, password, email_confirm: true}));
    const jar = new Map();
    const client = createServerClient(dbOrigin, publicKey, {global: {fetch: dbFetch},
      cookies: {getAll: () => [...jar].map(([name, value]) => ({name, value})), setAll: values => values.forEach(({name, value}) => jar.set(name, value))}});
    clients.push(client);
    const login = data(await client.auth.signInWithPassword({email, password}));
    assert.equal(login.user.id, account.user.id);
    actors[role] = {id: account.user.id, client, jar};
  }
  ownerId = actors.owner.id; await grant(true);
  stage = "save local generated design revisions";
  const workspace = data(await actors.owner.client.rpc("makeborne_create_workspace", {p_request_key: randomUUID(), p_name: `Source download ${runId}`})).workspace.id;
  const project = data(await actors.owner.client.rpc("makeborne_create_record", {p_workspace_id: workspace, p_request_key: randomUUID(), p_operation: "create_project", p_payload: {title: "Source fixture", kind: "website"}})).record.id;
  const artifact = data(await actors.owner.client.rpc("makeborne_create_record", {p_workspace_id: workspace, p_request_key: randomUUID(), p_operation: "create_artifact", p_payload: {project_id: project, title: "Source fixture", kind: "website"}})).record.id;
  const content = {schemaVersion: 1, title: "Source fixture", kind: "website", sections: [], website: {
    html: '<header><a href="#work">Work</a></header><main><h1>Original design</h1><section id="work"><h2>Our work</h2><p>Saved version content with a working collection anchor.</p></section></main>',
    css: "body{background:#fafafc;color:#202126;font-family:Arial,sans-serif}main{max-width:64rem;margin:auto;padding:2rem}h1{font-size:3rem}",
    description: "Saved local design", designNotes: "Static source export fixture",
  }};
  const style = {id: "fixture", name: "Fixture", version: 1, typography: {headingFont: "Arial", bodyFont: "Arial"}, colors: {ink: "#202126"}, description: "Local fixture", referenceAssetIds: []};
  const revisions = [];
  for (let expected = 0; expected < 2; expected++) {
    if (expected) content.website.html = content.website.html.replace("Original design", "Revised design");
    revisions.push(data(await actors.owner.client.rpc("makeborne_save_artifact_version", {p_workspace_id: workspace, p_artifact_id: artifact, p_expected_version: expected,
      p_content: content, p_style: style, p_asset_ids: [], p_change_summary: "Source fixture", p_request_key: randomUUID()})).version);
  }
  data(await admin.from("workspace_members").insert(["editor", "reviewer"].map(role => ({workspace_id: workspace, user_id: actors[role].id, role}))).select("user_id"));
  await grant(false); console.log("PASS temporary creation grant revoked before read-only download tests");
  const env = {...process.env, NEXT_PUBLIC_SUPABASE_URL: dbOrigin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
    SUPABASE_SECRET_KEY: secretKey, NEXT_PUBLIC_APP_URL: appOrigin,
    MAKEBORNE_CLOUD_ENABLED: "true", MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED: "true", MAKEBORNE_CLAUDE_PILOT_ENABLED: "false", MAKEBORNE_PUBLIC_GENERATION_ENABLED: "false",
    MAKEBORNE_DURABLE_SUBMISSIONS_ENABLED: "false", MAKEBORNE_PRESENTATION_SUBMISSIONS_ENABLED: "false", MAKEBORNE_BILLING_ENABLED: "false",
    ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", WHOP_API_KEY: "", DEEPSEEK_API_KEY: "", QWEN_API_KEY: ""};
  stage = "build against local configuration";
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build"], {env, windowsHide: true, stdio: "ignore", timeout: 120000});
    child.once("error", () => reject(new Error("BUILD_FAILED"))); child.once("exit", code => code === 0 ? resolve() : reject(new Error("BUILD_FAILED")));
  });
  console.log("PASS local-config production build");
  stage = "start local production server";
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "localhost", "--port", "3041"], {env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]});
  let processError = false, ready = false, startupText = "";
  app.on("error", () => {processError = true;});
  app.stdout.on("data", chunk => {startupText = (startupText + chunk.toString()).slice(-2000); ready ||= startupText.includes("Ready in");});
  app.stderr.on("data", () => { /* Drain diagnostics without exposing environment details. */ });
  for (let attempt = 0; ; attempt++) {
    if (processError || app.exitCode !== null || attempt > 30) throw new Error("SERVER_UNAVAILABLE");
    if (ready) try {const response = await fetch(`${appOrigin}/api/capabilities`, {signal: AbortSignal.timeout(1000)}); if (response.ok) break;} catch { /* Bounded startup poll of this child only. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const endpoint = target => `${appOrigin}/api/cloud/workspaces/${workspace}/artifacts/${target}`;
  async function request(actor, query = "version=1", account = actor?.id, target = artifact) {
    const headers = {};
    if (actor) headers.Cookie = [...actor.jar].map(([name, value]) => `${name}=${value}`).join("; ");
    if (account) headers["X-Makeborne-Account"] = account;
    return fetch(`${endpoint(target)}/source?${query}`, {headers, redirect: "error", signal: AbortSignal.timeout(15000)});
  }
  stage = "verify actual route and stored revisions";
  for (const role of ["owner", "editor"]) for (let number = 1; number <= 2; number++) {
    const response = await request(actors[role], `version=${number}`);
    assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("X-Makeborne-Revision"), revisions[number - 1].id);
    const zip = await JSZip.loadAsync(await response.arrayBuffer()), html = await zip.file("index.html").async("string");
    assert(html.includes(number === 1 ? "Original design" : "Revised design"));
    assert(!html.includes(number === 1 ? "Revised design" : "Original design"));
    const manifestRaw = await zip.file("manifest.json").async("string");
    assert.equal(response.headers.get("X-Makeborne-Manifest-Hash"), createHash("sha256").update(manifestRaw).digest("hex"));
    console.log(`PASS ${role} downloads saved version ${number} with exact revision and content`);
  }
  for (const [label, actor, query, account, status] of [
    ["anonymous", null, "version=1", null, 401], ["reviewer", actors.reviewer, "version=1", actors.reviewer.id, 403],
    ["other tenant", actors.outsider, "version=1", actors.outsider.id, 404], ["stale account", actors.owner, "version=1", actors.outsider.id, 409],
    ["missing revision", actors.owner, "version=99", actors.owner.id, 404], ["ambiguous version", actors.owner, "version=1&version=2", actors.owner.id, 400],
  ]) {
    const response = await request(actor, query, account); assert.equal(response.status, status); assert((await response.json()).error.code);
    console.log(`PASS ${label} denied (${status})`);
  }
  stage = "save canonical source through real HTTP with original private artwork";
  await grant(true);
  stage = "create canonical artifact";
  const fullArtifact = data(await actors.owner.client.rpc("makeborne_create_record", {p_workspace_id: workspace, p_request_key: randomUUID(), p_operation: "create_artifact", p_payload: {project_id: project, title: "Canonical source", kind: "website"}})).record.id;
  const assetId = randomUUID(), png = await sharp({create: {width: 8, height: 8, channels: 3, background: "#3559d8"}}).png().toBuffer();
  const sha256 = createHash("sha256").update(png).digest("hex"), objectPath = `${workspace}/${project}/artwork/${assetId}.png`;
  stage = "upload canonical artwork";
  data(await actors.owner.client.storage.from("project-assets").upload(objectPath, png, {contentType: "image/png", upsert: false}));
  stage = "register canonical artwork";
  data(await actors.owner.client.from("assets").insert({id: assetId, workspace_id: workspace, project_id: project, object_path: objectPath, content_type: "image/png", sha256}).select("id"));
  const source = {schemaVersion: 1, toolchainId: "react-vite-v1", entrypoint: "src/main.tsx",
    designDirection: {positioning: "Purposeful independent studio", composition: "Editorial project-led sequence", typography: "Confident display with readable supporting copy", palette: "Ivory, ink and cobalt", imagery: "Original approved project photography", motion: "Restrained with reduced-motion support"},
    files: [{path: "src/main.tsx", content: '// Canonical first revision\n'}, {path: "package.json", content: '{"private":true}'},
      {path: "package-lock.json", content: '{"lockfileVersion":3,"packages":{}}'}, {path: "index.html", content: '<!doctype html><div id="root"></div>'}],
    assets: [{id: assetId, path: "public/hero.png", sha256, bytes: png.length, mediaType: "image/png"}], routes: [{path: "/", title: "Home"}]};
  const fullContent = {schemaVersion: 1, title: "Canonical source", kind: "website", sections: [], websiteSource: source};
  const cookie = () => [...actors.owner.jar].map(([name, value]) => `${name}=${value}`).join("; ");
  async function saveSource(expectedVersion, nextContent, key = randomUUID()) {
    return fetch(`${endpoint(fullArtifact)}/versions`, {method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: {Cookie: cookie(), Origin: appOrigin, "X-Makeborne-Account": ownerId, "Content-Type": "application/json", "Idempotency-Key": key},
      body: JSON.stringify({expectedVersion, content: nextContent, style, assetIds: [assetId], changeSummary: "Canonical local fixture"})});
  }
  stage = "canonical HTTP initial save";
  const saveKey = randomUUID(), firstResponse = await saveSource(0, fullContent, saveKey);
  if (firstResponse.status !== 201) {
    const code = (await firstResponse.clone().json())?.error?.code;
    if (/^[A-Z_]{1,60}$/.test(code ?? "")) throw new Error(`LOCAL_OPERATION_${code}`);
  }
  assert.equal(firstResponse.status, 201); const first = await firstResponse.json();
  assert(first.version.content.websiteSource); assert.equal(first.version.content.sections.length, 0);
  assert.deepEqual(first.version.content.websiteSource.designDirection, source.designDirection);
  const replay = await saveSource(0, fullContent, saveKey); assert.equal(replay.status, 201);
  assert.equal((await replay.json()).version.id, first.version.id);
  console.log("PASS canonical source HTTP save verifies real private raster bytes and idempotent replay");
  stage = "canonical concurrent HTTP saves";
  const alternatives = ["second-a", "second-b"].map(label => {
    const value = structuredClone(fullContent); value.websiteSource.files[0].content = `// ${label}\n`;
    value.websiteSource.designDirection.composition = `Approved revision ${label}`; return value;
  });
  const raced = await Promise.all(alternatives.map(value => saveSource(1, value)));
  assert.deepEqual(raced.map(value => value.status).sort(), [201, 409]);
  const winner = raced.findIndex(value => value.status === 201), second = await raced[winner].json();
  const reopened = await fetch(endpoint(fullArtifact), {headers: {Cookie: cookie(), "X-Makeborne-Account": ownerId}, signal: AbortSignal.timeout(15000)});
  assert.equal(reopened.status, 200); const history = await reopened.json();
  assert.equal(history.artifact.currentVersion, 2); assert.equal(history.versions.length, 2);
  assert.equal(history.versions[0].id, second.version.id);
  assert.equal(history.versions[0].content.websiteSource.files.find(file => file.path === "src/main.tsx").content, alternatives[winner].websiteSource.files[0].content);
  assert.deepEqual(history.versions[0].content.websiteSource.designDirection, alternatives[winner].websiteSource.designDirection);
  console.log("PASS concurrent canonical saves yield one winner, one recoverable conflict and exact reopened history");
  stage = "canonical invalid input and asset identity guards";
  const invalidHash = structuredClone(alternatives[winner]); invalidHash.websiteSource.assets[0].sha256 = "a".repeat(64);
  assert.equal((await saveSource(2, invalidHash)).status, 409);
  stage = "canonical mixed representation guard";
  const mixed = {...alternatives[winner], website: content.website};
  assert.equal((await saveSource(2, mixed)).status, 400);
  stage = "canonical direct RPC asset guards";
  for (const [candidate, ids] of [[invalidHash, [assetId]], [alternatives[winner], []]]) {
    const rejected = await actors.owner.client.rpc("makeborne_save_artifact_version", {p_workspace_id: workspace, p_artifact_id: fullArtifact, p_expected_version: 2,
      p_content: candidate, p_style: style, p_asset_ids: ids, p_change_summary: "Must fail", p_request_key: randomUUID()});
    assert.equal(rejected.error?.code, "23514");
  }
  stage = "canonical direct RPC downgrade guard";
  const downgrade = await actors.owner.client.rpc("makeborne_save_artifact_version", {p_workspace_id: workspace, p_artifact_id: fullArtifact, p_expected_version: 2,
    p_content: content, p_style: style, p_asset_ids: [], p_change_summary: "Must fail", p_request_key: randomUUID()});
  assert.equal(downgrade.error?.code, "22023");
  stage = "canonical referenced metadata immutability guard";
  const metadataChange = await actors.owner.client.from("assets").update({sha256: "b".repeat(64)}).eq("id", assetId).select("id");
  assert.equal(metadataChange.error?.code, "42501"); // Browser role has no UPDATE grant.
  stage = "canonical referenced metadata privileged guards";
  const serverMetadataChange = await admin.from("assets").update({sha256: "b".repeat(64)}).eq("id", assetId).select("id");
  assert.equal(serverMetadataChange.error?.code, "23514");
  const serverMetadataDelete = await admin.from("assets").delete().eq("id", assetId).select("id");
  assert.equal(serverMetadataDelete.error?.code, "23514");
  stage = "canonical storage overwrite guard";
  const overwrite = await actors.owner.client.storage.from("project-assets").upload(objectPath, png, {contentType: "image/png", upsert: true});
  assert(overwrite.error);
  console.log("PASS changed asset hashes, mixed representations, direct RPC outline downgrade and referenced asset replacement denied");
  stage = "illustrated book and presentation HTTP saves";
  for (const kind of ["book", "presentation"]) {
    const documentProject = data(await actors.owner.client.rpc("makeborne_create_record", {p_workspace_id: workspace, p_request_key: randomUUID(), p_operation: "create_project", p_payload: {title: `Illustrated ${kind}`, kind}})).record.id;
    const documentArtifact = data(await actors.owner.client.rpc("makeborne_create_record", {p_workspace_id: workspace, p_request_key: randomUUID(), p_operation: "create_artifact", p_payload: {project_id: documentProject, title: `Illustrated ${kind}`, kind}})).record.id;
    const originalId = randomUUID(), corruptId = randomUUID(), missingId = randomUUID();
    const originalPath = `${workspace}/${documentProject}/artwork/${originalId}.png`;
    const corruptPath = `${workspace}/${documentProject}/artwork/${corruptId}.png`;
    for (const path of [originalPath, corruptPath]) data(await actors.owner.client.storage.from("project-assets").upload(path, png, {contentType: "image/png", upsert: false}));
    data(await actors.owner.client.from("assets").insert([
      {id: originalId, workspace_id: workspace, project_id: documentProject, object_path: originalPath, content_type: "image/png", sha256},
      {id: corruptId, workspace_id: workspace, project_id: documentProject, object_path: corruptPath, content_type: "image/png", sha256: "a".repeat(64)},
      {id: missingId, workspace_id: workspace, project_id: documentProject, object_path: `${workspace}/${documentProject}/artwork/${missingId}.png`, content_type: "image/png", sha256},
    ]).select("id"));
    const documentContent = id => ({schemaVersion: 1, title: `Illustrated ${kind}`, kind, sections: [{id: randomUUID(), title: "Original artwork", blocks: [{id: randomUUID(), type: "image", text: "Registered illustration", assetId: id}]}]});
    const originalContent = documentContent(originalId), documentStyle = {...style, referenceAssetIds: [originalId]};
    async function saveDocument(content, refs, expectedVersion, key = randomUUID(), actor = actors.owner) {
      return fetch(`${endpoint(documentArtifact)}/versions`, {method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: {Cookie: [...actor.jar].map(([name,value]) => `${name}=${value}`).join("; "), Origin: appOrigin, "X-Makeborne-Account": actor.id, "Content-Type": "application/json", "Idempotency-Key": key},
        body: JSON.stringify({expectedVersion, content, style: {...documentStyle, referenceAssetIds: refs}, assetIds: refs, changeSummary: "Verified original document artwork"})});
    }
    stage = `illustrated ${kind} initial save`;
    const key = randomUUID(), saved = await saveDocument(originalContent, [originalId], 0, key);
    assert.equal(saved.status, 201); const revision = (await saved.json()).version;
    assert.equal(revision.content.sections[0].blocks[0].assetId, originalId);
    stage = `illustrated ${kind} replay`;
    const replayed = await saveDocument(originalContent, [originalId], 0, key);
    assert.equal(replayed.status, 201); assert.equal((await replayed.json()).version.id, revision.id);
    for (const [id, expected] of [[corruptId, 409], [missingId, 503], [assetId, 409]]) {
      stage = `illustrated ${kind} bad original ${expected}`;
      const response = await saveDocument(documentContent(id), [id], 1);
      assert.equal(response.status, expected);
    }
    stage = `illustrated ${kind} foreign actor`;
    const foreign = await saveDocument(originalContent, [originalId], 1, randomUUID(), actors.outsider);
    assert.equal(foreign.status, 402);
    const foreignRows = data(await actors.outsider.client.from("assets").select("id").eq("workspace_id", workspace).eq("project_id", documentProject));
    assert.equal(foreignRows.length, 0);
    const foreignObject = await actors.outsider.client.storage.from("project-assets").download(originalPath);
    assert(foreignObject.error); assert.equal(foreignObject.data, null);
    stage = `illustrated ${kind} unchanged revision`;
    const current = data(await actors.owner.client.from("artifacts").select("current_version").eq("id", documentArtifact).single());
    assert.equal(current.current_version, 1);
    console.log(`PASS ${kind} actual HTTP/Auth/RLS/Storage original save/replay; corrupt, missing, foreign artwork and foreign actor refused without a revision`);
  }
  stage = "canonical premature publication guard";
  const publish = await fetch(`${endpoint(fullArtifact)}/publication`, {method: "POST",
    headers: {Cookie: cookie(), Origin: appOrigin, "Content-Type": "application/json", "X-Makeborne-Account": ownerId, "Idempotency-Key": randomUUID()},
    body: JSON.stringify({live: true, slug: `source-${runId.slice(0, 8)}`, version: 2, revision: 0, acknowledged: true}), signal: AbortSignal.timeout(15000)});
  assert.equal(publish.status, 409);
  assert.equal((await publish.json()).error.code, "BUILD_REQUIRED");
  console.log("PASS canonical source cannot publish through the legacy outline/static renderer before a verified build");
  await grant(false);
  stage = "canonical exact archive downloads";
  for (let number = 1; number <= 2; number++) {
    const response = await request(actors.owner, `version=${number}`, ownerId, fullArtifact); assert.equal(response.status, 200);
    const archive = await JSZip.loadAsync(await response.arrayBuffer());
    assert.equal(await archive.file("src/main.tsx").async("string"), number === 1 ? source.files[0].content : alternatives[winner].websiteSource.files[0].content);
    assert.equal(Buffer.compare(await archive.file("public/hero.png").async("nodebuffer"), png), 0);
    const manifestRaw = await archive.file(".makeborne/manifest.json").async("string"), manifest = JSON.parse(manifestRaw);
    assert.deepEqual(manifest.source.designDirection, number === 1 ? source.designDirection : alternatives[winner].websiteSource.designDirection);
    assert.equal(manifest.revisionId, number === 1 ? first.version.id : second.version.id);
    assert.equal(response.headers.get("X-Makeborne-Source-Hash"), manifest.sourceHash);
    assert.equal(response.headers.get("X-Makeborne-Manifest-Hash"), createHash("sha256").update(manifestRaw).digest("hex"));
  }
  for (const [role, status] of [["reviewer", 403], ["outsider", 404]]) assert.equal((await request(actors[role], "version=1", actors[role].id, fullArtifact)).status, status);
  console.log("PASS exact canonical source/archive/artwork downloads after grant revocation; reviewer and foreign tenant denied");
  console.log("PASS resolved design survives authenticated save, concurrent revision selection, reopen and exact per-version archive");
  data(await admin.from("workspace_members").delete().eq("workspace_id", workspace).eq("user_id", actors.editor.id).select("user_id"));
  assert.equal((await request(actors.editor)).status, 404);
  console.log("PASS revoked editor denied with existing session");
  console.log(`LOCAL SOURCE HTTP PASSED. Run ${runId}; disposable records remain local. No production or paid-provider evidence.`);
}
try {await main();} catch (error) {
  const safeAssertion = value => value === undefined ? "undefined" : typeof value === "number" ? String(value)
    : typeof value === "string" && /^[A-Z0-9_]{1,40}$/.test(value) ? value : "redacted";
  const detail = error?.code === "ERR_ASSERTION"
    ? ` expected ${safeAssertion(error.expected)}, received ${safeAssertion(error.actual)}` : /^LOCAL_OPERATION_[A-Za-z0-9_]+$/.test(error?.message ?? "") ? ` ${error.message}` : "";
  console.error(`LOCAL SOURCE CHECK FAILED at ${stage}${detail}; credentials and response bodies redacted.`); process.exitCode = 1;
}
finally {
  if (app && app.exitCode === null) app.kill();
  for (const client of clients) await client.auth.signOut().catch(() => {});
  try {await grant(false); console.log("PASS temporary source fixture grant cleanup");} catch {console.error("LOCAL SOURCE GRANT CLEANUP FAILED"); process.exitCode = 1;}
}

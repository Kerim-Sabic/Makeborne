/** Disposable LOCAL database verification. Never accepts a remote Supabase endpoint. */
import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { CLIENT_LIST_SELECTION } from "../src/lib/cloud/client-selection.ts";

const expectedOrigin = "http://127.0.0.1:55321";
if (process.env.MAKEBORNE_VERIFY_LOCAL_FIXTURES !== "true") {
  console.log("NOT RUN: explicitly set MAKEBORNE_VERIFY_LOCAL_FIXTURES=true for disposable local fixtures.");
  process.exit(2);
}
const path = process.env.MAKEBORNE_LOCAL_STATUS_FILE;
if (!path) { console.log("NOT RUN: provide MAKEBORNE_LOCAL_STATUS_FILE securely."); process.exit(2); }
let stage = "read local credentials";
const clients = [];
const fixtureAccountIds = [];
// Current schema requires creation access even for disposable workspace setup.
// Grant only the generated local actors; never enable public billing or modify real users.
async function localFixtureGrants(enabled) {
  if (fixtureAccountIds.length === 0) return;
  if (!fixtureAccountIds.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("LOCAL_FIXTURE_ID_INVALID");
  }
  const ids = fixtureAccountIds.map(id => `'${id}'::uuid`).join(",");
  const sql = enabled
    ? `insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason)
       select id,true,false,'Disposable local isolation fixture' from auth.users where id in (${ids});`
    : `delete from makeborne_private.account_privileges where user_id in (${ids})
       and reason='Disposable local isolation fixture';`;
  await new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", "supabase_db_makeborne-local", "psql",
      "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    {windowsHide: true, timeout: 15000, stdio: ["pipe", "ignore", "ignore"]});
    child.on("error", () => reject(new Error("LOCAL_FIXTURE_GRANT_PROCESS_FAILED")));
    child.on("exit", code => code === 0 ? resolve() : reject(new Error("LOCAL_FIXTURE_GRANT_FAILED")));
    child.stdin.on("error", () => reject(new Error("LOCAL_FIXTURE_GRANT_INPUT_FAILED")));
    child.stdin.end(sql);
  });
}
try {
  const status = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
  const publicKey = status.PUBLISHABLE_KEY || status.ANON_KEY;
  const secretKey = status.SECRET_KEY || status.SERVICE_ROLE_KEY;
  if (status.API_URL !== expectedOrigin || !publicKey || !secretKey) {
    throw new Error("LOCAL_CONFIG_INVALID");
  }
  const guardedFetch = (input, init = {}) => {
    const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (target.origin !== expectedOrigin) throw new Error("NON_LOCAL_REQUEST_DENIED");
    return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });
  };
  const makeClient = (key) => {
    const client = createClient(expectedOrigin, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: guardedFetch },
    });
    clients.push(client);
    return client;
  };
  const requireData = ({ data, error }) => {
    if (error || !data) {
      const upstreamCode = String(error?.code || error?.statusCode || "EXPECTED_DATA_MISSING");
      throw new Error(`UPSTREAM_${/^[a-zA-Z0-9_]{1,40}$/.test(upstreamCode) ? upstreamCode.toUpperCase() : "REDACTED"}`);
    }
    return data;
  };
  const admin = makeClient(secretKey);
  const runId = randomUUID();
  const actors = {};
  for (const role of ["ownerA", "ownerB", "reviewer", "fresh"]) {
    stage = `create and authenticate ${role}`;
    const email = `makeborne-${runId}-${role.toLowerCase()}@example.com`;
    const password = randomBytes(32).toString("base64url");
    const account = requireData(await admin.auth.admin.createUser({ email, password, email_confirm: true }));
    const client = makeClient(publicKey);
    const login = requireData(await client.auth.signInWithPassword({ email, password }));
    if (!login.session?.access_token || account.user.id !== login.user.id) throw new Error("AUTH_CONTROL_FAILED");
    actors[role] = { client, id: account.user.id, token: login.session.access_token };
    if (role !== "reviewer") fixtureAccountIds.push(account.user.id);
  }
  console.log("PASS: four independent local accounts authenticate");
  stage = "grant scoped local fixture creation access";
  await localFixtureGrants(true);
  console.log("PASS: local owner fixtures receive scoped admin creation access without unlimited credits; public billing remains unchanged");
  for (const role of ["ownerA", "ownerB"]) {
    stage = `create ${role} workspace and project`;
    const actor = actors[role];
    actor.workspace = requireData(await actor.client.rpc("makeborne_create_workspace", {
      p_request_key: randomUUID(), p_name: `Local verification ${runId} ${role}`,
    })).workspace.id;
    actor.project = requireData(await actor.client.rpc("makeborne_create_record", {
      p_workspace_id: actor.workspace, p_request_key: randomUUID(), p_operation: "create_project",
      p_payload: { title: `Local isolation ${role}`, kind: "website" },
    })).record.id;
  }
  stage = "assign reviewer to local fixture";
  requireData(await admin.from("workspace_members").insert({
    workspace_id: actors.ownerA.workspace, user_id: actors.reviewer.id, role: "reviewer",
  }).select("user_id").single());
  stage = "execute isolation checks";
  const crm = requireData(await actors.ownerA.client.rpc("makeborne_create_record", {
    p_workspace_id: actors.ownerA.workspace, p_request_key: randomUUID(), p_operation: "create_client",
    p_payload: { name: "CRM loading fixture" },
  })).record;
  const outreach = { stage: "Contacted", channel: "Instagram", profileUrl: "https://example.com/profile", lastContact: null,
    nextFollowUp: "2026-10-05", notes: "Loading fixture", activity: Array.from({ length: 100 }, () => ({ id: randomUUID(),
      at: new Date().toISOString(), type: "note", text: "Approved fixture text. ".repeat(50) })) };
  requireData(await actors.ownerA.client.from("clients").update({ outreach }).eq("id", crm.id).select("id").single());
  const summary = requireData(await actors.ownerA.client.from("clients").select(CLIENT_LIST_SELECTION).eq("id", crm.id).single());
  const detail = requireData(await actors.ownerA.client.from("clients").select("*").eq("id", crm.id).single());
  if ("outreach" in summary || summary.outreach_stage !== "Contacted" || summary.outreach_follow_up !== "2026-10-05") throw new Error("CRM_PROJECTION_FAILED");
  if (detail.outreach.activity.length !== 100 || JSON.stringify(summary).length * 20 >= JSON.stringify(detail).length) throw new Error("CRM_HISTORY_LOADING_FAILED");
  const hidden = requireData(await actors.ownerB.client.from("clients").select("*").eq("id", crm.id));
  if (hidden.length) throw new Error("CRM_DETAIL_TENANT_LEAK");
  console.log("PASS: client list excludes 100-entry history; detail retains it; summary is over 20x smaller; other tenant cannot read detail");
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./verify-isolation.mjs", import.meta.url))], {
      stdio: "inherit", windowsHide: true,
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: expectedOrigin,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
        MAKEBORNE_VERIFY_OWNER_A_TOKEN: actors.ownerA.token,
        MAKEBORNE_VERIFY_OWNER_B_TOKEN: actors.ownerB.token,
        MAKEBORNE_VERIFY_REVIEWER_A_TOKEN: actors.reviewer.token,
        MAKEBORNE_VERIFY_FRESH_OWNER_TOKEN: actors.fresh.token,
        MAKEBORNE_VERIFY_WORKSPACE_A: actors.ownerA.workspace,
        MAKEBORNE_VERIFY_WORKSPACE_B: actors.ownerB.workspace,
        MAKEBORNE_VERIFY_PROJECT_A: actors.ownerA.project,
        MAKEBORNE_VERIFY_DISPOSABLE_MUTATIONS: "true" },
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error("ISOLATION_CHECKS_FAILED");
  stage = "verify private immutable storage";
  const bucket = "project-assets";
  const objectPath = `${actors.ownerA.workspace}/${runId}/fixture.png`;
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  stage = "owner storage upload";
  requireData(await actors.ownerA.client.storage.from(bucket).upload(objectPath, bytes, { contentType: "image/png" }));
  stage = "owner storage download";
  const ownerDownload = requireData(await actors.ownerA.client.storage.from(bucket).download(objectPath));
  if (!Buffer.from(await ownerDownload.arrayBuffer()).equals(bytes)) throw new Error("STORAGE_POSITIVE_CONTROL_FAILED");
  stage = "reviewer storage download";
  requireData(await actors.reviewer.client.storage.from(bucket).download(objectPath));
  const deniedStorage = async (result, code) => {
    if (!result.error || !["400", "401", "403", "404"].includes(String(result.error.statusCode ?? result.error.status))) {
      throw new Error(code);
    }
  };
  stage = "storage negative permissions";
  await deniedStorage(await actors.ownerB.client.storage.from(bucket).download(objectPath), "CROSS_WORKSPACE_STORAGE_ACCESS");
  await deniedStorage(await actors.reviewer.client.storage.from(bucket).upload(
    `${actors.ownerA.workspace}/${runId}/denied.png`, bytes, { contentType: "image/png" }), "REVIEWER_STORAGE_WRITE");
  await deniedStorage(await actors.ownerA.client.storage.from(bucket).upload(
    objectPath, bytes, { contentType: "image/png", upsert: true }), "IMMUTABLE_STORAGE_OVERWRITE");
  const preserved = requireData(await actors.ownerA.client.storage.from(bucket).download(objectPath));
  if (!Buffer.from(await preserved.arrayBuffer()).equals(bytes)) throw new Error("STORAGE_BYTES_CHANGED");
  console.log("PASS: owner upload/download and reviewer read; cross-workspace read, reviewer upload and overwrite denied");
  stage = "verify project-scoped source and asset references";
  const siblingProject = requireData(await actors.ownerA.client.rpc("makeborne_create_record", {
    p_workspace_id: actors.ownerA.workspace, p_request_key: randomUUID(), p_operation: "create_project",
    p_payload: {title: "Sibling reference fixture", kind: "website"},
  })).record.id;
  const referenceLocations = [
    {workspace: actors.ownerA.workspace, project: actors.ownerA.project},
    {workspace: actors.ownerA.workspace, project: siblingProject},
    {workspace: actors.ownerB.workspace, project: actors.ownerB.project},
  ];
  const fixtureAssets = requireData(await admin.from("assets").insert(referenceLocations.map(location => ({
    workspace_id: location.workspace, project_id: location.project,
    object_path: `${location.workspace}/${randomUUID()}/reference.png`, content_type: "image/png",
  }))).select("id,project_id"));
  const fixtureSources = requireData(await admin.from("sources").insert(referenceLocations.map(location => ({
    workspace_id: location.workspace, project_id: location.project, kind: "text", title: "Local source fixture",
    content: "Permitted local fixture content", approved: true,
  }))).select("id,project_id"));
  const assetFor = projectId => fixtureAssets.find(asset => asset.project_id === projectId).id;
  const sourceFor = projectId => fixtureSources.find(source => source.project_id === projectId).id;
  const referenceArtifact = requireData(await actors.ownerA.client.rpc("makeborne_create_record", {
    p_workspace_id: actors.ownerA.workspace, p_request_key: randomUUID(), p_operation: "create_artifact",
    p_payload: {project_id: actors.ownerA.project, title: "Reference isolation fixture", kind: "website"},
  })).record.id;
  const referenceVersion = {
    p_workspace_id: actors.ownerA.workspace, p_artifact_id: referenceArtifact, p_expected_version: 0,
    p_content: {schemaVersion: 1, kind: "website", title: "Reference isolation fixture", sections: [{
      id: randomUUID(), title: "Fixture section", blocks: [{id: randomUUID(), type: "paragraph", text: "Fixture",
        locked: false, assetId: assetFor(actors.ownerA.project), sourceIds: [sourceFor(actors.ownerA.project)]}],
    }]},
    p_style: {id: "fixture", name: "Fixture", version: 1, typography: {headingFont: "Inter", bodyFont: "Inter"},
      colors: {ink: "#16181D"}, description: "Local reference fixture", referenceAssetIds: []},
    p_asset_ids: [assetFor(actors.ownerA.project)], p_change_summary: "Local reference control", p_request_key: randomUUID(),
  };
  const ownVersion = requireData(await actors.ownerA.client.rpc("makeborne_save_artifact_version", referenceVersion));
  if (ownVersion.version.version_number !== 1) throw new Error("PROJECT_REFERENCE_CONTROL_FAILED");
  for (const location of referenceLocations.slice(1)) {
    for (const referenceKind of ["asset", "source"]) {
      const changed = structuredClone(referenceVersion);
      changed.p_expected_version = 1;
      changed.p_request_key = randomUUID();
      if (referenceKind === "asset") {
        changed.p_asset_ids = [assetFor(location.project)];
        changed.p_content.sections[0].blocks[0].assetId = assetFor(location.project);
      } else changed.p_content.sections[0].blocks[0].sourceIds = [sourceFor(location.project)];
      const rejected = await actors.ownerA.client.rpc("makeborne_save_artifact_version", changed);
      if (!rejected.error || rejected.error.code !== "23514") throw new Error("FOREIGN_PROJECT_REFERENCE_ACCEPTED");
    }
  }
  const preservedVersion = requireData(await actors.ownerA.client.from("artifacts").select("current_version").eq("id", referenceArtifact).single());
  const preservedSnapshots = requireData(await actors.ownerA.client.from("artifact_versions").select("id").eq("artifact_id", referenceArtifact));
  if (preservedVersion.current_version !== 1 || preservedSnapshots.length !== 1) throw new Error("REJECTED_REFERENCE_CHANGED_REVISION");
  console.log("PASS: own-project asset/source references save; sibling-project and foreign-workspace references reject without changing accepted revision");
  stage = "revoke reviewer membership";
  const revoked = requireData(await admin.from("workspace_members").delete()
    .eq("workspace_id", actors.ownerA.workspace).eq("user_id", actors.reviewer.id).select("user_id"));
  if (revoked.length !== 1) throw new Error("REVOCATION_CONTROL_FAILED");
  const invisible = requireData(await actors.reviewer.client.from("projects").select("id").eq("id", actors.ownerA.project));
  if (invisible.length !== 0) throw new Error("REVOKED_MEMBER_RETAINED_ACCESS");
  await deniedStorage(await actors.reviewer.client.storage.from(bucket).download(objectPath), "REVOKED_MEMBER_STORAGE_ACCESS");
  console.log("PASS: membership revocation immediately removes project and storage access with existing session");
  console.log(`LOCAL FIXTURES PASSED. Run ${runId}; fixtures remain in the dedicated local database for inspection.`);
  console.log("Not production acceptance: browser auth/recovery, provider workers, payments and hosting remain separate checks.");
} catch (error) {
  // Never log upstream exception messages: they can contain request URLs or credentials.
  const code = /^[A-Z0-9_]{3,60}$/.test(error?.message ?? "") ? error.message : "DETAILS_REDACTED";
  console.error(`FAIL: ${stage} (${code}). Local fixtures may remain; no unrelated data was changed.`);
  process.exitCode = 1;
} finally {
  try {
    await localFixtureGrants(false);
    console.log("PASS: temporary local fixture administrator grants revoked");
  } catch {
    console.error("FAIL: temporary local fixture grants require scoped cleanup; never enable public billing to bypass this failure.");
    process.exitCode = 1;
  }
  for (const client of clients) await client.auth.stopAutoRefresh();
}

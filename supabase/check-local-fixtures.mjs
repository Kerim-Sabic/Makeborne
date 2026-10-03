/** Disposable LOCAL database verification. Never accepts a remote Supabase endpoint. */
import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const expectedOrigin = "http://127.0.0.1:55321";
if (process.env.MAKEBORNE_VERIFY_LOCAL_FIXTURES !== "true") {
  console.log("NOT RUN: explicitly set MAKEBORNE_VERIFY_LOCAL_FIXTURES=true for disposable local fixtures.");
  process.exit(2);
}
const path = process.env.MAKEBORNE_LOCAL_STATUS_FILE;
if (!path) { console.log("NOT RUN: provide MAKEBORNE_LOCAL_STATUS_FILE securely."); process.exit(2); }
let stage = "read local credentials";
const clients = [];
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
  }
  console.log("PASS: four independent local accounts authenticate");
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
  stage = "revoke reviewer membership";
  const revoked = requireData(await admin.from("workspace_members").delete()
    .eq("workspace_id", actors.ownerA.workspace).eq("user_id", actors.reviewer.id).select("user_id"));
  if (revoked.length !== 1) throw new Error("REVOCATION_CONTROL_FAILED");
  const invisible = requireData(await actors.reviewer.client.from("projects").select("id").eq("id", actors.ownerA.project));
  if (invisible.length !== 0) throw new Error("REVOKED_MEMBER_RETAINED_ACCESS");
  await deniedStorage(await actors.reviewer.client.storage.from(bucket).download(objectPath), "REVOKED_MEMBER_STORAGE_ACCESS");
  console.log("PASS: membership revocation immediately removes project and storage access with existing session");
  console.log(`LOCAL FIXTURES PASSED. Run ${runId}; fixtures remain in the dedicated local database for inspection.`);
  console.log("Not production acceptance: browser auth/recovery, cross-project asset references, provider workers, payments and hosting remain separate checks.");
} catch (error) {
  // Never log upstream exception messages: they can contain request URLs or credentials.
  const code = /^[A-Z0-9_]{3,60}$/.test(error?.message ?? "") ? error.message : "DETAILS_REDACTED";
  console.error(`FAIL: ${stage} (${code}). Local fixtures may remain; no unrelated data was changed.`);
  process.exitCode = 1;
} finally {
  for (const client of clients) await client.auth.stopAutoRefresh();
}

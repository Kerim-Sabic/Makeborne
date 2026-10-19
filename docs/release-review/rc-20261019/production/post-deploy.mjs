// OWNER-APPROVED post-deploy verification and watch for the rc-20261019 release (RELEASE_PROCEDURE.md step 3).
// Read-only. Subcommands:
//   deployment <expectedCommit>  production target is READY on that commit and makeborne.com points to it
//   checks                       public behaviour, builder state, help copy, telemetry, and a classification of every
//                                production artifact's current version with the candidate's savedFormat (counts and
//                                ids only; no content is printed or stored)
//   watch <minutes>              health probes every minute plus runtime error/fatal and 5xx request records
// Run from the LF archive of a6e70c6 (needs node_modules, the operator files and the candidate's src/).
import fs from "node:fs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rootCertificates } from "node:tls";
import pg from "pg";
import ts from "typescript";

const MAIN = "C:/Users/kerim/Documents/Codex/2026-10-03/referenced-chatgpt-conversation-this-is-an/work/makeborne-app";
const PUBLIC = `${MAIN}/.claude/worktrees/rc-20261019/docs/release-review/rc-20261019/production`;
const PROJECT = "prj_UzMAuCP7X4yeBP6FrUFCDlJ5GWHh", TEAM = "team_viiayqU1BnwJBdEqgHdgmtnA", REF = "rklojnmmsmhwnkbzuidp";
const CLI = "C:/Users/kerim/AppData/Local/npm-cache/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js";
const SITE = "https://makeborne.com";
const vercelToken = () => JSON.parse(fs.readFileSync("C:/Users/kerim/AppData/Roaming/com.vercel.cli/Data/auth.json")).token;
const vercel = async path => (await fetch(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${TEAM}`, { headers: { Authorization: `Bearer ${vercelToken()}` } })).json();
const writeJson = (name, value) => fs.writeFileSync(`${PUBLIC}/${name}`, JSON.stringify(value, null, 2));
const command = process.argv[2];

async function production() {
  const p = await vercel(`/v9/projects/${PROJECT}`), t = p.targets?.production;
  return { id: t?.id, url: t?.url, commit: t?.meta?.githubCommitSha, readyState: t?.readyState, aliases: t?.alias ?? [] };
}

if (command === "deployment") {
  const expected = process.argv[3];
  const d = await production();
  const result = { at: new Date().toISOString(), ...d, expectedCommit: expected, passed: d.commit === expected && d.readyState === "READY" && d.aliases.includes("makeborne.com") };
  writeJson("06-deployment.json", result); console.log(JSON.stringify(result, null, 2)); if (!result.passed) process.exitCode = 1;
} else if (command === "checks") {
  const out = { at: new Date().toISOString(), site: SITE, checks: {} };
  const page = async path => { const r = await fetch(SITE + path, { redirect: "manual" }); return { status: r.status, text: await r.text(), robots: r.headers.get("x-robots-tag") }; };
  for (const path of ["/", "/help", "/help/publish-your-website", "/help/make-a-book-with-ai", "/billing", "/login", "/portal/login"]) {
    const r = await page(path); out.checks[path] = { status: r.status, printReady: /print-ready/i.test(r.text), liveInSeconds: /live in seconds/i.test(r.text), robots: r.robots };
  }
  const build = await (await fetch(`${SITE}/api/build`, { cache: "no-store" })).json();
  out.checks["/api/build"] = { available: build.available, configured: build.configured, state: build.state, estimates: typeof build.estimates === "object" };
  const workspaces = await fetch(`${SITE}/api/workspaces`); out.checks["/api/workspaces (signed out)"] = { status: workspaces.status };
  const telemetry = await fetch(`${SITE}/api/telemetry`, { method: "POST", headers: { "Content-Type": "application/json", Origin: SITE }, body: JSON.stringify({ kind: "visit", page: "/studio" }) });
  out.checks["POST /api/telemetry (signed out)"] = { status: telemetry.status };
  // Classification with the candidate's own savedFormat (transpiled from src/lib/cloud/saved-preview.ts).
  const transpile = file => { const m = { exports: {} }; new Function("module", "exports", "require", ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(m, m.exports, () => ({})); return m.exports; };
  const { savedFormat } = transpile("src/lib/cloud/saved-preview.ts");
  let pw = fs.readFileSync(`${MAIN}/.env.production-db.private`, "utf8").replace(/^\uFEFF/, "").match(/^SUPABASE_PRODUCTION_DB_PASSWORD\s*=\s*([^\r\n]+)/m)[1].trim(); if (pw.startsWith('"')) pw = JSON.parse(pw);
  const token = fs.readFileSync("C:/Users/kerim/.supabase/access-token", "utf8").trim();
  const pools = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/config/database/pooler`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const url = new URL((pools.find(p => p.database_type === "PRIMARY") ?? pools[0]).connection_string);
  assert.equal(url.username, `postgres.${REF}`);
  const db = new pg.Client({ host: url.hostname, port: 5432, user: url.username, password: pw, database: "postgres", ssl: { rejectUnauthorized: true, ca: rootCertificates.join("\n") + "\n" + fs.readFileSync(`${MAIN}/work/release-auth-stack/supabase-ca.crt`, "utf8") } });
  await db.connect();
  try {
    await db.query("begin read only");
    const rows = (await db.query("select a.id, a.kind, a.current_version, v.content from public.artifacts a join public.artifact_versions v on v.artifact_id = a.id and v.version_number = a.current_version")).rows;
    const visits = (await db.query("select count(*)::int n from makeborne_private.studio_visits")).rows[0].n;
    const errors = (await db.query("select count(*)::int n from makeborne_private.app_error_groups")).rows[0].n;
    await db.query("commit");
    const counts = {}, legacy = [];
    for (const row of rows) {
      const format = savedFormat(row.content, row.current_version);
      counts[`${row.kind}:${format}`] = (counts[`${row.kind}:${format}`] ?? 0) + 1;
      if (format === "outline" || format === "website-design") legacy.push({ id: row.id, kind: row.kind, version: row.current_version, format });
    }
    const audited = JSON.parse(fs.readFileSync(`${MAIN}/work/launch-audit-20261019/legacy-documents.json`, "utf8")).map(r => r.id);
    // Invariant I1 as observed in production data: every record with content beyond its title opens as a saved format.
    // (The audit's 13 included empty v1 drafts whose only block is the title heading; those are correctly "starting".)
    const SAVED = new Set(["outline", "website-design", "website-source", "document"]);
    const hasContent = c => Boolean(c.website || c.websiteSource || c.document) || (c.sections ?? []).some(s => (s.title && s.title !== c.title) || (s.blocks ?? []).some(b => b.assetId || (b.text && b.text !== c.title)));
    const withContent = rows.filter(r => hasContent(r.content));
    const contentNotSaved = withContent.filter(r => !SAVED.has(savedFormat(r.content, r.current_version))).map(r => r.id);
    out.classification = { artifacts: rows.length, counts, withContent: withContent.length, contentNotSaved, legacyRecords: legacy.length, legacyByKind: legacy.reduce((t, r) => ({ ...t, [r.kind]: (t[r.kind] ?? 0) + 1 }), {}),
      auditedIdsAllSaved: audited.every(id => legacy.some(r => r.id === id)), auditedIds: audited.length, legacy };
    out.telemetryTables = { studioVisits: visits, errorGroups: errors };
  } finally { await db.end(); }
  out.passed = Object.entries(out.checks).filter(([k]) => k.startsWith("/") && !k.startsWith("/api")).every(([, c]) => c.status === 200 && !c.printReady && !c.liveInSeconds)
    && out.checks["/api/build"].available === false && out.checks["/api/build"].estimates && out.classification.withContent > 0 && out.classification.contentNotSaved.length === 0;
  writeJson("07-post-deploy-checks.json", out); console.log(JSON.stringify(out, null, 2)); if (!out.passed) process.exitCode = 1;
} else if (command === "watch") {
  const minutes = Number(process.argv[3] ?? 30), d = await production(), start = new Date();
  const record = { sourceCommit: d.commit, deploymentId: d.id, start: start.toISOString(), requiredMinutes: minutes, iterations: [], runtimeErrorRecords: 0, serverErrorRecords: 0, httpFailures: 0, logQueryFailures: 0 };
  const probes = [["/", 200], ["/portal/login", 200], ["/help", 200], ["/sitemap.xml", 200], ["/robots.txt", 200], ["/api/workspaces", 401], ["/api/build", 200]];
  const logs = (source, query, since) => {
    const r = spawnSync(process.execPath, [CLI, "logs", source, "--project", PROJECT, "--deployment", d.id, "--scope", "kerimsabic-6594s-projects", "--since", since, "--query", query, "--json", "--limit", "100", "--non-interactive"], { encoding: "utf8", timeout: 90000, maxBuffer: 16e6 });
    if (r.status !== 0) return { ok: false };
    const lines = (r.stdout ?? "").trim().split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const entries = lines.filter(l => l.type !== "summary");
    return { ok: true, count: entries.length, sample: entries.slice(0, 3).map(e => ({ level: e.level, path: e.requestPath ?? e.path ?? null, status: e.httpStatus ?? e.statusCode ?? null, message: String(e.message ?? "").slice(0, 160) })) };
  };
  let since = start.toISOString();
  for (let i = 0; Date.now() - start.getTime() < minutes * 60000 + 30000; i++) {
    const at = new Date();
    const health = [];
    for (const [path, expected] of probes) {
      try { const r = await fetch(SITE + path, { redirect: "manual", signal: AbortSignal.timeout(20000) }); health.push({ path, status: r.status, passed: r.status === expected }); }
      catch (error) { health.push({ path, status: null, passed: false, error: String(error.message).slice(0, 80) }); }
    }
    try { const r = await fetch("https://makeborne.site/", { redirect: "manual", signal: AbortSignal.timeout(20000) }); health.push({ path: "makeborne.site/", status: r.status, passed: r.status === 308 }); } catch { health.push({ path: "makeborne.site/", status: null, passed: false }); }
    const runtime = logs("runtime", "level:error OR level:fatal", since), requests = logs("requests", "httpStatus >= 500", since);
    since = at.toISOString();
    record.httpFailures += health.filter(h => !h.passed).length;
    if (!runtime.ok || !requests.ok) record.logQueryFailures++;
    record.runtimeErrorRecords += runtime.count ?? 0; record.serverErrorRecords += requests.count ?? 0;
    record.iterations.push({ at: at.toISOString(), health, runtime, requests });
    fs.writeFileSync(`${PUBLIC}/${process.env.WATCH_OUT ?? "08-watch.json"}`, JSON.stringify(record, null, 2));
    await new Promise(resolve => setTimeout(resolve, 60000));
  }
  record.end = new Date().toISOString(); record.elapsedSeconds = Math.round((Date.now() - start.getTime()) / 1000);
  record.passed = record.elapsedSeconds >= minutes * 60 && record.httpFailures === 0 && record.runtimeErrorRecords === 0 && record.serverErrorRecords === 0 && record.logQueryFailures === 0;
  writeJson(process.env.WATCH_OUT ?? "08-watch.json", record);
  console.log(JSON.stringify({ ...record, iterations: record.iterations.length }, null, 2)); if (!record.passed) process.exitCode = 1;
} else { console.error("usage: deployment <commit> | checks | watch <minutes>"); process.exitCode = 2; }

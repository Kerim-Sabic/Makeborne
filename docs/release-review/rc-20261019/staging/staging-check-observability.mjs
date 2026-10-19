// Runs supabase/check-app-observability.sql against STAGING inside its own rolled-back transaction.
import fs from "node:fs"; import pg from "pg"; import assert from "node:assert/strict";
const dir = "C:/Users/kerim/Documents/Codex/2026-10-03/referenced-chatgpt-conversation-this-is-an/work/makeborne-app/work/release-studio-parity-repair-20261017";
const config = JSON.parse(fs.readFileSync("work/release-auth-stack/cloud-staging.json", "utf8").replace(/^\uFEFF/, ""));
const ep = JSON.parse(fs.readFileSync(dir + "/staging-endpoint.json", "utf8")); assert.equal(ep.ref, "xzwikrunwpurxnxgkznh");
const db = new pg.Client({ host: ep.host, port: 5432, user: ep.user, password: config.password, database: "postgres", ssl: { rejectUnauthorized: true, ca: fs.readFileSync(dir + "/trusted-ca.crt", "utf8") } });
const notices = []; db.on("notice", n => notices.push(n.message));
await db.connect();
try {
  // psql meta-commands (lines starting with a backslash) are not SQL.
  const sql = fs.readFileSync("supabase/check-app-observability.sql", "utf8").split("\n").filter(line => !line.startsWith("\\")).join("\n");
  await db.query(sql);
  const residue = (await db.query("select (select count(*) from makeborne_private.app_error_groups)::int errors, (select count(*) from makeborne_private.studio_visits)::int visits")).rows[0];
  console.log(JSON.stringify({ target: "staging xzwikrunwpurxnxgkznh", passed: true, notices: notices.filter(n => /PASS/.test(n)), residueAfter: residue }, null, 2));
} catch (error) { console.log(JSON.stringify({ passed: false, error: error.message, notices }, null, 2)); process.exitCode = 1; }
finally { await db.end(); }

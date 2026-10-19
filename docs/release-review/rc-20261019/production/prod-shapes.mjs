// Read-only shape census of production artifacts' current versions (no content printed): why does savedFormat say "starting"?
import fs from "node:fs"; import pg from "pg"; import ts from "typescript"; import { rootCertificates } from "node:tls";
const MAIN = "C:/Users/kerim/Documents/Codex/2026-10-03/referenced-chatgpt-conversation-this-is-an/work/makeborne-app";
const m = { exports: {} }; new Function("module", "exports", "require", ts.transpileModule(fs.readFileSync("src/lib/cloud/saved-preview.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(m, m.exports, () => ({}));
const { savedFormat } = m.exports;
let pw = fs.readFileSync(`${MAIN}/.env.production-db.private`, "utf8").replace(/^\uFEFF/, "").match(/^SUPABASE_PRODUCTION_DB_PASSWORD\s*=\s*([^\r\n]+)/m)[1].trim(); if (pw.startsWith('"')) pw = JSON.parse(pw);
const token = fs.readFileSync("C:/Users/kerim/.supabase/access-token", "utf8").trim();
const pools = await (await fetch("https://api.supabase.com/v1/projects/rklojnmmsmhwnkbzuidp/config/database/pooler", { headers: { Authorization: `Bearer ${token}` } })).json();
const url = new URL((pools.find(p => p.database_type === "PRIMARY") ?? pools[0]).connection_string);
const db = new pg.Client({ host: url.hostname, port: 5432, user: url.username, password: pw, database: "postgres", ssl: { rejectUnauthorized: true, ca: rootCertificates.join("\n") + "\n" + fs.readFileSync(`${MAIN}/work/release-auth-stack/supabase-ca.crt`, "utf8") } });
await db.connect(); await db.query("begin read only");
const rows = (await db.query("select a.id, a.kind, a.current_version, a.title = (v.content->>'title') same_title, v.content from public.artifacts a join public.artifact_versions v on v.artifact_id=a.id and v.version_number=a.current_version order by a.kind, a.current_version desc")).rows;
await db.query("commit"); await db.end();
const audited = new Set(JSON.parse(fs.readFileSync(`${MAIN}/work/launch-audit-20261019/legacy-documents.json`, "utf8")).map(r => r.id));
const PLACEHOLDER = /^(untitled|new section|section \d+|page \d+|slide \d+|chapter \d+)$/i;
console.log(JSON.stringify(rows.map(r => {
  const c = r.content, sections = c.sections ?? [], blocks = sections.flatMap(s => s.blocks ?? []);
  return { id: r.id.slice(0, 8), audited: audited.has(r.id), kind: r.kind, v: r.current_version, format: savedFormat(c, r.current_version), keys: Object.keys(c).sort().join(","),
    sections: sections.length, blocks: blocks.length, blockTypes: [...new Set(blocks.map(b => b.type))].join(","), textChars: blocks.reduce((t, b) => t + (b.text?.length ?? 0), 0),
    sectionTitlesEqualDocTitle: sections.filter(s => s.title === c.title).length, sectionTitles: sections.map(s => (s.title ?? "").length), blockEqualsTitle: blocks.filter(b => b.text === c.title).length,
    website: c.website ? Object.keys(c.website).join(",") : null };
}), null, 0).replace(/\},\{/g, "},\n{"));

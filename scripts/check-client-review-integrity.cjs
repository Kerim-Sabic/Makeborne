/* eslint-disable @typescript-eslint/no-require-imports -- Local isolated PostgreSQL verification. */
const { spawn, spawnSync } = require("node:child_process");
const { randomUUID, randomBytes } = require("node:crypto");
const assert = require("node:assert/strict");
const fs = require("node:fs"), ts = require("typescript"), Module = require("node:module");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { emptyDocument } = require("../src/lib/documents/editor.ts");
const { projectDocument } = require("../src/lib/documents/project.ts");
const { ArtifactContentSchema } = require("../src/lib/domain.ts");
const container = "supabase_db_makeborne-release-auth", database = "makeborne_client_review_20261013";
const args = ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-q", "-A", "-t"];
function sql(text) {
 const result = spawnSync("docker", args, { input: text, encoding: "utf8" });
 if (result.status !== 0) throw Error(result.stderr || result.stdout);
 return result.stdout;
}
const user = randomUUID(), workspace = randomUUID(), project = randomUUID(), artifact = randomUUID(), link = randomUUID();
const token = randomBytes(32).toString("base64url");
async function race(version, mutation) {
 const writer = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
 let output = "";
 const locked = new Promise((resolve, reject) => {
  const observe = data => { output += data; if (output.includes("REVIEW_WRITER_LOCKED")) resolve(); };
  writer.stdout.on("data", observe); writer.stderr.on("data", observe);
  writer.on("error", reject); writer.on("exit", code => { if (!output.includes("REVIEW_WRITER_LOCKED")) reject(Error(output + code)); });
 });
 const finished = new Promise((resolve, reject) => writer.on("exit", code => code === 0 ? resolve() : reject(Error(output))));
 writer.stdin.end(`begin;
 insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
 values('${workspace}','${artifact}',${version+1},'{"schemaVersion":1,"kind":"book","title":"Race","sections":[]}','{}','${user}');
 update public.artifacts set current_version=${version+1} where id='${artifact}';
 do $$ begin raise notice 'REVIEW_WRITER_LOCKED'; end $$;
 select pg_sleep(2);
 commit;`);
 await locked;
 const started = Date.now();
 sql(`begin; set local role anon; do $$ begin
 begin perform public.${mutation}( '${token}',${version},'Reviewer','','${mutation.includes('decide') ? "approved','" : "Comment',null"}${mutation.includes('decide') ? "'" : ""});
 raise exception 'Stale view accepted after lock wait'; exception when sqlstate 'PT409' then null; end;
 end $$; rollback;`);
 assert.ok(Date.now()-started > 1000, 'Mutation did not wait behind the writer');
 await finished;
 sql(`do $$ begin
 assert (select decision from public.client_review_links where id='${link}') is null;
 assert (select count(*) from public.client_review_comments where link_id='${link}')=0;
 assert (select delivery_stage from public.projects where id='${project}')='active';
 end $$;`);
 console.log(`PASS concurrent save rejects stale ${mutation.includes('decide') ? 'approval' : 'comment'} without history or delivery changes`);
}
(async () => {
 try {
  sql(`begin;
  insert into auth.users(id,email,email_confirmed_at,is_anonymous) values('${user}','review-race-${user}@example.invalid',now(),false);
  insert into public.workspaces(id,name,owner_id) values('${workspace}','Review integrity race','${user}');
  insert into public.projects(id,workspace_id,title,kind) values('${project}','${workspace}','Race','book');
  insert into public.artifacts(id,workspace_id,project_id,kind,title,current_version) values('${artifact}','${workspace}','${project}','book','Race',0);
  insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by) values('${workspace}','${artifact}',1,'{"schemaVersion":1,"kind":"book","title":"Race","sections":[]}','{}','${user}');
  update public.artifacts set current_version=1 where id='${artifact}';
  insert into public.client_review_links(id,workspace_id,project_id,artifact_id,version_number,token_hash,recipient_name,message,expires_at,created_by)
  values('${link}','${workspace}','${project}','${artifact}',null,sha256(convert_to('${token}','UTF8')),'','',now()+interval '1 day','${user}');
  commit;`);
  const doc = emptyDocument("deck", "Review-safe chart");
  doc.slides = [{ id: "chart", layout: "chart", title: "Public chart", notes: "PRIVATE_SPEAKER", chart: { type: "bar", categories: ["A", "B"], series: [{ name: "Public series", values: [1, 2] }] } }];
  doc.assets = [{ name: "public-art", id: randomUUID(), aspect: "landscape", alt: "Public artwork", prompt: "PRIVATE_PROMPT" }];
  doc.theme.imageStyle = "PRIVATE_STYLE"; doc.theme.mood = "PRIVATE_MOOD";
  const content = ArtifactContentSchema.parse({ schemaVersion: 1, kind: "presentation", title: doc.title, sections: projectDocument(doc), document: doc });
  const quoted = JSON.stringify(content).replaceAll("'", "''");
  const projected = JSON.parse(sql(`select makeborne_private.client_review_content('${quoted}'::jsonb);`));
  ArtifactContentSchema.parse(projected);
  assert.ok(!JSON.stringify(projected).includes("PRIVATE_"));
  assert.deepEqual(projected.document.slides[0].chart, doc.slides[0].chart);
  assert.equal(projected.document.assets[0].id, doc.assets[0].id);
  console.log("PASS redacted live document keeps valid schema, chart data and artwork identity");
  await race(1, 'makeborne_decide_client_review');
  await race(2, 'makeborne_add_client_review_comment');
 } finally {
  sql(`begin; delete from public.client_review_comments where link_id='${link}'; delete from public.client_review_links where id='${link}'; delete from public.artifact_versions where artifact_id='${artifact}'; delete from public.artifacts where id='${artifact}'; delete from public.workspaces where id='${workspace}'; delete from auth.users where id='${user}'; commit;`);
 }
})().catch(error => { console.error(error); process.exitCode = 1; });

/* eslint-disable @typescript-eslint/no-require-imports -- Offline publication route checks across hosting modes (no network, no database). */
// Drives the real publication route with the database, storage and session
// mocked, once per hosting configuration: default (existing addresses),
// misconfigured, isolated domain, and rollback back to the default.
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), Module = require("node:module"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const root = path.join(__dirname, "..", "..", "..");
const src = path.join(root, "src");
const rpcCalls = [];
let projectImages = [];
let sourceWebsite=true, currentVersion=1, role="owner", storedPreparation=null;
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith("@/")) request = path.join(src, request.slice(2));
  try { return resolve.call(this, request, parent, ...rest); }
  catch (error) { if (!/\.(ts|js|json)$/.test(request)) return resolve.call(this, `${request}.ts`, parent, ...rest); throw error; }
};
const stubs = {
  "cloud/server": () => ({
    cloudBody: async (request, schema) => schema.parse(await request.json()),
    cloudContext: async () => ({ client: fakeClient(), user: { id: "11111111-1111-4111-8111-111111111111" }, workspace: { role } }),
    cloudError: error => Response.json({ error: { code: error.code ?? "ERROR", message: error.message } }, { status: error.status ?? 500 }),
    cloudJson: (value, status = 200) => Response.json(value, { status }),
    databaseError: error => { if (error) throw Object.assign(new Error("database"), { code: error.code }); },
    requestKey: request => request.headers.get("Idempotency-Key"),
    validId: id => id,
  }),
  "generation/submission-server": () => ({submissionContext: async () => ({trusted:{p_actor:"11111111-1111-4111-8111-111111111111"}})}),
  "billing/database": () => ({ billingDatabase: () => ({ rpc: (name,args) => {
    rpcCalls.push({name,args});
    const data=name.includes("publication_preparation") && !name.includes("promote") ? storedPreparation : {slug:args.p_slug??"bakery",live:args.p_live??true,version_number:1,revision:2,updated_at:"2026-10-13T00:00:00Z",interactive:args.p_interactive??false,entry_script:null};
    const response=Promise.resolve({data,error:null});response.abortSignal=()=>response;return response;
  } }) }),
  "billing/access": () => ({ requireCreationAccess: async () => {} }),
  "cloud/image-preview": () => ({ MAX_PREVIEW_SOURCE_BYTES: 8 * 1024 * 1024, renderAssetPreview: async bytes => Buffer.from(bytes) }),
};
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "server-only") return {};
  for (const [suffix, stub] of Object.entries(stubs)) if (name.endsWith(suffix) && !name.includes("check-")) return stub();
  return load.call(this, name, parent, main);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);

const webp = size => { const bytes = Buffer.alloc(size); bytes.write("RIFF", 0, "latin1"); bytes.writeUInt32LE(size - 8, 4); bytes.write("WEBP", 8, "latin1"); return bytes; };
const workspaceId = "22222222-2222-4222-8222-222222222222", artifactId = "33333333-3333-4333-8333-333333333333", assetId = "44444444-4444-4444-8444-444444444444";

function websiteContent() {
  const { ProjectFiles } = require(path.join(src, "lib", "builder", "files.ts"));
  const files = new ProjectFiles();
  files.write("index.html", '<!doctype html><html><head><title>T</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  files.write("src/main.tsx", 'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\ncreateRoot(document.getElementById("root")!).render(<App />);');
  files.write("src/App.tsx", 'export default function App() { return <main><h1>Bakery</h1><img src="/images/hero.webp" alt="Bread" /></main>; }');
  files.write("src/styles.css", "body { margin: 0 }");
  files.addAsset({ id: assetId, path: "public/images/hero.webp", sha256: "a".repeat(64), bytes: 64, mediaType: "image/webp" });
  return { schemaVersion: 1, kind: "website", title: "Bakery", sections: [], websiteSource: files.toSource() };
}
function chain(result) {
  const builder = { select: () => builder, eq: () => builder, in: () => builder, maybeSingle: async () => result, single: async () => result, then: (ok, fail) => Promise.resolve(result).then(ok, fail) };
  return builder;
}
function fakeClient() {
  const content = sourceWebsite ? websiteContent() : {schemaVersion:1,kind:"website",title:"Bakery",sections:[{id:assetId,title:"Bread",blocks:[{id:"77777777-7777-4777-8777-777777777777",type:"paragraph",text:"Fresh bread every morning.",sourceIds:[]}]}]};
  return {
    from: table => chain(table === "artifacts" ? { data: { project_id: "55555555-5555-4555-8555-555555555555", kind: "website", current_version: currentVersion }, error: null }
      : table === "artifact_versions" ? { data: { content, style_snapshot: {id:"editorial",name:"Editorial",version:1,typography:{headingFont:"Arial",bodyFont:"Arial"},colors:{ink:"#111111",paper:"#ffffff",accent:"#445566"},description:"Simple"} }, error: null }
      : table === "assets" ? { data: { object_path: `${workspaceId}/art/hero.webp`, content_type: "image/webp" }, error: null }
      : table === "hosted_sites" ? { data: { slug: "bakery", live: true, version_number: 1, revision: 2, updated_at: "2026-10-12T00:00:00Z", interactive: false, entry_script: null }, error: null }
      : { data: [], error: null }),
    storage: { from: () => ({ download: async () => ({ data: new Blob([projectImages[0] ?? webp(64)]), error: null }) }) },
  };
}
function loadRoute(env) {
  for (const key of ["NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING", "NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE", "NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED", "MAKEBORNE_HOSTING_NAMESPACE", "MAKEBORNE_STAGING_QA_WORKSPACE_ID", "NEXT_PUBLIC_SUPABASE_URL"]) delete process.env[key];
  Object.assign(process.env, env);
  for (const key of Object.keys(require.cache)) if (key.startsWith(src)) delete require.cache[key];
  return require(path.join(src, "app", "api", "cloud", "workspaces", "[workspaceId]", "artifacts", "[artifactId]", "publication", "route.ts"));
}
const context = { params: Promise.resolve({ workspaceId, artifactId }) };
const snapshot = '<html lang="en"><head><style data-makeborne-bundle>main{color:#333}</style></head><body><div id="root"><main><h1>Bakery</h1><img src="/images/hero.webp" alt="Bread"></main></div><script type="module" src="/x.js"></script></body></html>';
const publish = (route, extra = {}) => route.POST(new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
  body: JSON.stringify({ live: true, slug: "bakery", version: 1, revision: 1, acknowledged: true, interactive: false, ...extra }) }), context);
const toggle = (route, interactive) => route.PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
  body: JSON.stringify({ interactive, revision: 2 }) }), context);
const ISOLATED = { NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING: "isolated", NEXT_PUBLIC_MAKEBORNE_SITE_URL_TEMPLATE: "https://{slug}.makeborne.site/", NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED: "makeborne.site" };

let passed = 0;
async function check(name, fn) { rpcCalls.length = 0; projectImages = [webp(64)]; sourceWebsite=true;currentVersion=1;role="owner"; await fn(); passed++; console.log(`PASS ${name}`); }
const lastSave = () => rpcCalls.filter(call => call.name === "makeborne_save_hosted_site_v4").at(-1)?.args;

const prepId="66666666-6666-4666-8666-666666666666";
const prep=()=>({id:prepId,state:"ready",scope:{workspaceId,artifactId,projectId:"55555555-5555-4555-8555-555555555555"},versionNumber:1,publicationRevision:1,slug:"bakery",interactive:false,expiresAt:"2026-10-14T00:00:00Z",output:{html:"<html><head></head><body>Trusted</body></html>",routes:[{path:"/",html:"<html><head></head><body>Trusted</body></html>"}],script:"SECRET"},receipt:{token:"SECRET"},workerId:"SECRET",error:null});
(async()=>{
 await check("browser snapshot, bundle, source and receipt are rejected in every hosting mode",async()=>{
  for(const env of [{},ISOLATED])for(const extra of [{snapshot},{bundle:{js:"alert(1)",css:""}},{websiteSource:websiteContent().websiteSource},{receipt:{hash:"fake"}}]){
   const response=await publish(loadRoute(env),extra);assert.notEqual(response.status,200);assert.equal(rpcCalls.length,0);
  }
 });
 await check("source websites require trusted preparation; stale versions fail before saving",async()=>{
  const route=loadRoute({});let response=await publish(route);assert.equal(response.status,409);assert.equal((await response.json()).error.code,"PUBLICATION_PREPARATION_REQUIRED");
  currentVersion=2;response=await publish(route);assert.equal((await response.json()).error.code,"REVISION_CONFLICT");assert.equal(rpcCalls.length,0);
 });
 await check("legacy static publishing retains configured canonical and script-free storage",async()=>{
  sourceWebsite=false;for(const env of [{},{...ISOLATED,NEXT_PUBLIC_MAKEBORNE_SITE_DOMAIN_VERIFIED:""},ISOLATED,{}]){
   const route=loadRoute(env),response=await publish(route);const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
   const expected=env===ISOLATED?"https://bakery.makeborne.site/":"https://sites.makeborne.com/bakery";assert.equal(body.address,expected);
   const args=lastSave();assert.deepEqual([args.p_isolated_html,args.p_script,args.p_files,args.p_interactive],[null,null,[],false]);assert.ok(args.p_html.includes(expected));assert.doesNotMatch(args.p_html,/<script/);
  }
 });
 await check("unpublish remains available for source sites; owner restriction remains enforced",async()=>{
  const route=loadRoute({});assert.equal((await publish(route,{live:false})).status,200);assert.equal(lastSave().p_live,false);assert.equal(lastSave().p_html,"");
  rpcCalls.length=0;role="editor";assert.equal((await publish(route,{live:false})).status,403);assert.equal(rpcCalls.length,0);
 });
 await check("interactive toggle respects host and retained bundle",async()=>{
  let route=loadRoute({});assert.equal((await (await toggle(route,true)).json()).error.code,"JAVASCRIPT_UNAVAILABLE");assert.equal((await toggle(route,false)).status,200);
  route=loadRoute(ISOLATED);assert.equal((await (await toggle(route,true)).json()).error.code,"BUNDLE_REQUIRED");
 });
 await check("promotion accepts identifiers only, checks scope before mutation, and delegates freshness to atomic RPC",async()=>{
  const route=loadRoute({});storedPreparation=prep();
  const send=body=>route.POST(new Request("http://localhost/x",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),context);
  assert.equal((await send({preparationId:prepId,acknowledged:true})).status,200);
  assert.deepEqual(rpcCalls.map(c=>c.name),["makeborne_publication_preparation_status","makeborne_promote_publication_preparation"]);
  assert.deepEqual(Object.keys(rpcCalls[1].args).sort(),["p_actor","p_preparation"]);
  for(const extra of [{snapshot},{bundle:{js:"evil"}},{websiteSource:{}},{acknowledged:false}]){rpcCalls.length=0;assert.notEqual((await send({preparationId:prepId,acknowledged:true,...extra})).status,200);assert.equal(rpcCalls.length,0);}
  storedPreparation.scope.artifactId=assetId;rpcCalls.length=0;assert.equal((await send({preparationId:prepId,acknowledged:true})).status,503);assert.equal(rpcCalls.length,1);
 });
 await check("public preparation status redacts private evidence and fails closed on wrong scope or incomplete output",async()=>{
  const {publicPublicationPreparation}=require(path.join(src,"lib/projects/publication-server.ts"));
  let row=prep();let result=publicPublicationPreparation(row,workspaceId,artifactId);assert.ok(!JSON.stringify(result).includes("SECRET"));assert.equal(result.previewHtml,row.output.html);
  for(const [stored,publicState] of [["running","building"],["promoted","published"],["failed","failed"]]){row=prep();row.state=stored;row.error="SECRET";result=publicPublicationPreparation(row,workspaceId,artifactId);assert.equal(result.state,publicState);assert.equal(result.previewHtml,null);assert.ok(!result.error.includes("SECRET"));}
  row=prep();row.scope.workspaceId=assetId;assert.throws(()=>publicPublicationPreparation(row,workspaceId,artifactId));row=prep();row.output=null;assert.throws(()=>publicPublicationPreparation(row,workspaceId,artifactId));
 });
 await check("preparation request rejects injected output and flag-off queues nothing; repeat key is preserved",async()=>{
  loadRoute({});const {requestPublicationPreparation}=require(path.join(src,"lib/projects/publication-server.ts"));storedPreparation={...prep(),state:"queued",output:null};
  const key=randomUUID(),body={version:1,revision:1,slug:"bakery",interactive:false};
  const request=data=>new Request("http://localhost/x",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(data)});
  delete process.env.MAKEBORNE_TRUSTED_PUBLICATION_ENABLED;
  await assert.rejects(requestPublicationPreparation(request(body),workspaceId,artifactId),error=>error.code==="PUBLICATION_PREPARATION_UNAVAILABLE");assert.equal(rpcCalls.length,0);
  process.env.MAKEBORNE_TRUSTED_PUBLICATION_ENABLED="true";
  try{
   for(const extra of [{snapshot},{bundle:{js:"evil"}},{receipt:{}},{websiteSource:{}},{actorId:assetId}])await assert.rejects(requestPublicationPreparation(request({...body,...extra}),workspaceId,artifactId));
   assert.equal(rpcCalls.length,0);await requestPublicationPreparation(request(body),workspaceId,artifactId);await requestPublicationPreparation(request(body),workspaceId,artifactId);
   assert.equal(rpcCalls.length,2);assert.deepEqual(rpcCalls[0],rpcCalls[1]);assert.equal(rpcCalls[0].args.p_request,key);assert.deepEqual(Object.keys(rpcCalls[0].args).sort(),["p_actor","p_artifact","p_interactive","p_request","p_revision","p_slug","p_version","p_workspace"]);
  }finally{delete process.env.MAKEBORNE_TRUSTED_PUBLICATION_ENABLED;}
 });
 await check("status reads only status RPCs and rejects ambiguous queries or wrong scope",async()=>{
  loadRoute({});const {readPublicationPreparation}=require(path.join(src,"lib/projects/publication-server.ts"));storedPreparation=prep();
  await readPublicationPreparation(new Request("http://localhost/x"),workspaceId,artifactId);await readPublicationPreparation(new Request(`http://localhost/x?id=${prepId}`),workspaceId,artifactId);
  assert.deepEqual(rpcCalls.map(c=>c.name),["makeborne_latest_publication_preparation","makeborne_publication_preparation_status"]);
  rpcCalls.length=0;for(const query of [`?id=${prepId}&id=${prepId}`,"?snapshot=evil"]){await assert.rejects(readPublicationPreparation(new Request(`http://localhost/x${query}`),workspaceId,artifactId));}assert.equal(rpcCalls.length,0);
  storedPreparation.scope.workspaceId=assetId;await assert.rejects(readPublicationPreparation(new Request(`http://localhost/x?id=${prepId}`),workspaceId,artifactId),error=>error.code==="PUBLICATION_UNCONFIRMED");
 });
 await check("production reserves QA labels before legacy or trusted publication, but preserves offline cleanup",async()=>{
  const route=loadRoute({});sourceWebsite=false;
  for(const slug of ["release-check","release-check-renamed"]){
   rpcCalls.length=0;const denied=await publish(route,{slug});assert.equal(denied.status,409);assert.equal(rpcCalls.length,0);
   assert.equal((await publish(route,{slug,live:false})).status,200);
   storedPreparation={...prep(),slug};rpcCalls.length=0;
   const response=await route.POST(new Request("http://localhost/x",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({preparationId:prepId,acknowledged:true})}),context);
   assert.equal(response.status,409);assert.deepEqual(rpcCalls.map(c=>c.name),["makeborne_publication_preparation_status"]);
  }
 });
 await check("staging publication requires the exact server namespace, database and workspace",async()=>{
  const staging={...ISOLATED,MAKEBORNE_HOSTING_NAMESPACE:"staging",MAKEBORNE_STAGING_QA_WORKSPACE_ID:workspaceId,NEXT_PUBLIC_SUPABASE_URL:"https://xzwikrunwpurxnxgkznh.supabase.co"};sourceWebsite=false;
  const route=loadRoute(staging);
  const response=await route.GET(new Request("http://localhost/x"),context),body=await response.json();
  assert.deepEqual(body.addressPolicy,{enabled:true,allowedSlugs:["release-check","release-check-renamed"],reservedSlugs:[]});
  assert.equal((await publish(route,{slug:"release-check"})).status,200);
  rpcCalls.length=0;assert.equal((await publish(route)).status,409);assert.equal(rpcCalls.length,0);
  const bad=[{...staging,MAKEBORNE_HOSTING_NAMESPACE:"production"},{...staging,MAKEBORNE_HOSTING_NAMESPACE:""},{...staging,MAKEBORNE_STAGING_QA_WORKSPACE_ID:assetId},{...staging,MAKEBORNE_STAGING_QA_WORKSPACE_ID:"invalid"},{...staging,NEXT_PUBLIC_SUPABASE_URL:"https://rklojnmmsmhwnkbzuidp.supabase.co"}];
  for(const env of bad){const refused=loadRoute(env);rpcCalls.length=0;assert.equal((await publish(refused,{slug:"release-check"})).status,503);assert.equal(rpcCalls.length,0);assert.equal((await publish(refused,{live:false})).status,200);assert.equal((await toggle(refused,false)).status,200);}
 });
 await check("trusted preparation checks server address policy before its write",async()=>{
  loadRoute({});const {requestPublicationPreparation}=require(path.join(src,"lib/projects/publication-server.ts"));
  process.env.MAKEBORNE_TRUSTED_PUBLICATION_ENABLED="true";
  try{await assert.rejects(requestPublicationPreparation(new Request("http://localhost/x?namespace=staging",{method:"POST",headers:{"Content-Type":"application/json","X-Makeborne-Hosting-Namespace":"staging","Idempotency-Key":randomUUID()},body:JSON.stringify({version:1,revision:0,slug:"release-check",interactive:false})}),workspaceId,artifactId),error=>error.code==="ADDRESS_UNAVAILABLE");assert.equal(rpcCalls.length,0);}
  finally{delete process.env.MAKEBORNE_TRUSTED_PUBLICATION_ENABLED;}
 });
 console.log(`${passed} publication route/status groups passed. Database, auth and storage are mocked; atomic promotion freshness is qualified separately by SQL tests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});

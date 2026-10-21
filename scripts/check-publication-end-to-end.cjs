/* eslint-disable @typescript-eslint/no-require-imports -- Explicit disposable SQL + local compiler qualification. */
require('../src/lib/generation/check-website-worker.cjs');
const Module=require('node:module'),path=require('node:path'),originalLoad=Module._load;
Module._load=function(name,parent,main){return originalLoad.call(this,name.startsWith('@/')?path.join(__dirname,'../src',name.slice(2)):name,parent,main);};
const {spawn}=require('node:child_process');
const {randomUUID,createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const {PROJECT_TOOLCHAIN}=require('../src/lib/projects/build-input.ts');
const {runPublicationPreparation}=require('../src/lib/projects/publication-worker.ts');
const {publicationArtworkResolver}=require('../src/lib/projects/publication-assets.ts');
const container=process.argv[2];
assert.match(container??'',/^makeborne_publication_\d{14}$/);
assert.equal(process.env.MAKEBORNE_VERIFY_LOCAL_PUBLICATION,'true','Explicit local qualification opt-in required');
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const json=value=>literal(JSON.stringify(value));
const digest=value=>createHash('sha256').update(value).digest('hex');
async function query(sql,signal){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','rehearsal','-v','ON_ERROR_STOP=1','-Atq'],{signal});
  let output='',error='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>error+=data);
  child.on('error',reject);child.on('close',code=>code===0?resolve(output.trim()?JSON.parse(output.trim().split('\n').at(-1)):null):reject(new Error(error)));
  child.stdin.end(sql);
 });
}
let completedOutput;
const rpc=async(name,args,signal)=>{
 if(name==='makeborne_complete_publication_preparation')completedOutput=args.p_output;
 assert.match(name,/^makeborne_[a-z0-9_]+$/);
 const values=Object.entries(args).map(([key,value])=>{
  assert.match(key,/^p_[a-z_]+$/);
  return `${key} => ${value===null?'null':typeof value==='object'?json(value)+'::jsonb':literal(value)}`;
 });
 return query(`set role service_role;select public.${name}(${values.join(',')});`,signal);
};
async function main(){
 const {localPublicationExecutor}=await import('../infra/project-runtime/publication-adapter.mjs');
 const {dockerCommand}=await import('../infra/project-runtime/local-adapter.mjs');
 const image=(await dockerCommand(['image','inspect','makeborne-react-vite:local-v1','--format','{{.Id}}'])).output.trim();
 const browser=await require('playwright').chromium.launch();
 const renderer=await (await import('../infra/project-runtime/publication-renderer.mjs')).localPublicationRendererId(browser.version());await browser.close();
 const actor=randomUUID(),session=randomUUID(),workspace=randomUUID(),project=randomUUID(),artifact=randomUUID(),version=randomUUID(),asset=randomUUID();
 const slug=`integrated-${artifact.slice(0,8)}`,objectPath=`${workspace}/${project}/original.png`;
 const bytes=await require('sharp')({create:{width:8,height:8,channels:3,background:'#26847d'}}).png().toBuffer();
 const source={schemaVersion:1,toolchainId:'react-vite-v1',entrypoint:'src/main.tsx',routes:[{path:'/',title:'Home'},{path:'/work',title:'Work'}],assets:[{id:asset,path:'public/original.png',bytes:bytes.length,sha256:digest(bytes),mediaType:'image/png'}],files:[
  {path:'package.json',content:JSON.stringify(PROJECT_TOOLCHAIN.package)},
  {path:'package-lock.json',content:JSON.stringify(PROJECT_TOOLCHAIN.lock)},
  {path:'index.html',content:'<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'},
  {path:'src/main.tsx',content:`import {createRoot} from 'react-dom/client';import '@fontsource-variable/inter';import './app.css';createRoot(document.getElementById('root')!).render(<main><h1>{location.pathname==='/work'?'Verified work route':'Verified integrated publication'}</h1><img src="/original.png" alt="Original artwork"/><p>Saved source, original artwork, a retained build and an independently captured page.</p></main>);`},
  {path:'src/app.css',content:'body{font-family:"Inter Variable",sans-serif;color:#17342e;margin:24px}img{width:80px;height:80px}'}]};
 const content={schemaVersion:1,kind:'website',title:'Integrated publication',sections:[],websiteSource:source};
 const style={id:'automatic',name:'Automatic',version:1,typography:{headingFont:'Arial',bodyFont:'Arial'},colors:{ink:'#17342e'},description:'Fixture',referenceAssetIds:[]};
 const access={p_actor:actor,p_session:session,p_expires:new Date(Date.now()+1200000).toISOString()};
 const oldHtml='<!doctype html><html><body><h1>Previously approved website</h1></body></html>'+' '.repeat(160);
 let seeded=false;
 try{
  await query(`begin;
   insert into auth.users(id,email,email_confirmed_at) values('${actor}','${actor}@publication-e2e.invalid',now());
   insert into auth.sessions(id,user_id) values('${session}','${actor}');
   insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values('${actor}',true,false,'Disposable integration qualification');
   insert into public.workspaces(id,name,owner_id) values('${workspace}','Integrated publication','${actor}');
   insert into makeborne_private.trusted_publication_workspaces(workspace_id,enabled) values('${workspace}',true);
   insert into public.projects(id,workspace_id,title,kind) values('${project}','${workspace}','Integrated publication','website');
   insert into public.artifacts(id,workspace_id,project_id,title,kind) values('${artifact}','${workspace}','${project}','Integrated publication','website');
   insert into public.assets(id,workspace_id,project_id,object_path,content_type,sha256) values('${asset}','${workspace}','${project}',${literal(objectPath)},'image/png','${digest(bytes)}');
   insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,asset_manifest,created_by)
    values('${version}','${workspace}','${artifact}',1,${json(content)},${json(style)},${json([asset])},'${actor}');
   update public.artifacts set current_version=1 where id='${artifact}';
   insert into public.hosted_sites(artifact_id,workspace_id,owner_id,slug,version_number,html,live,revision,request_id,interactive)
    values('${artifact}','${workspace}','${actor}','${slug}',1,${literal(oldHtml)},true,1,'${randomUUID()}',false);
   commit;select '{}'::json;`);seeded=true;
  const prep=await rpc('makeborne_request_publication_preparation',{...access,p_workspace:workspace,p_artifact:artifact,p_version:1,p_revision:1,p_slug:slug,p_interactive:true,p_request:randomUUID()});
  assert.equal(prep.state,'queued');
  const objects=new Map();const store={async putIfAbsent(key,value){if(!objects.has(key))objects.set(key,Buffer.from(value));},async get(key,max){const value=objects.get(key);assert.ok(!value||value.length<=max);return value??null;}};
  let downloads=0;
  const resolveArtwork=publicationArtworkResolver({rpc,download:async(path,max,signal)=>{signal.throwIfAborted();assert.equal(path,objectPath);assert.equal(max,bytes.length);downloads++;return bytes;}});
  const result=await runPublicationPreparation(prep.id,randomUUID(),{rpc,resolveArtwork,address:slug=>`https://${slug}.makeborne.site`,executor:{...localPublicationExecutor({qualifiedRuntimeImageId:image,qualifiedRendererId:renderer}),sitesDomain:'makeborne.site',store}},AbortSignal.timeout(290000));
  assert.equal(result.state,'completed');assert.equal(result.result.state,'ready');assert.equal(downloads,1);
  const ready=await rpc('makeborne_publication_preparation_status',{...access,p_preparation:prep.id});
  assert.equal(ready.outputHash,digest(completedOutput));
  assert.deepEqual(ready.output,JSON.parse(completedOutput));
  const liveBefore=await query(`select json_build_object('html',html,'revision',revision) from public.hosted_sites where artifact_id='${artifact}';`);
  assert.equal(liveBefore.html,oldHtml);assert.equal(liveBefore.revision,1);
  const promotion=await rpc('makeborne_promote_publication_preparation',{...access,p_preparation:prep.id});
  assert.deepEqual(await rpc('makeborne_promote_publication_preparation',{...access,p_preparation:prep.id}),promotion);
  const root=await rpc('makeborne_read_hosted_site_v3',{p_slug:slug,p_path:'/'});
  const work=await rpc('makeborne_read_hosted_site_v3',{p_slug:slug,p_path:'/work'});
  assert.match(JSON.stringify(root),/Verified integrated publication/);assert.match(JSON.stringify(work),/Verified work route/);
  assert.equal(await rpc('makeborne_read_hosted_site_v3',{p_slug:slug,p_path:'/unknown'}),null);
  assert.equal((await query(`select json_build_object('revision',revision) from public.hosted_sites where artifact_id='${artifact}';`)).revision,2);
  console.log(JSON.stringify({passed:true,container,runtimeImageId:image,rendererId:renderer,checks:['real service-role queue and fenced asset lookup','original PNG SHA verified before compiler','real Docker compile and independent browser render','database accepts exact retained output digest','preparation preserves previous live page','explicit promotion and replay increment revision once','both routes served; undeclared route refused'],providerCalls:0}));
 }finally{
  if(seeded)await query(`delete from public.hosted_sites where workspace_id='${workspace}';delete from public.workspaces where id='${workspace}';delete from auth.users where id='${actor}';select '{}'::json;`);
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});



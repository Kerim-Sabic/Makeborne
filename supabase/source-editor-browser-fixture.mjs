/** Local-only Auth/Next fixture for computer-use verification. No browser automation. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {createClient} from '@supabase/supabase-js';
import nativeSlideFixture from './native-slide-fixture.cjs';
if(process.env.MAKEBORNE_SOURCE_EDITOR_FIXTURE!=='true')throw new Error('EXPLICIT_LOCAL_FIXTURE_REQUIRED');
const origin='http://127.0.0.1:55321',appOrigin='http://localhost:3046';
const config=JSON.parse((await readFile('.env.makeborne-local-status.json','utf8')).replace(/^\uFEFF/,''));assert.equal(config.API_URL,origin);
const localFetch=(input,init={})=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);assert.equal(url.origin,origin);return fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});};
const options={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:localFetch}};
const admin=createClient(origin,config.SECRET_KEY,options),client=createClient(origin,config.PUBLISHABLE_KEY,options);
let user,app,workspace,artifact,bookArtifact,presentationArtifact,customDesign,stage='CREATE_LOCAL_USER';
const data=result=>{if(result.error||!result.data)throw Object.assign(new Error('LOCAL_FIXTURE_OPERATION_FAILED'),{code:result.error?.code??'NO_DATA'});return result.data;};
async function sql(text){await new Promise((resolve,reject)=>{const child=spawn('docker',['exec','-i','supabase_db_makeborne-local','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','ignore','ignore'],timeout:15000});child.on('error',()=>reject(new Error('LOCAL_SQL_FAILED')));child.on('exit',code=>code===0?resolve():reject(new Error('LOCAL_SQL_FAILED')));child.stdin.on('error',()=>reject(new Error('LOCAL_SQL_FAILED')));child.stdin.end(text);});}
async function run(cmd,args,env){await new Promise((resolve,reject)=>{const child=spawn(cmd,args,{env,windowsHide:true,stdio:'ignore',timeout:180000});child.on('error',()=>reject(new Error('BUILD_FAILED')));child.on('exit',code=>code===0?resolve():reject(new Error('BUILD_FAILED')));});}
try{
 user=data(await admin.auth.admin.createUser({email:'makeborne-source-editor-'+randomUUID()+'@example.com',password:'Local-editor-check-8October2026!',email_confirm:true})).user;
 stage='SIGN_IN_LOCAL_USER';
 data(await client.auth.signInWithPassword({email:user.email,password:'Local-editor-check-8October2026!'}));
 stage='GRANT_LOCAL_FIXTURE';
 await sql(`insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values('${user.id}',true,false,'Local source editor computer-use fixture');`);
 stage='CREATE_LOCAL_RECORDS';workspace=data(await client.rpc('makeborne_create_workspace',{p_request_key:randomUUID(),p_name:'Code editor verification'})).workspace.id;
 const project=data(await client.rpc('makeborne_create_record',{p_workspace_id:workspace,p_request_key:randomUUID(),p_operation:'create_project',p_payload:{title:'Source editor verification',kind:'website'}})).record.id;
 artifact=data(await client.rpc('makeborne_create_record',{p_workspace_id:workspace,p_request_key:randomUUID(),p_operation:'create_artifact',p_payload:{project_id:project,title:'Source editor verification',kind:'website'}})).record.id;
 stage='READ_PINNED_TOOLCHAIN';const source={schemaVersion:1,toolchainId:'react-vite-v1',entrypoint:'src/main.tsx',files:[
 {path:'package.json',content:await readFile('infra/project-runtime/toolchain/package.json','utf8')},
 {path:'package-lock.json',content:await readFile('infra/project-runtime/toolchain/package-lock.json','utf8')},
 {path:'index.html',content:'<!doctype html><html><head><title>Editor fixture</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'},
 {path:'src/main.tsx',content:'import React from "react";\nimport {createRoot} from "react-dom/client";\nimport "./style.css";\ncreateRoot(document.getElementById("root")!).render(<h1>Original editor fixture</h1>);\n'},
 {path:'src/style.css',content:'body { background: #fafaff; color: #202126; }\n'}],assets:[],routes:[{path:'/',title:'Home'}]};
 const content={schemaVersion:1,title:'Source editor verification',kind:'website',sections:[],websiteSource:source};
 const style={id:'fixture',name:'Fixture',version:1,typography:{headingFont:'Arial',bodyFont:'Arial'},colors:{ink:'#202126'},description:'Local editor fixture',referenceAssetIds:[]};
 stage='SAVE_LOCAL_SOURCE';data(await client.rpc('makeborne_save_artifact_version',{p_workspace_id:workspace,p_artifact_id:artifact,p_expected_version:0,p_content:content,p_style:style,p_asset_ids:[],p_change_summary:'Initial local source',p_request_key:randomUUID()}));
 if(process.env.MAKEBORNE_BOOK_PREVIEW_FIXTURE==='true'){
  stage='CREATE_BOOK_FIXTURE';
  const bookProject=data(await client.rpc('makeborne_create_record',{p_workspace_id:workspace,p_request_key:randomUUID(),p_operation:'create_project',p_payload:{title:'The Thoughtful Client Guide',kind:'book'}})).record.id;
  bookArtifact=data(await client.rpc('makeborne_create_record',{p_workspace_id:workspace,p_request_key:randomUUID(),p_operation:'create_artifact',p_payload:{project_id:bookProject,title:'The Thoughtful Client Guide',kind:'book'}})).record.id;
  const paragraph='A strong client project starts with listening. Ask what success means, who will use the finished work, and what information is already approved. Keep the brief specific enough to guide decisions, while leaving room for a thoughtful visual direction. Record open questions instead of presenting assumptions as facts.';
  const bookContent={schemaVersion:1,title:'The Thoughtful Client Guide',kind:'book',sections:['Begin with a clear brief','Build a useful first version','Review before sharing'].map((title,chapter)=>({id:randomUUID(),title,blocks:Array.from({length:6},(_,index)=>({id:randomUUID(),type:'paragraph',text:`${chapter*6+index+1}. ${paragraph}`,assetId:null,locked:false,sourceIds:[]}))}))};
  data(await client.rpc('makeborne_save_artifact_version',{p_workspace_id:workspace,p_artifact_id:bookArtifact,p_expected_version:0,p_content:bookContent,p_style:{...style,typography:{headingFont:'Georgia',bodyFont:'Arial'},colors:{canvas:'#F8F7F4',ink:'#242A26',accent:'#45665A'}},p_asset_ids:[],p_change_summary:'Local book pagination fixture',p_request_key:randomUUID()}));
 }
 if(process.env.MAKEBORNE_PRESENTATION_PREVIEW_FIXTURE==='true'){
  stage='CREATE_PRESENTATION_FIXTURE';
  const deckProject=data(await client.rpc('makeborne_create_record',{p_workspace_id:workspace,p_request_key:randomUUID(),p_operation:'create_project',p_payload:{title:'Good Dog creative direction',kind:'presentation'}})).record.id;
  presentationArtifact=data(await client.rpc('makeborne_create_record',{p_workspace_id:workspace,p_request_key:randomUUID(),p_operation:'create_artifact',p_payload:{project_id:deckProject,title:'Good Dog creative direction',kind:'presentation'}})).record.id;
  const slides=[
   {title:'Good Dog, outdoors.',body:'A considered direction for an independent dog shop.'},
   {title:'Useful things. More time outside.',body:'Simple choices for everyday walks.'},
   {title:'The direction starts with the product.',body:'Warm photography, readable type and clear product details give the collection room to breathe.\n\nKeep materials, sizing and care information beside the purchase decision. Ask the owner to confirm missing details before publishing.\n\nThis is a proposed creative direction, not evidence of customer results.'},
   {title:'Full source is preserved.',body:'A supplied paragraph must not disappear. '.repeat(100)},
  ];
  const deck={schemaVersion:1,title:'Good Dog creative direction',kind:'presentation',sections:slides.map(slide=>({id:randomUUID(),title:slide.title,blocks:[{id:randomUUID(),type:'paragraph',text:slide.body,assetId:null,locked:false,sourceIds:[]}]}))};
  if(process.env.MAKEBORNE_CUSTOM_SLIDE_FIXTURE==='true'){const fixture=nativeSlideFixture.createNativeSlideFixture();deck.sections=fixture.content.sections;customDesign=structuredClone(deck.sections[0].slideDesign);}
  data(await client.rpc('makeborne_save_artifact_version',{p_workspace_id:workspace,p_artifact_id:presentationArtifact,p_expected_version:0,p_content:deck,p_style:{...style,typography:{headingFont:'Georgia',bodyFont:'Arial'},colors:{canvas:'#F8F7F4',ink:'#242A26',accent:'#45665A'}},p_asset_ids:[],p_change_summary:'Local native slide preview fixture',p_request_key:randomUUID()}));
 }
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:origin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:config.PUBLISHABLE_KEY,SUPABASE_SECRET_KEY:config.SECRET_KEY,NEXT_PUBLIC_APP_URL:appOrigin,MAKEBORNE_CLOUD_ENABLED:'true',MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED:'true',MAKEBORNE_DURABLE_SUBMISSIONS_ENABLED:'false',MAKEBORNE_PUBLIC_GENERATION_ENABLED:'false',MAKEBORNE_CLAUDE_PILOT_ENABLED:'false',MAKEBORNE_BILLING_ENABLED:'false'};
 for(const key of Object.keys(env))if(/ANTHROPIC|OPENAI|WHOP_API|CLAUDE_API|DEEPSEEK_API|QWEN_API/.test(key))env[key]='';
 for(const key of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','WHOP_API_KEY','DEEPSEEK_API_KEY','QWEN_API_KEY'])env[key]='';
 stage='BUILD_LOCAL_APP';console.log('BUILDING local-only production app; all paid providers disabled');await run(process.execPath,['node_modules/next/dist/bin/next','build'],env);
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','localhost','--port','3046'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let ready=false;app.stdout.on('data',chunk=>{ready ||= chunk.toString().includes('Ready in');});app.stderr.on('data',()=>{});
 for(let i=0;!ready;i++){assert(app.exitCode===null&&i<80);await new Promise(resolve=>setTimeout(resolve,250));}
 stage='INTERACTIVE_LOCAL_CHECK';const path=`/studio?tab=projects&workspace=${workspace}&artifact=${artifact}`;
 console.log(JSON.stringify({ready:true,url:appOrigin+'/login?next='+encodeURIComponent(path),email:user.email,workspace,artifact,...(presentationArtifact?{presentationUrl:`${appOrigin}/studio?tab=projects&workspace=${workspace}&artifact=${presentationArtifact}`} : {}),...(bookArtifact?{bookUrl:`${appOrigin}/studio?tab=projects&workspace=${workspace}&artifact=${bookArtifact}`}:{})}));
 const lines=createInterface({input:process.stdin});const timeout=setTimeout(()=>lines.close(),900000);
 for await(const command of lines){
  if(command==='stop')break;
  if(command==='snapshot'){
   const versions=data(await admin.from('artifact_versions').select('id,version_number,content').eq('artifact_id',artifact).order('version_number',{ascending:false}));
   const latest=versions[0];console.log(JSON.stringify({version:latest.version_number,files:latest.content.websiteSource.files.map(file=>({path:file.path,edited:file.content.includes('Verified editor revision')})),count:versions.length}));
  }
  if(command==='customsnapshot'||command==='customdowngrade'){
   assert(presentationArtifact&&customDesign);
   const versions=data(await admin.from('artifact_versions').select('id,version_number,content,style_snapshot,asset_manifest').eq('artifact_id',presentationArtifact).order('version_number',{ascending:false})),latest=versions[0];
   if(command==='customdowngrade'){
    const copy=structuredClone(latest.content);delete copy.sections[0].slideDesign;
    const result=await client.rpc('makeborne_save_artifact_version',{p_workspace_id:workspace,p_artifact_id:presentationArtifact,p_expected_version:latest.version_number,p_content:copy,p_style:latest.style_snapshot,p_asset_ids:latest.asset_manifest,p_change_summary:'Intentional old-client downgrade test',p_request_key:randomUUID()});
    assert.equal(result.error?.code,'22023');console.log('PASS direct authenticated RPC cannot discard saved slide geometry');
   }else {assert.deepEqual(latest.content.sections[0].slideDesign,customDesign);console.log(JSON.stringify({version:latest.version_number,geometryPreserved:true,firstText:latest.content.sections[0].blocks[0].text,versionCount:versions.length}));}
  }
  if(command==='stale'){
   const latest=data(await admin.from('artifact_versions').select('*').eq('artifact_id',artifact).order('version_number',{ascending:false}).limit(1))[0];
   data(await client.rpc('makeborne_save_artifact_version',{p_workspace_id:workspace,p_artifact_id:artifact,p_expected_version:latest.version_number,p_content:latest.content,p_style:latest.style_snapshot,p_asset_ids:latest.asset_manifest??[],p_change_summary:'Concurrent editor fixture',p_request_key:randomUUID()}));
   console.log('PASS concurrent fixture revision saved; open browser must reject its stale expected version');
  }
 }
 clearTimeout(timeout);
}catch(error){const code=/^[A-Za-z0-9_]{1,40}$/.test(error?.code??'')?error.code:'REDACTED';console.error(`LOCAL_EDITOR_FIXTURE_FAILED at ${stage} (${code}); sensitive diagnostics redacted`);process.exitCode=1;}
finally{
 if(app&&app.exitCode===null){app.kill();await new Promise(resolve=>{const timer=setTimeout(resolve,5000);app.once('exit',()=>{clearTimeout(timer);resolve();});});}
 await client.auth.signOut().catch(()=>{});
 if(user){await sql(`delete from makeborne_private.account_privileges where user_id='${user.id}' and reason='Local source editor computer-use fixture'; delete from auth.sessions where user_id='${user.id}';`).catch(()=>{process.exitCode=1;});}
 console.log('STOPPED local fixture; temporary grant and sessions removed; paid calls zero');
 process.stdin.pause();
}

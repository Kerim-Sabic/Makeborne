import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';import {createClient} from '@supabase/supabase-js';import {createServerClient} from '@supabase/ssr';import pg from 'pg';
const ref='xzwikrunwpurxnxgkznh',base='https://makeborne-release-staging-poymmdz0z-kerimsabic-6594s-projects.vercel.app',root='work/release-auth-stack/';
const project=JSON.parse(fs.readFileSync(root+'cloud-create-result.json'));assert.equal(project.ref,ref);const config=JSON.parse(fs.readFileSync(root+'cloud-staging.json'));const keys=JSON.parse(fs.readFileSync(root+'cloud-api-keys.json')).keys;const pub=keys.find(k=>k.type==='publishable').api_key,secret=keys.find(k=>k.type==='secret').api_key;
const db=new pg.Client({host:`db.${ref}.supabase.co`,user:'postgres',password:config.password,database:'postgres',ssl:{rejectUnauthorized:true,ca:fs.readFileSync(root+'supabase-ca.crt','utf8')}});await db.connect();
const admin=createClient(`https://${ref}.supabase.co`,secret,{auth:{persistSession:false,autoRefreshToken:false}});const email=`cloud-rehearsal-${randomUUID()}@example.invalid`,password=`Stage-${randomUUID()}!`;let uid;const cookies=new Map();
const auth=createServerClient(`https://${ref}.supabase.co`,pub,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(v=>cookies.set(v.name,v.value))}});
function api(route,body,method='POST',binary=false,guest=false){assert(route.startsWith('/api/'));const output=root+'upload-http-response.bin',request=root+'upload-http-request.json',cfg=root+'upload-curl.cfg';if(body!==undefined)fs.writeFileSync(request,JSON.stringify(body));const headers={'Cookie':guest?'':[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'Origin':base,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'x-makeborne-crm-protocol':'2'};fs.writeFileSync(cfg,Object.entries(headers).map(([k,v])=>`header = ${JSON.stringify(k+': '+v)}`).join('\n'));
const args=['C:/Users/kerim/AppData/Local/npm-cache/_npx/69f9afb961c37556/node_modules/vercel/dist/index.js','curl',base+route,'--scope','kerimsabic-6594s-projects','--','--config',cfg,'--silent','--show-error','--max-time','90','--request',method,'--output',output,'--write-out','%{http_code}',...(body===undefined?[]:['--data-binary','@'+request])];const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:120000});assert.equal(r.status,0,'Protected staging HTTP request failed');const status=Number(r.stdout.trim());const bytes=fs.readFileSync(output);return{status,body:binary?bytes:JSON.parse(bytes.toString())};}

try {
 if(process.argv.includes('--cleanup')) {
  const fixture=JSON.parse(fs.readFileSync(root+'cloud-upload-fixture.json'));
  assert.equal(fixture.base,base);uid=fixture.uid;
  const paths=await db.query('select object_path from public.assets where workspace_id=$1',[fixture.wid]);
  if(paths.rows.length)await admin.storage.from('project-assets').remove(paths.rows.map(x=>x.object_path));
  await db.query('delete from makeborne_private.cloud_mutation_receipts where actor_id=$1',[uid]);
  await db.query('delete from public.workspaces where owner_id=$1',[uid]);
  await admin.auth.admin.signOut(fixture.accessToken,'global');
  assert(!(await admin.auth.admin.deleteUser(uid)).error);
  console.log('Disposable upload fixture removed');
 } else {
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert(!created.error);uid=created.data.user.id;
 assert(!(await auth.auth.signInWithPassword({email,password})).error);
 await db.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,false,'Disposable upload fixture')",[uid]);
 const ws=api('/api/workspaces',{name:'Disposable upload rehearsal'});assert.equal(ws.status,201);const wid=ws.body.workspace.id;
 const p=api(`/api/cloud/workspaces/${wid}/projects`,{title:'Artwork upload test',kind:'book'});assert.equal(p.status,201);
 const a=api(`/api/cloud/workspaces/${wid}/projects/${p.body.project.id}/artifacts`,{title:'Artwork upload test',kind:'book'});assert.equal(a.status,201);const aid=a.body.artifact.id;
 const style={id:'editorial',name:'Editorial',version:1,typography:{headingFont:'Georgia',bodyFont:'Arial'},colors:{ink:'#172121'},description:'Disposable upload fixture',referenceAssetIds:[]};
 const save=api(`/api/cloud/workspaces/${wid}/artifacts/${aid}/versions`,{expectedVersion:0,content:{schemaVersion:1,title:'Artwork upload test',kind:'book',sections:[{id:randomUUID(),title:'Test chapter',blocks:[{id:randomUUID(),type:'paragraph',text:'Disposable staging artwork upload check.'}]}]},style,assetIds:[],changeSummary:'Upload fixture'});assert.equal(save.status,201,JSON.stringify(save));
 const session=(await auth.auth.getSession()).data.session;
 fs.writeFileSync(root+'cloud-upload-fixture.json',JSON.stringify({base,uid,email,password,wid,aid,accessToken:session.access_token}));
 fs.writeFileSync(root+'upload-test.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVuoAAAAASUVORK5CYII=','base64'));
 console.log('Disposable browser upload fixture prepared');
 }
}catch{
 if(uid&&!process.argv.includes('--cleanup')){
  await auth.auth.signOut();
  await db.query('delete from makeborne_private.cloud_mutation_receipts where actor_id=$1',[uid]);
  await db.query('delete from public.workspaces where owner_id=$1',[uid]);
  await admin.auth.admin.deleteUser(uid);
 }
 console.error('Upload fixture preparation failed; temporary account removed');process.exitCode=1;
}finally{await db.end();}

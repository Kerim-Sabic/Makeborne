import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';import {createClient} from '@supabase/supabase-js';import {createServerClient} from '@supabase/ssr';import pg from 'pg';
const ref='xzwikrunwpurxnxgkznh',base=process.env.STAGING_BASE??'https://makeborne-release-staging-jex4zjcir-kerimsabic-6594s-projects.vercel.app',root='work/release-auth-stack/';
if(!/^https:\/\/makeborne-release-staging-[a-z0-9]+-kerimsabic-6594s-projects\.vercel\.app$/.test(base))throw new Error('STAGING_BASE must be a staging preview');
const project=JSON.parse(fs.readFileSync(root+'cloud-create-result.json'));assert.equal(project.ref,ref);const config=JSON.parse(fs.readFileSync(root+'cloud-staging.json'));const keys=JSON.parse(fs.readFileSync(root+'cloud-api-keys.json')).keys;const pub=keys.find(k=>k.type==='publishable').api_key,secret=keys.find(k=>k.type==='secret').api_key;
const db=new pg.Client({host:`db.${ref}.supabase.co`,user:'postgres',password:config.password,database:'postgres',ssl:{rejectUnauthorized:true,ca:fs.readFileSync(root+'supabase-ca.crt','utf8')}});await db.connect();
const admin=createClient(`https://${ref}.supabase.co`,secret,{auth:{persistSession:false,autoRefreshToken:false}});const email=`cloud-rehearsal-${randomUUID()}@example.invalid`,password=`Stage-${randomUUID()}!`;let uid;const passed=[];const cookies=new Map();
const auth=createServerClient(`https://${ref}.supabase.co`,pub,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(v=>cookies.set(v.name,v.value))}});
function api(route,body,method='POST',binary=false,guest=false){assert(route.startsWith('/api/'));const output=root+'address-http-response.bin',request=root+'address-http-request.json',cfg=root+'address-curl.cfg';if(body!==undefined)fs.writeFileSync(request,JSON.stringify(body));const headers={'Cookie':guest?'':[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'Origin':base,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'x-makeborne-crm-protocol':'2'};fs.writeFileSync(cfg,Object.entries(headers).map(([k,v])=>`header = ${JSON.stringify(k+': '+v)}`).join('\n'));
const args=['C:/Users/kerim/AppData/Local/npm-cache/_npx/69f9afb961c37556/node_modules/vercel/dist/index.js','curl',base+route,'--scope','kerimsabic-6594s-projects','--','--config',cfg,'--silent','--show-error','--max-time','90','--request',method,'--output',output,'--write-out','%{http_code}',...(body===undefined?[]:['--data-binary','@'+request])];const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:120000});assert.equal(r.status,0,'Protected staging HTTP request failed');const status=Number(r.stdout.trim());const bytes=fs.readFileSync(output);return{status,body:binary?bytes:JSON.parse(bytes.toString())};}

try {
 const c=await admin.auth.admin.createUser({email,password,email_confirm:true});assert(!c.error);uid=c.data.user.id;assert(!(await auth.auth.signInWithPassword({email,password})).error);
 await db.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,false,'Disposable address change fixture')",[uid]);
 const w=api('/api/workspaces',{name:'Disposable address change'});assert.equal(w.status,201);const wid=w.body.workspace.id;
 const p=api(`/api/cloud/workspaces/${wid}/projects`,{title:'Moss studio',kind:'website'});assert.equal(p.status,201);
 const a=api(`/api/cloud/workspaces/${wid}/projects/${p.body.project.id}/artifacts`,{title:'Moss studio',kind:'website'});assert.equal(a.status,201);const aid=a.body.artifact.id;
 const style={id:'editorial',name:'Editorial',version:1,typography:{headingFont:'Georgia',bodyFont:'Arial'},colors:{ink:'#172121'},description:'Fixture',referenceAssetIds:[]};
 const v=api(`/api/cloud/workspaces/${wid}/artifacts/${aid}/versions`,{expectedVersion:0,content:{schemaVersion:1,title:'Moss studio',kind:'website',sections:[{id:randomUUID(),title:'Moss studio',blocks:[{id:randomUUID(),type:'paragraph',text:'A disposable cloud address test.'}]}]},style,assetIds:[],changeSummary:'Fixture'});assert.equal(v.status,201);
 const slug='moss-studio-'+randomUUID().slice(0,8),newSlug='moss-atelier-'+randomUUID().slice(0,8),route=`/api/cloud/workspaces/${wid}/artifacts/${aid}/publication`;
 const first=api(route,{live:true,slug,version:1,revision:0,acknowledged:true,interactive:false});assert.equal(first.status,200,JSON.stringify(first));
 const changed=api(route,{live:true,slug:newSlug,version:1,revision:first.body.site.revision,acknowledged:true,interactive:false});assert.equal(changed.status,200,JSON.stringify(changed));assert.equal(changed.body.site.slug,newSlug);
 const saved=(await db.query('select html from public.hosted_sites where artifact_id=$1',[aid])).rows[0];// Staging previews run the isolated domain (NEXT_PUBLIC_MAKEBORNE_SITE_HOSTING=isolated); STAGING_SITE_HOSTING=default checks the legacy host.
 const siteUrl=value=>process.env.STAGING_SITE_HOSTING==='default'?'https://sites.makeborne.com/'+value:'https://'+value+'.makeborne.site/';
 assert(saved.html.includes(siteUrl(newSlug)),'canonical must name the new address');assert(!saved.html.includes(siteUrl(slug)),'old address must be gone');
 passed.push('Real cloud publish and address change with updated canonical URL');
 const stale=api(route,{live:true,slug:'stale-'+randomUUID().slice(0,8),version:1,revision:first.body.site.revision,acknowledged:true,interactive:false});assert.equal(stale.status,409);passed.push('Stale address change rejected');
 console.log(JSON.stringify({passed,publicHostingTested:false,productionTouched:false,paidCalls:0}));
} catch(error){console.error(error.message);process.exitCode=1;}
finally{
 await auth.auth.signOut();
 if(uid){await db.query('delete from makeborne_private.cloud_mutation_receipts where actor_id=$1',[uid]);await db.query('delete from public.hosted_sites where owner_id=$1',[uid]);await db.query('delete from public.workspaces where owner_id=$1',[uid]);assert(!(await admin.auth.admin.deleteUser(uid)).error);}
 await db.end();fs.writeFileSync('docs/release-review/cloud-address-changes.json',JSON.stringify({deployment:base,passed,failed:!!process.exitCode,publicHostingTested:false,paidCalls:0,productionTouched:false},null,2));
}

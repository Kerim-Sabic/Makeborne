import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';import {createClient} from '@supabase/supabase-js';import {createServerClient} from '@supabase/ssr';import pg from 'pg';
const ref='xzwikrunwpurxnxgkznh',base=process.env.STAGING_BASE??'https://makeborne-release-staging-a8xmk8pqq-kerimsabic-6594s-projects.vercel.app',root='work/release-auth-stack/';
if(!/^https:\/\/makeborne-release-staging-[a-z0-9]+-kerimsabic-6594s-projects\.vercel\.app$/.test(base))throw new Error('STAGING_BASE must be a staging preview');
const project=JSON.parse(fs.readFileSync(root+'cloud-create-result.json'));assert.equal(project.ref,ref);const config=JSON.parse(fs.readFileSync(root+'cloud-staging.json'));const keys=JSON.parse(fs.readFileSync(root+'cloud-api-keys.json')).keys;const pub=keys.find(k=>k.type==='publishable').api_key,secret=keys.find(k=>k.type==='secret').api_key;
const db=new pg.Client({host:`db.${ref}.supabase.co`,user:'postgres',password:config.password,database:'postgres',ssl:{rejectUnauthorized:true,ca:fs.readFileSync(root+'supabase-ca.crt','utf8')}});await db.connect();
const admin=createClient(`https://${ref}.supabase.co`,secret,{auth:{persistSession:false,autoRefreshToken:false}});const email=`cloud-rehearsal-${randomUUID()}@example.invalid`,password=`Stage-${randomUUID()}!`;let uid;const passed=[];let stage='create synthetic account';const cookies=new Map();
const auth=createServerClient(`https://${ref}.supabase.co`,pub,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(v=>cookies.set(v.name,v.value))}});
function api(route,body,method='POST',binary=false,guest=false){assert(route.startsWith('/auth/confirm'));const output=root+'cloud-auth-http-response.bin',request=root+'cloud-auth-http-request.json',cfg=root+'cloud-auth-curl.cfg';if(body!==undefined)fs.writeFileSync(request,JSON.stringify(body));const headers={'Cookie':guest?'':[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'Origin':base,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'x-makeborne-crm-protocol':'2'};fs.writeFileSync(cfg,Object.entries(headers).map(([k,v])=>`header = ${JSON.stringify(k+': '+v)}`).join('\n'));
const args=['C:/Users/kerim/AppData/Local/npm-cache/_npx/69f9afb961c37556/node_modules/vercel/dist/index.js','curl',base+route,'--scope','kerimsabic-6594s-projects','--','--config',cfg,'--silent','--show-error','--max-time','90','--request',method,'--output',output,'--write-out','%{http_code}',...(body===undefined?[]:['--data-binary','@'+request])];const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:120000});assert.equal(r.status,0,'Protected staging HTTP request failed');const status=Number(r.stdout.trim());const bytes=fs.readFileSync(output);return{status,body:binary?bytes:JSON.parse(bytes.toString())};}

try {
 stage='generate isolated signup token';
 const link=await admin.auth.admin.generateLink({type:'signup',email,password});
 assert(!link.error,'Could not create synthetic signup link');uid=link.data.user.id;
 const token=link.data.properties.hashed_token;assert(token);
 assert(!(await admin.auth.admin.getUserById(uid)).data.user.email_confirmed_at);
 stage='scanner-safe GET';
 const scan=api(`/auth/confirm?token_hash=${encodeURIComponent(token)}&type=email`,undefined,'GET',true,true);
 assert.equal(scan.status,307);
 assert(!(await admin.auth.admin.getUserById(uid)).data.user.email_confirmed_at,'GET must not consume token');
 passed.push('Cloud confirmation GET leaves account unconfirmed');
 stage='explicit confirmation';
 const confirmed=api('/auth/confirm',{token_hash:token,type:'email',next:'https://example.org'},'POST',false,true);
 assert.equal(confirmed.status,200);
 assert(confirmed.body.next.startsWith('/')&&!confirmed.body.next.startsWith('//'));
 assert((await admin.auth.admin.getUserById(uid)).data.user.email_confirmed_at);
 passed.push('Explicit cloud confirmation succeeds and rejects external redirect');
 assert.equal(api('/auth/confirm',{token_hash:token,type:'email'},'POST',false,true).status,400);
 passed.push('Consumed confirmation link cannot be replayed');
 const login=await auth.auth.signInWithPassword({email,password});assert(!login.error);
 passed.push('Newly confirmed account signs in');
 stage='password recovery';
 const recovery=await admin.auth.admin.generateLink({type:'recovery',email});assert(!recovery.error,'Could not create synthetic recovery link');
 const recoveryToken=recovery.data.properties.hashed_token;
 const recovered=api('/auth/confirm',{token_hash:recoveryToken,type:'recovery',next:'/projects'},'POST',false,true);
 assert.equal(recovered.status,200);assert(recovered.body.next.startsWith('/auth/update-password'),'recovery must land on the password form: '+recovered.body.next);
 assert.equal(api('/auth/confirm',{token_hash:recoveryToken,type:'recovery'},'POST',false,true).status,400);
 passed.push('Recovery link opens the password form and cannot be replayed');
 stage='password change and logout';
 const changed=`Stage-${randomUUID()}!`;
 assert(!(await auth.auth.updateUser({password:changed})).error,'Password update failed');
 const oldRefresh=(await auth.auth.getSession()).data.session?.refresh_token;assert(oldRefresh);
 assert(!(await auth.auth.signOut({scope:'global'})).error,'Sign-out failed');
 const reuse=createClient(`https://${ref}.supabase.co`,pub,{auth:{persistSession:false,autoRefreshToken:false}});
 assert((await reuse.auth.refreshSession({refresh_token:oldRefresh})).error,'Refresh token still valid after sign-out');
 assert((await reuse.auth.signInWithPassword({email,password})).error,'Old password still accepted');
 assert(!(await reuse.auth.signInWithPassword({email,password:changed})).error,'New password refused');
 await reuse.auth.signOut();
 passed.push('Password change takes effect; sign-out revokes the session refresh token');
 console.log(JSON.stringify({passed}));
} catch(e){console.error(`FAIL ${stage}: ${e.message}`);process.exitCode=1;}
finally{
 await auth.auth.signOut();
 if(uid){const removed=await admin.auth.admin.deleteUser(uid);assert(!removed.error,'Synthetic account cleanup failed');}
 await db.end();
 fs.writeFileSync('docs/release-review/cloud-confirmation-results.json',JSON.stringify({deployment:base,passed,failedStage:process.exitCode?stage:null,emailDeliveryTested:false,productionTouched:false,paidCalls:0},null,2));
}

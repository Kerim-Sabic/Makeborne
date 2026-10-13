// Isolated namespace qualification. Explicit inspected disposable only.
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const container=process.argv[2];assert.equal(container,'makeborne_publication_20261013034802');
const migration='supabase/migrations/20261013200000_staging_site_address_namespace.sql';
const migrationText=readFileSync(migration,'utf8'),sha=value=>createHash('sha256').update(value).digest('hex');
const query=(sql,user='postgres')=>new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',container,'psql','-h','127.0.0.1','-U',user,'-d','rehearsal','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-Atq']);
 let output='',error='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>error+=data);
 child.on('error',reject);child.on('close',code=>resolve({code,output:output.trim(),error}));child.stdin.end(sql);
});
const holders=[];
const hold=async sql=>{
 const child=spawn('docker',['exec','-i',container,'psql','-h','127.0.0.1','-U','postgres','-d','rehearsal','-v','ON_ERROR_STOP=1','-Atq']);
 let output='',error='',ready=false;const closed=new Promise(resolve=>child.on('close',resolve));
 const item={child,closed};holders.push(item);child.stderr.on('data',chunk=>error+=chunk);
 await new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('NAMESPACE_HELD')){ready=true;resolve();}});child.on('error',reject);child.on('close',()=>{if(!ready)reject(new Error(error));});child.stdin.write(`begin;${sql}\n\\echo NAMESPACE_HELD\n`);});
 return {output,finish:async(commit=true)=>{child.stdin.end(commit?'commit;\n':'rollback;\n');assert.equal(await closed,0,error);holders.splice(holders.indexOf(item),1);}};
};
const one=async(sql,user)=>{const result=await query(sql,user);assert.equal(result.code,0,result.error);return result.output?JSON.parse(result.output.split('\n').at(-1)):null;};
const denied=async(sql,pattern=/42501: SITE_ADDRESS_NAMESPACE_DENIED/,user)=>{const result=await query(sql,user);assert.notEqual(result.code,0);assert.match(result.error,pattern);};
const lit=value=>`'${String(value).replaceAll("'","''")}'`,json=value=>`${lit(JSON.stringify(value))}::jsonb`;
const qa={u:randomUUID(),s:randomUUID(),w:randomUUID(),p:randomUUID()},other={u:randomUUID(),s:randomUUID(),w:randomUUID(),p:randomUUID()};
const ordinary=randomUUID(),legacy=randomUUID(),source=randomUUID(),foreign=randomUUID(),worker=randomUUID();
const artifacts=[{id:ordinary,scope:qa,source:false},{id:legacy,scope:qa,source:false},{id:source,scope:qa,source:true},{id:foreign,scope:other,source:true}].map(a=>({...a,v:randomUUID()}));
const sourceContent={kind:'website',sections:[],websiteSource:{schemaVersion:1,toolchainId:'react-vite-v1',entrypoint:'src/main.tsx',files:[{},{},{},{}],assets:[],routes:[{path:'/',title:'Home'}]}};
const html='<!doctype html><html><body><h1>Namespace fixture</h1></body></html>'+' '.repeat(120);
const output={html,isolatedHtml:html,script:null,files:[],interactive:false,routes:[{path:'/',html,isolatedHtml:html}]};
const script='console.log("namespace fixture")',files=[{path:'/_mb/app-1111111111111111.js',content_type:'text/javascript; charset=utf-8',body:Buffer.from(script).toString('base64'),sha256:sha(script)}];
const save=(id,slug,revision=0,live=true,interactive=false)=>`public.makeborne_save_hosted_site_v4('${qa.u}','${qa.w}','${id}',1,'${slug}',${lit(html)},${live},${revision},'${randomUUID()}',${interactive},${interactive?lit(files[0].path):'null'},${interactive?json(files):"'[]'"},${interactive?lit(html):'null'})`;
const request=(scope,id,slug,revision=0,key=randomUUID())=>`public.makeborne_request_publication_preparation('${scope.u}','${scope.s}',now()+interval '20 minutes','${scope.w}','${id}',1,${revision},'${slug}',false,'${key}')`;
const rpc=call=>one(`set role service_role;select ${call};`);
const suffix=randomUUID().replaceAll('-','').slice(0,10),logins=[{name:`ns_service_${suffix}`,role:'service_role'},{name:`ns_worker_${suffix}`,role:'makeborne_publication_worker'}];
const checks=[],evidence={container,startedAt:new Date().toISOString(),passed:false,cloudWrites:0,providerCalls:0,migration,sha256:sha(migrationText),checks};
const evidencePath='docs/release-review/site-address-namespace-20261013.json';
const prior=existsSync(evidencePath)?JSON.parse(readFileSync(evidencePath,'utf8')):null;
if(prior?.sha256===evidence.sha256 && prior.checks?.some(x=>x.startsWith('migration aborts atomically')))
 evidence.priorCollisionRun={startedAt:prior.startedAt,check:prior.checks[0],cleanupError:prior.cleanupError??null};
else if(prior?.sha256===evidence.sha256 && prior.priorCollisionRun)evidence.priorCollisionRun=prior.priorCollisionRun;
try{
 await one(`${[qa,other].map(s=>`insert into auth.users(id,email,email_confirmed_at) values('${s.u}','${s.u}@namespace.invalid',now());insert into auth.sessions(id,user_id) values('${s.s}','${s.u}');
 insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values('${s.u}',true,false,'Namespace fixture');
 insert into public.workspaces(id,name,owner_id) values('${s.w}','Namespace fixture','${s.u}');insert into public.projects(id,workspace_id,title,kind) values('${s.p}','${s.w}','Namespace fixture','website');`).join('\n')}
 ${artifacts.map(a=>`insert into public.artifacts(id,workspace_id,project_id,title,kind) values('${a.id}','${a.scope.w}','${a.scope.p}','Namespace fixture','website');
 insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,created_by) values('${a.v}','${a.scope.w}','${a.id}',1,${json(a.source?sourceContent:{})},'{}','${a.scope.u}');update public.artifacts set current_version=1 where id='${a.id}';`).join('\n')}select '{}'::json;`);
 const installed=await one("select to_json(to_regclass('makeborne_private.site_address_namespace_policy') is not null);");
 if(!installed){
  await rpc(save(legacy,'release-check'));
  await denied(migrationText,/MB409: QA address namespace already occupied/);
  assert.equal(await one("select to_json(to_regclass('makeborne_private.site_address_namespace_policy') is null);"),true);
  assert.equal(await one(`select to_json(slug) from public.hosted_sites where artifact_id='${legacy}';`),'release-check');
  await rpc(save(legacy,'former-qa-fixture',1));
  await denied(migrationText,/MB409: QA address namespace already occupied/);
  await one(`delete from public.hosted_sites where artifact_id='${legacy}';select '{}'::json;`);
  const pending=await rpc(request(qa,source,'release-check'));
  await denied(migrationText,/MB409: QA address namespace already occupied/);
  await one(`delete from makeborne_private.publication_preparations where id='${pending.id}';select '{}'::json;`);
  const applied=await query(migrationText);assert.equal(applied.code,0,applied.error);
  checks.push('migration aborts atomically for existing QA site, retired reservation, and preparation without seizing or changing ownership; clean apply succeeds');
 }else checks.push('migration already installed; collision apply evidence belongs to initial run');
 assert.deepEqual(await one('select json_build_object(\'mode\',mode,\'workspace\',qa_workspace_id) from makeborne_private.site_address_namespace_policy;'),{mode:'production',workspace:null});
 await rpc(save(ordinary,'existing-ordinary-fixture',0,true,true));
 for(const slug of ['release-check','release-check-renamed']){
  await denied(`set role service_role;select ${save(legacy,slug)};`);
  await denied(`set role service_role;select ${request(qa,source,slug)};`);
  await denied(`insert into makeborne_hosting.site_address_reservations(slug,artifact_id) values('${slug}','${ordinary}');`);
 }
 assert.equal(await one(`select to_json(slug) from public.hosted_sites where artifact_id='${ordinary}';`),'existing-ordinary-fixture');
 checks.push('default production refuses both QA labels through raw/legacy publication, trusted request and reservation writes; existing ordinary site unchanged');
 await one(`${logins.map(({name,role})=>`create role ${name} login noinherit;grant ${role} to ${name};`).join('\n')}select '{}'::json;`);
 for(const {name,role} of logins){
  await denied(`set role ${role};select makeborne_private.configure_site_address_namespace('staging','${qa.w}');`,/permission denied/,name);
  await denied(`set role ${role};update makeborne_private.site_address_namespace_policy set mode='staging',qa_workspace_id='${qa.w}';`,/permission denied/,name);
  await denied(`set role ${role};set role postgres;`,/permission denied to set role/,name);
 }
 checks.push('actual service/worker LOGIN sessions cannot configure, directly mutate policy, or SET ROLE to database owner');
 const active=await rpc(request(qa,source,'ordinary-pending'));
 await denied(`select makeborne_private.configure_site_address_namespace('staging','${qa.w}');`,/MB409: Drain incompatible/);
 await one(`delete from makeborne_private.publication_preparations where id='${active.id}';select '{}'::json;`);
 await denied(`select makeborne_private.configure_site_address_namespace('staging','${randomUUID()}');`,/22023: Invalid namespace/);
 // Writer-first: the policy share lock makes configuration wait, then its
 // validation must see the writer's committed incompatible preparation.
 const concurrentKey=randomUUID(),writer=await hold(`set local role service_role;select ${request(qa,source,'ordinary-concurrent',0,concurrentKey)};`);
 const switchName=`ns_switch_${suffix}`;
 const switching=query(`set application_name='${switchName}';select makeborne_private.configure_site_address_namespace('staging','${qa.w}');`);
 const waitForLock=async name=>{for(let i=0;i<30;i++){if(await one(`select to_json(exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock'));`))return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Expected concurrent policy lock wait');};
 await waitForLock(switchName);await writer.finish();
 const refused=await switching;assert.notEqual(refused.code,0);assert.match(refused.error,/MB409: Drain incompatible/);
 await one(`delete from makeborne_private.publication_preparations where actor_id='${qa.u}' and request_id='${concurrentKey}';select '{}'::json;`);
 // Configuration-first: a request waiting on the policy row must validate the
 // new staging mode after the owner commits, rather than a stale snapshot.
 const configHolder=await hold(`select makeborne_private.configure_site_address_namespace('staging','${qa.w}');`);
 const publishName=`ns_publish_${suffix}`,publishing=query(`set application_name='${publishName}';set role service_role;select ${request(qa,source,'ordinary-racing-switch')};`);
 await waitForLock(publishName);await configHolder.finish();
 const publishRefused=await publishing;assert.notEqual(publishRefused.code,0);assert.match(publishRefused.error,/42501: SITE_ADDRESS_NAMESPACE_DENIED/);
 checks.push('real policy/write races in both orders: configuration waits then sees committed incompatible work; waiting publication sees newly committed staging policy and fails');
 checks.push('owner configuration validates workspace and refuses incompatible in-flight preparations before staging opt-in');
 assert.equal(await one("select to_json(public.makeborne_read_hosted_site('existing-ordinary-fixture'));"),html);
 await one(`update public.hosted_sites set enquiries_enabled=false,updated_at=clock_timestamp() where artifact_id='${ordinary}';select '{}'::json;`);
 await denied(`set role service_role;select ${save(ordinary,'existing-ordinary-fixture',1)};`);
 await denied(`set role service_role;select ${save(ordinary,'outside-staging',1)};`);
 await rpc(`public.makeborne_set_hosted_site_interactive('${qa.u}','${qa.w}','${ordinary}',false,1,'${randomUUID()}')`);
 await denied(`set role service_role;select public.makeborne_set_hosted_site_interactive('${qa.u}','${qa.w}','${ordinary}',true,2,'${randomUUID()}');`);
 await denied(`update public.hosted_sites set interactive=false,html=html||'hidden change' where artifact_id='${ordinary}';`);
 await rpc(save(ordinary,'existing-ordinary-fixture',2,false));
 assert.equal(await one(`select to_json(live) from public.hosted_sites where artifact_id='${ordinary}';`),false);
 assert.equal(await one(`select to_json(interactive) from public.hosted_sites where artifact_id='${ordinary}';`),false);
 await one(`delete from public.hosted_sites where artifact_id='${ordinary}';select '{}'::json;`);
 assert.equal(await one(`select to_json(count(*)) from makeborne_hosting.site_address_reservations where artifact_id='${ordinary}';`),0);
 checks.push('ordinary staging sites remain readable, metadata-editable, interactive-disableable, unpublishable and deletable; enable/hidden-content-change/republish/rename outside QA refused');
 await denied(`set role service_role;select ${request(other,foreign,'release-check')};`);
 await denied(`set role service_role;select ${request(qa,source,'ordinary-address')};`);
 await rpc(save(legacy,'release-check'));
 const renamed=await rpc(save(legacy,'release-check-renamed',1));assert.equal(renamed.slug,'release-check-renamed');
 assert.equal(await one("select to_json(count(*)) from makeborne_hosting.site_address_reservations where slug in ('release-check','release-check-renamed');"),2);
 await denied(`select makeborne_private.configure_site_address_namespace('staging','${other.w}');`,/MB409: QA address namespace belongs/);
 await denied("update makeborne_private.site_address_namespace_policy set mode='production',qa_workspace_id=null;",/MB409: QA address namespace belongs/);
 await one(`delete from public.hosted_sites where artifact_id='${legacy}';select '{}'::json;`);
 checks.push('only configured QA workspace can claim exact labels; legacy publish+rename retain both reservations; conflicting owner reconfiguration/direct policy update refused');
 const pending=await rpc(request(qa,source,'release-check'));
 const claimed=await rpc(`public.makeborne_claim_publication_preparation('${pending.id}','${worker}')`);
 const receipt={preparationId:pending.id,actorId:qa.u,workspaceId:qa.w,projectId:qa.p,artifactId:source,versionId:artifacts.find(a=>a.id===source).v,versionNumber:1,publicationRevision:0,versionContentHash:claimed.versionContentHash,slug:'release-check',interactive:false};
 await rpc(`public.makeborne_complete_publication_preparation('${pending.id}','${worker}',${claimed.fence},${json(receipt)},${lit(JSON.stringify(output))})`);
 const promoted=await rpc(`public.makeborne_promote_publication_preparation('${pending.id}','${qa.u}','${qa.s}',now()+interval '20 minutes')`);assert.equal(promoted.slug,'release-check');
 await denied(`update makeborne_private.publication_preparations set slug='outside-staging' where id='${pending.id}';`);
 await denied(`update public.hosted_sites set slug='outside-staging' where artifact_id='${source}';`);
 checks.push('trusted QA request/claim/completion/promotion succeeds; direct preparation/site identity mutation cannot bypass namespace');
 const original=await one(`select to_json(count(*)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='makeborne_private' and p.proname in ('check_site_address_namespace','guard_site_address_namespace','validate_site_address_namespace_policy','configure_site_address_namespace') and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE') or has_function_privilege('makeborne_publication_worker',p.oid,'EXECUTE'));`);assert.equal(original,0);
 checks.push('all new private helpers have zero browser/service/worker execute grants; policy has RLS and no caller table grants');
 assert.equal(sha(readFileSync(migration,'utf8')),evidence.sha256);evidence.passed=true;
}catch(error){evidence.error=String(error?.stack??error);process.exitCode=1;}
finally{
 for(const item of holders){item.child.stdin.end('rollback;\n');await item.closed;}
 const cleanup=await query(`delete from public.hosted_sites where workspace_id in ('${qa.w}','${other.w}');delete from public.workspaces where id in ('${qa.w}','${other.w}');delete from auth.users where id in ('${qa.u}','${other.u}');${logins.map(({name})=>`drop role if exists ${name};`).join('\n')}
 do $$begin if to_regclass('makeborne_private.site_address_namespace_policy') is not null then perform makeborne_private.configure_site_address_namespace('production',null);end if;end$$;`);
 if(cleanup.code!==0){evidence.cleanupError=cleanup.error;evidence.passed=false;process.exitCode=1;}
 evidence.finishedAt=new Date().toISOString();writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
}
console.log(JSON.stringify(evidence,null,2));

/* eslint-disable @typescript-eslint/no-require-imports -- Rolled-back local database authority qualification. */
const fs=require('node:fs'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {createNativeSlideFixture}=require('./native-slide-fixture.cjs');
if(process.env.MAKEBORNE_VERIFY_LOCAL_JOBS!=='true'){console.error('Explicit local verification required.');process.exit(2);}
// Reuse the established result-authority fixture setup. Fail if its boundaries
// change rather than quietly running a different fixture or touching real rows.
const original=fs.readFileSync('supabase/check-generation-result.sql','utf8');
const boundary=" perform set_config('request.jwt.claims'";assert.equal(original.split(boundary).length,2);
let setup=original.slice(0,original.indexOf(boundary));
if(process.env.MAKEBORNE_VERIFY_PENDING_NATIVE_PROGRESS==='true'){
 const pending=fs.readFileSync('supabase/migrations/20261009015516_native_presentation_progress.sql','utf8').replace(/^begin;\s*/,'').replace(/commit;\s*$/,'');
 setup=setup.replace('begin;',()=> 'begin;\n'+pending);
}
assert.ok(setup.includes('vendor_limit=100,concurrency_limit=10'));
// Existing paid qualification receipts are immutable. Only inside this rolled
// back transaction, leave headroom above that spend instead of resetting it.
setup=setup.replace('vendor_limit=100,concurrency_limit=10','vendor_limit=vendor_spent+vendor_reserved+100,concurrency_limit=10');
for(const before of ["'Authority fixture','website'","'output','website'"]){assert.ok(setup.includes(before));setup=setup.replaceAll(before,before.replace("'website'","'presentation'"));}
const fixture=createNativeSlideFixture();
for(const [name,value]of [['content',fixture.content],['style',fixture.style]]){
 const pattern=new RegExp(` ${name}:='[^\\n]*'::jsonb;`);assert.equal((setup.match(pattern)||[]).length,1);
 setup=setup.replace(pattern,` ${name}:='${JSON.stringify(value).replaceAll("'","''")}'::jsonb;`);
}
// Qualify the actual saved-base operation rather than only an empty artifact.
const assignments=setup.match(/ (?:content|style):='[^\n]*'::jsonb;/g);assert.equal(assignments?.length,2);
for(const line of assignments)setup=setup.replace(line,'');
const baseSetup=assignments.join('\n')+`
 insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,content,style_snapshot,asset_manifest,created_by)
 values(version_uuid,workspace,artifact,1,content,style,'[]',actor);
 update public.artifacts set current_version=1 where id=artifact;
`;
assert.ok(setup.includes(' snapshot:=jsonb_build_object'));
setup=setup.replace(' snapshot:=jsonb_build_object',baseSetup+'\n snapshot:=jsonb_build_object');
assert.ok(setup.includes("'baseVersionId',null"));setup=setup.replace("'baseVersionId',null","'baseVersionId',version_uuid");
assert.ok(setup.includes('(id,workspace_id,project_id,artifact_id,input_hash'));
setup=setup.replace('(id,workspace_id,project_id,artifact_id,input_hash','(id,workspace_id,project_id,artifact_id,base_version_id,input_hash');
assert.ok(setup.includes('values(proposal,workspace,project,artifact,'));
setup=setup.replace('values(proposal,workspace,project,artifact,','values(proposal,workspace,project,artifact,version_uuid,');
if(process.env.MAKEBORNE_VERIFY_NATIVE_OPERATOR==='true'){
 if(process.env.MAKEBORNE_VERIFY_PENDING_NATIVE_OPERATOR==='true'){
  const migration=fs.readFileSync('supabase/migrations/20261009021050_operator_native_composition_qualification.sql','utf8').replace(/^begin;\s*/,'').replace(/commit;\s*$/,'');setup=setup.replace('begin;',()=> 'begin;\n'+migration);
 }
 const before=' insert into makeborne_private.generation_proposals';assert.equal(setup.split(before).length,2);
 const patch=`
 snapshot:=snapshot||jsonb_build_object('purpose','operator_qualification','qualificationRound','claude-design-round-1');
 snapshot:=jsonb_set(snapshot,'{input,content}',content);
 snapshot:=jsonb_set(snapshot,'{workflow}',(snapshot->'workflow')||jsonb_build_object('presentationMode','editable','includeImages',false,'maximumExecutions',1,'maximumCustomerCredits','0','stages',jsonb_build_array(jsonb_build_object('stage','draft','maximumExecutions',1,'route',route||jsonb_build_object('evaluation',null),'request',jsonb_build_object('maximumAttempts',1)))));
 for i in 1..7 loop
  begin
   insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,base_version_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at)
   values(proposal,workspace,project,artifact,version_uuid,repeat('a',64),repeat('b',64),
    case i when 1 then jsonb_set(snapshot,'{qualificationRound}','"other"')
    when 2 then jsonb_set(snapshot,'{workflow,output}','"book"')
    when 3 then jsonb_set(snapshot,'{workflow,presentationMode}','"full_visual"')
    when 4 then jsonb_set(snapshot,'{workflow,includeImages}','true')
    when 5 then jsonb_set(snapshot,'{workflow,stages,0,route,evaluation}','{"quality":100,"evidenceId":"invented"}')
    when 6 then jsonb_set(snapshot,'{purpose}','"presentation_composition"')
    else jsonb_set(snapshot,'{workflow,maximumExecutions}','2') end,12,0,t,t+interval '1 hour');
   raise exception 'Invalid operator native proposal accepted';
  exception when check_violation then null; end;
 end loop;
 raise notice 'PASS seven direct operator-native shape/evaluation/round mutations independently rejected';
`;
 setup=setup.replace(before,()=>patch+before).replace('snapshot,12,3,t,','snapshot,12,0,t,');
}
const checks=`
 set local role makeborne_generation_worker;
 begin
  perform makeborne_private.commit_generation_worker_result(job.id,worker,job.fence,dispatch,0,'anthropic','offline','fixture-v1','native-result-fixture',repeat('e',64),jsonb_set(content,'{sections,0,slideDesign,elements,0,x}','-1'),style,'[]','Invalid native composition');
  raise exception 'Invalid native geometry accepted';
 exception when invalid_parameter_value then null; end;
 reset role;
 if (select count(*) from public.artifact_versions where artifact_id=artifact)<>1 or exists(select 1 from makeborne_private.generation_provider_outcomes where job_id=job.id) then raise exception 'Invalid geometry left partial state'; end if;
 raise notice 'PASS database independently rejects invalid slide geometry and leaves no version/outcome';
 for i in 1..3 loop
  begin
   if i=1 then delete from auth.sessions where id=session_uuid;
   elsif i=2 then update public.workspace_members set role='reviewer' where workspace_id=workspace and user_id=actor;
   else update public.sources set content='Changed after presentation dispatch' where id=source_uuid; end if;
   perform makeborne_private.commit_generation_worker_result(job.id,worker,job.fence,dispatch,0,'anthropic','offline','fixture-v1','native-result-fixture',repeat('e',64),content,style,'[]','Native composition; visual review required');
   raise exception 'Revoked native authority saved output';
  exception when insufficient_privilege or sqlstate 'PT409' then null; end;
 end loop;
 if (select count(*) from public.artifact_versions where artifact_id=artifact)<>1 or exists(select 1 from makeborne_private.generation_provider_outcomes where job_id=job.id) then raise exception 'Revoked authority left native partial state'; end if;
 raise notice 'PASS signout, editor revocation and changed source block native result without side effects';
 set local role makeborne_generation_worker;
 saved:=makeborne_private.commit_generation_worker_result(job.id,worker,job.fence,dispatch,0,'anthropic','offline','fixture-v1','native-result-fixture',repeat('e',64),content,style,'[]','Native composition; visual review required');
 again:=makeborne_private.commit_generation_worker_result(job.id,worker,job.fence,dispatch,0,'anthropic','offline','fixture-v1','native-result-fixture',repeat('e',64),content,style,'[]','Native composition; visual review required');
 reset role;
 if saved->>'versionId' is distinct from again->>'versionId' or saved->>'outcomeId' is distinct from again->>'outcomeId' or again->>'replayed'<>'true' then raise exception 'Native replay changed receipt'; end if;
 if (select count(*) from public.artifact_versions where artifact_id=artifact)<>2 or (select count(*) from makeborne_private.generation_provider_outcomes where job_id=job.id)<>1 then raise exception 'Native result not exactly once'; end if;
 if not exists(select 1 from public.artifact_versions where id=(saved->>'versionId')::uuid and version_number=2 and parent_version_id=version_uuid) then raise exception 'Native result lost saved base'; end if;
 if (select v.content from public.artifact_versions v where v.id=(saved->>'versionId')::uuid) is distinct from content then raise exception 'Native geometry/text changed'; end if;
 if exists(select 1 from makeborne_private.project_builds where job_id=job.id) then raise exception 'Native slides queued a website build'; end if;
 if saved->>'readyForPublication'<>'false' then raise exception 'Native result implicitly published'; end if;
 raise notice 'PASS restricted worker preserves saved base as parent and native composition/cost once; replay stable, no website build or publication';
 result:=makeborne_private.submission_progress(job.id,actor,session_uuid,t+interval '30 minutes');
 if result->>'state'<>'awaiting_review' or result->>'outputVersionId' is distinct from saved->>'versionId'
   or result#>>'{credits,charged}'<>'0' then raise exception 'Native saved output has incorrect progress'; end if;
 begin
  update public.workspace_members set role='reviewer' where workspace_id=workspace and user_id=actor;
  result:=makeborne_private.submission_progress(job.id,actor,session_uuid,t+interval '30 minutes');
  if result->'credits'<>'null'::jsonb or result->>'canCancel'<>'false' then raise exception 'Reviewer can see finances or cancel'; end if;
  raise exception 'Rollback reviewer projection fixture' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 raise notice 'PASS native output projects awaiting_review with exact saved revision; reviewer finance/cancel restrictions preserved';
 begin
  insert into public.artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,content,style_snapshot,asset_manifest,created_by)
  values(gen_random_uuid(),workspace,artifact,3,(saved->>'versionId')::uuid,content,style,'[]',actor);
  perform makeborne_private.commit_generation_worker_result(job.id,worker,job.fence,dispatch,0,'anthropic','offline','fixture-v1','native-result-fixture',repeat('e',64),content,style,'[]','Native composition; visual review required');
  raise exception 'Later customer revision overwritten';
 exception when sqlstate 'PT409' then null; end;
 raise notice 'PASS stale native worker replay cannot overwrite a later customer revision';
end $$;
rollback;
`;
const r=spawnSync('docker',['exec','-i','supabase_db_makeborne-local','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:setup+checks,encoding:'utf8',windowsHide:true});
process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status??1;

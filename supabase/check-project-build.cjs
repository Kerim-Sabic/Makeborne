/* eslint-disable @typescript-eslint/no-require-imports -- Explicit local synthetic qualification only. */
const {Client}=require('pg'),{randomUUID,randomBytes,createHash}=require('node:crypto'),{fork}=require('node:child_process');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createProjectBuildWorker,validateBuildReceipt}=require('../src/lib/projects/build-worker.ts');
const {canonicalSourceJson}=require('../src/lib/projects/canonical-json.ts');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

exports.qualifyBuild=async({admin,url,job,result,owner,evidenceDirectory})=>{
 const name=`makeborne_builder_probe_${randomUUID().replaceAll('-','').slice(0,12)}`,password=randomBytes(32).toString('hex');
 const target=new URL(url);target.username=name;target.password=password;
 const connections=[],crashedWorker=randomUUID(),recoveredWorker=randomUUID(),supervisorWorker=randomUUID();
 let created=false,child,supervisor,receipt,builtWorkload,retainedDirectory,outputStore,heartbeats=0,builds=0,disposals=0,temporaryOutput,interruptRetention=true,r2Runtime;
 async function connect(){const db=new Client({connectionString:target.href,options:'-c role=makeborne_project_builder',query_timeout:5000});db.on('error',()=>{});await db.connect();connections.push(db);return db;}
 async function denied(fn,code='PT409'){await assert.rejects(fn,e=>e.code===code);}
 async function rolledBack(fn){await admin.query('begin');try{await fn();}finally{await admin.query('rollback');}}
 try {
  const queued=(await admin.query('select * from makeborne_private.project_builds where job_id=$1',[job.id])).rows[0];
  assert.equal(queued.status,'queued');assert.equal(queued.version_id,result.versionId);assert.equal(queued.attempts,0);
  await denied(admin.query('select makeborne_private.settle_generation_job($1,$2,$3,true,$4)',[job.id,owner,(await admin.query('select run_revision from public.generation_jobs where id=$1',[job.id])).rows[0].run_revision,'a'.repeat(64)]));
  assert.equal((await admin.query('select count(*)::int n from makeborne_private.generation_job_settlements where job_id=$1',[job.id])).rows[0].n,0);
  console.log('PASS durable queued build exists before any compiler; acceptance/credit settlement blocked until compilation');
  await admin.query(`create role "${name}" login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}'`);created=true;
  await admin.query(`grant makeborne_project_builder to "${name}"`);
  const db=await connect(),other=await connect();
  const {assertGenerationRole}=await import('../infra/generation-worker/queue-runtime.mjs');await assertGenerationRole(db,'makeborne_project_builder');
  for(const table of ['public.artifact_versions','public.sources','public.usage_ledger','makeborne_private.project_builds','makeborne_private.generation_provider_outcomes'])await denied(db.query(`select * from ${table} limit 1`),'42501');
  for(const signature of ['makeborne_private.claim_capped_generation_dispatch(uuid,uuid,bigint,uuid)','makeborne_private.settle_generation_job(uuid,uuid,bigint,boolean,text)'])assert.equal((await admin.query("select has_function_privilege('makeborne_project_builder',$1,'execute') allowed",[signature])).rows[0].allowed,false);
  assert.equal((await db.query('select makeborne_private.next_project_build() id')).rows[0].id,job.id);
  await rolledBack(async()=>{
    const actor=randomUUID();
    for(let attempt=1;attempt<=3;attempt++){
      const lease=(await admin.query('select makeborne_private.lease_project_build($1,$2,1) lease',[job.id,actor])).rows[0].lease;
      assert.equal(lease.state,'leased');
      await admin.query("update makeborne_private.project_builds set lease_expires_at=clock_timestamp()-interval '1 second' where job_id=$1",[job.id]);
    }
    const final=(await admin.query('select makeborne_private.lease_project_build($1,$2,1) lease',[job.id,actor])).rows[0].lease;
    assert.equal(final.status,'failed');assert.equal((await admin.query('select failure_code from makeborne_private.project_builds where job_id=$1',[job.id])).rows[0].failure_code,'attempts_exhausted');
  });
  await rolledBack(async()=>{
    const actor=randomUUID(),lease=(await admin.query('select makeborne_private.lease_project_build($1,$2,30) lease',[job.id,actor])).rows[0].lease;
    await admin.query('select makeborne_private.fail_project_build($1,$2,$3)',[job.id,actor,lease.fence]);
    assert.equal((await admin.query('select status from makeborne_private.project_builds where job_id=$1',[job.id])).rows[0].status,'failed');
    await denied(admin.query('select makeborne_private.settle_generation_job($1,$2,$3,true,$4)',[job.id,owner,(await admin.query('select run_revision from public.generation_jobs where id=$1',[job.id])).rows[0].run_revision,'a'.repeat(64)]));
  });
  await rolledBack(async()=>{
    await admin.query('delete from auth.sessions where user_id=$1',[owner]);
    assert.equal((await admin.query('select makeborne_private.lease_project_build($1,$2,30) lease',[job.id,randomUUID()])).rows[0].lease.status,'cancelled');
    assert.equal((await admin.query('select failure_code from makeborne_private.project_builds where job_id=$1',[job.id])).rows[0].failure_code,'authority_changed');
  });
  console.log('PASS independent rollback cases: three-attempt limit, compilation failure prevents acceptance, revoked authority closes queued build');
  child=fork(path.resolve('supabase/project-build-crash-child.cjs'),[],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  const leased=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CHILD_TIMEOUT')),10000);child.once('message',message=>{clearTimeout(timer);if(message.lease)resolve(message.lease);else reject(Error('CHILD_FAILED'));});child.once('error',()=>{clearTimeout(timer);reject(Error('CHILD_FAILED'));});child.send({url:target.href,jobId:job.id,workerId:crashedWorker});});
  assert.equal(leased.state,'leased');
  await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL');});child=null;
  await pause(1100);
  const recovered=(await db.query('select makeborne_private.lease_project_build($1,$2,2) lease',[job.id,recoveredWorker])).rows[0].lease;
  assert.equal(recovered.state,'leased');assert.equal(recovered.versionId,result.versionId);assert(BigInt(recovered.fence)>BigInt(leased.fence));
  await denied(db.query('select makeborne_private.load_project_build($1,$2,$3)',[job.id,crashedWorker,leased.fence]));
  assert.equal((await other.query('select makeborne_private.lease_project_build($1,$2,2) lease',[job.id,randomUUID()])).rows[0].lease.state,'busy');
  const loaded=(await db.query('select makeborne_private.load_project_build($1,$2,$3) input',[job.id,recoveredWorker,recovered.fence])).rows[0].input;
  assert.equal(loaded.version.id,result.versionId);assert(loaded.version.content.websiteSource);
  console.log('PASS forcibly killed restricted builder: expired lease reclaimed for same saved source; stale fence denied and live competing builder busy');
  // Change authority inside an operator transaction; verify the real function
  // sees it immediately, then rollback without altering the approved fixture.
  for(const mutate of [
    ()=>admin.query("update public.sources set content='Changed after generation' where project_id=$1",[job.project_id]),
    ()=>admin.query("delete from auth.sessions where user_id=$1",[owner]),
    ()=>admin.query("update public.generation_jobs set cancel_requested_at=clock_timestamp() where id=$1",[job.id]),
  ])await rolledBack(async()=>{await mutate();await denied(admin.query('select makeborne_private.load_project_build($1,$2,$3)',[job.id,recoveredWorker,recovered.fence]),mutate.toString().includes('sessions')?'42501':'PT409');});
  console.log('PASS current source/session/cancellation authority independently rechecked before compilation');
  await pause(2100);
  let finish,fail;
  const done=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
  retainedDirectory=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'makeborne-build-'));
  const {createLocalOutputStore}=await import('../infra/project-runtime/local-output-store.mjs');
  const useR2=process.env.MAKEBORNE_VERIFY_LOCAL_R2_OUTPUT==='true';
  async function openOutputStore(){
   if(!useR2)return createLocalOutputStore(retainedDirectory);
   if(process.env.MAKEBORNE_VERIFY_LOCAL_R2_S3_OUTPUT==='true'){
    const {createLocalR2S3OutputRuntime}=await import('../infra/project-runtime/local-r2-s3-output.mjs'),{createR2S3OutputStore}=require('../src/lib/projects/r2-s3-output-store.ts');
    r2Runtime=await createLocalR2S3OutputRuntime(retainedDirectory);
    console.log('PASS original builder uses signed S3 HTTP transport backed by actual private local R2');
    return createR2S3OutputStore(r2Runtime.configuration,r2Runtime.transport);
   }
   const {createLocalR2OutputRuntime}=await import('../infra/project-runtime/local-r2-output.mjs'),{createR2OutputStore}=require('../src/lib/projects/r2-output-store.ts');
   r2Runtime=await createLocalR2OutputRuntime(retainedDirectory);
   return createR2OutputStore(r2Runtime.bucket);
  }
  outputStore=await openOutputStore();
  const {readCompiledOutputFile}=require('../src/lib/projects/compiled-output.ts');
  const executor=createProjectBuildWorker({outputStore:{get:(...args)=>outputStore.get(...args),putIfAbsent:async(...args)=>{
    if(interruptRetention){interruptRetention=false;throw Object.assign(Error('Synthetic offline storage interruption'),{code:'SYNTHETIC_RETENTION_INTERRUPTED'});}
    return outputStore.putIfAbsent(...args);
  }},sql:{query:async(text,args)=>{
    if(text.includes('complete_project_build')){
      const index=await readCompiledOutputFile(outputStore,job.workspace_id,receipt,'index.html',new AbortController().signal);
      assert(index?.byteLength>0,'OUTPUT_NOT_RETAINED_BEFORE_COMPLETION');
    }
    return db.query(text,args);
  }},resolveArtwork:async()=>[],build:async(workload,signal)=>{
    builds++;builtWorkload=workload;
    const {runLocalBuild}=await import('../infra/project-runtime/local-adapter.mjs');
    const built=await runLocalBuild(workload,{signal});
    assert.equal(built.status,'built');temporaryOutput=built.outputDirectory;
    receipt=JSON.parse(await fs.readFile(path.join(built.outputDirectory,'makeborne-build.json'),'utf8'));
    assert.equal(validateBuildReceipt(receipt,workload).buildHash,receipt.buildHash);
    for(const patch of [{revisionId:randomUUID()},{sourceHash:'0'.repeat(64)},{buildHash:'0'.repeat(64)}])assert.throws(()=>validateBuildReceipt({...receipt,...patch},workload));
    for(const files of [[...receipt.files,receipt.files[0]],[{path:'../escape',bytes:1,sha256:'0'.repeat(64)}]]){const changed={...receipt,files},identity={...changed};delete identity.buildHash;changed.buildHash=createHash('sha256').update(canonicalSourceJson(identity)).digest('hex');assert.throws(()=>validateBuildReceipt(changed,workload));}
    const active=(await admin.query('select fence from makeborne_private.project_builds where job_id=$1',[job.id])).rows[0];
    await denied(db.query('select makeborne_private.complete_project_build($1,$2,$3,$4)',[job.id,supervisorWorker,active.fence,{...receipt,revisionId:randomUUID()}]),'22023');
    return {status:'built',receipt,readFile:built.readFile,dispose:async()=>{await built.dispose();disposals++;}};
  }});
  const {startProjectBuildWorker}=await import('../infra/generation-worker/build-worker.mjs');
  supervisor=await startProjectBuildWorker({pool:{query:async(text,args)=>{if(text.includes('renew_project_build'))heartbeats++;return db.query(text,args);}},workerId:supervisorWorker,leaseSeconds:2,heartbeatMs:300,pollingMs:100,
    execute:async(lease,signal)=>{try{
      await assert.rejects(executor(lease,signal),error=>error.code==='SYNTHETIC_RETENTION_INTERRUPTED');
      assert.equal(disposals,1);await assert.rejects(fs.access(temporaryOutput),error=>error.code==='ENOENT');
      const interrupted=(await admin.query('select status,receipt from makeborne_private.project_builds where job_id=$1',[job.id])).rows[0];
      assert.equal(interrupted.status,'running');assert.equal(interrupted.receipt,null);
      console.log('PASS failed private retention cannot mark SQL build compiled; temporary compiler output disposed before explicit same-lease retry');
      const result=await executor(lease,signal);assert.equal(result.state,'compiled');finish(result);}catch(error){fail(error);throw error;}}});
  let timeout;try{await Promise.race([done,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('BUILD_TIMEOUT')),20000);})]);}finally{clearTimeout(timeout);}
  await supervisor.stop();supervisor=null;assert.equal(builds,2);assert.equal(disposals,2);assert(heartbeats>0);
  const compiled=(await admin.query('select * from makeborne_private.project_builds where job_id=$1',[job.id])).rows[0];
  if(r2Runtime?.stats){const stats=r2Runtime.stats();assert(stats.requests>0);assert.equal(stats.denials,0);console.log(`PASS ${stats.requests} independently verified signed storage HTTP requests before restart, no authorization denials`);}
  await r2Runtime?.dispose();r2Runtime=null;
  const reopened=await openOutputStore();
  for(const file of receipt.files){const bytes=await readCompiledOutputFile(reopened,job.workspace_id,receipt,file.path,new AbortController().signal);assert.equal(bytes.byteLength,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
  assert.equal(await readCompiledOutputFile(reopened,randomUUID(),receipt,'index.html',new AbortController().signal).catch(error=>error.code),'OUTPUT_NOT_RETAINED');
  if(process.env.MAKEBORNE_VERIFY_LOCAL_PREVIEW==='true')await require('./check-project-preview.cjs').qualifyPreview({admin,job,receipt,owner,outputStore:reopened,evidenceDirectory});
  const bundledPreview=process.env.MAKEBORNE_VERIFY_LOCAL_PREVIEW_WORKER==='true';
  if(bundledPreview){assert.equal(useR2,true,'BUNDLED_PREVIEW_REQUIRES_R2');if(r2Runtime?.stats){const stats=r2Runtime.stats();assert(stats.requests>0);assert.equal(stats.denials,0);console.log(`PASS ${stats.requests} independently verified signed storage HTTP reads after restart, no authorization denials`);}await r2Runtime.dispose();r2Runtime=null;}
  if(process.env.MAKEBORNE_VERIFY_LOCAL_PREVIEW_SESSION_HTTP==='true')await require('./check-preview-session-http.cjs').qualifyPreviewSessionHttp({admin,job,receipt,outputStore:reopened,evidenceDirectory,r2Directory:bundledPreview?retainedDirectory:undefined});
  console.log(`PASS real compiled files retained before SQL completion, readable from reopened private ${useR2?'R2/workerd':'disk'} store after runtime disposal; cross-workspace locator denied`);
  assert.equal(compiled.status,'compiled');assert.equal(compiled.attempts,3);assert.deepEqual(compiled.receipt,receipt);
  const replay=(await db.query('select makeborne_private.complete_project_build($1,$2,$3,$4) result',[job.id,supervisorWorker,compiled.fence,receipt])).rows[0].result;
  assert.equal(replay.replayed,true);assert.equal(replay.readyForPublication,false);
  await denied(db.query('select makeborne_private.complete_project_build($1,$2,$3,$4)',[job.id,crashedWorker,leased.fence,receipt]));
  await denied(db.query('select makeborne_private.complete_project_build($1,$2,$3,$4)',[job.id,supervisorWorker,compiled.fence,{...receipt,buildHash:'0'.repeat(64)}]));
  assert.equal((await other.query('select makeborne_private.lease_project_build($1,$2,2) lease',[job.id,randomUUID()])).rows[0].lease.state,'terminal');
  assert.equal((await db.query('select makeborne_private.next_project_build() id')).rows[0].id,null);
  supervisor=await startProjectBuildWorker({pool:db,workerId:randomUUID(),pollingMs:100,execute:async()=>{throw Error('TERMINAL_BUILD_REEXECUTED');},report:()=>assert.fail('TERMINAL_BUILD_REEXECUTED')});
  await pause(250);await supervisor.stop();supervisor=null;
  await denied(admin.query("update makeborne_private.project_builds set receipt='{}' where job_id=$1",[job.id]),'23514');
  await rolledBack(async()=>{
    const revision=(await admin.query('select run_revision from public.generation_jobs where id=$1',[job.id])).rows[0].run_revision;
    assert.equal((await admin.query('select (makeborne_private.settle_generation_job($1,$2,$3,true,$4)).status',[job.id,owner,revision,'a'.repeat(64)])).rows[0].status,'succeeded');
  });
  await rolledBack(async()=>{
    await admin.query("update public.sources set content='Changed after successful compilation' where project_id=$1",[job.project_id]);
    const revision=(await admin.query('select run_revision from public.generation_jobs where id=$1',[job.id])).rows[0].run_revision;
    await denied(admin.query('select makeborne_private.settle_generation_job($1,$2,$3,true,$4)',[job.id,owner,revision,'a'.repeat(64)]));
  });
  assert.equal((await admin.query('select count(*)::int n from makeborne_private.generation_dispatches where reservation_id=$1',[job.reservation_id])).rows[0].n,1);
  assert.equal((await admin.query('select count(*)::int n from makeborne_private.generation_provider_outcomes where job_id=$1',[job.id])).rows[0].n,1);
  console.log('PASS real isolated Docker build under supervised restricted builder with live heartbeat; exact immutable receipt persisted, replay safe, no redispatch or customer charge');
  const {runLocalBuild,dockerCommand}=await import('../infra/project-runtime/local-adapter.mjs');
  const controller=new AbortController();let observed=false;
  const aborted=runLocalBuild(builtWorkload,{signal:controller.signal}).then(async built=>{await built.dispose?.();return {completed:true};},()=>({completed:false}));
  try{
    for(let attempt=0;attempt<30;attempt++){
      const active=await dockerCommand(['ps','--filter','label=makeborne.runtime=local-qualification','--format','{{.Names}}']);
      if(active.output.trim()){observed=true;break;}await pause(100);
    }
  }finally{controller.abort();}
  assert.equal((await aborted).completed,false);assert.equal(observed,true,'RUNNING_COMPILER_NOT_OBSERVED');
  assert.equal((await dockerCommand(['ps','-a','--filter','label=makeborne.runtime=local-qualification','--format','{{.Names}}'])).output.trim(),'');
  console.log('PASS cancellation stops local Docker build and leaves no qualification container');
  await fs.writeFile(path.join(evidenceDirectory,'build-fixture.json'),JSON.stringify(receipt,null,2)+'\n');
  await fs.writeFile(path.join(evidenceDirectory,'durable-build.json'),JSON.stringify({workspaceId:job.workspace_id,jobId:job.id,versionId:result.versionId,status:compiled.status,attempts:compiled.attempts,heartbeats,builds,paidCalls:0,readyForPublication:false},null,2)+'\n');
  const migration=await fs.readFile('supabase/migrations/20261008161434_project_build_handoff.sql','utf8');let definitions=0;
  for(const match of migration.matchAll(/create function makeborne_private\.([a-z_]+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/g)){
    const rows=(await admin.query("select prosrc,proconfig,prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='makeborne_private' and p.proname=$1",[match[1]])).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].prosrc.replace(/\r\n/g,'\n').trim(),match[2].replace(/\r\n/g,'\n').trim());assert(rows[0].proconfig.includes('search_path=""'));assert.equal(rows[0].prosecdef,match[1]!=='protect_project_build');definitions++;
    for(const role of ['anon','authenticated','service_role','makeborne_generation_worker','makeborne_generation_publisher','makeborne_project_builder']){
      const allowed=(await admin.query("select has_function_privilege($1,p.oid,'execute') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='makeborne_private' and p.proname=$2",[role,match[1]])).rows[0].allowed;
      assert.equal(allowed,role==='makeborne_project_builder'&&!['protect_project_build','enqueue_project_build','require_compiled_website_settlement'].includes(match[1]));
    }
  }
  assert.equal(definitions,9);
  console.log('PASS all nine build function bodies/fixed search paths and exact role grants match migration source');
 } finally {
  child?.kill('SIGKILL');await supervisor?.stop();
  await r2Runtime?.dispose();
  if(retainedDirectory){const {removeLocalTemporary}=await import('../infra/project-runtime/local-adapter.mjs');await removeLocalTemporary(retainedDirectory);}
  for(const db of connections)await db.end();
  if(created)await admin.query(`drop role "${name}"`);
 }
};

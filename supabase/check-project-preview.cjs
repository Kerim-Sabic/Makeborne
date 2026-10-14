/* eslint-disable @typescript-eslint/no-require-imports -- Local restricted read authority qualification. */
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs/promises');
const {readAuthorizedPreviewFile}=require('../src/lib/projects/authorized-preview.ts');

exports.qualifyPreview=async({admin,job,receipt,owner,outputStore,evidenceDirectory})=>{
 const expires=new Date(Date.now()+600000).toISOString(),identity={jobId:job.id,versionId:receipt.revisionId,buildHash:receipt.buildHash};
 const ownerSession=(await admin.query('select id from auth.sessions where user_id=$1',[owner])).rows[0].id;
 const actors={owner:{p_actor:owner,p_session:ownerSession,p_expires:expires}};
 const signal=()=>new AbortController().signal;
 let reads=0;
 await admin.query('begin');
 try{
  for(const role of ['editor','reviewer','outsider']){
   const user=randomUUID(),session=randomUUID();actors[role]={p_actor:user,p_session:session,p_expires:expires};
   await admin.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[user,`preview-${user}@example.invalid`]);
   await admin.query('insert into auth.sessions(id,user_id,created_at,updated_at) values($1,$2,now(),now())',[session,user]);
   if(role!=='outsider')await admin.query('insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,$3)',[job.workspace_id,user,role]);
  }
  // The role change and any failed SQL statement are rolled back to this exact
  // savepoint; outer fixture mutations remain visible for revocation tests.
  async function authorize(id,viewer){
   await admin.query('savepoint preview_call');
   try{await admin.query('set local role service_role');reads++;return (await admin.query('select public.makeborne_project_preview($1,$2,$3,$4,$5,$6) as preview',[id.jobId,id.versionId,id.buildHash,viewer.p_actor,viewer.p_session,viewer.p_expires])).rows[0].preview;}
   finally{await admin.query('rollback to savepoint preview_call');await admin.query('release savepoint preview_call');}
  }
  await require('./check-saved-website-preview.cjs').qualifySavedWebsitePreview({admin,job,receipt,actors});
  const deps={store:outputStore,authorize};
  async function memberQuery(actor,sql,args=[]){
   await admin.query('savepoint member_role');
   try{await admin.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[actor.p_actor,JSON.stringify({sub:actor.p_actor,role:'authenticated'})]);await admin.query('set local role authenticated');return await admin.query(sql,args);}
   finally{await admin.query('rollback to savepoint member_role');await admin.query('release savepoint member_role');}
  }
  for(const role of ['owner','editor','reviewer'])assert((await memberQuery(actors[role],'select * from public.workspace_members where workspace_id=$1',[job.workspace_id])).rows.length>=2);
  assert.equal((await memberQuery(actors.outsider,'select * from public.workspace_members where workspace_id=$1',[job.workspace_id])).rows.length,0);
  assert.equal((await memberQuery(actors.owner,'update public.workspace_members set role=\'editor\' where workspace_id=$1 and user_id=$2 returning user_id',[job.workspace_id,actors.reviewer.p_actor])).rowCount,1);
  assert.equal((await memberQuery(actors.owner,'delete from public.workspace_members where workspace_id=$1 and user_id=$2 returning user_id',[job.workspace_id,actors.reviewer.p_actor])).rowCount,1);
  assert.equal((await memberQuery(actors.owner,'insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,\'reviewer\') returning user_id',[job.workspace_id,actors.outsider.p_actor])).rowCount,1);
  for(const role of ['editor','reviewer','outsider']){
   assert.equal((await memberQuery(actors[role],'update public.workspace_members set role=\'editor\' where workspace_id=$1 and user_id=$2 returning user_id',[job.workspace_id,actors.reviewer.p_actor])).rowCount,0);
   assert.equal((await memberQuery(actors[role],'delete from public.workspace_members where workspace_id=$1 and user_id=$2 returning user_id',[job.workspace_id,actors.reviewer.p_actor])).rowCount,0);
   await assert.rejects(memberQuery(actors[role],'insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,\'reviewer\')',[job.workspace_id,actors.outsider.p_actor]),e=>['42501','MB402'].includes(e.code));
  }
  const policies=(await admin.query("select polcmd,polpermissive from pg_policy where polrelid='public.workspace_members'::regclass order by polcmd")).rows;
  assert.deepEqual(policies.map(row=>row.polcmd),['a','d','r','w']);assert(policies.every(row=>row.polpermissive));
  console.log('PASS actual authenticated membership policies: one SELECT policy; owner read/insert/update/delete preserved, editor/reviewer read only, outsider no access');

  for(const role of ['owner','editor','reviewer']){
   const before=reads,bytes=await readAuthorizedPreviewFile(deps,identity,actors[role],'index.html',signal());
   assert.equal(bytes.byteLength,receipt.files.find(file=>file.path==='index.html').bytes);assert.equal(reads-before,2);
  }
  assert.equal((await admin.query('select makeborne_private.has_creation_membership_for_actor($1) allowed',[actors.reviewer.p_actor])).rows[0].allowed,false);
  console.log('PASS actual service-role bridge: owner/editor/reviewer read exact compiled bytes with two current checks; reviewer without creation plan can review saved output');
  for(const patch of [{jobId:randomUUID()},{versionId:randomUUID()},{buildHash:'0'.repeat(64)}])await assert.rejects(readAuthorizedPreviewFile(deps,{...identity,...patch},actors.owner,'index.html',signal()),e=>e.code==='P0002');
  await assert.rejects(readAuthorizedPreviewFile(deps,identity,actors.outsider,'index.html',signal()),e=>e.code==='P0002');
  await assert.rejects(readAuthorizedPreviewFile(deps,identity,{...actors.owner,p_actor:actors.editor.p_actor},'index.html',signal()),e=>e.code==='42501');
  console.log('PASS wrong job/version/build, outside workspace and mismatched actor/session cannot read retained files');
  async function changed(mutate,viewer,code){await admin.query('savepoint preview_change');try{await mutate();await assert.rejects(readAuthorizedPreviewFile(deps,identity,viewer,'index.html',signal()),e=>e.code===code);}finally{await admin.query('rollback to savepoint preview_change');await admin.query('release savepoint preview_change');}}
  await changed(()=>admin.query('delete from public.workspace_members where workspace_id=$1 and user_id=$2',[job.workspace_id,actors.reviewer.p_actor]),actors.reviewer,'P0002');
  await changed(()=>admin.query('delete from auth.sessions where id=$1',[actors.editor.p_session]),actors.editor,'42501');
  await changed(()=>admin.query("update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id=$1",[actors.editor.p_session]),actors.editor,'42501');
  for(const sql of ["update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1","update auth.users set email_confirmed_at=null where id=$1","update auth.users set deleted_at=clock_timestamp() where id=$1"])
   await changed(()=>admin.query(sql,[actors.editor.p_actor]),actors.editor,'42501');
  await changed(()=>admin.query('update public.generation_jobs set cancel_requested_at=clock_timestamp() where id=$1',[job.id]),actors.owner,'P0002');
  console.log('PASS live membership, deleted/expired session, banned/unconfirmed/deleted account and cancelled job deny subsequent reads');
  await admin.query('savepoint original_session');
  try{await admin.query('delete from auth.sessions where id=$1',[ownerSession]);assert((await readAuthorizedPreviewFile(deps,identity,actors.editor,'index.html',signal())).byteLength>0);}
  finally{await admin.query('rollback to savepoint original_session');await admin.query('release savepoint original_session');}
  console.log('PASS another current viewer can review saved output after original generator session ends');
  await admin.query('savepoint during_storage');
  try{
   let revoke=true;
   const store={...outputStore,get:async(...args)=>{const bytes=await outputStore.get(...args);if(revoke){revoke=false;await admin.query('delete from public.workspace_members where workspace_id=$1 and user_id=$2',[job.workspace_id,actors.reviewer.p_actor]);}return bytes;}};
   await assert.rejects(readAuthorizedPreviewFile({authorize,store},identity,actors.reviewer,'index.html',signal()),e=>e.code==='P0002');
  }finally{await admin.query('rollback to savepoint during_storage');await admin.query('release savepoint during_storage');}
  console.log('PASS permission removed during actual private storage I/O prevents returning already-read bytes');
  for(const role of ['anon','authenticated','makeborne_generation_worker','makeborne_generation_publisher','makeborne_project_builder']){
   for(const schema of ['makeborne_private','public']){
    const name=schema==='public'?'makeborne_project_preview':'read_project_preview';
    assert.equal((await admin.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,`${schema}.${name}(uuid,uuid,text,uuid,uuid,timestamptz)`])).rows[0].allowed,false);
   }
  }
  const source=await fs.readFile('supabase/migrations/20261008181217_generation_preview_read_authority.sql','utf8');let definitions=0;
  for(const match of source.matchAll(/create function (makeborne_private|public)\.([a-z_]+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/g)){
   const rows=(await admin.query('select prosrc,proconfig,prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',[match[1],match[2]])).rows;
   assert.equal(rows.length,1);assert.equal(rows[0].prosrc.replaceAll('\r\n','\n').trim(),match[3].replaceAll('\r\n','\n').trim());assert(rows[0].proconfig.includes('search_path=""'));assert.equal(rows[0].prosecdef,match[1]==='makeborne_private');definitions++;
  }
  assert.equal(definitions,2);
  console.log('PASS both exact preview function bodies/search paths/definer boundaries and browser/worker deny grants match migration source');
  await require('./check-preview-serving.cjs').qualifyPreviewServing({admin,job,identity,viewer:actors.reviewer,dependencies:deps,evidenceDirectory});
  if(process.env.MAKEBORNE_VERIFY_LOCAL_PREVIEW_SESSIONS==='true')await require('./check-preview-sessions.cjs').qualifyPreviewSessions({admin,job,receipt,actors,outputStore});
 }finally{await admin.query('rollback');}
};

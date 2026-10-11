/* eslint-disable @typescript-eslint/no-require-imports -- Rolled-back local saved revision authority checks. */
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs/promises');
exports.qualifySavedWebsitePreview=async({admin,job,receipt,actors})=>{
 async function read(viewer,patch={}){
  await admin.query('savepoint saved_preview_call');
  try{await admin.query('set local role service_role');return (await admin.query('select public.makeborne_saved_website_generation($1,$2,$3,$4,$5,$6) value',[
   patch.workspaceId??job.workspace_id,patch.artifactId??job.artifact_id,patch.versionId??receipt.revisionId,viewer.p_actor,viewer.p_session,viewer.p_expires])).rows[0].value;}
  finally{await admin.query('rollback to savepoint saved_preview_call');await admin.query('release savepoint saved_preview_call');}
 }
 for(const role of ['owner','editor','reviewer']){const result=await read(actors[role]);assert.equal(result.id,job.id);assert.equal(result.outputVersionId,receipt.revisionId);assert(['awaiting_review','ready'].includes(result.state));assert.equal(result.scope.artifactId,job.artifact_id);if(role==='reviewer'){assert.equal(result.credits,null);assert.equal(result.canCancel,false);}}
 for(const patch of [{workspaceId:randomUUID()},{artifactId:randomUUID()},{versionId:randomUUID()}])await assert.rejects(read(actors.owner,patch),error=>error.code==='P0002');
 await assert.rejects(read(actors.outsider),error=>error.code==='P0002');
 await assert.rejects(read({...actors.owner,p_actor:actors.editor.p_actor}),error=>error.code==='42501');
 console.log('PASS saved revision discovery: owner/editor/reviewer exact job/version, reviewer financial redaction, outsider/foreign scope/version/session mismatch denied');
 async function changed(sql,args,viewer,code){await admin.query('savepoint saved_preview_change');try{await admin.query(sql,args);await assert.rejects(read(viewer),error=>error.code===code);}finally{await admin.query('rollback to savepoint saved_preview_change');await admin.query('release savepoint saved_preview_change');}}
 await changed('delete from public.workspace_members where workspace_id=$1 and user_id=$2',[job.workspace_id,actors.reviewer.p_actor],actors.reviewer,'P0002');
 await changed('delete from auth.sessions where id=$1',[actors.editor.p_session],actors.editor,'42501');
 await admin.query('savepoint saved_preview_immutable');
 try{await assert.rejects(admin.query("update public.artifact_versions set content=jsonb_set(content,'{title}',to_jsonb('Changed source'::text)) where id=$1",[receipt.revisionId]),error=>error.code==='23514');}
 finally{await admin.query('rollback to savepoint saved_preview_immutable');await admin.query('release savepoint saved_preview_immutable');}
 assert.equal((await read(actors.owner)).outputVersionId,receipt.revisionId);
 console.log('PASS saved discovery reuses current membership/session and immutable compiled source authority');
 for(const schema of ['makeborne_private','public']){
  const name=schema==='public'?'makeborne_saved_website_generation':'saved_website_generation';
  for(const role of ['anon','authenticated','makeborne_generation_worker','makeborne_generation_publisher','makeborne_project_builder'])assert.equal((await admin.query("select has_function_privilege($1,$2,'execute') allowed",[role,`${schema}.${name}(uuid,uuid,uuid,uuid,uuid,timestamptz)`])).rows[0].allowed,false);
  assert.equal((await admin.query("select has_function_privilege('service_role',$1,'execute') allowed",[`${schema}.${name}(uuid,uuid,uuid,uuid,uuid,timestamptz)`])).rows[0].allowed,true);
 }
 const source=await fs.readFile('supabase/migrations/20261008190859_saved_website_preview_discovery.sql','utf8');let definitions=0;
 for(const match of source.matchAll(/create function (makeborne_private|public)\.([a-z_]+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/g)){
  const rows=(await admin.query('select prosrc,proconfig,prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',[match[1],match[2]])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].prosrc.replaceAll('\r\n','\n').trim(),match[3].replaceAll('\r\n','\n').trim());assert(rows[0].proconfig.includes('search_path=""'));assert.equal(rows[0].prosecdef,match[1]==='makeborne_private');definitions++;
 }
 assert.equal(definitions,2);console.log('PASS saved discovery exact function definitions, fixed search paths, private definer/public invoker and service-only grants');
};

/* eslint-disable @typescript-eslint/no-require-imports -- Local private session lifecycle qualification. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {opaquePreviewToken,previewTokenHash,handlePreviewGateway,previewGatewayOrigin,PREVIEW_HANDOFF_PATH}=require('../src/lib/projects/preview-gateway.ts');
exports.qualifyPreviewSessions=async({admin,job,receipt,actors,outputStore})=>{
 const hash=()=>previewTokenHash(opaquePreviewToken()),buildHash=receipt.buildHash;
 async function service(sql,args){await admin.query('savepoint private_session_call');try{await admin.query('set local role service_role');return (await admin.query(sql,args)).rows[0].result;}finally{await admin.query('rollback to savepoint private_session_call');await admin.query('release savepoint private_session_call');}}
 // Writes must persist within the outer fixture transaction. A savepoint is
 // released on success; on error it restores the same prior role/JWT state.
 async function mutate(sql,args){await admin.query('savepoint private_session_write');try{await admin.query('set local role service_role');const value=(await admin.query(sql,args)).rows[0].result;await admin.query('reset role');await admin.query('release savepoint private_session_write');return value;}catch(error){await admin.query('rollback to savepoint private_session_write');await admin.query('release savepoint private_session_write');throw error;}}
 const issue=(actor,handoff=hash())=>mutate('select public.makeborne_issue_preview_session($1,$2,$3,$4,$5) result',[job.id,handoff,actor.p_actor,actor.p_session,actor.p_expires]);
 const rpc={consume:(handoff,cookie,build)=>mutate('select public.makeborne_consume_preview_handoff($1,$2,$3) result',[handoff,cookie,build]),read:(cookie,build)=>service('select public.makeborne_read_preview_session($1,$2) result',[cookie,build])};
 const handoff=hash(),cookie=hash(),issued=await issue(actors.reviewer,handoff);
 assert.equal(issued.identity.versionId,receipt.revisionId);assert.equal(issued.identity.buildHash,buildHash);
 assert(Date.parse(issued.handoffUntil)<=Date.now()+60000);assert(Date.parse(issued.expiresAt)<=Date.parse(actors.reviewer.p_expires));
 await assert.rejects(rpc.consume(handoff,cookie,'0'.repeat(64)),e=>e.code==='P0002');
 await rpc.consume(handoff,cookie,buildHash);const read=await rpc.read(cookie,buildHash);assert.equal(read.viewer.p_actor,actors.reviewer.p_actor);
 await assert.rejects(rpc.consume(handoff,hash(),buildHash),e=>e.code==='P0002');
 await assert.rejects(rpc.read(hash(),buildHash),e=>e.code==='P0002');
 await assert.rejects(rpc.read(cookie,'0'.repeat(64)),e=>e.code==='P0002');
 await assert.rejects(issue(actors.outsider),e=>e.code==='P0002');
 console.log('PASS actual service-only preview grants: bounded TTL, current viewer, one-use handoff, wrong build/cookie/outsider denied');
 await admin.query('savepoint session_revocation');
 try{await admin.query('delete from auth.sessions where id=$1',[actors.reviewer.p_session]);assert.equal((await admin.query('select count(*)::int n from makeborne_private.preview_sessions where cookie_hash=$1',[cookie])).rows[0].n,0);await assert.rejects(rpc.read(cookie,buildHash),e=>e.code==='P0002');}
 finally{await admin.query('rollback to savepoint session_revocation');await admin.query('release savepoint session_revocation');}
 console.log('PASS Auth-session deletion cascades preview grants and invalidates existing opaque cookie');
 await admin.query('savepoint preview_quota');
 try{for(let index=0;index<20;index++)await issue(actors.editor);await assert.rejects(issue(actors.editor),e=>e.code==='MB429');assert.equal((await admin.query('select count(*)::int n from makeborne_private.preview_sessions where actor_id=$1',[actors.editor.p_actor])).rows[0].n,20);}
 finally{await admin.query('rollback to savepoint preview_quota');await admin.query('release savepoint preview_quota');}
 await admin.query('savepoint preview_expiry');
 try{const expired=hash();await issue(actors.owner,expired);await admin.query("update makeborne_private.preview_sessions set handoff_until=created_at+interval '1 microsecond' where handoff_hash=$1",[expired]);await assert.rejects(rpc.consume(expired,hash(),buildHash),e=>e.code==='P0002');await issue(actors.owner);assert.equal((await admin.query('select count(*)::int n from makeborne_private.preview_sessions where handoff_hash=$1',[expired])).rows[0].n,0);}
 finally{await admin.query('rollback to savepoint preview_expiry');await admin.query('release savepoint preview_expiry');}
 console.log('PASS original 20-grant actor quota has no partial over-limit insert; expired unconsumed handoffs pruned before next issue');
 const config={applicationOrigin:'https://makeborne.example',baseOrigin:'https://preview.makeborne.example'},origin=previewGatewayOrigin(config,buildHash);
 const rawHandoff=opaquePreviewToken();await issue(actors.owner,previewTokenHash(rawHandoff));
 const bootstrap=await handlePreviewGateway(new Request(origin+PREVIEW_HANDOFF_PATH,{method:'POST',headers:{Origin:config.applicationOrigin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handoff:rawHandoff})}),config,rpc,outputStore);
 assert.equal(bootstrap.status,303);assert.equal(bootstrap.headers.get('Location'),origin+'/');
 const setCookie=bootstrap.headers.get('Set-Cookie');assert.match(setCookie,/^__Host-makeborne-preview=/);assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);assert.match(setCookie,/SameSite=Lax/);assert(!setCookie.includes('Domain='));
 const boundCookie=setCookie.split(';')[0];
 const page=await handlePreviewGateway(new Request(origin+'/',{headers:{Cookie:boundCookie}}),config,rpc,outputStore);assert.equal(page.status,200);
 const rawCookie=boundCookie.split('=')[1];assert(!rawCookie.includes(actors.owner.p_actor));
 const stored=(await admin.query('select handoff_hash,cookie_hash from makeborne_private.preview_sessions where handoff_hash=$1',[previewTokenHash(rawHandoff)])).rows[0];
 assert.equal(stored.cookie_hash,previewTokenHash(rawCookie));assert.notEqual(stored.handoff_hash,rawHandoff);assert.notEqual(stored.cookie_hash,rawCookie);
 const replay=await handlePreviewGateway(new Request(origin+PREVIEW_HANDOFF_PATH,{method:'POST',headers:{Origin:config.applicationOrigin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handoff:rawHandoff})}),config,rpc,outputStore);assert.equal(replay.status,404);
 console.log('PASS actual gateway bootstrap: POST-only body handoff becomes host-only Secure/HttpOnly cookie, exact compiled bytes load, replay denied; database holds only hashes');
 const migration=await fs.readFile('supabase/migrations/20261008182736_private_preview_sessions.sql','utf8');let definitions=0;
 for(const match of migration.matchAll(/create function (makeborne_private|public)\.([a-z_]+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/g)){
  const rows=(await admin.query('select p.oid,prosrc,proconfig,prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',[match[1],match[2]])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].prosrc.replaceAll('\r\n','\n').trim(),match[3].replaceAll('\r\n','\n').trim());assert(rows[0].proconfig.includes('search_path=""'));assert.equal(rows[0].prosecdef,match[1]==='makeborne_private');definitions++;
  for(const role of ['anon','authenticated','service_role','makeborne_generation_worker','makeborne_generation_publisher','makeborne_project_builder'])assert.equal((await admin.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,rows[0].oid])).rows[0].allowed,role==='service_role');
 }
 assert.equal(definitions,6);
 for(const role of ['anon','authenticated','service_role','makeborne_generation_worker','makeborne_project_builder'])for(const privilege of ['select','insert','update','delete'])assert.equal((await admin.query('select has_table_privilege($1,\'makeborne_private.preview_sessions\',$2) allowed',[role,privilege])).rows[0].allowed,false);
 assert.equal((await admin.query("select relrowsecurity from pg_class where oid='makeborne_private.preview_sessions'::regclass")).rows[0].relrowsecurity,true);
 console.log('PASS all six session function bodies/search paths/definer modes/exact grants, private table RLS and direct table denies');
};

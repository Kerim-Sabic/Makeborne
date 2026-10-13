const invalid=()=>{throw Error('PUBLICATION_CONTROLLER_STARTUP_DENIED');};
export const LOGIN_ATTESTATION_SQL=`SELECT jsonb_build_object(
 'user',current_user,'sessionUser',session_user,'role',current_setting('role'),
 'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
 'login',(SELECT jsonb_build_object('login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication,'bypassRls',rolbypassrls) FROM pg_roles WHERE rolname=session_user),
 'worker',(SELECT jsonb_build_object('login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication,'bypassRls',rolbypassrls) FROM pg_roles WHERE rolname='makeborne_publication_worker'),
 'memberships',(SELECT coalesce(jsonb_agg(r.rolname ORDER BY r.rolname),'[]') FROM pg_roles r WHERE r.rolname<>session_user AND pg_has_role(session_user,r.oid,'MEMBER')),
 'membership',(SELECT jsonb_build_object('admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE r.rolname='makeborne_publication_worker' AND u.rolname=session_user),
 'extraTables',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','makeborne_private','makeborne_hosting','auth','storage') AND c.relkind IN('r','v','m','p') AND has_table_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
 'extraFunctions',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','makeborne_private','makeborne_hosting') AND p.prokind='f' AND has_function_privilege(session_user,p.oid,'EXECUTE')),
 'createSchema',EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname IN('public','makeborne_private','makeborne_hosting','auth','storage') AND has_schema_privilege(session_user,n.oid,'CREATE')),
 'createDatabase',has_database_privilege(session_user,current_database(),'CREATE'),
 'database',current_database()) AS result`;
function roleSafe(value,login){return value&&value.login===login&&['inherit','super','createRole','createDb','replication','bypassRls'].every(k=>value[k]===false);}
export function validateLoginAttestation(value,config,stream){
 if(!stream?.encrypted||stream.authorized!==true||value?.user!==config.database.user||value.sessionUser!==config.database.user
  ||value.role!=='none'||value.database!=='postgres'||value.tls!==true||!roleSafe(value.login,true)||!roleSafe(value.worker,false)
  ||JSON.stringify(value.memberships)!=='["makeborne_publication_worker"]'||value.membership?.admin!==false||value.membership?.inherit!==false||value.membership?.set!==true
  ||value.extraTables!==false||value.extraFunctions!==false||value.createSchema!==false||value.createDatabase!==false)invalid();
}
export function validateNamespaceAttestation(value,config){
 if(!value||Object.keys(value).length!==3||value.contractVersion!=='publication-controller-v1'||value.namespace!=='staging'||value.qaWorkspaceId!==config.qaWorkspaceId)invalid();
}
export async function attestController(pool,config,parent){
 const signal=AbortSignal.any([parent,AbortSignal.timeout(10_000)]);signal.throwIfAborted();
 let client,released=false,rejectAbort;const aborted=new Promise((_,reject)=>rejectAbort=reject);
 const release=destroy=>{if(client&&!released){released=true;client.release(destroy);}};
 const abort=()=>{release(true);rejectAbort(Error('PUBLICATION_CONTROLLER_STARTUP_DENIED'));};signal.addEventListener('abort',abort,{once:true});
 try{
  const pending=pool.connect().then(c=>{client=c;if(signal.aborted){release(true);invalid();}return c;});await Promise.race([pending,aborted]);
  const query=async text=>{signal.throwIfAborted();return Promise.race([client.query(text),aborted]);};
  await query('BEGIN');await query("SET LOCAL statement_timeout='5s'");await query("SET LOCAL lock_timeout='2s'");
  const login=await query(LOGIN_ATTESTATION_SQL);if(login.rows?.length!==1)invalid();validateLoginAttestation(login.rows[0].result,config,client.connection?.stream);
  await query('SET LOCAL ROLE makeborne_publication_worker');
  const namespace=await query('SELECT public.makeborne_publication_worker_attest() AS result');if(namespace.rows?.length!==1)invalid();validateNamespaceAttestation(namespace.rows[0].result,config);
  await query('COMMIT');signal.throwIfAborted();release(false);
 }catch{release(true);invalid();}finally{signal.removeEventListener('abort',abort);}
}

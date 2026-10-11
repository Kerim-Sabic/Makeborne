/** Local applied-definition and least-privilege checks. No provider or writes. */
import {readFile} from "node:fs/promises";
import assert from "node:assert/strict";
import {Pool} from "pg";
if(process.env.MAKEBORNE_VERIFY_LOCAL_JOBS!=="true"||!process.env.MAKEBORNE_LOCAL_STATUS_FILE){console.log("NOT RUN: explicit local job verification and ignored config required.");process.exit(2);}
let pool;
try {
  const config=JSON.parse((await readFile(process.env.MAKEBORNE_LOCAL_STATUS_FILE,"utf8")).replace(/^\uFEFF/,""));
  const url=new URL(config.DB_URL);
  assert.equal(url.hostname,"127.0.0.1");assert.equal(url.port,"55322");assert.equal(url.pathname,"/postgres");
  pool=new Pool({connectionString:url.href,max:1,connectionTimeoutMillis:2000,query_timeout:3000});pool.on("error",()=>{});
  const migrations=await Promise.all(['20261008151657_generation_approved_input_authority.sql','20261008154453_generation_atomic_worker_result.sql'].map(name=>readFile(new URL(`./migrations/${name}`,import.meta.url),'utf8')));
  const latest=new Map();
  for(const migration of migrations) for(const match of migration.matchAll(/create(?: or replace)? function makeborne_private\.([a-z_]+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g)) latest.set(match[1],match[2]);
  let definitions=0;
  for(const [name,body] of latest){
    const rows=(await pool.query("select p.prosrc,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='makeborne_private' and p.proname=$1",[name])).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].prosrc.trim(),body.trim());assert.equal(rows[0].prosecdef,true);assert.deepEqual(rows[0].proconfig,name==='commit_generation_worker_result'?['search_path=""','lock_timeout=5s']:['search_path=""']);definitions++;
  }
  assert.equal(definitions,8);console.log("PASS eight latest applied authority/result definitions match source with fixed search paths and no obsolete overload");
  const bind='makeborne_private.authorize_and_enqueue_generation_job(uuid,uuid,uuid,text,text,timestamptz,uuid,timestamptz,boolean,boolean,boolean)';
  const loader='makeborne_private.load_generation_worker_input(uuid,uuid,bigint)';
  const unchecked='makeborne_private.claim_capped_generation_dispatch_unchecked(uuid,uuid,bigint,uuid)';
  const commit='makeborne_private.commit_generation_worker_result(uuid,uuid,bigint,uuid,bigint,text,text,text,text,text,jsonb,jsonb,jsonb,text)';
  for(const role of ['anon','authenticated','service_role','makeborne_generation_worker','makeborne_generation_publisher']){
    const result=(await pool.query("select has_function_privilege($1,$2,'execute') as bind,has_function_privilege($1,$3,'execute') as load,has_function_privilege($1,$4,'execute') as bypass",[role,bind,loader,unchecked])).rows[0];
    assert.equal(result.bind,role==='service_role');assert.equal(result.load,role==='makeborne_generation_worker');assert.equal(result.bypass,false);
    assert.equal((await pool.query("select has_function_privilege($1,$2,'execute') as allowed",[role,commit])).rows[0].allowed,role==='makeborne_generation_worker');
  }
  console.log("PASS only trusted service binds approvals; only restricted workers load scoped input; no runtime role can bypass authority");
  console.log("PASS only restricted workers can atomically commit results; browser, service and publisher denied");
}catch(error){console.error(`LOCAL AUTHORITY PARITY FAILED: ${typeof error?.code==='string'?error.code:'ASSERTION_OR_CONFIGURATION'}; configuration and driver details omitted.`);process.exitCode=1;}
finally{await pool?.end();}

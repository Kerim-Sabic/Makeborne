import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Client} from "pg";
import {qualificationRound as round,assertLocalQualificationDatabase,initializeQualificationRound,
  enableQualificationSpending,stopQualificationSpending} from "./qualification-round.mjs";

assert.equal(process.env.MAKEBORNE_VERIFY_LOCAL_JOBS,'true');
const c=JSON.parse((await readFile('.env.makeborne-local-status.json','utf8')).replace(/^\uFEFF/,''));
const url=assertLocalQualificationDatabase(c.DB_URL),db=new Client({connectionString:url.href,query_timeout:5000});
let locked=false;
async function rolledBack(operation){
  await db.query('begin');
  // Exercise each real transaction body inside a savepoint, then roll back the
  // entire scenario. No synthetic spend is committed into the live test round.
  const nested={query:(sql,args)=>db.query(sql==='begin'?'savepoint nested_policy':sql==='commit'?'release savepoint nested_policy':sql==='rollback'?'rollback to savepoint nested_policy':sql,args)};
  try{await operation(nested);}finally{await db.query('rollback');}
}
try {
  for(const bad of ['postgresql://localhost:55322/postgres','postgresql://127.0.0.1:5432/postgres','postgresql://127.0.0.1:55322/other','postgresql://example.com:55322/postgres'])assert.throws(()=>assertLocalQualificationDatabase(bad));
  await db.connect();locked=(await db.query('select pg_try_advisory_lock(hashtextextended($1,0)) locked',[`run:${round.id}`])).rows[0].locked;assert(locked);
  const first=await initializeQualificationRound(db,url.href),second=await initializeQualificationRound(db,url.href);assert.deepEqual(first,second);assert.equal(first.maximumVendorMicrousd,'25000000');
  console.log('PASS fixed local-only round initializes idempotently, remains disabled and preserves original spent balance');
  await rolledBack(async nested=>{
    await db.query('update makeborne_private.generation_budgets set vendor_spent=vendor_spent+123 where workspace_id=$1',[round.workspaceId]);
    const before=(await db.query('select vendor_spent,revision from makeborne_private.generation_budgets where workspace_id=$1',[round.workspaceId])).rows[0];
    await initializeQualificationRound(nested,url.href);const after=(await db.query('select vendor_spent,revision from makeborne_private.generation_budgets where workspace_id=$1',[round.workspaceId])).rows[0];assert.deepEqual(after,before);
  });console.log('PASS reopening never resets spent funds or silently replenishes the round (rolled-back simulated amount)');
  await rolledBack(async nested=>{
    await db.query('update makeborne_private.generation_budgets set vendor_reserved=544000,active_reservations=1 where workspace_id=$1',[round.workspaceId]);
    await assert.rejects(initializeQualificationRound(nested,url.href));await assert.rejects(enableQualificationSpending(nested));
    const b=(await db.query('select vendor_reserved,active_reservations from makeborne_private.generation_budgets where workspace_id=$1',[round.workspaceId])).rows[0];assert.equal(b.vendor_reserved,'544000');assert.equal(b.active_reservations,1);
  });console.log('PASS unresolved/reserved outcomes block initialization and enablement without releasing their holds');
  await rolledBack(async nested=>{
    await db.query("update makeborne_private.generation_execution_caps set enabled=true where scope='anthropic'");await assert.rejects(enableQualificationSpending(nested));
    assert.equal((await db.query('select spending_enabled from makeborne_private.generation_budgets where workspace_id=$1',[round.workspaceId])).rows[0].spending_enabled,false);
  });console.log('PASS conflicting provider policy causes atomic refusal with no partial budget enablement');
  await rolledBack(async nested=>{
    await enableQualificationSpending(nested);
    await db.query('update makeborne_private.generation_budgets set vendor_spent=vendor_spent+123,vendor_reserved=544000,active_reservations=1 where workspace_id=$1',[round.workspaceId]);
    await db.query("update makeborne_private.generation_execution_caps set vendor_spent=vendor_spent+123,vendor_reserved=544000,active_dispatches=1 where scope in ('global','anthropic')");
    await stopQualificationSpending(nested);
    const b=(await db.query('select spending_enabled,vendor_reserved,active_reservations from makeborne_private.generation_budgets where workspace_id=$1',[round.workspaceId])).rows[0];assert.deepEqual(b,{spending_enabled:false,vendor_reserved:'544000',active_reservations:1});
    const caps=(await db.query("select enabled,vendor_limit,vendor_reserved,active_dispatches from makeborne_private.generation_execution_caps where scope in ('global','anthropic')")).rows;assert(caps.every(x=>!x.enabled&&x.vendor_limit==='25000000'&&x.vendor_reserved==='544000'&&x.active_dispatches===1));
  });console.log('PASS stopping disables execution while preserving spent/unknown reservations and fixed $25 limits');
  assert.deepEqual(await initializeQualificationRound(db,url.href),first);
  console.log('PASS all mutation scenarios rolled back; persistent initialized round remains stopped with unchanged actual spend; zero provider calls');
} finally {if(locked)await db.query('select pg_advisory_unlock(hashtextextended($1,0))',[`run:${round.id}`]);await db.end();}

/* eslint-disable @typescript-eslint/no-require-imports -- Disposable local PostgreSQL concurrency qualification. */
const {Client}=require('pg'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
async function main(){
 const url=new URL(process.argv[2]??'');assert(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.port,'55482');assert.equal(url.pathname,'/billing_ux_concurrency_20261021');
 const db=new Client({connectionString:url.href});await db.connect();const clients=[];const u=randomUUID();
 try{
  assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,0,'Only a clean disposable database');
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[u,u+'@ux-concurrency.example.invalid']);
  await db.query("select makeborne_private.credit_grant($1,1000,'topup','fixture','{}')",[u]);
  await db.query('insert into makeborne_private.credit_preferences(user_id,monthly_limit) values($1,100)',[u]);
  for(let i=0;i<8;i++){const c=new Client({connectionString:url.href});await c.connect();clients.push(c);}
  const outcomes=await Promise.all(clients.map(async(c,i)=>{try{const r=await c.query('select makeborne_private.credit_reserve($1,30,$2) result',[u,'race:'+i]);return{admitted:true,reference:'race:'+i,value:r.rows[0].result};}catch(e){assert.equal(e.code,'MB403');return{admitted:false};}}));
  const admitted=outcomes.filter(x=>x.admitted);assert.equal(admitted.length,3);assert.equal(outcomes.filter(x=>!x.admitted).length,5);
  assert.equal((await db.query("select sum(amount)::int n from makeborne_private.credit_reservations where user_id=$1 and status='reserved'",[u])).rows[0].n,90);
  assert.equal((await db.query('select makeborne_private.credit_reserve($1,30,$2) result',[u,admitted[0].reference])).rows[0].result.replayed,true);
  await db.query('select makeborne_private.credit_settle($1,$2,10)',[u,admitted[0].reference]);
  await db.query("select makeborne_private.credit_reserve($1,30,'after-settlement')",[u]);
  await assert.rejects(db.query("select makeborne_private.credit_reserve($1,1,'over-after-settlement')",[u]),e=>e.code==='MB403');
  console.log('PASS actual SQL: 8 concurrent holds, exactly 3 admitted / 5 refused; replay does not consume room; settlement releases only unused room; cap remains 100');
 }finally{await Promise.all(clients.map(c=>c.end()));await db.end();}
}
main().catch(e=>{console.error('BILLING_UX_CONCURRENCY_FAILED '+e.name+' '+String(e.message).replace(/postgres[^\s]+/g,'[redacted]').slice(0,180));process.exitCode=1;});

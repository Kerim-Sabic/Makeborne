/* eslint-disable @typescript-eslint/no-require-imports -- Real SQL concurrency, named disposable database only. */
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const db = 'makeborne_topup_verify';
function sql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker',['exec','-i','supabase_db_makeborne-release-auth','psql','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1','-At']);
    let out='',err='';
    child.stdout.on('data',chunk=>out+=chunk); child.stderr.on('data',chunk=>err+=chunk);
    child.on('error',reject); child.on('close',code=>code ? reject(new Error(err)) : resolve(out.trim()));
    child.stdin.end(statement);
  });
}
(async()=>{
  assert.equal(await sql("select current_database();"),db);
  assert.equal(await sql('select count(*) from auth.users;'),'0','Disposable database must be empty');
  const user=randomUUID(), request=randomUUID(), tag=user.replaceAll('-','');
  const version=`concurrency-${tag}`, plan=`plan_${tag}`, checkout=`ch_${tag}`, payment=`pay_${tag}`;
  let order;
  try {
    await sql(`begin;
      insert into auth.users(id,email,email_confirmed_at) values('${user}','${tag}@topup.example.invalid',now());
      insert into makeborne_private.account_privileges(user_id,is_admin,reason) values('${user}',true,'Disposable concurrency fixture');
      insert into makeborne_private.topup_catalog(version,pack_id,credits,price_cents,merchant_id,plan_id,enabled)
        values('${version}','boost_100',100,1200,'biz_Test','${plan}',true);
      commit;`);
    order=await sql(`select public.makeborne_prepare_topup('${user}','${request}','boost_100','${version}','user_Test')->>'id';`);
    assert.match(order,/^[0-9a-f-]{36}$/);
    const body=JSON.stringify({plan_id:plan,mode:'payment',metadata:{makeborne_topup_order_id:order},redirect_url:'https://sandbox.whop.com/'});
    const claims=await Promise.all(Array.from({length:8},()=>sql(`select public.makeborne_claim_topup_checkout('${user}','${order}','${body}'::jsonb)->>'claimed';`)));
    assert.equal(claims.filter(x=>x==='true').length,1);assert.equal(claims.filter(x=>x==='false').length,7);
    console.log('PASS: eight simultaneous checkout requests claim one provider attempt');
    await sql(`select public.makeborne_bind_topup_checkout('${user}','${order}','${checkout}');`);
    const evidence=JSON.stringify({id:payment,merchantId:'biz_Test',planId:plan,checkoutId:checkout,whopUserId:'user_Test',currency:'usd',principalCents:'1200',refundedPrincipalCents:'0',status:'paid',dispute:'none',updatedAt:new Date(Date.now()-1000).toISOString()});
    const outcomes=await Promise.all(Array.from({length:8},()=>sql(`select public.makeborne_reconcile_topup('${user}','${order}','${evidence}'::jsonb)->>'outcome';`)));
    assert.equal(outcomes.filter(x=>x==='updated').length,1);
    assert.equal(outcomes.filter(x=>x==='duplicate').length,7);
    assert.equal(await sql(`select makeborne_private.credit_available('${user}');`),'100');
    assert.equal(await sql(`select count(*) from public.credit_ledger where user_id='${user}' and kind='topup';`),'1');
    assert.equal(await sql(`select count(*) from makeborne_private.topup_observations where order_id='${order}';`),'1');
    console.log('PASS: eight simultaneous deliveries grant one 100-credit lot and record one observation');
  } finally {
    await sql(`begin; delete from makeborne_private.topup_orders where user_id='${user}';
      delete from auth.users where id='${user}'; delete from makeborne_private.topup_catalog where version='${version}'; commit;`);
    assert.equal(await sql('select count(*) from auth.users;'),'0');
    assert.equal(await sql('select count(*) from public.credit_ledger;'),'0');
    console.log('PASS: disposable fixtures cleaned; no account or ledger rows remain');
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});

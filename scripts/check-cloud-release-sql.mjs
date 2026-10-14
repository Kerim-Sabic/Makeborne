import fs from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';import pg from 'pg';
const root='work/release-auth-stack/',ref='xzwikrunwpurxnxgkznh';assert.equal(JSON.parse(fs.readFileSync(root+'cloud-create-result.json')).ref,ref);
const cfg=JSON.parse(fs.readFileSync(root+'cloud-staging.json'));const db=new pg.Client({host:`db.${ref}.supabase.co`,user:'postgres',password:cfg.password,database:'postgres',ssl:{rejectUnauthorized:true,ca:fs.readFileSync(root+'supabase-ca.crt','utf8')}});await db.connect();
const report={ref,productionTouched:false,paidCalls:0,migrationHashes:[],checks:[]};
try{
 const applied=(await db.query('select version,sha256 from makeborne_release_test.applied order by version')).rows;
 for(const row of applied){const file=fs.readdirSync('supabase/migrations').find(f=>f.startsWith(row.version+'_'));assert(file);const digest=createHash('sha256').update(fs.readFileSync('supabase/migrations/'+file)).digest('hex');assert.equal(digest,row.sha256,`Changed migration ${file}`);report.migrationHashes.push({file,sha256:digest});}
 const production=new Set(JSON.parse(fs.readFileSync('docs/release-review/production-baseline.json','utf8')).rows[0].baseline.versions);const expected=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&!production.has(f.slice(0,14))).length;
 assert.equal(applied.length,expected);report.checks.push(`All ${expected} staging migration hashes match the reviewed working tree`);
 const disabled=(await db.query('select scope,enabled from makeborne_private.live_provider_limits')).rows;assert(disabled.every(r=>!r.enabled));report.checks.push('All provider spend limits remain off');
 for(const file of ['check-plan-credit-allocations.sql','check-credit-lots-expiry.sql','check-crm-sales-delivery.sql','check-live-ai-spend.sql','check-hosting-modes.sql','check-site-address-changes.sql','check-site-enquiries.sql']){
  const sql=fs.readFileSync('supabase/'+file,'utf8').replace(/^\\set[^\r\n]*$/gm,'');assert(/rollback\s*;\s*$/i.test(sql.trim()),'Check must end with rollback: '+file);
  try{await db.query(sql);report.checks.push(file+': passed, rolled back');console.log('PASS '+file);}catch(e){await db.query('rollback');throw e;}
 }
}catch(e){report.error=e.message;console.error(e.message);process.exitCode=1;}finally{await db.end();fs.writeFileSync('docs/release-review/cloud-release-sql.json',JSON.stringify(report,null,2)+'\n');}

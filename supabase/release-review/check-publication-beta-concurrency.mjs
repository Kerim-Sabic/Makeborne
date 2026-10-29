// Disposable LOCAL database only. No ports, network, cloud or existing DB writes.
// Usage: node supabase/release-review/check-publication-beta-concurrency.mjs makeborne_candidate_20261025
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {runRefundRace} from './check-publication-refund-concurrency.mjs';

const prefix=process.argv[2];
assert.match(prefix??'',/^makeborne_candidate_[0-9]{8}$/);
// Reuse the reviewed baseline loader and migration ordering verbatim, excluding
// its historical report writes and unrelated three-scenario execution loop.
const source=readFileSync('scripts/rehearse-candidate.mjs','utf8');
assert.equal(source.split('const evidence =').length,2);
const helper=await import('data:text/javascript;base64,'+Buffer.from(source.split('const evidence =')[0]+
 '\nexport {build,apply,check,psql,migrations,migrationText,DB,IMAGE};').toString('base64'));
const container=`${prefix}_publication_beta_${Date.now()}`;
const report={container,database:helper.DB,network:'none',providerCalls:0,existingDatabasesChanged:false,startedAt:new Date().toISOString(),migrations:[]};
const reportFile='docs/release-review/publication-beta-local-20261025.json';
const sql=(text,options)=>helper.psql(container,helper.DB,text,options);
const payingMigration='20261025200000_paying_workspace_publication.sql';
const definitionsSql=`select md5(string_agg(pg_get_functiondef(p.oid),E'\n' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='makeborne_private' and p.proname in('publication_workspace_allowed','publication_authority','request_publication_preparation','promote_publication_preparation','publication_worker_attest'))
 or (n.nspname='makeborne_hosting' and p.proname='save_site_v4');`;
// Earlier migration files deliberately mix LF/CRLF; rollback equivalence must
// preserve every SQL character except that platform newline representation.
const canonicalDefinitionsSql=definitionsSql.replace('pg_get_functiondef(p.oid),',"replace(pg_get_functiondef(p.oid),E'\\r\\n',E'\\n'),");
const definitionRowsSql=`select json_agg(x order by name) from (select n.nspname||'.'||p.proname name,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='makeborne_private' and p.proname in('publication_workspace_allowed','publication_authority','request_publication_preparation','promote_publication_preparation','publication_worker_attest'))
 or (n.nspname='makeborne_hosting' and p.proname='save_site_v4')) x;`;
try{
 console.log('Building isolated local publication database:',container);
 report.build=helper.build(container);
 for(const file of helper.migrations){
  if(file===payingMigration){report.beforeMigrationDefinitionHash=sql(definitionsSql).output.trim();report.beforeCanonicalDefinitionHash=sql(canonicalDefinitionsSql).output.trim();writeFileSync('work/qualification/publication-original-definitions.json',sql(definitionRowsSql).output);}
  helper.apply(container,file);
  report.migrations.push({file,sha256:createHash('sha256').update(helper.migrationText(file)).digest('hex')});
 }
 console.log('Applied complete candidate chain:',report.migrations.length,'migrations after baseline');
 report.publication=helper.check(container,'supabase/check-paying-workspace-publication.sql');
 console.log(report.publication.join('\n'));
 const migration=helper.migrationText(payingMigration).replace(/\r\n/g,'\n');
 const functions=['makeborne_private.publication_authority','makeborne_hosting.save_site_v4'].map(name=>{
  const escaped=name.replaceAll('.','\\.');
  const found=migration.match(new RegExp('create or replace function '+escaped+'\\([\\s\\S]*?\\nend \\$\\$;'));
  assert(found,'Missing function '+name);return found[0];
 }).join('\n');
 const beforeFix=functions.replace(/ -- BEGIN publication payment serialization\.[\s\S]*? -- END publication payment serialization\.\n/g,'');
 assert.notEqual(beforeFix,functions,'Missing marked payment-lock fix');
 sql(beforeFix);
 report.beforeFix=await runRefundRace(container);
 console.log('Confirmed original race: actual refund commits before blocked promotion');
 sql(functions);
 report.publishFirst=await runRefundRace(container,{expectSerialized:true});
 report.refundFirst=await runRefundRace(container,{expectSerialized:true,refundFirst:true});
 console.log('Fixed: publish-first serializes refund; refund-first refuses promotion');
 sql(readFileSync('supabase/release-review/rollback-paying-workspace-publication.sql','utf8'));
 report.rollbackDefinitionHash=sql(definitionsSql).output.trim();
 report.rollbackCanonicalDefinitionHash=sql(canonicalDefinitionsSql).output.trim();
 writeFileSync('work/qualification/publication-rollback-definitions.json',sql(definitionRowsSql).output);
 report.rollbackRawBytesMatch=report.rollbackDefinitionHash===report.beforeMigrationDefinitionHash;
 assert.equal(report.rollbackCanonicalDefinitionHash,report.beforeCanonicalDefinitionHash,'Rollback changed SQL beyond newline representation');
 assert.equal(sql("select to_regclass('makeborne_private.trusted_publication_scope') is null").output.trim(),'t');
 sql(migration);
 report.afterReapply=helper.check(container,'supabase/check-paying-workspace-publication.sql');
 report.existingChecks={};
 for(const file of ['check-trusted-publication.sql','check-publication-production-profile.sql','check-site-address-namespace.sql','check-unlimited-sites.sql','check-publication-worker-authority.sql','check-site-address-changes.sql','check-publication-sandbox-journal.sql']){
  report.existingChecks[file]=helper.check(container,'supabase/'+file);
  console.log(file+': '+report.existingChecks[file].length+' PASS');
 }
 report.passed=true;
}catch(error){report.passed=false;report.error=error.message;console.error(error.message);process.exitCode=1;}
finally{
 report.finishedAt=new Date().toISOString();
 writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
 // Keep this named local container for investigation; cleanup is explicit.
 console.log('Local report:',reportFile);
}

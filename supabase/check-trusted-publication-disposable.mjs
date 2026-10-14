// Reuse the pinned populated-candidate bootstrap, but isolate this package's
// fixtures, evidence and container. No linked CLI, cloud DB or provider calls.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const bootstrap=readFileSync('scripts/rehearse-candidate.mjs','utf8');
const boundary=bootstrap.indexOf('const evidence =');
assert(boundary>0 && bootstrap.includes('function build(container)') && bootstrap.includes('const stop = container'));
process.argv[2]='makeborne_candidate_20261013';
const run=String.raw`
const container = 'makeborne_publication_'+stamp;
const evidence = {container,startedAt:new Date().toISOString(),passed:false,providerCalls:0,productionTouched:false,stagingTouched:false,checks:[]};
try {
 read('supabase/check-trusted-publication-disposable.mjs');read('supabase/check-trusted-publication-concurrency.mjs');
 build(container);pause(container);
 for(const file of migrations)apply(container,file);
 evidence.checks.push(...check(container,'supabase/check-trusted-publication.sql'));
 evidence.hostingRegressions={};
 for(const file of ['check-hosting-modes.sql','check-site-address-changes.sql','check-site-enquiries.sql','check-unlimited-sites.sql'])
  evidence.hostingRegressions[file]=check(container,'supabase/'+file);
 const concurrency=spawnSync(process.execPath,['supabase/check-trusted-publication-concurrency.mjs',container],{encoding:'utf8',maxBuffer:1000000});
 if(concurrency.status!==0)throw new Error(concurrency.stderr+' '+concurrency.stdout);
 evidence.concurrency=JSON.parse(concurrency.stdout);
 evidence.inputs=[...consumed].map(([file,text])=>({file,sha256:sha(text)}));
 evidence.changedInputs=evidence.inputs.filter(x=>sha(readFileSync(x.file,'utf8'))!==x.sha256).map(x=>x.file);
 evidence.candidateMigrations=migrations.length;
 evidence.passed=evidence.checks.length>=8&&evidence.concurrency.passed&&evidence.changedInputs.length===0;
 if(!evidence.passed)throw new Error('Qualification input or check mismatch');
} catch(error) { evidence.error=error.message;process.exitCode=1; }
finally {stop(container);evidence.finishedAt=new Date().toISOString();writeFileSync('docs/release-review/trusted-publication-sql-20261013.json',JSON.stringify(evidence,null,2)+String.fromCharCode(10));}
console.log(JSON.stringify({passed:evidence.passed,container,groups:evidence.checks.length,concurrency:evidence.concurrency?.checks,error:evidence.error},null,2));
`;
// The bootstrap defines functions but does no work before this marker. Its
// build() accepts only our freshly named container and creates "rehearsal".
await import('data:text/javascript;base64,'+Buffer.from(bootstrap.slice(0,boundary)+run).toString('base64'));

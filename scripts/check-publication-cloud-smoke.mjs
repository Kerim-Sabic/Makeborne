/** Owner-approved two-session probe only. No database, app deployment or production access. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {Sandbox} from '../infra/publication-controller/node_modules/@vercel/sandbox/dist/index.js';
import {canonicalRuntimeJson as canonical} from '../infra/project-runtime/identity.mjs';
const teamId='team_viiayqU1BnwJBdEqgHdgmtnA',projectId='prj_c9h8fuyEmVAT8F3NHFMvzFR1BnLc';
const directory='work/publication-cloud-smoke-20261014',out=directory+'/runtime-evidence.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
// Owner approved one retry after the first normalized-name failure: three
// sessions TOTAL, not three per process. Refuse an unknown cleanup on restart.
const previous=fs.existsSync(out)?JSON.parse(fs.readFileSync(out,'utf8')):null;
if(previous){assert.equal(previous.projectId,projectId);assert.equal(previous.authorizedCapUsd,2);assert(previous.sessions.every(s=>s.stopConfirmed===true));assert(previous.passed!==true);}
const report={schemaVersion:1,scope:'two-session-staging-image-smoke',startedAt:new Date().toISOString(),teamId,projectId,
  authorizedCapUsd:2,maxSessionsTotal:3,retryApproved:true,productionTouched:false,aiCalls:0,appDeployed:false,databaseTouched:false,checks:[],sessions:previous?.sessions??[],passed:false};
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
const record=(name,details={})=>{report.checks.push({name,passed:true,...details});save();console.log('PASS '+name);};
const auth=JSON.parse(fs.readFileSync('C:/Users/kerim/AppData/Roaming/com.vercel.cli/Data/auth.json','utf8'));
assert(typeof auth.token==='string'&&auth.token.length>20);
const creds={token:auth.token,teamId,projectId};
const mapping=JSON.parse(fs.readFileSync(directory+'/image-inputs.json','utf8'));
assert(mapping.teamId===teamId&&mapping.projectId===projectId);
for(const kind of ['compiler','renderer'])assert(new RegExp('^vcr\\.vercel\\.com/kerimsabic-6594s-projects/makeborne-release-staging/mbpub-smoke-'+kind+'-20261014@sha256:[a-f0-9]{64}$').test(mapping[kind].image));
let createdCount=report.sessions.length;
async function withBox(kind,fn){
  assert(createdCount<3);createdCount++;
  const name='mbpub-smoke-'+kind+'-'+randomUUID(),entry={kind,name,image:mapping[kind].image,state:'creating',requestedTimeoutMs:75000,requestedVcpus:1};
  report.sessions.push(entry);save();let box;
  try{
    box=await Sandbox.create({...creds,name,image:entry.image,persistent:false,networkPolicy:'deny-all',timeout:75000,
      resources:{vcpus:1},ports:[],mounts:{},env:{},region:'iad1',signal:AbortSignal.timeout(20000)});
    const session=box.currentSession();Object.assign(entry,{state:'running',sessionId:session.sessionId,imageReturned:box.image,persistent:box.persistent,startedAt:new Date().toISOString()});save();
    assert.equal(box.name,name);assert.equal(box.image.replace(/^vcr\.vercel\.com\//,''),entry.image.replace(/^vcr\.vercel\.com\//,''));assert.equal(box.persistent,false);assert.equal(session.status,'running');
    await fn(session,entry);
  }catch(error){
    entry.failure={name:error?.name??'Error',status:error?.status??null,message:String(error?.message??'unknown').split(auth.token).join('[redacted]').slice(0,1200)};save();throw error;
  }finally{
    if(!box){try{box=await Sandbox.get({...creds,name,resume:false,signal:AbortSignal.timeout(10000)});}catch{entry.state='create-unconfirmed';save();}}
    if(box){try{const stopped=await box.stop({signal:AbortSignal.timeout(10000)});entry.state=stopped.status;entry.stoppedAt=new Date().toISOString();entry.stopConfirmed=stopped.status==='stopped';save();assert.equal(stopped.status,'stopped');}catch{entry.state='cleanup-unconfirmed';save();throw Error('CLOUD_CLEANUP_UNCONFIRMED');}}
  }
}
async function run(session,code,env={}){
  const cmd=await session.runCommand({cmd:'node',args:['--input-type=module','-e',code],cwd:'/tmp',sudo:false,detached:true,
    timeoutMs:65000,env:{NODE_ENV:'production',HOME:'/tmp',...env},signal:AbortSignal.timeout(10000)});
  const result=await cmd.wait({signal:AbortSignal.timeout(68000)});
  const stdout=await result.stdout(),stderr=await result.stderr();
  assert(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)<8_000_000);
  if(result.exitCode!==0){report.commandFailure={exitCode:result.exitCode,stderr:stderr.slice(0,7000)};save();throw Error('CLOUD_WORKLOAD_FAILED');}
  return JSON.parse(stdout);
}
try{
  const packageJson=JSON.parse(fs.readFileSync('infra/project-runtime/toolchain/package.json')),lock=JSON.parse(fs.readFileSync('infra/project-runtime/toolchain/package-lock.json'));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNI61iFFTEMLQkAyhFmAcKExhUAAAAASUVORK5CYII=','base64');
  const files=[['package.json',JSON.stringify(packageJson)],['package-lock.json',JSON.stringify(lock)],
    ['index.html','<!doctype html><html><head><title>Cloud qualification fixture</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'],
    ['src/main.tsx',"import {createRoot} from 'react-dom/client';import './style.css';createRoot(document.getElementById('root')!).render(<main><nav><a href='#contact'>Contact</a></nav><h1>Cloud publishing works</h1><img src='/hero.png' alt='Local artwork'/><section id='contact'><h2>Contact us</h2></section></main>);"],
    ['src/style.css','body{font-family:Inter,sans-serif}img{width:8px;height:8px}']].map(([path,text])=>({path,body:Buffer.from(text)}));
  const entry=f=>({path:f.path,bytes:f.body.length,sha256:sha(f.body)}),asset={path:'public/hero.png',body:png},routes=[{path:'/',title:'Home'}];
  const manifest={schemaVersion:1,toolchainId:'react-vite-v1',routes,files:files.map(entry),assets:[entry(asset)]};
  const uuid='11111111-1111-4111-8111-111111111111';
  const request={schemaVersion:1,artifactId:uuid,revisionId:uuid,version:1,sourceHash:sha(canonical(manifest)+'\n'),sourceManifest:manifest,toolchainId:'react-vite-v1',
    toolchainHash:sha(canonical({id:'react-vite-v1',package:packageJson,lock})),routes,files:[...files,asset].map(f=>({...entry(f),base64:f.body.toString('base64')}))};
  let build;
  await withBox('compiler',async(session,sessionEvidence)=>{
    await session.writeFiles([{path:'/input/request.json',content:Buffer.from(JSON.stringify(request))}],{signal:AbortSignal.timeout(10000)});
    build=await run(session,`import fs from 'node:fs';import {spawn} from 'node:child_process';if(process.getuid()===0)throw Error('ROOT');const s=fs.statSync('/input');if(s.uid!==process.getuid())throw Error('INPUT_OWNER');const child=spawn(process.execPath,['/opt/makeborne/watchdog.mjs'],{stdio:'ignore'});const end=Date.now()+60000;while(!fs.existsSync('/tmp/build-complete')){if(child.exitCode!==null||Date.now()>end)throw Error('COMPILER_FAILED');await new Promise(r=>setTimeout(r,100));}const receipt=JSON.parse(fs.readFileSync('/tmp/result/makeborne-build.json'));const files=receipt.files.map(f=>({...f,base64:fs.readFileSync('/tmp/result/'+f.path).toString('base64')}));await new Promise(r=>process.stdout.write(JSON.stringify({uid:process.getuid(),inputOwner:s.uid,receipt,files}),r));process.exit(0);`,
      {MAKEBORNE_RUNTIME_IMAGE:mapping.compiler.runtimeImageId,MAKEBORNE_RUNTIME_TTL_MS:'65000'});
    assert(build.uid>0);assert.equal(build.uid,build.inputOwner);assert.equal(build.receipt.sourceHash,request.sourceHash);assert.equal(build.receipt.runtimeImageId,mapping.compiler.runtimeImageId);
    for(const f of build.files){const body=Buffer.from(f.base64,'base64');assert.equal(body.length,f.bytes);assert.equal(sha(body),f.sha256);}
    assert(build.files.some(f=>f.path.endsWith('.woff2')));assert(build.files.some(f=>f.path==='hero.png'));
    Object.assign(sessionEvidence,{uid:build.uid,inputOwner:build.inputOwner});fs.writeFileSync(directory+'/compiled-fixture.json',JSON.stringify(build));
    record('actual cloud compiler builds React with bundled fonts and local artwork',{sourceHash:request.sourceHash,buildHash:build.receipt.buildHash});
  });
  await withBox('renderer',async(session,sessionEvidence)=>{
    const identity=await run(session,`import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {chromium} from '/opt/makeborne/node_modules/playwright/index.mjs';import {localPublicationRendererId} from '/opt/makeborne/publication-renderer.mjs';if(process.getuid()===0)throw Error('ROOT');const binary=chromium.executablePath();fs.accessSync(binary,fs.constants.R_OK|fs.constants.X_OK);const version=execFileSync(binary,['--version'],{encoding:'utf8'}).trim().match(/[0-9]+(?:\\.[0-9]+){3}/)[0];console.log(JSON.stringify({uid:process.getuid(),home:process.env.HOME,binary,version,rendererId:await localPublicationRendererId(version),playwright:JSON.parse(fs.readFileSync('/opt/makeborne/node_modules/playwright/package.json')).version}));`);
    assert.equal(identity.playwright,'1.63.0');assert.equal(identity.home,'/tmp');Object.assign(sessionEvidence,identity);save();
    const mime=p=>p.endsWith('.js')?'text/javascript; charset=utf-8':p.endsWith('.css')?'text/css; charset=utf-8':p.endsWith('.png')?'image/png':p.endsWith('.woff2')?'font/woff2':'application/octet-stream';
    const input={schemaVersion:1,origin:'https://release-check.makeborne.site',path:'/',indexHtml:Buffer.from(build.files.find(f=>f.path==='index.html').base64,'base64').toString(),files:build.files.filter(f=>f.path!=='index.html').map(f=>({path:'/'+f.path,contentType:mime(f.path),sha256:f.sha256,base64:f.base64})),rendererId:identity.rendererId,timeoutMs:15000};
    await session.writeFiles([{path:'/vercel/sandbox/render-input.json',content:Buffer.from(JSON.stringify(input))}],{signal:AbortSignal.timeout(10000)});
    const rendered=await run(session,`import fs from 'node:fs';import {spawn} from 'node:child_process';const child=spawn(process.execPath,['/opt/makeborne/vercel-publication-render-watchdog.mjs'],{stdio:['ignore','ignore','pipe']});let diagnostic='';child.stderr.on('data',b=>diagnostic+=b);const code=await new Promise(r=>child.once('exit',r));if(code!==0){console.error(diagnostic.slice(0,7000));process.exit(code??1);}process.stdout.write(fs.readFileSync('/vercel/sandbox/render-result.json'));`,{MAKEBORNE_RENDER_TTL_MS:'16000'});
    assert.equal(rendered.rendererId,identity.rendererId);assert.match(rendered.html,/Cloud publishing works/);assert.match(rendered.html,/Local artwork/);
    fs.writeFileSync(directory+'/rendered-fixture.html',rendered.html);record('actual cloud Chromium sandbox captures retained HTML and bundled assets',{htmlSha256:sha(rendered.html)});
  });
  assert(report.sessions.every(s=>s.stopConfirmed));report.passed=true;
}catch(error){report.failure={name:error?.name??'Error',message:String(error?.message??'unknown').split(auth.token).join('[redacted]').slice(0,1200)};process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();report.actualInvoiceUsd=null;report.limitations=['Two image/runtime probes only; not an end-to-end publication, form delivery or recovery qualification.','Actual invoice pending; SDK credentials never entered either sandbox environment.'];save();console.log(JSON.stringify({passed:report.passed,sessions:report.sessions.map(s=>({name:s.name,state:s.state,stopConfirmed:s.stopConfirmed})),failure:report.failure??null}));}

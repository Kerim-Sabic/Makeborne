/** Local Docker-only packaging smoke. No API credentials or remote activation. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {canonicalRuntimeJson as canonical} from '../identity.mjs';
const runtime=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [compiler='makeborne-publication-compiler-local:20261013',renderer='makeborne-publication-renderer-local:20261013',output]=process.argv.slice(2);
const sha=b=>createHash('sha256').update(b).digest('hex');
const report={schemaVersion:1,scope:'local-image-packaging-only',createdAt:new Date().toISOString(),checks:[],cloudQualified:false};
function command(args,input='',timeout=85000){return new Promise((resolve,reject)=>{
 const child=spawn('docker',args,{windowsHide:true,stdio:['pipe','pipe','pipe'],timeout});let stdout='',stderr='',bytes=0;
 for(const [stream,key] of [[child.stdout,'stdout'],[child.stderr,'stderr']])stream.on('data',b=>{bytes+=b.length;if(bytes>8_000_000){child.kill();return;}if(key==='stdout')stdout+=b;else stderr+=b;});
 child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));child.stdin.on('error',()=>{});child.stdin.end(input);
});}
async function run(image,code,input={},env={}){
 const name='mbpub-package-'+randomUUID();
 try{return await command(['run','--rm','--pull','never','--name',name,'--network','none','--cpus','1','--memory','2g','--memory-swap','2g','--pids-limit','128','--cap-drop','ALL','--security-opt','no-new-privileges','--env','HOME=/tmp','--env','NODE_ENV=production',...Object.entries(env).flatMap(([k,v])=>['--env',`${k}=${v}`]),'--workdir','/tmp','--entrypoint','node','-i',image,'--input-type=module','-e',code],JSON.stringify(input));}
 finally{await command(['rm','--force',name],'',15000);}
}
function record(name,result){report.checks.push({name,...result});console.log(JSON.stringify({name,...result}));}
let build;
try{
 for(const [kind,image] of [['compiler',compiler],['renderer',renderer]]){
  const inspect=await command(['image','inspect',image,'--format','{{json .}}']);assert.equal(inspect.code,0,inspect.stderr);
  const data=JSON.parse(inspect.stdout);assert.equal(data.Config.User,'node');assert.equal(data.Architecture,'amd64');
  report[kind]={localImageId:data.Id,os:data.Os,architecture:data.Architecture};
 }
 const packageJson=JSON.parse(await readFile(resolve(runtime,'toolchain/package.json'),'utf8')),lock=JSON.parse(await readFile(resolve(runtime,'toolchain/package-lock.json'),'utf8'));
 const files=[['package.json',JSON.stringify(packageJson)],['package-lock.json',JSON.stringify(lock)],
  ['index.html','<!doctype html><html><head><title>Packaging fixture</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'],
  ['src/main.tsx',"import {createRoot} from 'react-dom/client';import './style.css';createRoot(document.getElementById('root')!).render(<main><h1>Image packaging works</h1><img src='/hero.png' alt='Local artwork'/></main>);"],
  ['src/style.css','body{font-family:Inter,sans-serif}img{width:8px;height:8px}']].map(([path,text])=>({path,body:Buffer.from(text)}));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNI61iFFTEMLQkAyhFmAcKExhUAAAAASUVORK5CYII=','base64');
 const entry=f=>({path:f.path,bytes:f.body.length,sha256:sha(f.body)});
 const asset={path:'public/hero.png',body:png},routes=[{path:'/',title:'Home'}];
 const manifest={schemaVersion:1,toolchainId:'react-vite-v1',routes,files:files.map(entry),assets:[entry(asset)]};
 const uuid='11111111-1111-4111-8111-111111111111';
 const request={schemaVersion:1,artifactId:uuid,revisionId:uuid,version:1,sourceHash:sha(canonical(manifest)+'\n'),sourceManifest:manifest,toolchainId:'react-vite-v1',toolchainHash:sha(canonical({id:'react-vite-v1',package:packageJson,lock})),routes,
  files:[...files,asset].map(f=>({...entry(f),base64:f.body.toString('base64')}))};
 const compilerCode=`import fs from 'node:fs';import {spawn} from 'node:child_process';let input='';for await(const part of process.stdin)input+=part;if(process.getuid()===0)throw Error('ROOT');const s=fs.statSync('/input');if(s.uid!==process.getuid())throw Error('INPUT_OWNER');fs.writeFileSync('/input/request.json',input,{flag:'wx',mode:0o600});const child=spawn(process.execPath,['/opt/makeborne/watchdog.mjs'],{stdio:'ignore'});const end=Date.now()+60000;while(!fs.existsSync('/tmp/build-complete')){if(child.exitCode!==null||Date.now()>end)throw Error('COMPILER_FAILED');await new Promise(r=>setTimeout(r,100));}const receipt=JSON.parse(fs.readFileSync('/tmp/result/makeborne-build.json'));const files=receipt.files.map(f=>({...f,base64:fs.readFileSync('/tmp/result/'+f.path).toString('base64')}));await new Promise(r=>process.stdout.write(JSON.stringify({uid:process.getuid(),inputOwner:s.uid,receipt,files}),r));process.exit(0);`;
 const compiled=await run(compiler,compilerCode,request,{MAKEBORNE_RUNTIME_IMAGE:report.compiler.localImageId,MAKEBORNE_RUNTIME_TTL_MS:'65000'});assert.equal(compiled.code,0,compiled.stderr);
 build=JSON.parse(compiled.stdout);assert.equal(build.uid,1000);assert.equal(build.receipt.runtimeImageId,report.compiler.localImageId);assert.equal(build.receipt.sourceHash,request.sourceHash);
 for(const f of build.files){const body=Buffer.from(f.base64,'base64');assert.equal(body.length,f.bytes);assert.equal(sha(body),f.sha256);}
 assert(build.files.some(f=>f.path.endsWith('.woff2')));assert(build.files.some(f=>f.path==='hero.png'));
 record('compiler default-user transfer and real React/font/artwork build',{passed:true,sourceHash:request.sourceHash,buildHash:build.receipt.buildHash});
 const metadataCode=`import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {chromium} from '/opt/makeborne/node_modules/playwright/index.mjs';import {localPublicationRendererId} from '/opt/makeborne/publication-renderer.mjs';if(process.getuid()===0)throw Error('ROOT');const binary=chromium.executablePath();fs.accessSync(binary,fs.constants.R_OK|fs.constants.X_OK);if(!binary.startsWith('/opt/ms-playwright/'))throw Error('BROWSER_PATH');fs.writeFileSync('/vercel/sandbox/input-probe','ok',{flag:'wx',mode:0o600});const version=execFileSync(binary,['--version'],{encoding:'utf8'}).trim().match(/[0-9]+(?:\.[0-9]+){3}/)[0];console.log(JSON.stringify({uid:process.getuid(),home:process.env.HOME,binary,version,rendererId:await localPublicationRendererId(version),playwright:JSON.parse(fs.readFileSync('/opt/makeborne/node_modules/playwright/package.json')).version}));`;
 const meta=await run(renderer,metadataCode);assert.equal(meta.code,0,meta.stderr);const identity=JSON.parse(meta.stdout);assert.equal(identity.playwright,'1.63.0');assert.equal(identity.home,'/tmp');assert.equal(identity.uid,1000);Object.assign(report.renderer,identity);
 record('renderer dependency imports, sibling policy, binary and writable paths with HOME=/tmp',{passed:true});
 const mime=p=>p.endsWith('.js')?'text/javascript; charset=utf-8':p.endsWith('.css')?'text/css; charset=utf-8':p.endsWith('.png')?'image/png':p.endsWith('.woff2')?'font/woff2':'application/octet-stream';
 const input={schemaVersion:1,origin:'https://release-check.makeborne.site',path:'/',indexHtml:Buffer.from(build.files.find(f=>f.path==='index.html').base64,'base64').toString(),files:build.files.filter(f=>f.path!=='index.html').map(f=>({path:'/'+f.path,contentType:mime(f.path),sha256:f.sha256,base64:f.base64})),rendererId:identity.rendererId,timeoutMs:15000};
 const renderCode=`import fs from 'node:fs';import {spawn} from 'node:child_process';let input='';for await(const part of process.stdin)input+=part;fs.writeFileSync('/vercel/sandbox/render-input.json',input,{flag:'wx',mode:0o600});const child=spawn(process.execPath,['/opt/makeborne/vercel-publication-render-watchdog.mjs'],{stdio:'ignore'});const code=await new Promise(r=>child.once('exit',r));if(code!==0)process.exit(code??1);process.stdout.write(fs.readFileSync('/vercel/sandbox/render-result.json'));`;
 const rendered=await run(renderer,renderCode,input,{MAKEBORNE_RENDER_TTL_MS:'16000'});
 if(rendered.code!==0){
  // Trusted diagnostic only: do not disable Chromium's sandbox or loosen Docker.
  const diagnostic=await run(renderer,`import {chromium} from '/opt/makeborne/node_modules/playwright/index.mjs';try{const b=await chromium.launch({headless:true,chromiumSandbox:true,timeout:10000});await b.close();}catch(e){console.error(String(e));process.exitCode=1;}`);
  record('renderer real watchdog and Chromium sandbox capture',{passed:false,exitCode:rendered.code,diagnostic:diagnostic.stderr.slice(0,7000)});
  record('renderer denied-network and timeout workloads',{passed:false,skipped:true,reason:'Browser sandbox capture must work before workload checks count'});
  process.exitCode=1;
 }else{
  const result=JSON.parse(rendered.stdout);assert.equal(result.rendererId,identity.rendererId);assert.match(result.html,/Image packaging works/);assert.match(result.html,/Local artwork/);
  record('renderer real watchdog and Chromium sandbox capture',{passed:true,htmlSha256:sha(result.html)});
  const denied=structuredClone(input);denied.indexHtml=denied.indexHtml.replace('</head>','<script src="https://example.invalid/denied.js"></script></head>');
  const refusal=await run(renderer,renderCode,denied,{MAKEBORNE_RENDER_TTL_MS:'16000'});assert.notEqual(refusal.code,0);record('renderer external script refused',{passed:true});
  const slow=structuredClone(input),script=Buffer.from('while(true){}');slow.indexHtml='<!doctype html><html><body><div id="root"></div><script src="/slow.js"></script></body></html>';slow.files=[{path:'/slow.js',contentType:'text/javascript; charset=utf-8',sha256:sha(script),base64:script.toString('base64')}];slow.timeoutMs=15000;
  const started=Date.now(),expired=await run(renderer,renderCode,slow,{MAKEBORNE_RENDER_TTL_MS:'1100'});assert.equal(expired.code,124);assert(Date.now()-started<12000);record('renderer watchdog kills stalled workload',{passed:true});
 }
}catch(error){record('packaging harness',{passed:false,error:String(error)});process.exitCode=1;}
finally{report.passed=report.checks.every(c=>c.passed);if(output)await writeFile(resolve(output),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,cloudQualified:false}));}

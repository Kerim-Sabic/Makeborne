/* eslint-disable @typescript-eslint/no-require-imports -- Owned localhost fixture, UI exercised through computer use. */
const {fixture}=require('./check-compiled-output.cjs');
const {retainCompiledOutput}=require('./compiled-output.ts');
const {servePrivatePreview,previewOriginLabel}=require('./preview-response.ts');
const {PRIVATE_PREVIEW_SANDBOX}=require('./preview-sandbox.ts');
const {canonicalSourceJson}=require('./canonical-json.ts');
const {createServer}=require('node:http'),{randomUUID,createHash}=require('node:crypto');
const assert=require('node:assert/strict');
async function main(){
 const f=fixture(),jobId=randomUUID(),viewer={p_actor:randomUUID(),p_session:randomUUID(),p_expires:new Date(Date.now()+600000).toISOString()};
 const source=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Preview form boundary</title><main><h1>Preview form boundary</h1>
 <form id="local"><label>Email<input name="email" type="email" required></label><button>Validate locally</button></form><p role="status" id="status">Not submitted</p>
 <form action="/forbidden-write" method="post"><button>Try native submission</button></form><button id="fetch">Try application request</button><p id="network" role="status">Not requested</p>
 <script src="/assets/site.js"></script></main></html>`;
 const script=`document.querySelector('#local').addEventListener('submit',event=>{event.preventDefault();document.querySelector('#status').textContent='Validated locally. Nothing sent or saved.'});document.querySelector('#fetch').addEventListener('click',async()=>{try{await fetch(parentOrigin+'/forbidden-fetch');document.querySelector('#network').textContent='Unexpected request success'}catch{document.querySelector('#network').textContent='Application request blocked'}});`;
 f.contents.set('index.html',Buffer.from(source));
 // Origin is filled before retention, once the owned listener has a port.
 let config,identity,approved,writeRequests=0,applicationRequests=0;
 const server=createServer(async(req,res)=>{
  try{
   const origin=`http://${req.headers.host}`;
   if(config&&origin===config.applicationOrigin){
    if(req.url==='/forbidden-fetch'){applicationRequests++;res.writeHead(403);res.end('Forbidden');return;}
    if(req.url!=='/'||req.method!=='GET'){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
    res.end(`<!doctype html><title>Makeborne preview forms qualification</title><h1>Isolated website preview</h1><iframe title="Website preview" sandbox="${PRIVATE_PREVIEW_SANDBOX}" src="${config.previewOrigin}/" width="850" height="500"></iframe>`);return;
   }
   if(req.url==='/forbidden-write')writeRequests++;
   const result=await servePrivatePreview(new Request(origin+req.url,{method:req.method}),config,identity,viewer,{store:f.store,authorize:async()=>approved});
   res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
  }catch{res.writeHead(503);res.end('Fixture unavailable');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port,app=`http://app.makeborne.localhost:${port}`;
 f.contents.set('assets/site.js',Buffer.from(`const parentOrigin=${JSON.stringify(app)};${script}`));
 f.receipt.files=[...f.contents].map(([path,bytes])=>({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
 const {buildHash,...receiptIdentity}=f.receipt;void buildHash;
 f.receipt.buildHash=createHash('sha256').update(canonicalSourceJson(receiptIdentity)).digest('hex');
 config={applicationOrigin:app,previewOrigin:`http://${previewOriginLabel(f.receipt.buildHash)}.preview.makeborne.localhost:${port}`,allowLocalhost:true};
 identity={jobId,versionId:f.receipt.revisionId,buildHash:f.receipt.buildHash};
 approved={jobId,versionId:identity.versionId,scope:{workspaceId:f.workspace,projectId:randomUUID(),artifactId:f.receipt.artifactId},receipt:f.receipt};
 await retainCompiledOutput(f.store,f.workspace,f.receipt,f.read,new AbortController().signal);
 const response=await servePrivatePreview(new Request(config.previewOrigin+'/'),config,identity,viewer,{store:f.store,authorize:async()=>approved});
 assert.equal(response.status,200);assert.match(response.headers.get('Content-Security-Policy'),/form-action 'none'/);
 assert.ok(response.headers.get('Content-Security-Policy').endsWith(`sandbox ${PRIVATE_PREVIEW_SANDBOX}`));
 assert.equal((await servePrivatePreview(new Request(config.previewOrigin+'/forbidden-write',{method:'POST'}),config,identity,viewer,{store:f.store,authorize:async()=>assert.fail('WRITE_AUTHORIZATION')})).status,405);
 console.log(JSON.stringify({applicationOrigin:app,previewOrigin:config.previewOrigin,ready:true}));
 let closing=false;const timer=setTimeout(()=>void stop(),600000);
 async function stop(){if(closing)return;closing=true;clearTimeout(timer);await new Promise(resolve=>server.close(resolve));process.stdin.pause();console.log(JSON.stringify({closed:true,writeRequests,applicationRequests}));}
 process.stdin.resume();process.stdin.once('data',()=>void stop());process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
}
main().catch(()=>{console.error('PREVIEW_FORM_QUALIFICATION_FAILED');process.exitCode=1;});

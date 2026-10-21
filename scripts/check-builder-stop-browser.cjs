/* eslint-disable @typescript-eslint/no-require-imports -- Real mounted builder/hooks, local HTTP/SSE and sessionStorage; fictional operation service, no provider/database/cloud calls. */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {build}=require('esbuild'),{ browserType, engine } = require('./browser-engine.cjs'),{createServer}=require('node:http');
const ids={actor:'11111111-1111-4111-8111-111111111111',workspace:'22222222-2222-4222-8222-222222222222',artifact:'33333333-3333-4333-8333-333333333333',operation:'44444444-4444-4444-8444-444444444444',run:'55555555-5555-4555-8555-555555555555'};
const fixture=`import React from'react';import{createRoot}from'react-dom/client';import LiveBuilder from'./src/components/live-builder';
createRoot(document.getElementById('root')).render(<LiveBuilder accountId="${ids.actor}" workspaceId="${ids.workspace}" artifactId="${ids.artifact}" version={1} history={[]} baseFiles={{}} baseAssets={[]} defaultEffort="light" autoStart="A fictional book about a lighthouse cat" kind="book" onLive={()=>{}} onSaved={()=>{}}/>);`;
async function main(){
 const output=await build({stdin:{contents:fixture,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env':'{}'},plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/design-capture$|cloud-api$/},args=>({path:args.path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export async function captureDesign(){throw Error("Unexpected capture")}export async function readCloudImage(){throw Error("Unexpected image")}',loader:'js'}));
  b.onResolve({filter:/^@\//},args=>{const base=path.resolve('src',args.path.slice(2));return{path:fs.existsSync(base)?base:fs.existsSync(base+'.tsx')?base+'.tsx':base+'.ts'};});
  b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));
 }}]});
 const css=fs.readFileSync('src/app/live-builder.css','utf8');
 let state;
 const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
 const server=createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(!pathname.startsWith('/api/')){res.setHeader('content-type',pathname==='/fixture.js'?'text/javascript':'text/html');res.end(pathname==='/fixture.js'?output.outputFiles[0].contents:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:14px sans-serif}*{box-sizing:border-box}${css}</style><div id="root"></div><script src="/fixture.js"></script>`);return;}
  const current=state;assert(current,'active fixture');
  if(pathname==='/api/credits')return json(res,{available:500,unlimited:false});
  if(pathname==='/api/build/questions')return json(res,{questions:[]});
  if(pathname==='/api/build/plan'&&req.method==='GET')return json(res,{stored:null});
  let text='';for await(const chunk of req)text+=chunk;const body=text?JSON.parse(text):null;
  if(pathname==='/api/build/operations'){
   current.requests.push({method:req.method,body});
   if(!current.operation)return json(res,{error:{message:'Not recorded'}},404);
   if(req.method==='DELETE'){
    assert.equal(req.headers['x-makeborne-account'],ids.actor);assert.equal(body.workspaceId,ids.workspace);assert.equal(body.artifactId,ids.artifact);
    assert(body.id===ids.operation||body.actionKey===current.actionKey,'Stop binds stored identity');
    const stale={...current.operation};
    if(current.operation.status!=='cancelled')current.operation={...current.operation,revision:2,cancelRequested:true,maximumAdditionalCredits:0};
    if(current.lostReply){current.lostReply=false;res.destroy();}else json(res,{operation:current.operation,result:current.result,recovery:null});
    if(current.staleEvent)setTimeout(()=>{current.emit({type:'operation',operation:stale});current.staleDelivered=true;},20);
    if(current.finishOnStop)setTimeout(()=>current.finish(),current.staleEvent?300:60);
    return;
   }
   return json(res,{operation:current.operation,result:current.result,recovery:null});
  }
  assert.equal(pathname,'/api/build');assert.equal(req.method,'POST');
  current.builds.push(body);current.actionKey=body.operation.actionKey;
  current.operation={id:ids.operation,revision:1,kind:'build',effort:'light',authorizedCredits:20,chargedCredits:0,reservedCredits:20,remainingCredits:0,maximumAdditionalCredits:20,status:'running',cancelRequested:false,pendingKind:null,lastVersion:1,canContinue:false,recoverable:false,expiresAt:'2030-01-01T00:00:00Z'};
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});res.flushHeaders();current.stream=res;
  const emit=event=>{if(!res.destroyed&&!res.writableEnded)res.write('data: '+JSON.stringify(event)+'\n\n');};
  current.emit=emit;
  const initial=setTimeout(()=>emit({type:'operation',operation:current.operation}),current.initialDelay);
  current.finish=()=>{clearTimeout(initial);current.operation={...current.operation,status:'cancelled',cancelRequested:true,reservedCredits:0,chargedCredits:current.charge,remainingCredits:20-current.charge};
   current.result={runId:ids.run,version:1,summary:'Stopped fixture',charged:current.charge,changed:false,finished:true};
   emit({...current.result,type:'done',operation:current.operation});if(!res.destroyed&&!res.writableEnded)res.end();};
 }catch(error){state?.errors.push(String(error.message));if(!res.headersSent)json(res,{error:{message:'Fixture failed'}},500);else res.destroy();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`,browser=await browserType.launch({headless:true});
 let passed=0;
 try{
  for(const name of ['before-id','mid-run-double-stop','reload-during-stop','lost-stop-reply','late-operation-event']){
   state={requests:[],builds:[],errors:[],operation:null,result:null,stream:null,initialDelay:name==='before-id'?1500:0,charge:name==='before-id'?0:1,finishOnStop:name!=='reload-during-stop',lostReply:name==='lost-stop-reply',finish:()=>{throw Error('Build not started');}};
   state.staleEvent=name==='late-operation-event';
   const current=state,context=await browser.newContext({viewport:{width:375,height:900}}),page=await context.newPage(),errors=[];
   let reloading=false;page.setDefaultTimeout(15000);
   // WebKit's driver reports a fetch the unloading page starts (and catches) as a page error "<url> due to access control checks.".
   // Only that message, only while this check reloads, is set aside (and printed); any other page error still fails.
   page.on('pageerror',error=>{if(engine==='webkit'&&reloading&&/^\S+ due to access control checks\.$/.test(error.message)){console.log(`NOTE WebKit reported a fetch cancelled by the reload: ${error.message}`);return;}errors.push(error.message);});
   await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/))/,route=>route.abort());
   try{
    await page.goto(base);await page.getByText(/Your brief is ready below/).waitFor();assert.equal(current.builds.length,0,'a handed-over brief is never sent on load');await page.locator('form.lb-composer button[type=submit]').click();const stop=page.getByRole('button',{name:'Stop',exact:true});await stop.waitFor();
    // Press Stop once the server holds the build request. Stop can be shown before the POST arrives (WebKit sends it later);
    // a Stop that reaches the server first is refused as unrecorded and correctly resent once the id is known.
    for(const until=Date.now()+5000;!current.builds.length&&Date.now()<until;)await new Promise(resolve=>setTimeout(resolve,10));
    if(name!=='before-id')await page.getByText('0 / 20 credits',{exact:true}).waitFor();
    if(name==='mid-run-double-stop')await stop.dblclick();else await stop.click();
    if(name==='late-operation-event'){await page.waitForTimeout(100);assert.equal(current.staleDelivered,true);assert.equal(await page.getByRole('button',{name:'Stopping',exact:true}).isDisabled(),true,'late initial SSE cannot undo acknowledged Stop');}
    if(name==='reload-during-stop'){
     await page.getByRole('button',{name:'Stopping',exact:true}).waitFor();reloading=true;await page.reload();reloading=false;
     await page.getByRole('button',{name:'Stopping',exact:true}).waitFor();assert.equal(current.builds.length,1,'reload never starts another build');
     current.finish();await page.getByText('1 / 20 credits',{exact:true}).waitFor();
    }else{await page.getByText('Stopped fixture',{exact:true}).waitFor({state:'attached'});const toggle=page.locator('.workbench-chat-toggle');if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();await page.getByText('Stopped fixture',{exact:true}).waitFor();await page.getByRole('region',{name:'Request receipt'}).waitFor();}
    await page.waitForFunction(()=>{const value=JSON.parse(sessionStorage.getItem(`makeborne:operation:v1:${'11111111-1111-4111-8111-111111111111'}:${'22222222-2222-4222-8222-222222222222'}:${'33333333-3333-4333-8333-333333333333'}:build`));return value?.id&&!value.cancelPending;});
    assert.equal(current.builds.length,1);const deletes=current.requests.filter(request=>request.method==='DELETE').length;
    // A lost Stop reply on a kept-alive connection is resent once by Chromium's (and Firefox's) network stack; the app itself
    // never repeats Stop. WebKit's stack does not resend, so it sees the single intent. Either way at most one retry reaches the server.
    if(name==='lost-stop-reply'&&engine!=='chromium'){assert.ok(deletes===1||deletes===2,`response loss permits at most one idempotent retry (${deletes})`);console.log(`NOTE ${engine} transport sent ${deletes} DELETE for the lost Stop reply`);}
    else assert.equal(deletes,name==='lost-stop-reply'?2:1,'response loss permits one idempotent retry; double click sends one intent');
    if(name==='before-id')assert.equal(current.requests.find(request=>request.method==='DELETE').body.actionKey,current.actionKey,'can stop before first operation event');
    assert.equal(await page.getByRole('button',{name:'Approve allowance & continue'}).count(),0);
    assert.ok(await page.getByRole('textbox',{name:'Message the builder'}).isEnabled(),'new message allowed after settled Stop');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'375px controls fit');
    assert.deepEqual(errors,[]);assert.deepEqual(current.errors,[]);console.log('PASS Stop browser: '+name);passed++;
   }finally{current.stream?.destroy();await context.close();}
  }
  console.log(`${passed} mounted Stop scenarios passed; no paid calls.`);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

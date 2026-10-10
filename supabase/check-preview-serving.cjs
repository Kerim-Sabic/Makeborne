/* eslint-disable @typescript-eslint/no-require-imports -- Local owned HTTP/Chromium fixture only. */
const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path'),{randomBytes}=require('node:crypto');
const {chromium}=require('playwright');
const {servePrivatePreview,previewOriginLabel}=require('../src/lib/projects/preview-response.ts');

exports.qualifyPreviewServing=async({admin,job,identity,viewer,dependencies,evidenceDirectory})=>{
 let server,browser,origin,config,pending=Promise.resolve(),unboundRequests=0;
 const credential=randomBytes(32).toString('hex'); // Fixture-only opaque handle, never production authentication.
 const input=(pathname,method='GET',base=origin)=>new Request(`${base}${pathname}`,{method});
 const serve=request=>servePrivatePreview(request,config,identity,viewer,dependencies);
 try{
  server=http.createServer((req,res)=>{
   const run=async()=>{
    if(req.headers.authorization!==`Bearer ${credential}`){res.writeHead(401,{'Cache-Control':'no-store'});res.end('Unavailable');return;}
    const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method});
    if(new URL(request.url).origin!==origin)unboundRequests++;
    const response=await serve(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
   };
   // This fixture shares one SQL connection/savepoints. Production RPCs each
   // have their own transaction; do not share mutable database role state.
   pending=pending.then(run).catch(()=>{res.writeHead(503);res.end('Unavailable');});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  origin=`http://${previewOriginLabel(identity.buildHash)}.preview.localhost:${port}`;
  config={applicationOrigin:`http://app.localhost:${port}`,previewOrigin:origin,allowLocalhost:true};
  const root=await serve(input('/'));assert.equal(root.status,200);assert.equal(root.headers.get('Content-Type'),'text/html; charset=utf-8');
  assert.match(root.headers.get('Content-Security-Policy'),/sandbox allow-scripts allow-same-origin/);
  assert.match(root.headers.get('Content-Security-Policy'),/worker-src 'none'/);
  assert.match(root.headers.get('Cache-Control'),/no-store/);assert.equal(root.headers.get('Access-Control-Allow-Origin'),null);
  assert.equal((await serve(input('/missing.js'))).status,404);assert.equal((await serve(input('/missing-route'))).status,404);
  assert.equal((await serve(input('/','POST'))).status,405);assert.equal((await serve(input('/','GET',config.applicationOrigin))).status,404);
  const head=await serve(input('/','HEAD'));assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal((await servePrivatePreview(input('/'),{...config,allowLocalhost:false},identity,viewer,dependencies)).status,404);
  const wrong={...config,previewOrigin:origin.replace(previewOriginLabel(identity.buildHash),'b-wrong')};
  assert.equal((await servePrivatePreview(new Request(`${wrong.previewOrigin}/`),wrong,identity,viewer,dependencies)).status,404);
  console.log('PASS actual preview response: exact build host, no app-origin serving, GET/HEAD, missing assets/routes 404, MIME/no-store/CSP/no permissive CORS and local HTTP opt-in');
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({extraHTTPHeaders:{Authorization:`Bearer ${credential}`}}),page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});
   const response=await page.goto(`${origin}/`,{waitUntil:'networkidle'});assert.equal(response.status(),200);
   await page.getByRole('heading',{name:'Stage',exact:true}).waitFor();
   await page.screenshot({path:path.join(evidenceDirectory,`private-preview-${width}.png`)});
  }
  assert.deepEqual(errors,[]);
  const blocked=await page.evaluate(async target=>{try{await fetch(target);return false;}catch{return true;}},`${config.applicationOrigin}/private`);
  assert.equal(blocked,true);assert.equal(unboundRequests,0);
  const js=await page.evaluate(async()=>{const url=document.querySelector('script[type="module"]').src;const response=await fetch(url);return {status:response.status,type:response.headers.get('Content-Type'),bytes:(await response.text()).length};});
  assert.equal(js.status,200);assert.match(js.type,/text\/javascript/);assert(js.bytes>0);
  await admin.query('savepoint preview_browser_revoke');
  try{
   await admin.query('delete from public.workspace_members where workspace_id=$1 and user_id=$2',[job.workspace_id,viewer.p_actor]);
   assert.equal(await page.evaluate(async()=>{const response=await fetch('/index.html');return response.status;}),404);
  }finally{await admin.query('rollback to savepoint preview_browser_revoke');await admin.query('release savepoint preview_browser_revoke');}
  console.log('PASS actual isolated localhost Chromium at 390/1440 renders retained React bundle; app fetch blocked, exact JS served and live membership revocation returns 404 on next request');
 }finally{await browser?.close();await pending;if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
};

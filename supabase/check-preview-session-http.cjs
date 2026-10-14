/* eslint-disable @typescript-eslint/no-require-imports -- Explicit local Auth/Next/browser qualification; never paid transport. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),net=require('node:net'),path=require('node:path');
const {spawn}=require('node:child_process'),{randomUUID,randomBytes}=require('node:crypto');
const {createClient}=require('@supabase/supabase-js'),{createServerClient}=require('@supabase/ssr'),{chromium}=require('playwright');
const {handlePreviewGateway,previewGatewayOrigin,PREVIEW_HANDOFF_PATH,previewTokenHash}=require('../src/lib/projects/preview-gateway.ts');
const {PreviewLaunchSchema}=require('../src/lib/projects/preview-session-contract.ts');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const data=result=>{if(result.error||!result.data)throw Object.assign(Error('LOCAL_AUTH_UNCONFIRMED'),{code:result.error?.code});return result.data;};
async function freePort(port){const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await Promise.race([exited,pause(5000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await Promise.race([exited,pause(5000)]);}assert(child.exitCode!==null||child.signalCode!==null,'OWNED_CHILD_NOT_STOPPED');}
async function buildNext(env){let timer;const child=spawn(process.execPath,['node_modules/next/dist/bin/next','build'],{env,windowsHide:true,stdio:'ignore'});try{const code=await Promise.race([new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('LOCAL_NEXT_BUILD_TIMEOUT')),120000);})]);assert.equal(code,0,'LOCAL_NEXT_BUILD_FAILED');}finally{clearTimeout(timer);await stop(child);}}

exports.qualifyPreviewSessionHttp=async({admin:db,job,receipt,outputStore,evidenceDirectory,r2Directory})=>{
 assert.equal(process.env.MAKEBORNE_VERIFY_LOCAL_PREVIEW_SESSION_HTTP,'true');
 const config=JSON.parse((await fs.readFile(process.env.MAKEBORNE_LOCAL_STATUS_FILE,'utf8')).replace(/^\uFEFF/,''));
 assert.equal(config.API_URL,'http://127.0.0.1:55321');const database=new URL(config.DB_URL);assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'55322');
 const applicationOrigin='http://app.makeborne.localhost:3043',localFetch=(input,init={})=>{assert.equal(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url).origin,config.API_URL);return fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});};
 const admin=createClient(config.API_URL,config.SECRET_KEY,{global:{fetch:localFetch},auth:{persistSession:false,autoRefreshToken:false}}),jar=new Map();
 let previewWorker,user,client,gateway,app,browser,gatewayConfig,previewOrigin,stage='owned port',credentialLeaks=0,requests=0;
 const errors=[],pending=new Set();
 try{
  await freePort(3043);
  stage='real Auth reviewer';
  const email=`preview-http-${randomUUID()}@example.com`,password=randomBytes(32).toString('base64url');
  user=data(await admin.auth.admin.createUser({email,password,email_confirm:true})).user;
  client=createServerClient(config.API_URL,config.PUBLISHABLE_KEY,{global:{fetch:localFetch},cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>jar.set(name,value))}});
  const auth=data(await client.auth.signInWithPassword({email,password})),claims=data(await client.auth.getClaims()).claims;
  assert.equal(claims.sub,user.id);assert.equal(claims.is_anonymous,false);
  await db.query("insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'reviewer')",[job.workspace_id,user.id]);
  const rpc={
   async consume(handoffHash,cookieHash,buildHash,signal){return data(await admin.rpc('makeborne_consume_preview_handoff',{p_handoff_hash:handoffHash,p_cookie_hash:cookieHash,p_build_hash:buildHash}).abortSignal(signal));},
   async read(cookieHash,buildHash,signal){return data(await admin.rpc('makeborne_read_preview_session',{p_cookie_hash:cookieHash,p_build_hash:buildHash}).abortSignal(signal));},
  };
  gateway=http.createServer((req,res)=>{
   const run=async()=>{
    requests++;if((req.headers.cookie??'').split(';').some(value=>value.trim().startsWith('sb-'))||req.headers.authorization||req.headers.apikey)credentialLeaks++;
    const bytes=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024){res.writeHead(413);res.end();return;}bytes.push(chunk);}
    const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(bytes)});
    const response=previewWorker?await previewWorker.dispatchFetch(request):await handlePreviewGateway(request,gatewayConfig,rpc,outputStore);if(previewWorker&&response.status>=400)console.log(`LOCAL_WORKER_RESPONSE ${request.method} ${response.status}`);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
   };
   const running=run().catch(()=>{if(!res.headersSent)res.writeHead(503);res.end('Unavailable');});pending.add(running);running.finally(()=>pending.delete(running));
  });
  await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(0,'127.0.0.1',resolve);});
  const gatewayPort=gateway.address().port;
  gatewayConfig={applicationOrigin,baseOrigin:`http://preview.makeborne.localhost:${gatewayPort}`,allowLocalhost:true};previewOrigin=previewGatewayOrigin(gatewayConfig,receipt.buildHash);
  if(r2Directory){
   assert(process.env.MAKEBORNE_LOCAL_PREVIEW_WORKER_BUNDLE,'EXPLICIT_LOCAL_WORKER_BUNDLE_REQUIRED');
   const {createLocalPreviewRuntime}=await import('../infra/private-preview/local-runtime.mjs');
   previewWorker=await createLocalPreviewRuntime({directory:r2Directory,bundle:path.resolve(process.env.MAKEBORNE_LOCAL_PREVIEW_WORKER_BUNDLE),apiUrl:config.API_URL,secret:config.SECRET_KEY,applicationOrigin,baseOrigin:gatewayConfig.baseOrigin});
   console.log('PASS actual bundled Cloudflare Worker started with private persisted R2; outbound transport restricted to two local authority RPCs');
  }
  const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:config.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:config.PUBLISHABLE_KEY,SUPABASE_SECRET_KEY:config.SECRET_KEY,
   MAKEBORNE_CLOUD_ENABLED:'true',MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED:'true',MAKEBORNE_PRIVATE_PREVIEWS_ENABLED:'true',MAKEBORNE_PREVIEW_APPLICATION_ORIGIN:applicationOrigin,MAKEBORNE_PREVIEW_BASE_ORIGIN:gatewayConfig.baseOrigin,MAKEBORNE_PREVIEW_ALLOW_LOCALHOST:'true',MAKEBORNE_DURABLE_SUBMISSIONS_ENABLED:'false',MAKEBORNE_PUBLIC_GENERATION_ENABLED:'false',MAKEBORNE_CLAUDE_PILOT_ENABLED:'false',MAKEBORNE_BILLING_ENABLED:'false'};
  for(const key of Object.keys(env))if(/ANTHROPIC|OPENAI|WHOP_API|CLAUDE_API|DEEPSEEK_API|QWEN_API/.test(key))env[key]='';
  for(const key of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','WHOP_API_KEY','DEEPSEEK_API_KEY','QWEN_API_KEY'])env[key]='';
  stage='local production build';await buildNext(env);
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3043'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let ready=false,startup='',startError=false;app.on('error',()=>{startError=true;});app.stdout.on('data',bytes=>{startup=(startup+bytes.toString()).slice(-2000);ready ||= startup.includes('Ready in');});app.stderr.on('data',()=>{});
  stage='owned server readiness';for(let i=0;!ready;i++){assert(!startError&&app.exitCode===null&&i<80,'OWNED_SERVER_NOT_READY');await pause(250);}
  browser=await chromium.launch({headless:true});const context=await browser.newContext();
  await context.route('**/*',route=>{const origin=new URL(route.request().url()).origin;return [applicationOrigin,previewOrigin,config.API_URL].includes(origin)?route.continue():route.abort();});
  await context.addCookies([...jar].map(([name,value])=>({name,value,url:applicationOrigin,sameSite:'Lax'})));
  const page=await context.newPage();page.on('pageerror',()=>errors.push('APP_PAGE_ERROR'));
  await page.clock.install({time:new Date()});
  await page.goto(applicationOrigin+'/',{waitUntil:'domcontentloaded'});
  async function issue(extra={},id=job.id){return page.evaluate(async({id,actor,extra})=>{const response=await fetch(`/api/generate/${id}/preview`,{method:'POST',headers:{'X-Makeborne-Account':actor,...extra}});return {status:response.status,cache:response.headers.get('Cache-Control'),value:await response.json()};},{id,actor:user.id,extra});}
  stage='actual signed-in issuer';
  const issued=await issue();assert.equal(issued.status,200,`ISSUER_HTTP_${issued.status}_${issued.value.error?.code??'UNKNOWN'}`);assert.match(issued.cache,/no-store/,'ISSUER_CACHE_POLICY');
  const launch=PreviewLaunchSchema.parse(issued.value.preview);assert.equal(launch.url,previewOrigin+PREVIEW_HANDOFF_PATH,'ISSUER_WRONG_PREVIEW_ORIGIN');
  const serialized=JSON.stringify(issued.value);for(const secret of [user.id,claims.session_id,auth.session.access_token,config.SECRET_KEY])assert(!serialized.includes(secret),'ISSUER_CREDENTIAL_LEAK');
  assert.equal((await issue({'X-Makeborne-Account':randomUUID()})).status,409,'ISSUER_SWITCHED_ACCOUNT_STATUS');
  assert.equal((await issue({},randomUUID())).status,404,'ISSUER_UNKNOWN_JOB_STATUS');
  console.log('PASS actual local Auth → production Next issuer: current reviewer without paid creation plan gets bounded handoff; switched account/foreign job denied; no account/session/JWT/server key in response');
  stage='saved revision discovery';
  const discoveryPath=`/api/cloud/workspaces/${job.workspace_id}/artifacts/${job.artifact_id}/preview?versionId=${receipt.revisionId}`;
  async function discover(path=discoveryPath,actor=user.id){return page.evaluate(async({path,actor})=>{const response=await fetch(path,{headers:{'X-Makeborne-Account':actor}});return {status:response.status,cache:response.headers.get('Cache-Control'),value:await response.json()};},{path,actor});}
  const beforeDiscovery=(await db.query('select count(*)::int n from makeborne_private.preview_sessions where actor_id=$1',[user.id])).rows[0].n;
  const discovered=await discover();assert.equal(discovered.status,200,'SAVED_DISCOVERY_HTTP');assert.match(discovered.cache,/no-store/);assert.equal(discovered.value.job.id,job.id);assert.equal(discovered.value.job.outputVersionId,receipt.revisionId);assert.equal(discovered.value.job.credits,null);assert.equal(discovered.value.job.canCancel,false);
  assert.equal((await discover(discoveryPath,randomUUID())).status,409);
  assert.equal((await discover(discoveryPath.replace(receipt.revisionId,randomUUID()))).status,404);
  assert.equal((await discover(discoveryPath+'&versionId='+receipt.revisionId)).status,400);
  assert.equal((await discover(discoveryPath+'&actor='+user.id)).status,400);
  assert.equal((await db.query('select count(*)::int n from makeborne_private.preview_sessions where actor_id=$1',[user.id])).rows[0].n,beforeDiscovery);
  console.log('PASS actual saved revision discovery: reviewer without creation plan, exact revision, no preview grant/mutation; switched account, foreign revision and extra/duplicate parameters denied');
  stage='browser form cookie iframe';
  await page.evaluate(launch=>{const iframe=document.createElement('iframe');iframe.name='makeborne-preview-check';iframe.title='Private compiled website';iframe.width='1000';iframe.height='700';document.body.replaceChildren(iframe);const form=document.createElement('form');form.method='POST';form.action=launch.url;form.target=iframe.name;const input=document.createElement('input');input.type='hidden';input.name='handoff';input.value=launch.handoff;form.append(input);document.body.append(form);form.submit();form.remove();},launch);
  const locator=page.frameLocator('iframe');await locator.getByRole('heading',{name:'Stage',exact:true}).waitFor({timeout:15000});
  let frame=page.frames().find(frame=>frame.url()===previewOrigin+'/');assert(frame,'PREVIEW_IFRAME_MISSING');
  assert.equal(await frame.evaluate(()=>document.cookie),'');assert.equal(await frame.evaluate(()=>{try{void parent.document.body;return false;}catch{return true;}}),true);
  const cookies=await context.cookies(previewOrigin);assert.equal(cookies.length,1);const cookie=cookies[0];assert.equal(cookie.name,'makeborne-preview-local');assert.equal(cookie.httpOnly,true);assert.equal(cookie.domain,new URL(previewOrigin).hostname);assert.equal(cookie.path,'/');assert.equal(cookie.sameSite,'Lax');
  const hashes=(await db.query('select handoff_hash,cookie_hash from makeborne_private.preview_sessions where actor_id=$1',[user.id])).rows;assert.equal(hashes.length,1);assert.equal(hashes[0].handoff_hash,previewTokenHash(launch.handoff));assert.equal(hashes[0].cookie_hash,previewTokenHash(cookie.value));
  const js=await frame.evaluate(async()=>{const response=await fetch(document.querySelector('script[type="module"]').src);return {status:response.status,type:response.headers.get('Content-Type')};});assert.equal(js.status,200);assert.match(js.type,/text\/javascript/);
  for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(evidenceDirectory,`session-handoff-${width}.png`)});}
  assert.equal(credentialLeaks,0);assert(requests>=3);assert.deepEqual(errors,[]);
  console.log('PASS actual cross-origin browser POST → 303 → host-only HttpOnly cookie → compiled React iframe; bundled JS works, parent DOM blocked, no application Auth/API credential reaches gateway');
  stage='actual editor preview controls';
  await db.query("update public.workspace_members set role='editor' where workspace_id=$1 and user_id=$2",[job.workspace_id,user.id]);
  // Only this local UI fixture gets workspace-page access. The earlier real
  // reviewer test had no account privilege or paid creation entitlement.
  await db.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,false,'Local private preview UI qualification')",[user.id]);
  await page.evaluate(()=>localStorage.clear());
  assert.equal(await page.evaluate(()=>localStorage.length),0,'BROWSER_REFERENCE_NOT_EMPTY');
  await page.goto(`${applicationOrigin}/studio?tab=projects&workspace=${job.workspace_id}&artifact=${job.artifact_id}`,{waitUntil:'domcontentloaded'});
  // Returning to a completed original job opens its compiled site directly;
  // no second build or preview click is needed.
  await page.frameLocator('iframe[title="Website preview"]').getByRole('heading',{name:'Stage',exact:true}).waitFor({timeout:15000});
  assert.equal(await page.locator('.cloud-workbench-preview').count(),0,'DUPLICATE_OUTLINE_PREVIEW');
  // A second browser context has only Auth cookies, no request key or storage.
  const fresh=await browser.newContext();
  try {
   await fresh.route('**/*',route=>[applicationOrigin,previewOrigin,config.API_URL].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
   await fresh.addCookies([...jar].map(([name,value])=>({name,value,url:applicationOrigin,sameSite:'Lax'})));
   const reopened=await fresh.newPage();await reopened.goto(`${applicationOrigin}/studio?tab=projects&workspace=${job.workspace_id}&artifact=${job.artifact_id}`,{waitUntil:'domcontentloaded'});
   await reopened.frameLocator('iframe[title="Website preview"]').getByRole('heading',{name:'Stage',exact:true}).waitFor({timeout:15000});
   assert.equal(await reopened.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('makeborne.generation.')).length),0,'FRESH_CONTEXT_GENERATION_REFERENCE');
   assert.equal(await reopened.locator('.cloud-workbench-preview').count(),0);
   await reopened.reload({waitUntil:'domcontentloaded'});await reopened.frameLocator('iframe[title="Website preview"]').getByRole('heading',{name:'Stage',exact:true}).waitFor({timeout:15000});
  }finally{await fresh.close();}
  console.log('PASS saved website auto-opens in empty-storage original and independent fresh browser contexts, survives reload, needs no generation reference or request key');

  assert.equal(await page.locator('input[name="handoff"]').count(),0);
  assert.equal(await page.evaluate(handoff=>Object.values(localStorage).some(value=>String(value).includes(handoff)),launch.handoff),false);
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.getByRole('button',{name:'Mobile preview',exact:true}).click();
   assert((await page.locator('iframe[title="Website preview"]').boundingBox()).width<=390);
   await page.screenshot({path:path.join(evidenceDirectory,`editor-preview-${width}.png`)});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'EDITOR_HORIZONTAL_OVERFLOW');
  }
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Desktop preview',exact:true}).click();
  stage='editor fullscreen';
  await page.getByRole('button',{name:'Expand preview',exact:true}).click();await page.waitForFunction(()=>Boolean(document.fullscreenElement));
  await page.getByRole('button',{name:'Exit full screen',exact:true}).click();
  await page.waitForFunction(()=>!document.fullscreenElement);
  stage='editor refresh close reopen';
  const refreshed=page.waitForResponse(response=>response.url()===previewOrigin+'/'&&response.status()===200);
  await page.getByRole('button',{name:'Refresh preview',exact:true}).click();
  await refreshed;
  await page.frameLocator('iframe[title="Website preview"]').getByRole('heading',{name:'Stage',exact:true}).waitFor();
  await page.getByRole('button',{name:'Close preview',exact:true}).click();await page.locator('iframe[title="Website preview"]').waitFor({state:'detached'});
  await page.getByRole('button',{name:'Preview website',exact:true}).click();await page.frameLocator('iframe[title="Website preview"]').getByRole('heading',{name:'Stage',exact:true}).waitFor();
  stage='editor expiry';
  await page.clock.fastForward(20*60_000+1000);
  await page.getByText('Preview session ended. Open it again to continue reviewing.',{exact:true}).waitFor();
  assert.equal(await page.locator('iframe[title="Website preview"]').count(),0,'EXPIRED_IFRAME_RETAINED');
  stage='editor reopen after expiry';
  await page.clock.setSystemTime(new Date());await page.getByRole('button',{name:'Reopen preview',exact:true}).click();
  await page.frameLocator('iframe[title="Website preview"]').getByRole('heading',{name:'Stage',exact:true}).waitFor();
  await page.getByRole('button',{name:'Close preview',exact:true}).click();
  stage='editor pending-close boundary';
  let release,entered,handled;
  const held=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{entered=resolve;}),finished=new Promise(resolve=>{handled=resolve;});
  const pattern=`**/api/generate/${job.id}/preview`,hold=async route=>{entered();await held;try{await route.continue();}catch{/* Closed/aborted browser request is expected. */}finally{handled();}};
  await context.route(pattern,hold);
  try{
   await page.getByRole('button',{name:'Preview website',exact:true}).click();await seen;
   await page.getByRole('button',{name:'Close preview',exact:true}).click();release();await finished;
   await page.getByRole('button',{name:'Preview website',exact:true}).waitFor();assert.equal(await page.locator('iframe[title="Website preview"]').count(),0,'CLOSED_PREVIEW_REAPPEARED');
  }finally{release();await context.unroute(pattern,hold);}
  await page.getByRole('button',{name:'Preview website',exact:true}).click();await page.frameLocator('iframe[title="Website preview"]').getByRole('heading',{name:'Stage',exact:true}).waitFor();
  frame=page.frames().find(frame=>frame.url()===previewOrigin+'/');assert(frame,'EDITOR_PREVIEW_IFRAME_MISSING');
  assert.equal(credentialLeaks,0,'EDITOR_CREDENTIAL_LEAKS');assert.equal(errors.length,0,'EDITOR_PAGE_ERRORS');
  console.log('PASS real editor automatically opens compiled website without duplicate outline; mobile width <=390, desktop/fullscreen/refresh/close/reopen/expiry/pending-close work, no form token remains or enters storage, no horizontal overflow at 390/1440');
  const direct=async(pathname,{method='GET',headers={},body,host=new URL(previewOrigin).host}={})=>fetch(`http://127.0.0.1:${gatewayPort}${pathname}`,{method,headers:{Host:host,...headers},body,redirect:'manual',signal:AbortSignal.timeout(5000)});
  const cookieHeader=`${cookie.name}=${cookie.value}`;
  stage='replay and live revocation';
  assert.equal((await direct(PREVIEW_HANDOFF_PATH,{method:'POST',headers:{Origin:applicationOrigin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({handoff:launch.handoff})})).status,404);
  assert.equal((await direct('/',{headers:{Cookie:cookieHeader},host:new URL(previewGatewayOrigin(gatewayConfig,'b'.repeat(64))).host})).status,404);
  await db.query('delete from public.workspace_members where workspace_id=$1 and user_id=$2',[job.workspace_id,user.id]);
  assert.equal(await frame.evaluate(async()=> (await fetch('/index.html')).status),404);assert.equal((await issue()).status,404,'REVOKED_ISSUER_STATUS');
  await db.query("insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'reviewer')",[job.workspace_id,user.id]);assert.equal(await frame.evaluate(async()=> (await fetch('/index.html')).status),200);
  const signedOut=await client.auth.signOut();assert.equal(signedOut.error,null);
  assert.equal((await db.query('select count(*)::int n from auth.sessions where id=$1',[claims.session_id])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from makeborne_private.preview_sessions where actor_id=$1',[user.id])).rows[0].n,0);
  assert.equal((await direct('/',{headers:{Cookie:cookieHeader}})).status,404);assert([401,403].includes((await issue()).status));
  console.log('PASS replay/wrong-build cookie denied; membership revocation stops next iframe read and issuer, restoration permits read; real Auth sign-out deletes grant and denies retained cookie/JWT');
  await fs.writeFile(path.join(evidenceDirectory,'session-http-fixture.json'),JSON.stringify({workspaceId:job.workspace_id,jobId:job.id,versionId:receipt.revisionId,buildHash:receipt.buildHash,bundledCloudflareWorker:!!previewWorker,requests,credentialLeaks,paidCalls:0,checks:['saved-revision-discovery','fresh-browser-no-reference','fresh-browser-reload','real-auth-issuer','account-binding','foreign-job','browser-form-cookie-iframe','host-only-httponly','hash-only-storage','compiled-js','cross-origin-parent-denial','replay','wrong-build','membership-revocation','real-logout']},null,2)+'\n');
 }catch(error){const code=typeof error?.message==='string'&&/^[A-Z_0-9]+$/.test(error.message.split('\n')[0])?error.message.split('\n')[0]:typeof error?.code==='string'?error.code:'ASSERTION_OR_CONFIGURATION';console.error(`FAIL local preview HTTP at ${stage}: ${code}${typeof error?.actual==='number'&&typeof error?.expected==='number'?` (${error.actual} expected ${error.expected})`:''}; sensitive details omitted`);throw Object.assign(Error('PREVIEW_HTTP_FAILED'),{code});}
 finally{
  await browser?.close();await stop(app);await Promise.allSettled([...pending]);
  if(gateway){gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));}
  await previewWorker?.dispose();
  if(user){await db.query('delete from makeborne_private.preview_sessions where actor_id=$1',[user.id]);await db.query('delete from public.workspace_members where workspace_id=$1 and user_id=$2',[job.workspace_id,user.id]);await db.query('delete from makeborne_private.account_privileges where user_id=$1',[user.id]);await client?.auth.signOut();const removed=await admin.auth.admin.deleteUser(user.id);assert.equal(removed.error,null);}
  client?.auth.stopAutoRefresh();admin.auth.stopAutoRefresh();await freePort(3043);
  console.log('PASS owned Next/browser/gateway awaited stopped; local reviewer/membership/session/grants removed; no paid provider credentials used');
 }
};

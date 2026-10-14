/** Operator-only local renderer qualification. Never import into request handlers.
 * All document requests are fulfilled from verified retained bytes. The local
 * controller is not qualification of a production OS/container sandbox. */
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {siteDocumentHeaders, siteFileHeaders} from '../customer-sites/site-policy.js';

/** Qualification identity includes the exact controller and delivery-policy
 * implementation bytes as well as the actual Chromium binary version. */
export async function localPublicationRendererId(browserVersion) {
  const hash=createHash('sha256');
  for(const path of ['./publication-renderer.mjs','../customer-sites/site-policy.js','../customer-sites/website-policy.js'])hash.update(await readFile(new URL(path,import.meta.url)));
  return `chromium-${browserVersion}-controller-${hash.digest('hex')}`;
}

export async function renderLocalPublication({origin,path='/',indexHtml,files,signal}, {timeoutMs=15000,qualifiedRendererId}={}) {
  if (!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000) throw Error('PUBLICATION_RENDER_DEADLINE_INVALID');
  const address=new URL(origin);
  if(address.protocol!=='https:'||address.origin!==origin||address.port||address.username||address.password) throw Error('PUBLICATION_RENDER_ORIGIN_INVALID');
  if(typeof path!=='string'||path.length>240||!/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(path))throw Error('PUBLICATION_RENDER_PATH_INVALID');
  signal.throwIfAborted();
  // Chromium subprocesses receive no application/provider/database environment.
  const env=Object.fromEntries(['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','HOME','LOCALAPPDATA'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  const server=await chromium.launchServer({headless:true,chromiumSandbox:true,env,timeout:10000,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--renderer-process-limit=1','--js-flags=--max-old-space-size=128','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=<-loopback>','--host-resolver-rules=MAP * ~NOTFOUND','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
  let timer, abort;
  const work=async()=>{
    const browser=await chromium.connect(server.wsEndpoint());
    const rendererId=await localPublicationRendererId(browser.version());
    if(qualifiedRendererId&&rendererId!==qualifiedRendererId)throw Error('PUBLICATION_RENDERER_UNQUALIFIED');
    const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:false,javaScriptEnabled:true,reducedMotion:'reduce',permissions:[]});
    // WebRTC sockets are outside normal HTTP interception. Deny the constructors
    // before project execution in every frame, with non-replaceable properties.
    await context.addInitScript(()=>{for(const name of ['RTCPeerConnection','webkitRTCPeerConnection'])Object.defineProperty(window,name,{value:undefined,writable:false,configurable:false});});
    const fileMap=new Map(files.map(file=>[file.path,file]));
    let requests=0,totalBytes=0;const violations=[];
    await context.routeWebSocket('**/*',socket=>{violations.push('socket');socket.close();});
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(++requests>256||req.method()!=='GET'||url.origin!==origin||url.search||url.hash||!['document','script','stylesheet','font','image'].includes(req.resourceType())) {violations.push('network');await route.abort();return;}
      if(url.pathname===path&&req.resourceType()==='document'&&req.isNavigationRequest()){
        totalBytes+=Buffer.byteLength(indexHtml);
        if(totalBytes>12_000_000){violations.push('network-budget');await route.abort();return;}
        await route.fulfill({status:200,headers:siteDocumentHeaders({interactive:true,secure:true,indexable:false}),body:indexHtml});return;
      }
      const file=fileMap.get(url.pathname);
      if(!file||req.isNavigationRequest()){violations.push('unlisted');await route.abort();return;}
      totalBytes+=file.body.length;
      if(totalBytes>12_000_000){violations.push('network-budget');await route.abort();return;}
      await route.fulfill({status:200,headers:siteFileHeaders({pathname:file.path,contentType:file.contentType,secure:true}),body:file.body});
    });
    const page=await context.newPage();
    page.on('pageerror',()=>violations.push('runtime'));
    page.on('console',message=>{if(message.type()==='error')violations.push('console');});
    page.on('download',download=>{violations.push('download');void download.cancel();});
    context.on('page',popup=>{if(popup!==page){violations.push('popup');void popup.close();}});
    await page.goto(`${origin}${path}`,{waitUntil:'load',timeout:timeoutMs});
    await page.waitForLoadState('networkidle',{timeout:timeoutMs});
    const cdp=await context.newCDPSession(page);
    const {frameTree}=await cdp.send('Page.getFrameTree');
    const {executionContextId}=await cdp.send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'makeborne-trusted-publication',grantUniveralAccess:false});
    // Isolated-world native DOM bindings cannot be replaced by project scripts.
    // Neither postMessage nor app-defined ready globals can authorize capture.
    const ready=await cdp.send('Runtime.evaluate',{contextId:executionContextId,awaitPromise:true,returnByValue:true,expression:`(async()=>{
      const end=Date.now()+8000;
      while(!document.querySelector('#root')?.children.length){if(Date.now()>end)throw Error('ROOT_NOT_READY');await new Promise(r=>setTimeout(r,20));}
      for(const img of document.images)img.loading='eager';
      await document.fonts.ready;
      for(const face of document.fonts)if(face.status==='error')throw Error('FONT_FAILED');
      await Promise.all([...document.images].map(async img=>{await img.decode();if(!img.complete||!img.naturalWidth)throw Error('IMAGE_FAILED');}));
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      if(document.documentElement.outerHTML.length>3900000)throw Error('SNAPSHOT_LIMIT');
      return {ready:true};
    })()`});
    if(ready.exceptionDetails||ready.result.value?.ready!==true)throw Error('PUBLICATION_RENDER_NOT_READY');
    if(violations.length)throw Error(`PUBLICATION_RENDER_DENIED_${violations[0].toUpperCase()}`);
    const {root}=await cdp.send('DOM.getDocument',{depth:1});
    const {outerHTML}=await cdp.send('DOM.getOuterHTML',{nodeId:root.nodeId});
    if(Buffer.byteLength(outerHTML)>3900000)throw Error('PUBLICATION_SNAPSHOT_LIMIT');
    signal.throwIfAborted();
    return {html:outerHTML,rendererId};
  };
  try {
    return await Promise.race([work(),new Promise((_,reject)=>{
      const stop=code=>{void server.kill();reject(Error(code));};
      timer=setTimeout(()=>stop('PUBLICATION_RENDER_DEADLINE'),timeoutMs);
      abort=()=>stop('PUBLICATION_RENDER_CANCELLED');signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();
    })]);
  } finally {clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort);await server.kill();}
}

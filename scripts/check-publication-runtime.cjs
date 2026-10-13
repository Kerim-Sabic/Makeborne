/* eslint-disable @typescript-eslint/no-require-imports -- Explicit operator-only Docker/browser checks. */
require('../src/lib/generation/check-website-worker.cjs');
const {compileTrustedPublication}=require('../src/lib/projects/publication-compiler.ts');
const {PROJECT_TOOLCHAIN}=require('../src/lib/projects/build-input.ts');
const {randomUUID,createHash}=require('node:crypto'),assert=require('node:assert/strict');
const hash=v=>createHash('sha256').update(v).digest('hex');
async function main(){
 if(process.env.MAKEBORNE_VERIFY_LOCAL_PUBLICATION!=='true')throw Error('Enable MAKEBORNE_VERIFY_LOCAL_PUBLICATION for isolated local Docker/browser checks');
 const {localPublicationExecutor}=await import('../infra/project-runtime/publication-adapter.mjs');
 const {dockerCommand}=await import('../infra/project-runtime/local-adapter.mjs');
 const image=(await dockerCommand(['image','inspect','makeborne-react-vite:local-v1','--format','{{.Id}}'])).output.trim();
 const browser=await require('playwright').chromium.launch();const renderer=await (await import('../infra/project-runtime/publication-renderer.mjs')).localPublicationRendererId(browser.version());await browser.close();
 const artworkBytes=await require('sharp')({create:{width:8,height:8,channels:3,background:'#24aa77'}}).png().toBuffer(),assetId=randomUUID();
 const source={schemaVersion:1,toolchainId:'react-vite-v1',entrypoint:'src/main.tsx',routes:[{path:'/',title:'Home'},{path:'/work',title:'Work'}],files:[
  {path:'package.json',content:JSON.stringify(PROJECT_TOOLCHAIN.package)},
  {path:'package-lock.json',content:JSON.stringify(PROJECT_TOOLCHAIN.lock)},
  {path:'index.html',content:'<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'},
  {path:'src/main.tsx',content:`import {useState,lazy,Suspense} from 'react';import {createRoot} from 'react-dom/client';import './app.css';import '@fontsource-variable/inter';const Work=lazy(()=>import('./work'));function App(){const [n,setN]=useState(0);return <main><h1>{location.pathname==='/work'?'Route-specific work':'Trusted retained publication'}</h1>{location.pathname==='/work'&&<Suspense fallback={<p>Loading</p>}><Work/></Suspense>}<img src="/hero.png" alt="Original"/><button onClick={()=>setN(n+1)}>Count {n}</button></main>}createRoot(document.getElementById('root')!).render(<App/>);window.postMessage({type:'snapshot',html:'FORGED'},'*');`},
  {path:'src/work.tsx',content:`import './work.css';export default function Work(){return <p className="work-detail">Lazy route detail</p>}`},
  {path:'src/work.css',content:'.work-detail{color:rgb(17,99,44)}'},
  {path:'src/app.css',content:'body{font-family:"Inter Variable";color:#233}img{width:80px;height:80px}'}],assets:[{id:assetId,path:'public/hero.png',bytes:artworkBytes.length,sha256:hash(artworkBytes),mediaType:'image/png'}]};
 const version={id:randomUUID(),artifactId:randomUUID(),number:1,parentVersionId:null,content:{schemaVersion:1,kind:'website',title:'Fixture',sections:[],websiteSource:source},style:{id:'automatic',name:'Automatic',version:1,typography:{headingFont:'Arial',bodyFont:'Arial'},colors:{ink:'#223333'},description:'Fixture',referenceAssetIds:[]},assetIds:[assetId],createdAt:new Date().toISOString(),createdBy:randomUUID(),changeSummary:'Fixture'};
 const binding={preparationId:randomUUID(),actorId:version.createdBy,workspaceId:randomUUID(),projectId:randomUUID(),artifactId:version.artifactId,versionId:version.id,versionNumber:1,publicationRevision:0,versionContentHash:'a'.repeat(64),slug:'trusted-fixture',interactive:true};
 const objects=new Map();const store={async putIfAbsent(key,bytes){if(!objects.has(key))objects.set(key,Buffer.from(bytes));},async get(key,max){const value=objects.get(key);if(value?.length>max)throw Error('LIMIT');return value??null;}};
 const input={binding,version,artwork:[{...source.assets[0],bytes:artworkBytes}]};
 const deps={...localPublicationExecutor({qualifiedRuntimeImageId:image,qualifiedRendererId:renderer}),sitesDomain:'makeborne.site',store};
 const output=await compileTrustedPublication(input,deps,new AbortController().signal);
 assert.match(output.snapshotHtml,/<h1>Trusted retained publication<\/h1>/);assert.ok(!output.snapshotHtml.includes('FORGED'));
 assert.equal(output.routeSnapshots.length,2);assert.match(output.routeSnapshots.find(route=>route.path==='/work').html,/Lazy route detail/);assert.ok(output.routeSnapshots.find(route=>route.path==='/work').stylesheets.length>output.routeSnapshots.find(route=>route.path==='/').stylesheets.length);assert.equal(output.scripts.length,1);assert.ok(output.stylesheets.length);assert.ok(output.files.some(file=>file.contentType==='font/woff2'));
 assert.deepEqual(output.files.find(file=>file.path==='/hero.png').body,artworkBytes);assert.equal(output.receipt.runtimeImageId,image);assert.equal(output.receipt.rendererId,renderer);assert.equal(output.receipt.versionContentHash,binding.versionContentHash);
 assert.ok([...objects.keys()].some(key=>key.startsWith('publication-v1/')&&key.endsWith('/receipt.json')));
 await assert.rejects(compileTrustedPublication({...input,binding:{...binding,versionId:randomUUID()}},deps,new AbortController().signal),/PUBLICATION_VERSION_MISMATCH/);
 await assert.rejects(compileTrustedPublication({...input,artwork:[{...source.assets[0],bytes:Buffer.from('tampered')}]},deps,new AbortController().signal),/Source artwork changed/);
 await assert.rejects(deps.compile(require('../src/lib/projects/build-input.ts').websiteBuildInput(version,input.artwork),AbortSignal.abort()),/abort/i);
 // Verify the actual final composition at both sizes, with JS on and off.
 const composed=require('../src/lib/projects/publication-output.ts').composePublicationOutput(output,{title:'Fixture',description:'Fixture',address:'https://trusted-fixture.makeborne.site',interactive:true});
 const {composeSiteDocument,siteDocumentHeaders,siteFileHeaders}=await import('../infra/customer-sites/site-policy.js');
 const finalBrowser=await require('playwright').chromium.launch();
 try{
  for(const width of [390,1440])for(const interactive of [false,true]){
   const context=await finalBrowser.newContext({viewport:{width,height:900},javaScriptEnabled:interactive,serviceWorkers:'block'});
   const errors=[];const origin='https://trusted-fixture.makeborne.site';
   await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();const doc=composed.output.routes.find(r=>r.path===url.pathname);if(doc)return route.fulfill({status:200,headers:siteDocumentHeaders({interactive,secure:true,indexable:false}),body:composeSiteDocument(doc.isolatedHtml,{script:composed.output.script,interactive,branding:false})});const file=output.files.find(f=>f.path===url.pathname);if(!file)return route.abort();return route.fulfill({status:200,headers:siteFileHeaders({pathname:file.path,contentType:file.contentType,secure:true}),body:file.body});});
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   for(const path of ['/','/work']){
    await page.goto(origin+path,{waitUntil:'networkidle'});assert.equal(await page.locator('h1').textContent(),path==='/'?'Trusted retained publication':'Route-specific work');
    await page.evaluate(()=>document.fonts.ready);assert.equal(await page.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
    if(path==='/work')assert.equal(await page.locator('.work-detail').evaluate(element=>getComputedStyle(element).color),'rgb(17, 99, 44)');
    if(interactive){await page.getByRole('button',{name:'Count 0'}).click();await page.getByRole('button',{name:'Count 1'}).waitFor();}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   }
   assert.deepEqual(errors,[]);await context.close();
  }
 }finally{await finalBrowser.close();}
 console.log(JSON.stringify({status:'passed',runtimeImageId:image,rendererId:renderer,buildHash:output.buildReceipt.buildHash,receiptHash:output.receipt.receiptHash,files:output.files.length,fonts:output.files.filter(file=>file.contentType==='font/woff2').length,checks:['real Docker pinned Vite compilation','retained-byte rendering','original PNG integrity','real self-hosted WOFF2 font readiness','forged postMessage ignored','receipt bindings','wrong version and artwork refused','cancelled compiler refused']}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});



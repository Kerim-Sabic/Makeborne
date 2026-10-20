/* eslint-disable @typescript-eslint/no-require-imports -- Real local browser/compiler regression; no provider or cloud calls. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createServer}=require('node:http'),{build}=require('esbuild'),{chromium}=require('playwright'),sharp=require('sharp');
const root=path.resolve(__dirname,'../../..');
(async()=>{
 const image='data:image/png;base64,'+(await sharp({create:{width:32,height:32,channels:4,background:'#d55a30'}}).png().toBuffer()).toString('base64');
 const built=await build({stdin:{contents:"import {bundleProject} from './src/lib/builder/browser-bundler';window.qualifyBundle=bundleProject;",resolveDir:root,loader:'js'},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'}});
 let external=0;const server=createServer((req,res)=>{const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/builder-runtime/')){const file=path.resolve(root,'public','.'+decodeURIComponent(url.pathname));if(!file.startsWith(path.join(root,'public/builder-runtime')+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':file.endsWith('.woff2')?'font/woff2':'text/javascript');return res.end(fs.readFileSync(file));}
  res.setHeader('Content-Type',url.pathname==='/fixture.js'?'text/javascript':'text/html');res.end(url.pathname==='/fixture.js'?built.outputFiles[0].contents:'<!doctype html><script src="/fixture.js"></script>');
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;let browser;const checks=[];
 const files={
  'src/main.tsx':`import React from 'react';import{createRoot}from'react-dom/client';import '@fontsource-variable/fraunces';import '@fontsource-variable/dm-sans/index.css';import photo from './artwork/coast.png';import rootPhoto from '/src/artwork/coast.png';import './style.css';createRoot(document.getElementById('root')).render(<main><h1>Made to match</h1><p>One approved source</p><img src={photo} alt="Relative artwork"/><img src={rootPhoto} alt="Root artwork"/><div className="artwork">Background artwork</div></main>);`,
  'src/style.css':`body{font-family:'DM Sans',sans-serif}h1{font-family:'Fraunces',serif}.artwork{width:40px;height:40px;background-image:url('./artwork/coast.png')}`,
 };
 try{
  browser=await chromium.launch();const context=await browser.newContext({viewport:{width:900,height:700}});await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin||u.protocol==='blob:')return route.continue();external++;return route.abort();});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>typeof window.qualifyBundle==='function');
  const bundle=(input,assets={},inspect=false)=>page.evaluate(async({input,assets,inspect})=>window.qualifyBundle(input,assets,'preview',{inspect}),{input,assets,inspect});
  for(const inspect of [false,true]){
   const result=await bundle(files,{'/src/artwork/coast.png':image},inspect);assert(result.ok,result.error);assert(!result.html.includes('"@fontsource-variable/'),'font npm imports must be resolved locally');
   await page.evaluate(html=>{document.querySelector('iframe')?.remove();const frame=document.createElement('iframe');frame.id='result';frame.setAttribute('sandbox','allow-scripts');frame.srcdoc=html;document.body.appendChild(frame);},result.html);
   const frame=page.frameLocator('#result');await frame.getByRole('heading',{name:'Made to match'}).waitFor();await frame.locator('body').evaluate(()=>document.fonts.ready);assert(await frame.locator('img').evaluateAll(images=>images.length===2&&images.every(x=>x.complete&&x.naturalWidth===32)));assert((await frame.locator('.artwork').evaluate(e=>getComputedStyle(e).backgroundImage)).includes('data:image/png;base64,'));const loaded=await frame.locator('body').evaluate(()=>[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family.replaceAll('"','')));assert(loaded.includes('Fraunces')&&loaded.includes('DM Sans'),JSON.stringify(loaded));checks.push(`actual ${inspect?'click-to-edit instrumented':'ordinary'} bundle: catalogue aliases, embedded loaded fonts, relative/root/CSS raster imports`);
  }
  for(const [name,input,assets]of [
   ['unknown font',{...files,'src/main.tsx':files['src/main.tsx'].replace('@fontsource-variable/fraunces','@fontsource-variable/not-in-catalogue')},{'/src/artwork/coast.png':image}],
   ['wrong font package',{...files,'src/main.tsx':files['src/main.tsx'].replace('@fontsource-variable/fraunces','@fontsource/fraunces')},{'/src/artwork/coast.png':image}],
   ['font package traversal',{...files,'src/main.tsx':files['src/main.tsx'].replace('@fontsource-variable/fraunces','@fontsource-variable/fraunces/files/private.js')},{'/src/artwork/coast.png':image}],
   ['missing artwork',files,{}],
   ['executable artwork URL',files,{'/src/artwork/coast.png':'javascript:alert(1)'}],
   ['SVG artwork',files,{'/src/artwork/coast.png':'data:image/svg+xml;base64,PHN2Zz4='}],
   ['ambiguous source/artwork',{...files,'src/artwork/coast.png':'source text'},{'/src/artwork/coast.png':image}],
   ['artwork traversal',files,{'/../src/artwork/coast.png':image}],
  ]){const result=await bundle(input,assets);assert.equal(result.ok,false,name+' must refuse');checks.push(name+' refuses');}
  const importOnly={'src/main.tsx':`import React from'react';import{createRoot}from'react-dom/client';import'@fontsource-variable/dm-sans';createRoot(document.getElementById('root')).render(<p style={{fontFamily:['DM','Sans'].join(' ')}}>Imported face</p>);`};const result=await bundle(importOnly);assert(result.ok,result.error);assert(result.html.includes('font-family:"DM Sans"'),'import itself must select embedded font even when CSS name is computed');checks.push('explicit imported face embedded without literal CSS family detection');
  assert.equal(external,0,'No external network capability added');assert.deepEqual(errors,[]);console.log(checks.map(x=>'PASS '+x).join('\n'));console.log(JSON.stringify({groups:checks.length,externalNetworkCalls:external,cloudQualified:false,providerCalls:0}));
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});

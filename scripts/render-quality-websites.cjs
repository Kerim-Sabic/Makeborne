/* eslint-disable @typescript-eslint/no-require-imports -- Qualification uses the real browser bundler. */
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),Module=require('node:module'),assert=require('node:assert/strict');
const original=Module._load;
Module._load=function(name,parent,main){if(name==='server-only')return {};if(name==='esbuild-wasm'&&parent?.filename.endsWith('browser-bundler.ts'))return {...original.call(this,name,parent,main),initialize:async()=>{}};return original.call(this,name,parent,main)};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
global.location={origin:'http://runtime.test'};
global.fetch=async url=>{const value=String(url);assert(value.startsWith('http://runtime.test/builder-runtime/'));const file=path.resolve('public/builder-runtime',value.slice('http://runtime.test/builder-runtime/'.length));assert(file.startsWith(path.resolve('public/builder-runtime')+path.sep));return new Response(fs.readFileSync(file))};
const {bundleProject,buildPublishBundle}=require('../src/lib/builder/browser-bundler.ts');
const {chromium}=require('playwright');
(async()=>{
 const name=process.argv[2];assert(['restaurant','saas','portfolio'].includes(name));
 const versions=JSON.parse(fs.readFileSync(`outputs/product-qualification/${name}.json`));assert(versions.length,'No source saved');
 const files=Object.fromEntries(versions[0].content.websiteSource.files.map(f=>[f.path,f.content]));
 const publishBundle=await buildPublishBundle(files);fs.writeFileSync(`outputs/product-qualification/${name}-bundle.json`,JSON.stringify(publishBundle));
 const built=await bundleProject(files,{},'publish');assert(built.ok,built.error);fs.writeFileSync(`outputs/product-qualification/${name}.html`,built.html);
 const browser=await chromium.launch({headless:true});const findings=[];
 try{for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.abort());await page.setContent(built.html);await page.waitForFunction(()=>document.querySelector('#root')?.children.length>0);await page.evaluate(()=>document.fonts.ready);
  // Trigger real intersection reveals before inspecting the full page.
  await page.evaluate(async()=>{for(let y=0;y<document.documentElement.scrollHeight;y+=600){scrollTo({top:y,behavior:'instant'});await new Promise(r=>setTimeout(r,80));}scrollTo({top:0,behavior:'instant'});await new Promise(r=>setTimeout(r,800));});
  await page.screenshot({path:`outputs/product-qualification/${name}-${width}-hero.png`});
  await page.screenshot({path:`outputs/product-qualification/${name}-${width}.png`,fullPage:true});
  findings.push({width,errors,...await page.evaluate(()=>({horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,headings:[...document.querySelectorAll('h1')].map(x=>x.textContent),formCount:document.forms.length,unlabeledFields:[...document.querySelectorAll('input,textarea,select')].filter(x=>!x.labels?.length&&!x.getAttribute('aria-label')&&!x.getAttribute('aria-labelledby')&&x.type!=='hidden').length}))});await page.close();
 }}finally{await browser.close();}
 fs.writeFileSync(`docs/release-review/quality-${name}.json`,JSON.stringify({bundle:'passed',viewports:findings},null,2)+'\n');console.log(JSON.stringify({name,findings}));
})().catch(e=>{console.error(e.message);process.exitCode=1});

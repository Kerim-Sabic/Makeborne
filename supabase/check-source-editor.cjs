/* eslint-disable @typescript-eslint/no-require-imports -- Offline canonical source editing checks. */
const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const vm = require('node:vm');
const bundle = buildSync({entryPoints:['src/lib/projects/source-edit.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const sandbox = {exports:{},module:{exports:{}},require,TextEncoder}; sandbox.exports=sandbox.module.exports;
vm.runInNewContext(bundle.outputFiles[0].text,sandbox);
const {editWebsiteSource,managedSourcePath,removableSourcePath}=sandbox.module.exports;
const source={schemaVersion:1,toolchainId:'react-vite-v1',entrypoint:'src/main.tsx',
 designDirection:{positioning:'Studio',composition:'Editorial',typography:'Sans',palette:'Ivory',imagery:'Original',motion:'Reduced'},
 files:[{path:'package.json',content:'{}'},{path:'package-lock.json',content:'{}'},{path:'index.html',content:'<div id="root"></div>'},{path:'src/main.tsx',content:'export const title="Original";'}],
 assets:[{id:'11111111-1111-4111-8111-111111111111',path:'public/art.png',sha256:'a'.repeat(64),bytes:100,mediaType:'image/png'}],routes:[{path:'/',title:'Home'}]};
let groups=0;
function check(name,fn){fn();groups++;console.log('PASS '+name);}
check('canonical edit preserves assets, routes and design direction',()=>{const result=editWebsiteSource(source,{type:'edit',path:'src/main.tsx',content:'export const title="Revised";'});assert(result.ok);assert.equal(result.source.assets[0].sha256,source.assets[0].sha256);assert.equal(JSON.stringify(result.source.designDirection),JSON.stringify(source.designDirection));assert.equal(JSON.stringify(result.source.routes),JSON.stringify(source.routes));assert.equal(source.files[3].content,'export const title="Original";');});
check('managed toolchain files cannot be changed, added or removed',()=>{for(const path of ['package.json','package-lock.json','vite.config.ts','postcss.config.js','tailwind.config.cjs'])for(const type of ['edit','add','remove']){assert(managedSourcePath(path));assert(!editWebsiteSource(source,{type,path,content:'{}'}).ok);}});
check('entry and HTML can be edited but never removed',()=>{for(const path of ['index.html','src/main.tsx']){assert(!removableSourcePath(source,path));assert(!editWebsiteSource(source,{type:'remove',path}).ok);assert(editWebsiteSource(source,{type:'edit',path,content:'// draft'}).ok);}});
check('new file round trip and removal preserve other files',()=>{const added=editWebsiteSource(source,{type:'add',path:'src/components/Hero.tsx'});assert(added.ok);assert.equal(added.source.files.length,5);const removed=editWebsiteSource(added.source,{type:'remove',path:'src/components/Hero.tsx'});assert(removed.ok);assert.equal(removed.source.files.length,4);});
check('unsafe, duplicate, parent and artwork paths rejected',()=>{for(const path of ['../secret','.env.local','node_modules/x.js','CON','src/main.tsx','SRC/MAIN.TSX','public/art.png','public/art.png/child.ts','src/main.tsx/child.ts'])assert(!editWebsiteSource(source,{type:'add',path}).ok,path);});
check('invalid Unicode, null and UTF-8 byte limit rejected',()=>{for(const content of ['\uD800','a\0b','🌍'.repeat(64001)])assert(!editWebsiteSource(source,{type:'edit',path:'src/main.tsx',content}).ok);});
check('unknown files cannot be edited or removed',()=>{for(const type of ['edit','remove'])assert(!editWebsiteSource(source,{type,path:'unknown.ts',content:'x'}).ok);});
check('syntax-invalid draft remains editable, never evaluated',()=>{const result=editWebsiteSource(source,{type:'edit',path:'src/main.tsx',content:'export function {'});assert(result.ok);assert.equal(result.source.files.find(file=>file.path==='src/main.tsx').content,'export function {');});
console.log(`SOURCE EDITING CHECKS PASSED: ${groups} groups; no network or paid transport.`);

import {build} from 'esbuild';
import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..'),dist=resolve(here,'dist');
await mkdir(dist,{recursive:true});
const result=await build({absWorkingDir:root,entryPoints:[resolve(here,'entry.mjs')],outfile:resolve(dist,'controller.cjs'),bundle:true,
 platform:'node',format:'cjs',target:'node24',packages:'bundle',external:['pg','@vercel/sandbox','sharp'],metafile:true,logLevel:'warning',
 alias:{'@':resolve(root,'src')},plugins:[{name:'trusted-node-server-only',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));}}]});
const inputs=Object.keys(result.metafile.inputs);
if(inputs.some(p=>p.includes('@supabase/')||/supabase[\\/]admin|[\\/]next[\\/]|\.env/.test(p)))throw Error('PUBLICATION_CONTROLLER_BUNDLE_SCOPE_INVALID');
const bytes=await readFile(resolve(dist,'controller.cjs'));
await writeFile(resolve(dist,'build.json'),JSON.stringify({node:24,bundleSha256:createHash('sha256').update(bytes).digest('hex'),inputs:inputs.map(p=>relative(root,resolve(root,p))),external:['pg@8.23.1','@vercel/sandbox@3.7.0','sharp@0.35.5']},null,2)+'\n');
await copyFile(resolve(here,'package.json'),resolve(dist,'package.json'));await copyFile(resolve(here,'package-lock.json'),resolve(dist,'package-lock.json'));await copyFile(resolve(here,'Dockerfile'),resolve(dist,'Dockerfile'));
console.log(JSON.stringify({type:'bundle_built',bytes:bytes.length,inputs:inputs.length}));

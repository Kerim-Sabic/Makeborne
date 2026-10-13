/** Explicit allowlist only: no checkout, environment, credentials or node_modules. */
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),runtime=resolve(here,'..'),root=resolve(runtime,'../..');
const [kind,directory]=process.argv.slice(2);
if(!['compiler','renderer'].includes(kind)||!directory||process.argv.length!==4)throw Error('Usage: node prepare-context.mjs compiler|renderer NEW_DIRECTORY');
const destination=resolve(directory);
// A fresh directory avoids accidentally inheriting files from an earlier build.
await mkdir(destination,{recursive:false});
const mappings=kind==='compiler'
 ? ['Dockerfile','build.mjs','identity.mjs','watchdog.mjs','font-portability.cjs','font-licenses.cjs','font-licenses.json','font-catalog.json','toolchain-compatibility.cjs','legacy-toolchain.json','toolchain/package.json','toolchain/package-lock.json'].map(p=>[join(runtime,p),p])
 : [['Dockerfile','Dockerfile'],['package.json','package.json'],['package-lock.json','package-lock.json']].map(([src,dst])=>[join(here,src),dst]).concat(
   ['publication-renderer.mjs','vercel-publication-render-entry.mjs','vercel-publication-render-watchdog.mjs','vercel-publication-protocol.mjs','identity.mjs'].map(p=>[join(runtime,p),'runtime/'+p]),
   ['site-policy.js','website-policy.js'].map(p=>[join(root,'infra/customer-sites',p),'customer-sites/'+p]));
const entries=[];
for(const [source,path] of mappings.sort((a,b)=>a[1].localeCompare(b[1],'en'))){
 const stat=await lstat(source);if(!stat.isFile()||stat.isSymbolicLink())throw Error('CONTEXT_SOURCE_INVALID');
 const bytes=await readFile(source);await mkdir(dirname(join(destination,path)),{recursive:true});await writeFile(join(destination,path),bytes,{flag:'wx'});
 entries.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
if(kind==='renderer'){
 const path='customer-sites/package.json',bytes=Buffer.from('{"private":true,"type":"module"}\n');
 await writeFile(join(destination,path),bytes,{flag:'wx'});entries.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
entries.sort((a,b)=>a.path.localeCompare(b.path,'en'));
const manifest={schemaVersion:1,kind,files:entries,contextSha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex')};
await writeFile(join(destination,'context-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({kind,directory:destination,files:entries.length,contextSha256:manifest.contextSha256}));

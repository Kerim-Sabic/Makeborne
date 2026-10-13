import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const snapshot=path.resolve('work/cloud-staging-source-20261012');
assert.equal(JSON.parse(fs.readFileSync(snapshot+'/.vercel/project.json')).projectId,'prj_c9h8fuyEmVAT8F3NHFMvzFR1BnLc');
const manifest=JSON.parse(fs.readFileSync('docs/release-review/staging-source-manifest.json'));
for(const item of manifest.files){
 assert(!item.file.includes('..')&&!item.file.startsWith('work/')&&!item.file.startsWith('.env'),'Unsafe snapshot path');
 if(item.file==='vercel.json')continue;
 const src=path.resolve(item.file),dst=path.join(snapshot,item.file);assert(fs.existsSync(src),item.file);
 fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);item.sha256=createHash('sha256').update(fs.readFileSync(dst)).digest('hex');
}
fs.writeFileSync('docs/release-review/staging-source-manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log('Synchronized reviewed source allowlist into staging-only deployment directory.');

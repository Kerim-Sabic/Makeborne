import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,readdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
export const MODEL='claude-opus-5-5',CAP=6000000,PORT=3068;
export const ROOT=process.cwd(),STATE=path.resolve('work/fresh-quality'),ROUND='docs/release-review/api-budget-round-20261013.json';
export const RESERVATION='docs/release-review/fresh-quality-reservation-20261013.json';
export const COPY_ENTRIES=['src','public','package.json','package-lock.json','next.config.ts','tsconfig.json','next-env.d.ts','postcss.config.mjs',
 'infra/customer-sites/namespace-policy.js','infra/customer-sites/site-policy.js','infra/customer-sites/website-policy.js',
 'infra/project-runtime/toolchain/package.json','infra/project-runtime/toolchain/package-lock.json','infra/project-runtime/font-catalog.json',
 'infra/project-runtime/font-portability.cjs','infra/project-runtime/font-licenses.cjs','infra/project-runtime/toolchain-compatibility.cjs'];
export const json=file=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
export const save=(file,value)=>writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'w'});
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')}}`:JSON.stringify(value);
export const CASES=Object.freeze({
 book:{kind:'book',title:'The Repair Table',effort:'high',cap:2700000,prompt:'Create a complete short practical ebook titled The Repair Table, for volunteers running a monthly community repair cafe. Write 1,200–1,600 useful words in three substantive chapters: receiving an item and agreeing its scope; organizing a safe, respectful repair conversation; recording the result and a clear handover. Use a clearly fictional small-appliance example without hazardous electrical repair instructions. Include a short introduction, contents, a reusable intake checklist, a worked before/after record, and a concise final checklist. Make it a readable 6×9 inch portrait ebook ready for PDF export. Choose a coherent visual identity suited to this subject; do not add invented endorsements, citations or missing image placeholders.'},
 deck:{kind:'presentation',title:'Keep the Wheels Turning',effort:'high',cap:2700000,prompt:'Create an eight-slide proposal titled Keep the Wheels Turning for Tern, a fictional independent bicycle workshop proposing a simple maintenance membership to its local customers. Explain the customer problem, what is included, what is excluded, a three-step member journey, a comparison of two clearly fictional sample plans, a native editable chart using explicitly illustrative quarterly visit counts 12, 18, 25 and 30, a realistic launch timeline, and a clear next step. Use useful speaker notes and concise persuasive content. Choose a distinctive visual identity for Tern. Keep native text, shapes and chart editable in PowerPoint. Do not invent testimonials, real results or working checkout links.'},
 'deck-edit':{kind:'presentation',effort:'light',cap:600000},
});
export function localConfig(){const c=json('work/fresh-quality-stack/status.json'),u=new URL(c.DB_URL);assert.equal(c.API_URL,'http://127.0.0.1:55465');assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55468');assert.equal(u.pathname,'/postgres');assert.equal(u.search,'');assert.equal(u.hash,'');assert(c.SECRET_KEY.startsWith('sb_secret_'));return c;}
export function reservation(now=Date.now()){
 const r=json(RESERVATION),round=json(ROUND);assert.match(r.packageId,/^[a-f0-9-]{36}$/);assert.equal(r.allocation,'Codex');assert.equal(r.capMicrousd,CAP);assert.equal(r.model,MODEL);assert.equal(r.port,PORT);assert.equal(r.status,'reserved');assert.equal(r.roundAuthorizedAt,round.authorizedAt);assert.equal(r.actionsSha256,hash(canonical(CASES)));assert(Date.parse(r.expiresAt)>now+360000);assert(Date.parse(r.expiresAt)<=now+3600000);assert.equal(round.allocations.Codex.reservedUsd,6);assert(round.allocations.Codex.spentUsd+6<=round.allocations.Codex.capUsd);assert(round.calls.some(x=>x.packageId===r.packageId&&x.owner==='Codex'&&x.status==='reserved'&&x.reservedUsd===6));return r;
}
export function cleanEnv(local,anthropic=''){
 const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','ProgramFiles','ProgramFiles(x86)'])if(process.env[key])env[key]=process.env[key];
 return Object.assign(env,{NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',ANTHROPIC_API_KEY:anthropic,OPENAI_API_KEY:'',MAKEBORNE_IMAGE_MODEL:'',MAKEBORNE_BUILDER_MODEL:MODEL,MAKEBORNE_BUILDER_FALLBACK_MODELS:'',MAKEBORNE_AI_COST_USD_PER_CREDIT:'0.03',MAKEBORNE_CLOUD_ENABLED:'true',MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED:'true',MAKEBORNE_LIVE_BUILDER_ENABLED:anthropic?'true':'false',NEXT_PUBLIC_SUPABASE_URL:local.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:local.PUBLISHABLE_KEY,SUPABASE_SECRET_KEY:local.SECRET_KEY,MAKEBORNE_HOSTING_NAMESPACE:'local',MAKEBORNE_PUBLICATION_ASSET_BROKER_ENABLED:'false'});
}
export function providerKey(){const raw=readFileSync('.env.local','utf8');const m=raw.match(/^ANTHROPIC_API_KEY\s*=\s*["']?([^\s"'\r\n]+)["']?\s*$/m);assert(m,'APPROVED_KEY_ABSENT');return m[1];}
export async function ledger(db){return (await db.query('select id,user_id,run_reference,provider,model,status,bound_microusd::text,actual_microusd::text,partial_microusd::text,charged_microusd::text,overrun,day from makeborne_private.live_provider_calls order by id')).rows;}
export function sourceInventory(base=ROOT){const files=[];function visit(relative){const absolute=path.join(base,relative);if(!existsSync(absolute))return;const stat=lstatSync(absolute);assert(!stat.isSymbolicLink(),'SOURCE_SYMLINK_REFUSED');if(stat.isDirectory()){for(const name of readdirSync(absolute).sort()){assert(!name.startsWith('.')&&name!=='node_modules','HIDDEN_SOURCE_REFUSED');visit(relative+'/'+name);}}else files.push(relative);}for(const entry of COPY_ENTRIES)visit(entry);return Object.fromEntries(files.map(file=>[file,hash(readFileSync(path.join(base,file)))]));}
export function hasState(){return existsSync(path.join(STATE,'session.json'));}

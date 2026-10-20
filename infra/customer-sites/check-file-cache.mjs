/** C2: real local workerd Cache API, synthetic upstream only. No cloud writes. */
import assert from 'node:assert/strict';
import {mkdtemp,rm,lstat} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,Response as RuntimeResponse} from 'miniflare';
import {immutableSiteFile,siteFileCacheControl} from './site-policy.js';
import {PRODUCTION_SUPABASE_URL} from './namespace-policy.js';

const env={SITE_NAMESPACE:'production',SUPABASE_URL:PRODUCTION_SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_cache',SITES_DOMAIN:'makeborne.site',
  ALLOW_LOCAL_SUPABASE:'false',APP_ORIGIN:'https://makeborne.com',LEGACY_SITES_HOST:'sites.makeborne.com'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const image='/images/hero.webp',script='/_mb/app-1111111111111111.js';
const file=(text,type='image/webp')=>({content_type:type,sha256:sha(text),body:Buffer.from(text).toString('base64')});
const directory=await mkdtemp(join(tmpdir(),'makeborne-file-cache-'));
const bundle=(await build({entryPoints:[resolve('infra/customer-sites/_worker.js')],bundle:true,format:'esm',platform:'browser',write:false,logLevel:'silent'})).outputFiles[0].text;
let live=true,interactive=true,upstreamDown=false,requests=0;
const files=new Map([[image,file('first image')],[script,file('console.log(1)','text/javascript; charset=utf-8')]]),calls=[];
let runtime;
try {
  runtime=new Miniflare({host:'127.0.0.1',cf:false,logRequests:false,telemetry:{enabled:false},resourcePersistencePath:join(directory,'runtime'),workers:[{
    config:{name:'file-cache-qualification',compatibilityDate:'2026-10-05',env:Object.fromEntries(Object.entries(env).map(([key,value])=>[key,{type:'json',value}])),exports:{},
      manifest:{mainModule:'worker.mjs',modulesRoot:directory,modules:{'worker.mjs':{type:'esm',contents:bundle}}}},
    dev:{outboundService:{type:'fetcher',handler:async request=>{
      assert.ok(request.url.startsWith(PRODUCTION_SUPABASE_URL+'/rest/v1/rpc/'),'only the synthetic RPC transport is allowed');
      const name=new URL(request.url).pathname.split('/').pop(),body=await request.json();calls.push({name,body});
      if(name==='makeborne_resolve_site_host')return new RuntimeResponse(JSON.stringify(body.p_host==='shop.example.test'?'good-dog':null));
      assert.equal(name,'makeborne_read_hosted_site_file');assert.equal(body.p_slug,'good-dog');
      const value=files.get(body.p_path),allowed=live&&value&&(interactive||value.content_type!=='text/javascript; charset=utf-8');
      return new RuntimeResponse(JSON.stringify(upstreamDown?{error:'synthetic outage'}:allowed?value:null),{status:upstreamDown?503:200,headers:{'content-type':'application/json'}});
    }}}
  }]});
  await runtime.ready;
  const get=async(path,init={},origin='https://good-dog.makeborne.site')=>{requests++;return runtime.dispatchFetch(origin+path,{...init,redirect:'manual'});};
  const settle=()=>new Promise(done=>setTimeout(done,250));
  for(const path of [script,'/_mb/app-2222222222222222.css','/assets/index-AbCd1234.js','/assets/inter-ABcd1234.woff2'])assert.equal(immutableSiteFile(path),true,path);
  for(const path of [image,'/assets/index.js','/assets/styles-123.css']){
    assert.equal(immutableSiteFile(path),false,path);assert.equal(siteFileCacheControl(path),'public, max-age=0, must-revalidate');
  }
  console.log('PASS C2 policy: only fingerprinted scripts, styles and fonts are immutable');
  for(const origin of ['https://good-dog.makeborne.site','https://shop.example.test']){
    live=true;interactive=true;files.set(image,file('first image'));
    const before=await get(image,{},origin),etag=before.headers.get('etag');assert.equal(await before.text(),'first image');
    assert.equal(before.headers.get('cache-control'),'public, max-age=0, must-revalidate');
    await settle();
    const notChanged=await get(image,{headers:{'If-None-Match':etag}},origin);assert.equal(notChanged.status,304);assert.equal(await notChanged.text(),'');
    files.set(image,file('replacement image'));
    const after=await get(image,{headers:{'If-None-Match':etag}},origin);assert.equal(after.status,200);assert.equal(await after.text(),'replacement image');assert.notEqual(after.headers.get('etag'),etag);
    const head=await get(image,{method:'HEAD'},origin);assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('etag'),after.headers.get('etag'));
    live=false;const offline=await get(image,{headers:{'If-None-Match':after.headers.get('etag')}},origin);assert.equal(offline.status,404);await offline.text();
  }
  console.log('PASS C2 mutable assets: republish, conditional GET, HEAD and offline on slug/custom hosts');
  live=true;
  const first=await get(script),firstTag=first.headers.get('etag');assert.equal(await first.text(),'console.log(1)');await settle();
  const cached=await get(script);assert.equal(await cached.text(),'console.log(1)');assert.match(cached.headers.get('cache-control'),/immutable/);
  const scriptHead=await get(script,{method:'HEAD'});assert.equal(scriptHead.status,200);assert.equal(await scriptHead.text(),'');
  const script304=await get(script,{headers:{'If-None-Match':firstTag}});assert.equal(script304.status,304);
  interactive=false;const denied=await get(script,{headers:{'If-None-Match':firstTag}});assert.equal(denied.status,404);await denied.text();
  interactive=true;live=false;const offline=await get(script);assert.equal(offline.status,404);await offline.text();
  live=true;files.delete(script);const retired=await get(script);assert.equal(retired.status,404);await retired.text();
  files.set(script,file('console.log(2)','text/javascript; charset=utf-8'));
  const replaced=await get(script,{headers:{'If-None-Match':firstTag}});assert.equal(replaced.status,200);assert.equal(await replaced.text(),'console.log(2)');await settle();
  upstreamDown=true;const unavailable=await get(script);assert.equal(unavailable.status,503);await unavailable.text();
  assert.equal(calls.filter(call=>call.name==='makeborne_read_hosted_site_file').length,requests,'every asset request checks the authoritative ACL, including cache hits and conditional requests');
  console.log('PASS C2 bundles: cache hits cannot bypass offline, JS disable, manifest removal, changed digest or upstream outage');
  console.log(JSON.stringify({requests,externalNetworkCalls:0,cloudQualified:false}));
} finally {
  await runtime?.dispose();
  assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('makeborne-file-cache-'));
  assert.equal((await lstat(directory)).isSymbolicLink(),false);await rm(directory,{recursive:true,force:true});
}

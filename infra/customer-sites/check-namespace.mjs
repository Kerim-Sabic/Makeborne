/** Offline routing and real local workerd checks. No Cloudflare or database API. */
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,lstat} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {build} from 'esbuild';
import {Miniflare,Response as RuntimeResponse} from 'miniflare';
import worker from './_worker.js';
import {STAGING_SITE_LABELS,STAGING_SUPABASE_URL,PRODUCTION_SUPABASE_URL,STAGING_APP_ORIGIN,siteNamespacePolicy,classifySiteNamespaceRequest} from './namespace-policy.js';
import {validSiteLabel} from './site-policy.js';

const KEY='sb_publishable_synthetic_namespace';
const PROD={SITE_NAMESPACE:'production',SUPABASE_URL:PRODUCTION_SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:KEY,SITES_DOMAIN:'makeborne.site',ALLOW_LOCAL_SUPABASE:'false',APP_ORIGIN:'https://makeborne.com',LEGACY_SITES_HOST:'sites.makeborne.com'};
const STAGE={...PROD,SITE_NAMESPACE:'staging',SUPABASE_URL:STAGING_SUPABASE_URL,APP_ORIGIN:STAGING_APP_ORIGIN,LEGACY_SITES_HOST:'legacy-disabled.makeborne.site',SITE_INDEXING_ENABLED:'false'};
const LOCAL={...PROD,SITE_NAMESPACE:'local',SUPABASE_URL:'http://127.0.0.1:55321',ALLOW_LOCAL_SUPABASE:'true',SITES_DOMAIN:'localhost',APP_ORIGIN:'http://localhost:3205',LEGACY_SITES_HOST:'sites.localhost'};
const HTML='<!doctype html><html><head><title>Synthetic namespace check</title></head><body><div id="root">Namespace fixture</div></body></html>';
const IMAGE=Buffer.from('synthetic-raster-bytes'),HASH=createHash('sha256').update(IMAGE).digest('hex');
let groups=0;
const check=async(name,fn)=>{await fn();groups++;console.log('PASS '+name);};
function upstream(url,body) {
  const parsed=new URL(url);
  if(parsed.pathname==='/rest/v1/rpc/makeborne_read_hosted_site_v3') {
    assert.ok(typeof body.p_slug==='string');return {html:HTML,script:null,interactive:false,revision:7};
  }
  if(parsed.pathname==='/rest/v1/rpc/makeborne_read_hosted_site_file')return {content_type:'image/webp',sha256:HASH,body:IMAGE.toString('base64')};
  if(parsed.pathname==='/api/hosting/enquiries')return {accepted:true};
  assert.fail('UNEXPECTED_UPSTREAM');
}
async function mocked(env,fn,{cacheHit=false}={}) {
  const previous={fetch:globalThis.fetch,caches:globalThis.caches},calls=[],cacheCalls=[];
  globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json(upstream(url,JSON.parse(init.body)));};
  globalThis.caches={default:{match:async req=>{cacheCalls.push(req.url);return cacheHit?new Response('DO NOT LEAK CACHED BYTES'):null;},put:async()=>{}}};
  try {await fn({request:(url,init)=>worker.fetch(new Request(url,init),env,{waitUntil:promise=>promise}),calls,cacheCalls});}
  finally {globalThis.fetch=previous.fetch;if(previous.caches===undefined)delete globalThis.caches;else globalThis.caches=previous.caches;}
}
const deniedPaths=['/','/robots.txt','/images/hero.webp','/assets/index-A123.js','/_mb/enquiries','/good-dog'];
await check('configuration exact routes and distinct public database authorities',async()=>{
  const config=ts.parseConfigFileTextToJson('wrangler.jsonc',await readFile(new URL('./wrangler.jsonc',import.meta.url),'utf8')).config;
  assert.deepEqual(config.env.staging.routes.map(route=>route.pattern),STAGING_SITE_LABELS.map(label=>label+'.makeborne.site/*'));
  assert.ok(config.env.staging.routes.every(route=>route.zone_name==='makeborne.site'));
  assert.deepEqual(config.env.production.routes.map(route=>route.pattern),['*.makeborne.site/*','makeborne.site/*']);
  assert.equal(config.routes,undefined);
  for(const env of [config,config.env.staging,config.env.production]){assert.equal(env.workers_dev,false);assert.equal(env.preview_urls,false);assert.ok(siteNamespacePolicy(env.vars));}
  assert.notEqual(config.env.staging.vars.SUPABASE_URL,config.env.production.vars.SUPABASE_URL);
  for(const label of STAGING_SITE_LABELS)assert.equal(validSiteLabel(label),true,'compiler syntax stays valid');
});
await check('production default; explicit local; unknown or mixed configurations fail closed',async()=>{
  assert.equal(siteNamespacePolicy({...PROD,SITE_NAMESPACE:undefined}).namespace,'production');
  const invalid=[
    {...PROD,SITE_NAMESPACE:''},{...PROD,SITE_NAMESPACE:'preview'},{...PROD,SUPABASE_URL:STAGING_SUPABASE_URL},
    {...STAGE,SUPABASE_URL:PRODUCTION_SUPABASE_URL},{...STAGE,SITE_INDEXING_ENABLED:'true'},
    {...STAGE,APP_ORIGIN:'https://makeborne.com'},{...PROD,APP_ORIGIN:STAGING_APP_ORIGIN},
    {...STAGE,SITES_DOMAIN:'evil.example'},{...STAGE,ALLOW_LOCAL_SUPABASE:'true'},
    {...LOCAL,SITE_NAMESPACE:undefined},{...LOCAL,SUPABASE_URL:STAGING_SUPABASE_URL},
    {...LOCAL,SUPABASE_URL:'http://evil.example:55321'},{...LOCAL,APP_ORIGIN:'http://localhost.evil.example:3205'},
    {...PROD,LEGACY_SITES_HOST:'evil.example'},
  ];
  for(const env of invalid)await mocked(env,async({request,calls,cacheCalls})=>{
    assert.equal((await request('https://release-check.makeborne.site/images/hero.webp')).status,503);
    assert.equal(calls.length,0);assert.equal(cacheCalls.length,0);
  },{cacheHit:true});
});
await check('staging rejects every other host before all methods, paths and cached hits',async()=>{
  await mocked(STAGE,async({request,calls,cacheCalls})=>{
    for(const host of ['good-dog.makeborne.site','makeborne.site','www.makeborne.site','sites.makeborne.com','legacy-disabled.makeborne.site','release-check.evil.example','evil.release-check.makeborne.site'])
      for(const path of deniedPaths)for(const method of ['GET','HEAD','POST','OPTIONS']) {
        const response=await request('https://'+host+path,{method,headers:{'If-None-Match':'"anything"','Host':'release-check.makeborne.site','X-Forwarded-Host':'release-check.makeborne.site'}});
        assert.equal(response.status,404,host+path+method);assert.equal(response.headers.get('location'),null);
      }
    assert.equal(calls.length,0);assert.equal(cacheCalls.length,0);
  },{cacheHit:true});
});
await check('production refuses both QA labels before methods, caches, forms and legacy redirects',async()=>{
  await mocked(PROD,async({request,calls,cacheCalls})=>{
    for(const slug of STAGING_SITE_LABELS)for(const path of deniedPaths)for(const method of ['GET','HEAD','POST','OPTIONS']) {
      assert.equal((await request('https://'+slug+'.makeborne.site'+path,{method})).status,404);
    }
    for(const slug of STAGING_SITE_LABELS)for(const protocol of ['http:','https:']) {
      assert.equal((await request(protocol+'//sites.makeborne.com/'+slug)).status,404);
      assert.equal((await request(protocol+'//'+slug+'.makeborne.site/')).status,404,'no HTTPS redirect bypass');
    }
    assert.equal(calls.length,0);assert.equal(cacheCalls.length,0);
  },{cacheHit:true});
});
await check('URL authority normalizes case/default ports; trailing dots/nondefault ports blocked',async()=>{
  await mocked(STAGE,async({request,calls})=>{
    for(const address of ['https://release-check.makeborne.site.:443/','https://release-check.makeborne.site:8443/','http://release-check.makeborne.site:443/'])assert.equal((await request(address)).status,404);
    assert.equal(calls.length,0);
    for(const address of ['https://RELEASE-CHECK.MAKEBORNE.SITE/','https://release-check.makeborne.site:443/'])assert.equal((await request(address,{headers:{Host:'evil.example',Forwarded:'host=evil.example','X-Forwarded-Host':'evil.example'}})).status,200);
    assert.ok(calls.every(call=>call.url.startsWith(STAGING_SUPABASE_URL+'/')));
    const response=await request('http://release-check.makeborne.site:80/path?q=1');
    assert.equal(response.status,308);assert.equal(response.headers.get('location'),'https://release-check.makeborne.site/path?q=1');
  });
});
await check('allowed staging documents/assets/robots and forms retain existing behavior',async()=>{
  await mocked({...STAGE,FORMS_SIGNING_SECRET:'synthetic-secret-'.repeat(3)},async({request,calls})=>{
    for(const slug of STAGING_SITE_LABELS) {
      const origin='https://'+slug+'.makeborne.site';
      const document=await request(origin+'/');assert.equal(document.status,200);assert.equal(document.headers.get('X-Robots-Tag'),'noindex');
      const asset=await request(origin+'/images/hero.webp');assert.equal(asset.status,200);assert.deepEqual(Buffer.from(await asset.arrayBuffer()),IMAGE);
      const robots=await request(origin+'/robots.txt');assert.match(await robots.text(),/Disallow: \//);
      assert.equal((await request(origin+'/',{method:'OPTIONS'})).status,405);
      assert.equal((await request(origin+'/_mb/enquiries',{method:'OPTIONS'})).status,405);
      const form=await request(origin+'/_mb/enquiries',{method:'POST',headers:{Origin:origin,'content-type':'application/json','CF-Connecting-IP':'192.0.2.1'},
        body:JSON.stringify({requestId:'11111111-1111-4111-8111-111111111111',name:'Fixture',email:'fixture@example.invalid',message:'Synthetic local check'})});
      assert.equal(form.status,200);
    }
    const gateways=calls.filter(call=>call.url.endsWith('/api/hosting/enquiries'));assert.equal(gateways.length,2);
    assert.ok(gateways.every(call=>call.url===STAGING_APP_ORIGIN+'/api/hosting/enquiries'));
  });
});
await check('allowed QA assets cannot reuse legacy or production cache entries',async()=>{
  const previous={fetch:globalThis.fetch,caches:globalThis.caches},keys=[],calls=[];
  const origin='https://release-check.makeborne.site',path='/images/hero.webp';
  const old=new Map([[origin+path,new Response('OLD_PRODUCTION_BYTES')],[origin+path+'?__mb_namespace=production-v1',new Response('OTHER_NAMESPACE_BYTES')]]);
  globalThis.caches={default:{match:async request=>{keys.push(request.url);return old.get(request.url);},put:async()=>{}}};
  globalThis.fetch=async(url,init)=>{calls.push(url);return Response.json(upstream(url,JSON.parse(init.body)));};
  try {
    const response=await worker.fetch(new Request(origin+path+'?__mb_namespace=production-v1'),STAGE,{waitUntil:promise=>promise});
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),IMAGE);
    assert.deepEqual(keys,[origin+path+'?__mb_namespace=staging-v1']);assert.equal(calls.length,1);
    assert.ok(calls[0].startsWith(STAGING_SUPABASE_URL));
  } finally {globalThis.fetch=previous.fetch;if(previous.caches===undefined)delete globalThis.caches;else globalThis.caches=previous.caches;}
});
await check('production apex, legacy regular sites and ordinary customer hosts preserved',async()=>{
  await mocked(PROD,async({request,calls})=>{
    for(const host of ['makeborne.site','www.makeborne.site']) {
      const response=await request('https://'+host+'/');assert.equal(response.status,308);assert.equal(response.headers.get('location'),'https://makeborne.com/');
    }
    const legacy=await request('https://sites.makeborne.com/good-dog');assert.equal(legacy.status,301);assert.equal(legacy.headers.get('location'),'https://good-dog.makeborne.site/');
    assert.equal(calls.length,0);
    assert.equal((await request('https://good-dog.makeborne.site/')).status,200);
    assert.ok(calls[0].url.startsWith(PRODUCTION_SUPABASE_URL));
  });
});
await check('explicit local mode is restricted to localhost development origins',async()=>{
  await mocked(LOCAL,async({request,calls})=>{
    for(const host of ['release-check.makeborne.site','good-dog.makeborne.site','evil.example','good-dog.localhost.evil.example','127.0.0.1'])assert.equal((await request('http://'+host+':8787/')).status,404);
    assert.equal(calls.length,0);assert.equal((await request('http://good-dog.localhost:8787/')).status,200);
    assert.ok(calls[0].url.startsWith(LOCAL.SUPABASE_URL));
  });
  assert.equal(classifySiteNamespaceRequest(new URL('https://release-check.makeborne.site'),siteNamespacePolicy(PROD)),null);
});

// Bundle the actual Worker. The only fixture wrapper action primes Cache API;
// ordinary requests run the unmodified Worker export. Every outbound call is mocked.
const directory=await mkdtemp(join(tmpdir(),'makeborne-namespace-'));
const moduleRoot=resolve('infra/customer-sites');
const bundle=(await build({stdin:{contents:"import worker from './_worker.js';export default {async fetch(request,env,ctx){if(new URL(request.url).pathname==='/__fixture_prime_cache'){for(const host of ['good-dog.makeborne.site','release-check.makeborne.site'])for(const query of ['', '?__mb_namespace='+env.SITE_NAMESPACE+'-v1'])await caches.default.put(new Request('https://'+host+'/images/hero.webp'+query),new Response('SEEDED_FORBIDDEN_CACHE',{headers:{'Cache-Control':'public,max-age=600','ETag':'synthetic-cache'}}));for(const query of ['','?__mb_namespace=production-v1'])await caches.default.put(new Request('https://release-check-renamed.makeborne.site/images/hero.webp'+query),new Response('OLD_PRODUCTION_BYTES',{headers:{'Cache-Control':'public,max-age=600','ETag':'synthetic-cache'}}));return new Response('primed')}return worker.fetch(request,env,ctx)}}",resolveDir:moduleRoot,sourcefile:'fixture.mjs'},bundle:true,format:'esm',platform:'browser',write:false,logLevel:'silent'})).outputFiles[0].text;
let workerdRequests=0;
try {
  for(const [mode,values] of [['staging',STAGE],['production',PROD],['local',LOCAL]]) {
    const calls=[];
    const env=Object.fromEntries(Object.entries({...values,FORMS_SIGNING_SECRET:'synthetic-secret-'.repeat(3)}).map(([key,value])=>[key,{type:'json',value}]));
    const runtime=new Miniflare({host:'127.0.0.1',cf:false,logRequests:false,telemetry:{enabled:false},resourcePersistencePath:join(directory,mode),workers:[{
      config:{name:'namespace-'+mode,compatibilityDate:'2026-10-05',env,exports:{},manifest:{mainModule:'worker.mjs',modulesRoot:directory,modules:{'worker.mjs':{type:'esm',contents:bundle}}}},
      dev:{stripCfConnectingIp:false,outboundService:{type:'fetcher',handler:async request=>{
        calls.push(request.url);assert.ok(request.url.startsWith(values.SUPABASE_URL+'/rest/v1/rpc/')||request.url===values.APP_ORIGIN+'/api/hosting/enquiries','unexpected external transport');
        return new RuntimeResponse(JSON.stringify(upstream(request.url,await request.json())),{headers:{'content-type':'application/json'}});
      }}}
    }]});
    try {
      await runtime.ready;
      await check('real local workerd '+mode+' namespace, seeded cache and no external transport',async()=>{
        const request=async(url,init={})=>{workerdRequests++;return runtime.dispatchFetch(url,{...init,redirect:'manual'});};
        assert.equal((await request('https://fixture.invalid/__fixture_prime_cache')).status,200);
        const denied=mode==='staging'?['good-dog.makeborne.site','makeborne.site','sites.makeborne.com']:mode==='production'?STAGING_SITE_LABELS.map(x=>x+'.makeborne.site'):['good-dog.makeborne.site','release-check.makeborne.site'];
        for(const host of denied)for(const path of deniedPaths)for(const method of ['GET','HEAD','POST','OPTIONS']) {
          const response=await request('https://'+host+path,{method,headers:{Host:mode==='staging'?'release-check.makeborne.site':'good-dog.makeborne.site','X-Forwarded-Host':mode==='staging'?'release-check.makeborne.site':'good-dog.makeborne.site'}});
          assert.equal(response.status,404,mode+' '+host+path+' '+method);assert.doesNotMatch(await response.text(),/SEEDED_FORBIDDEN_CACHE/);
        }
        assert.equal(calls.length,0);
        const origin=mode==='local'?'http://good-dog.localhost:8787':mode==='staging'?'https://release-check.makeborne.site':'https://good-dog.makeborne.site';
        const doc=await request(origin+'/');assert.equal(doc.status,200);assert.match(await doc.text(),/Namespace fixture/);
        assert.equal(calls.length,1);
        assert.equal((await request(origin+'/robots.txt')).status,200);
        if(mode==='production') {
          for(const slug of STAGING_SITE_LABELS)assert.equal((await request('https://sites.makeborne.com/'+slug)).status,404);
          assert.equal((await request('https://sites.makeborne.com/good-dog')).status,301);
          assert.equal((await request('https://makeborne.site/')).headers.get('location'),'https://makeborne.com/');
        }
        if(mode==='staging') {
          const uncached=await request('https://release-check-renamed.makeborne.site/images/hero.webp');
          assert.deepEqual(Buffer.from(await uncached.arrayBuffer()),IMAGE,'legacy production cache never reused by staging');
        }
        const asset=await request(origin+'/images/hero.webp');assert.equal(asset.status,200);
        if(mode!=='local')assert.equal(await asset.text(),'SEEDED_FORBIDDEN_CACHE','same-namespace authorized cache still works');
        const form=await request(origin+'/_mb/enquiries',{method:'POST',headers:{Origin:origin,'content-type':'application/json','CF-Connecting-IP':'192.0.2.1'},
          body:JSON.stringify({requestId:'11111111-1111-4111-8111-111111111111',name:'Fixture',email:'fixture@example.invalid',message:'Synthetic local check'})});
        assert.equal(form.status,200);assert.equal(calls.at(-1),values.APP_ORIGIN+'/api/hosting/enquiries');
        for(const alias of [origin.replace(/(?=:8787|$)/,'.'),origin.replace(/:8787$/,'')+':8443']) {
          if(mode!=='local')assert.equal((await request(alias+'/')).status,404);
        }
      });
    } finally {await runtime.dispose();}
  }
} finally {
  // Generated exact temp directory only; no project paths are removed.
  assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('makeborne-namespace-'));
  assert.equal((await lstat(directory)).isSymbolicLink(),false);
  await rm(directory,{recursive:true,force:true});
}
console.log(JSON.stringify({groups,workerdRequests,externalNetworkCalls:0,cloudQualified:false}));


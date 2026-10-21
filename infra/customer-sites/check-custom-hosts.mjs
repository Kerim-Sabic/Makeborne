/** Offline custom-hostname checks: classification per namespace, Worker resolution,
 * edge caching, 404/503 handling and a real local workerd run. Every upstream call
 * is mocked; no Cloudflare, Supabase or DNS API is contacted. */
import assert from 'node:assert/strict';
import {mkdtemp,rm,lstat} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,Response as RuntimeResponse} from 'miniflare';
import worker,{CUSTOM_HOST_CACHE_SECONDS} from './_worker.js';
import {STAGING_SUPABASE_URL,PRODUCTION_SUPABASE_URL,STAGING_APP_ORIGIN,STAGING_CUSTOM_HOST_LIMIT,siteNamespacePolicy,classifySiteNamespaceRequest,validCustomHostname} from './namespace-policy.js';

const KEY='sb_publishable_synthetic_custom_hosts';
const SECRET='synthetic-secret-'.repeat(3);
const PROD={SITE_NAMESPACE:'production',SUPABASE_URL:PRODUCTION_SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:KEY,SITES_DOMAIN:'makeborne.site',ALLOW_LOCAL_SUPABASE:'false',APP_ORIGIN:'https://makeborne.com',LEGACY_SITES_HOST:'sites.makeborne.com',FORMS_SIGNING_SECRET:SECRET};
const STAGE={...PROD,SITE_NAMESPACE:'staging',SUPABASE_URL:STAGING_SUPABASE_URL,APP_ORIGIN:STAGING_APP_ORIGIN,LEGACY_SITES_HOST:'legacy-disabled.makeborne.site',SITE_INDEXING_ENABLED:'false'};
const LOCAL={...PROD,SITE_NAMESPACE:'local',SUPABASE_URL:'http://127.0.0.1:55321',ALLOW_LOCAL_SUPABASE:'true',SITES_DOMAIN:'localhost',APP_ORIGIN:'http://localhost:3205',LEGACY_SITES_HOST:'sites.localhost'};
const HTML='<!doctype html><html><head><title>Custom host fixture</title></head><body><div id="root">Custom host fixture</div></body></html>';
const IMAGE=Buffer.from('synthetic-custom-host-raster'),HASH=createHash('sha256').update(IMAGE).digest('hex');
// Database fixture: active hostname → slug of a live site. Everything else is unknown.
const HOSTS=new Map([['www.customer.com','good-dog'],['customer.com','good-dog'],['qa.customer-test.com','release-check'],['shop.example.test','good-dog'],['qa-label.customer.com','release-check'],['odd-slug.customer.com','Not A Slug']]);
let groups=0;
const check=async(name,fn)=>{await fn();groups++;console.log('PASS '+name);};
const classify=(address,env)=>classifySiteNamespaceRequest(new URL(address),siteNamespacePolicy(env));

function upstream(url,body) {
  const parsed=new URL(url);
  if(parsed.pathname==='/rest/v1/rpc/makeborne_resolve_site_host') {
    assert.deepEqual(Object.keys(body),['p_host']);
    if(body.p_host==='error.customer.com')return {status:500,value:{message:'synthetic upstream failure'}};
    if(body.p_host==='shape.customer.com')return {status:200,value:{slug:'good-dog'}};
    return {status:200,value:HOSTS.get(body.p_host)??null};
  }
  if(parsed.pathname==='/rest/v1/rpc/makeborne_read_hosted_site_v3') {
    assert.equal(body.p_slug,'good-dog','only the resolved slug is read');return {status:200,value:{html:HTML,script:null,interactive:false,revision:3}};
  }
  if(parsed.pathname==='/rest/v1/rpc/makeborne_read_hosted_site_file')return {status:200,value:{content_type:'image/webp',sha256:HASH,body:IMAGE.toString('base64')}};
  // The page list behind sitemap.xml; nested documents are indexable only when listed.
  if(parsed.pathname==='/rest/v1/rpc/makeborne_read_site_paths'){assert.deepEqual(body,{p_slug:'good-dog'});return {status:200,value:{paths:['/','/about','/pricing'],updated_at:null}};}
  if(parsed.pathname==='/api/hosting/enquiries')return {status:200,value:{accepted:true}};
  assert.fail('UNEXPECTED_UPSTREAM '+url);
}
function memoryCache() {
  const entries=new Map(),puts=[],matches=[];
  return {entries,puts,matches,default:{
    match:async request=>{matches.push(request.url);const hit=entries.get(request.url);return hit?hit.clone():undefined;},
    put:async(request,response)=>{puts.push({url:request.url,cacheControl:response.headers.get('Cache-Control'),body:await response.clone().text()});entries.set(request.url,response);},
  }};
}
async function mocked(env,fn) {
  const previous={fetch:globalThis.fetch,caches:globalThis.caches},calls=[],cache=memoryCache();
  globalThis.fetch=async(url,init)=>{
    const body=JSON.parse(init.body);calls.push({url,body,headers:init.headers});
    const {status,value}=upstream(url,body);return Response.json(value,{status});
  };
  globalThis.caches={default:cache.default};
  const pending=[];
  try {
    await fn({request:async(url,init)=>{const response=await worker.fetch(new Request(url,init),env,{waitUntil:promise=>pending.push(promise)});await Promise.all(pending.splice(0));return response;},
      calls,cache,resolves:()=>calls.filter(call=>call.url.endsWith('/rpc/makeborne_resolve_site_host'))});
  } finally {globalThis.fetch=previous.fetch;if(previous.caches===undefined)delete globalThis.caches;else globalThis.caches=previous.caches;}
}
const resolutionKey=(domain,namespace,host)=>`https://${domain}/_mb/custom-host?__mb_namespace=${namespace}-v1&host=${encodeURIComponent(host)}`;

// Same lists as supabase/check-custom-domains.sql: the Worker and the CHECK agree.
const INVALID=['Shop.example.com','example','shop.example.com.','1.2.3.4','10.0.0.1','a..example.com','.example.com','-a.example.com','a-.example.com','a.-example.com',
  'exa mple.com','_dmarc.example.com','shop.example.123','makeborne.com','www.makeborne.com','makeborne.site','good-dog.makeborne.site','localhost','shop.localhost',
  'a'.repeat(64)+'.example.com','abcdefghi.'.repeat(25)+'example.com',''];
const VALID=['shop.example.com','example.co.uk','notmakeborne.com','makeborne.site.example.org','xn--bcher-kva.example','a.b','shop.example.test'];

await check('hostname validator mirrors the database CHECK',async()=>{
  for(const host of INVALID)assert.equal(validCustomHostname(host),false,host);
  for(const host of VALID)assert.equal(validCustomHostname(host),true,host);
  for(const value of [null,undefined,42,['a.com']])assert.equal(validCustomHostname(value),false);
});

await check('production classifies only non-Makeborne DNS names as custom; existing rules kept',async()=>{
  assert.deepEqual(classify('https://www.customer.com/',PROD),{kind:'custom',host:'www.customer.com'});
  assert.deepEqual(classify('https://WWW.Customer.COM/x',PROD),{kind:'custom',host:'www.customer.com'});
  assert.deepEqual(classify('https://customer.com/',PROD),{kind:'custom',host:'customer.com'});
  assert.deepEqual(classify('https://bücher.example/',PROD),{kind:'custom',host:'xn--bcher-kva.example'});
  assert.deepEqual(classify('https://good-dog.makeborne.site/',PROD),{kind:'site',slug:'good-dog'});
  assert.deepEqual(classify('https://makeborne.site/',PROD),{kind:'apex'});
  assert.deepEqual(classify('https://www.makeborne.site/',PROD),{kind:'apex'});
  assert.deepEqual(classify('https://sites.makeborne.com/good-dog',PROD),{kind:'legacy',slug:'good-dog'});
  for(const address of ['https://1.2.3.4/','https://[::1]/','https://10.0.0.1/','https://intranet/','https://makeborne.com/','https://app.makeborne.com/','https://www.makeborne.com/',
    'https://a.b.makeborne.site/','https://x.makeborne.site/','https://release-check.makeborne.site/','https://foo.localhost/','https://localhost/','https://customer.com./',
    'https://customer.com:8443/','https://user:pass@customer.com/','ftp://customer.com/','https://_dmarc.customer.com/'])
    assert.equal(classify(address,PROD),null,address);
});

await check('staging serves only listed custom hosts; absent list means none; bad lists fail closed',async()=>{
  assert.equal(classify('https://www.customer.com/',STAGE),null);
  assert.equal(classify('https://qa.customer-test.com/',STAGE),null);
  const listed={...STAGE,STAGING_CUSTOM_HOSTS:'qa.customer-test.com, shop.example.org'};
  assert.deepEqual(classify('https://qa.customer-test.com/',listed),{kind:'custom',host:'qa.customer-test.com'});
  assert.deepEqual(classify('https://SHOP.example.org/',listed),{kind:'custom',host:'shop.example.org'});
  assert.equal(classify('https://www.customer.com/',listed),null);
  assert.equal(classify('https://sub.qa.customer-test.com/',listed),null);
  assert.equal(classify('https://qa.customer-test.com:8443/',listed),null);
  assert.deepEqual(classify('https://release-check.makeborne.site/',listed),{kind:'site',slug:'release-check'});
  assert.equal(classify('https://good-dog.makeborne.site/',listed),null);
  assert.ok(siteNamespacePolicy({...STAGE,STAGING_CUSTOM_HOSTS:''}));
  for(const value of ['evil.makeborne.site','UPPER.example.com','1.2.3.4','intranet','x.example.com,x.example.com','a.example.com,,b.example.com',',',
    'app.makeborne.com',Array.from({length:STAGING_CUSTOM_HOST_LIMIT+1},(_,i)=>`h${i}.example.com`).join(',')])
    assert.equal(siteNamespacePolicy({...STAGE,STAGING_CUSTOM_HOSTS:value}),null,value);
  assert.equal(siteNamespacePolicy({...PROD,STAGING_CUSTOM_HOSTS:'qa.customer-test.com'}),null,'production refuses a staging list');
  assert.equal(siteNamespacePolicy({...LOCAL,STAGING_CUSTOM_HOSTS:'qa.customer-test.com'}),null,'local refuses a staging list');
  assert.ok(siteNamespacePolicy({...PROD,STAGING_CUSTOM_HOSTS:''}));
});

await check('local accepts only .test custom hosts',async()=>{
  assert.deepEqual(classify('http://shop.example.test:8787/',LOCAL),{kind:'custom',host:'shop.example.test'});
  for(const address of ['http://shop.example.com:8787/','http://evil.example:8787/','http://test:8787/','http://127.0.0.1:8787/','http://good-dog.makeborne.site:8787/'])
    assert.equal(classify(address,LOCAL),null,address);
  assert.deepEqual(classify('http://good-dog.localhost:8787/',LOCAL),{kind:'site',slug:'good-dog'});
});

await check('production custom host resolves once, serves the site and caches 60 s under a synthetic key',async()=>{
  await mocked(PROD,async({request,calls,cache,resolves})=>{
    const document=await request('https://www.customer.com/',{headers:{Host:'evil.example',Forwarded:'host=evil.example','X-Forwarded-Host':'evil.example'}});
    assert.equal(document.status,200);assert.match(await document.text(),/Custom host fixture/);
    assert.equal(resolves().length,1);assert.deepEqual(resolves()[0].body,{p_host:'www.customer.com'});
    assert.equal(resolves()[0].headers.apikey,KEY);assert.ok(calls.every(call=>call.url.startsWith(PRODUCTION_SUPABASE_URL+'/')));
    assert.equal(document.headers.get('Strict-Transport-Security'),'max-age=31536000','no includeSubDomains on a customer apex');
    assert.match(document.headers.get('Content-Security-Policy'),/script-src 'none'/);
    assert.equal(document.headers.get('X-Robots-Tag'),null);
    const key=resolutionKey('makeborne.site','production','www.customer.com');
    assert.deepEqual(cache.puts.map(put=>[put.url,put.cacheControl]),[[key,`public, max-age=${CUSTOM_HOST_CACHE_SECONDS.found}`]]);
    assert.deepEqual(JSON.parse(cache.puts[0].body),{host:'www.customer.com',slug:'good-dog'});
    // Cached: further documents, files and robots skip resolution.
    const nested=await request('https://www.customer.com/about');
    assert.equal(nested.status,200);assert.equal(nested.headers.get('X-Robots-Tag'),null,'a listed nested page on a custom host is indexable');
    const unlisted=await request('https://www.customer.com/not-listed');
    assert.equal(unlisted.status,200);assert.equal(unlisted.headers.get('X-Robots-Tag'),'noindex','a page outside the sitemap is not');
    const asset=await request('https://www.customer.com/images/hero.webp');
    assert.equal(asset.status,200);assert.deepEqual(Buffer.from(await asset.arrayBuffer()),IMAGE);
    assert.equal(asset.headers.get('Strict-Transport-Security'),'max-age=31536000');
    assert.ok(!cache.puts.some(put=>put.url.includes('/images/hero.webp')),'mutable project images are never edge cached');
    const robots=await request('https://www.customer.com/robots.txt');assert.equal(robots.status,200);assert.match(await robots.text(),/Allow: \//);
    assert.equal(resolves().length,1,'resolution cached');
    assert.equal((await request('https://www.customer.com/',{method:'OPTIONS'})).status,405);
    assert.equal((await request('https://www.customer.com/nope.txt')).status,404);
    // The regular slug address keeps its own headers.
    const regular=await request('https://good-dog.makeborne.site/');
    assert.equal(regular.headers.get('Strict-Transport-Security'),'max-age=31536000; includeSubDomains');
    // Resolution keys never equal a visitor URL and never live on the visitor's host.
    assert.ok(cache.matches.filter(url=>url.includes('/_mb/custom-host')).every(url=>url.startsWith('https://makeborne.site/_mb/custom-host?')));
  });
});

await check('unknown custom hosts 404 and are negatively cached for 30 s; errors are not cached',async()=>{
  await mocked(PROD,async({request,cache,resolves,calls})=>{
    for(const method of ['GET','HEAD','POST']) {
      const response=await request('https://unknown.customer.com/',{method,headers:{Host:'www.customer.com','X-Forwarded-Host':'www.customer.com'}});
      assert.equal(response.status,404,method);if(method==='GET')assert.match(await response.text(),/Page not found/);
      assert.equal(response.headers.get('Strict-Transport-Security'),'max-age=31536000');
    }
    assert.equal((await request('https://unknown.customer.com/_mb/enquiries',{method:'POST',headers:{Origin:'https://unknown.customer.com','content-type':'application/json'},body:'{}'})).status,404);
    assert.equal((await request('https://unknown.customer.com/robots.txt')).status,404);
    assert.equal(resolves().length,1,'negative answer cached');assert.deepEqual(resolves()[0].body,{p_host:'unknown.customer.com'});
    assert.deepEqual(cache.puts.map(put=>put.cacheControl),[`public, max-age=${CUSTOM_HOST_CACHE_SECONDS.missing}`]);
    assert.equal(calls.length,1,'no site read for an unknown host');
    // Upstream failure: 503, not cached, retried next time.
    for(let attempt=0;attempt<2;attempt++)assert.equal((await request('https://error.customer.com/')).status,503);
    assert.equal(resolves().filter(call=>call.body.p_host==='error.customer.com').length,2);
    // Unexpected response shape: 503, not cached.
    assert.equal((await request('https://shape.customer.com/')).status,503);
    // Slugs that are invalid or reserved for QA are refused like unknown hosts.
    assert.equal((await request('https://qa-label.customer.com/')).status,404);
    assert.equal((await request('https://odd-slug.customer.com/')).status,404);
    assert.equal(cache.puts.length,3);
    assert.ok(!calls.some(call=>call.url.endsWith('/makeborne_read_hosted_site_v3')),'refused hosts never read a site');
  });
});

await check('cache entries are validated: wrong host or malformed bodies are misses',async()=>{
  await mocked(PROD,async({request,cache,resolves})=>{
    const key=resolutionKey('makeborne.site','production','unknown.customer.com');
    cache.entries.set(key,new Response(JSON.stringify({host:'other.customer.com',slug:'good-dog'})));
    assert.equal((await request('https://unknown.customer.com/')).status,404);
    cache.entries.set(resolutionKey('makeborne.site','production','www.customer.com'),new Response('not json'));
    assert.equal((await request('https://www.customer.com/')).status,200);
    cache.entries.set(resolutionKey('makeborne.site','production','customer.com'),new Response(JSON.stringify({host:'customer.com',slug:'release-check'})));
    assert.equal((await request('https://customer.com/')).status,200,'cached QA label is ignored and re-resolved');
    assert.equal(resolves().length,3);
  });
});

await check('HTTPS redirect, enquiries and Origin checks behave like slug sites',async()=>{
  await mocked(PROD,async({request,calls})=>{
    const insecure=await request('http://www.customer.com/contact?from=menu');
    assert.equal(insecure.status,308);assert.equal(insecure.headers.get('location'),'https://www.customer.com/contact?from=menu');
    assert.equal(calls.length,0,'redirect precedes resolution');
    const origin='https://www.customer.com';
    const payload=JSON.stringify({requestId:'11111111-1111-4111-8111-111111111111',name:'Fixture',email:'fixture@example.invalid',message:'Synthetic custom host check'});
    const denied=await request(origin+'/_mb/enquiries',{method:'POST',headers:{Origin:'https://good-dog.makeborne.site','content-type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:payload});
    assert.equal(denied.status,403);
    const form=await request(origin+'/_mb/enquiries',{method:'POST',headers:{Origin:origin,'content-type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:payload});
    assert.equal(form.status,200);assert.deepEqual(await form.json(),{accepted:true});
    const gateway=calls.filter(call=>call.url==='https://makeborne.com/api/hosting/enquiries');
    assert.equal(gateway.length,1);assert.equal(gateway[0].body.slug,'good-dog');
  });
});

await check('staging and local resolve against their own database and cache namespace',async()=>{
  await mocked({...STAGE,STAGING_CUSTOM_HOSTS:'qa.customer-test.com'},async({request,calls,cache})=>{
    assert.equal((await request('https://www.customer.com/')).status,404);assert.equal(calls.length,0,'unlisted host never reaches upstream');
    const response=await request('https://qa.customer-test.com/robots.txt');
    assert.equal(response.status,200);assert.match(await response.text(),/Disallow: \//);
    assert.ok(calls.every(call=>call.url.startsWith(STAGING_SUPABASE_URL+'/')));
    assert.deepEqual(cache.puts.map(put=>put.url),[resolutionKey('makeborne.site','staging','qa.customer-test.com')]);
  });
  await mocked(LOCAL,async({request,calls,cache})=>{
    const document=await request('http://shop.example.test:8787/');
    assert.equal(document.status,200);assert.equal(document.headers.get('X-Robots-Tag'),'noindex');
    assert.ok(calls.every(call=>call.url.startsWith(LOCAL.SUPABASE_URL+'/')));
    assert.deepEqual(cache.puts.map(put=>put.url),[resolutionKey('localhost','local','shop.example.test')]);
    assert.equal((await request('http://shop.example.com:8787/')).status,404);
  });
});

// Real local workerd with its Cache API: resolution is cached across requests.
const directory=await mkdtemp(join(tmpdir(),'makeborne-custom-hosts-'));
const bundle=(await build({entryPoints:[resolve('infra/customer-sites/_worker.js')],bundle:true,format:'esm',platform:'browser',write:false,logLevel:'silent'})).outputFiles[0].text;
let workerdRequests=0;
try {
  const calls=[];
  const env=Object.fromEntries(Object.entries(PROD).map(([key,value])=>[key,{type:'json',value}]));
  const runtime=new Miniflare({host:'127.0.0.1',cf:false,logRequests:false,telemetry:{enabled:false},resourcePersistencePath:join(directory,'production'),workers:[{
    config:{name:'custom-hosts-production',compatibilityDate:'2026-10-05',env,exports:{},manifest:{mainModule:'worker.mjs',modulesRoot:directory,modules:{'worker.mjs':{type:'esm',contents:bundle}}}},
    dev:{stripCfConnectingIp:false,outboundService:{type:'fetcher',handler:async request=>{
      calls.push(request.url);assert.ok(request.url.startsWith(PROD.SUPABASE_URL+'/rest/v1/rpc/'),'unexpected external transport');
      const {status,value}=upstream(request.url,await request.json());
      return new RuntimeResponse(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
    }}}
  }]});
  try {
    await runtime.ready;
    await check('real local workerd caches custom host resolution and serves 404s',async()=>{
      const request=async(url,init={})=>{workerdRequests++;return runtime.dispatchFetch(url,{...init,redirect:'manual'});};
      const resolveCalls=()=>calls.filter(url=>url.endsWith('/makeborne_resolve_site_host')).length;
      const settle=()=>new Promise(done=>setTimeout(done,250));
      const first=await request('https://www.customer.com/',{headers:{Host:'evil.example'}});
      assert.equal(first.status,200);assert.match(await first.text(),/Custom host fixture/);
      await settle();
      const second=await request('https://www.customer.com/pricing');assert.equal(second.status,200);assert.equal(second.headers.get('X-Robots-Tag'),null,'listed nested page indexable under workerd');await second.arrayBuffer();
      const head=await request('https://www.customer.com/pricing',{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('X-Robots-Tag'),null);await head.arrayBuffer();
      const conditional=await request('https://www.customer.com/pricing',{headers:{'If-None-Match':second.headers.get('ETag')}});
      assert.equal(conditional.status,304);assert.equal(conditional.headers.get('X-Robots-Tag'),null);await conditional.arrayBuffer();
      const unlisted=await request('https://www.customer.com/not-listed');assert.equal(unlisted.headers.get('X-Robots-Tag'),'noindex');await unlisted.arrayBuffer();
      // Preferred-address policy under workerd: the custom host is a non-canonical copy with no sitemap.
      const customSitemap=await request('https://www.customer.com/sitemap.xml');assert.equal(customSitemap.status,404,'no sitemap on a custom host');await customSitemap.arrayBuffer();
      const customRobots=await request('https://www.customer.com/robots.txt');assert.equal(await customRobots.text(),'User-agent: *\nAllow: /\n','custom host robots names no sitemap');
      const slugSitemap=await request('https://good-dog.makeborne.site/sitemap.xml');assert.equal(slugSitemap.status,200);assert.match(await slugSitemap.text(),/<loc>https:\/\/good-dog\.makeborne\.site\/about<\/loc>/);
      assert.equal(resolveCalls(),1,'positive resolution served from the Cache API');
      const missing=await request('https://unknown.customer.com/');assert.equal(missing.status,404);await missing.arrayBuffer();
      await settle();
      const again=await request('https://unknown.customer.com/about');assert.equal(again.status,404);await again.arrayBuffer();
      assert.equal(resolveCalls(),2,'negative resolution served from the Cache API');
      const ip=await request('https://192.0.2.1/');assert.equal(ip.status,404);await ip.arrayBuffer();
      const platform=await request('https://app.makeborne.com/');assert.equal(platform.status,404);await platform.arrayBuffer();
      assert.equal(resolveCalls(),2,'IP and Makeborne hosts never resolve');
    });
  } finally {await runtime.dispose();}
} finally {
  // Generated exact temp directory only; no project paths are removed.
  assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('makeborne-custom-hosts-'));
  assert.equal((await lstat(directory)).isSymbolicLink(),false);
  await rm(directory,{recursive:true,force:true});
}
console.log(JSON.stringify({groups,workerdRequests,externalNetworkCalls:0,cloudQualified:false}));

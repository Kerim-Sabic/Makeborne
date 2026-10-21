/** Offline sitemap.xml and robots.txt checks for slug and custom hosts. Every
 * upstream call is mocked; no Supabase, Cloudflare or DNS API is contacted. */
import assert from 'node:assert/strict';
import worker from './_worker.js';
import {sitePaths,sitemapDocument,robotsDocument} from './sitemap.js';
import {PRODUCTION_SUPABASE_URL,STAGING_SUPABASE_URL,STAGING_APP_ORIGIN} from './namespace-policy.js';

const PROD={SITE_NAMESPACE:'production',SUPABASE_URL:PRODUCTION_SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_sitemap',SITES_DOMAIN:'makeborne.site',ALLOW_LOCAL_SUPABASE:'false',APP_ORIGIN:'https://makeborne.com',LEGACY_SITES_HOST:'sites.makeborne.com',FORMS_SIGNING_SECRET:'synthetic-secret-'.repeat(3)};
const STAGE={...PROD,SITE_NAMESPACE:'staging',SUPABASE_URL:STAGING_SUPABASE_URL,APP_ORIGIN:STAGING_APP_ORIGIN,LEGACY_SITES_HOST:'legacy-disabled.makeborne.site',SITE_INDEXING_ENABLED:'false'};
const LOCAL={...PROD,SITE_NAMESPACE:'local',SUPABASE_URL:'http://127.0.0.1:55321',ALLOW_LOCAL_SUPABASE:'true',SITES_DOMAIN:'localhost',APP_ORIGIN:'http://localhost:3205',LEGACY_SITES_HOST:'sites.localhost'};
// good-dog and down publish per-route pages; legacy-dog predates per-route output (only "/" is listed).
const SITES=new Map([['good-dog',{paths:['/visit','/','/menu','/menu'],updated_at:'2026-10-14T09:30:00+00:00'}],['broken',{paths:'nope'}],['legacy-dog',{paths:['/'],updated_at:null}],['release-check',{paths:['/','/menu'],updated_at:null}]]);
const ROUTED=new Map([['good-dog',['/','/menu','/visit']],['down',['/','/menu']],['release-check',['/','/menu']]]);
const HTML='<!doctype html><html><head><title>Sitemap fixture</title><link rel="canonical" href="https://good-dog.makeborne.site/"><meta property="og:url" content="https://good-dog.makeborne.site/"></head><body><main>Sitemap fixture</main></body></html>';
let groups=0;
const check=async(name,fn)=>{await fn();groups++;console.log('PASS '+name);};

/** Mirrors makeborne_read_hosted_site_v3: a site with routes serves only those paths; an older site serves its one snapshot everywhere. */
function documentFor(slug,path) {
  if(slug==='legacy-dog')return {html:HTML,script:null,interactive:false,revision:2};
  return ROUTED.get(slug)?.includes(path)?{html:HTML,script:null,interactive:false,revision:5}:null;
}
async function mocked(env,fn) {
  const previous={fetch:globalThis.fetch,caches:globalThis.caches,error:console.error},calls=[];
  globalThis.fetch=async(url,init)=>{
    const body=JSON.parse(init.body),path=new URL(url).pathname;calls.push({path,body});
    if(path==='/rest/v1/rpc/makeborne_read_site_paths'){if(body.p_slug==='down')return Response.json({message:'x'},{status:500});return Response.json(SITES.get(body.p_slug)??null);}
    if(path==='/rest/v1/rpc/makeborne_resolve_site_host')return Response.json(body.p_host==='www.gooddog.co.uk'?'good-dog':null);
    if(path==='/rest/v1/rpc/makeborne_read_hosted_site_v3'){
      assert.deepEqual(Object.keys(body),['p_slug','p_path']);
      if(body.p_slug==='document-down')return Response.json({message:'x'},{status:500});
      return Response.json(documentFor(body.p_slug,body.p_path));
    }
    assert.fail('UNEXPECTED_UPSTREAM '+path);
  };
  console.error=()=>{};
  const store=new Map();globalThis.caches={default:{match:async request=>store.get(request.url)?.clone(),put:async(request,response)=>{store.set(request.url,response);}}};
  try {await fn({request:(url,init)=>worker.fetch(new Request(url,init),env,{waitUntil(){}}),calls});}
  finally {globalThis.fetch=previous.fetch;console.error=previous.error;if(previous.caches===undefined)delete globalThis.caches;else globalThis.caches=previous.caches;}
}
const listedPaths=xml=>[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>new URL(match[1]).pathname);

await check('pure helpers: paths are validated, deduplicated and sorted; XML is escaped',()=>{
  assert.deepEqual(sitePaths({paths:['/menu','/','/menu','../etc','/a b'],updated_at:'2026-10-14T09:30:00Z'}),{paths:['/','/menu'],updated:'2026-10-14'});
  assert.equal(sitePaths(null),null);
  for(const bad of [{},{paths:[]},{paths:['../x']},{paths:Array.from({length:101},(_,i)=>`/p${i}`)},'x'])assert.throws(()=>sitePaths(bad),/invalid_sitemap/);
  assert.match(sitemapDocument('https://a.example',['/a&b'],null),/<loc>https:\/\/a\.example\/a&amp;b<\/loc>/);
  assert.equal(robotsDocument('https://www.gooddog.co.uk',true),'User-agent: *\nAllow: /\nSitemap: https://www.gooddog.co.uk/sitemap.xml\n');
  assert.equal(robotsDocument('https://www.gooddog.co.uk',true,false),'User-agent: *\nAllow: /\n','a non-canonical host allows crawling but names no sitemap');
  assert.equal(robotsDocument('https://x',false),'User-agent: *\nDisallow: /\n');
});

await check('preferred address: only the Makeborne address serves a sitemap; a custom host allows crawling and names none',async()=>{
  await mocked(PROD,async({request,calls})=>{
    const slug=await request('https://good-dog.makeborne.site/sitemap.xml');
    assert.equal(slug.status,200);assert.equal(slug.headers.get('Content-Type'),'application/xml; charset=utf-8');
    const xml=await slug.text();
    assert.equal((xml.match(/<url>/g)??[]).length,3);
    assert.match(xml,/<loc>https:\/\/good-dog\.makeborne\.site\/menu<\/loc><lastmod>2026-10-14<\/lastmod>/);
    const before=calls.length;
    for(const method of ['GET','HEAD'])assert.equal((await request('https://www.gooddog.co.uk/sitemap.xml',{method})).status,404,'custom host '+method+' sitemap');
    assert.ok(!calls.slice(before).some(call=>call.path.endsWith('read_site_paths')),'a custom-host sitemap request never reads the page list');
    assert.equal(await (await request('https://www.gooddog.co.uk/robots.txt')).text(),'User-agent: *\nAllow: /\n');
    assert.match(await (await request('https://good-dog.makeborne.site/robots.txt')).text(),/Sitemap: https:\/\/good-dog\.makeborne\.site\/sitemap\.xml/);
    assert.equal((await request('https://good-dog.makeborne.site/sitemap.xml',{method:'HEAD'})).status,200);
    assert.ok(calls.filter(call=>call.path.endsWith('read_site_paths')).every(call=>call.body.p_slug==='good-dog'&&Object.keys(call.body).length===1));
  });
});

await check('missing, offline or broken sites fail closed without leaking details',async()=>{
  await mocked(PROD,async({request})=>{
    assert.equal((await request('https://gone-dog.makeborne.site/sitemap.xml')).status,404);
    assert.equal((await request('https://broken.makeborne.site/sitemap.xml')).status,503);
    assert.equal((await request('https://down.makeborne.site/sitemap.xml')).status,503);
    assert.equal((await request('https://unknown.customer.com/sitemap.xml')).status,404);
  });
});

await check('no sitemap where indexing is off (staging)',async()=>{
  await mocked(STAGE,async({request,calls})=>{
    const response=await request('https://release-check.makeborne.site/sitemap.xml');
    assert.equal(response.status,404);assert.equal(calls.length,0,'nothing is read');
    assert.equal(await (await request('https://release-check.makeborne.site/robots.txt')).text(),'User-agent: *\nDisallow: /\n');
  });
});

await check('every page in the Makeborne sitemap is indexable on both addresses (custom copies stay crawlable so their canonical is read): root and nested, GET, HEAD and 304',async()=>{
  await mocked(PROD,async({request})=>{
    for(const origin of ['https://good-dog.makeborne.site','https://www.gooddog.co.uk']) {
      const listed=listedPaths(await (await request('https://good-dog.makeborne.site/sitemap.xml')).text());
      assert.deepEqual(listed,['/','/menu','/visit']);
      for(const path of listed) {
        const page=await request(origin+path);
        assert.equal(page.status,200,origin+path);assert.equal(page.headers.get('X-Robots-Tag'),null,`GET ${origin}${path} contradicts its sitemap`);
        assert.match(await page.text(),/Sitemap fixture/);
        const head=await request(origin+path,{method:'HEAD'});
        assert.equal(head.status,200);assert.equal(head.headers.get('X-Robots-Tag'),null,`HEAD ${origin}${path}`);assert.equal(await head.text(),'');
        const etag=page.headers.get('ETag');assert.ok(etag);
        const revalidated=await request(origin+path,{headers:{'If-None-Match':etag}});
        assert.equal(revalidated.status,304);assert.equal(revalidated.headers.get('X-Robots-Tag'),null,`304 ${origin}${path} keeps the page's policy`);
      }
    }
  });
});

await check('pages outside the sitemap, errors, disabled indexing, staging and local stay noindex',async()=>{
  const noindex=async(request,url,status,init)=>{const response=await request(url,init);assert.equal(response.status,status,url);assert.equal(response.headers.get('X-Robots-Tag'),'noindex',url);return response;};
  await mocked(PROD,async({request,calls})=>{
    await noindex(request,'https://good-dog.makeborne.site/missing',404);
    await noindex(request,'https://www.gooddog.co.uk/missing',404,{method:'HEAD'});
    await noindex(request,'https://gone-dog.makeborne.site/',404);
    await noindex(request,'https://unknown.customer.com/menu',404);
    await noindex(request,'https://document-down.makeborne.site/menu',503);
    // An older site answers every path with its home snapshot; only "/" is in its sitemap.
    assert.deepEqual(listedPaths(await (await request('https://legacy-dog.makeborne.site/sitemap.xml')).text()),['/']);
    assert.equal((await request('https://legacy-dog.makeborne.site/')).headers.get('X-Robots-Tag'),null);
    const fallback=await noindex(request,'https://legacy-dog.makeborne.site/services',200);
    await noindex(request,'https://legacy-dog.makeborne.site/services',200,{method:'HEAD'});
    await noindex(request,'https://legacy-dog.makeborne.site/services',304,{headers:{'If-None-Match':fallback.headers.get('ETag')}});
    await noindex(request,'https://legacy-dog.makeborne.site/index.html',200);
    // If the page list can't be read, a nested page is still served, but never marked indexable.
    assert.equal((await request('https://down.makeborne.site/sitemap.xml')).status,503);
    assert.equal((await request('https://down.makeborne.site/')).headers.get('X-Robots-Tag'),null);
    await noindex(request,'https://down.makeborne.site/menu',200);
    const reads=calls.filter(call=>call.path.endsWith('read_site_paths'));
    assert.ok(reads.every(call=>Object.keys(call.body).length===1&&typeof call.body.p_slug==='string'),'the page list is read by slug only');
  });
  await mocked({...PROD,SITE_INDEXING_ENABLED:'false'},async({request,calls})=>{
    await noindex(request,'https://good-dog.makeborne.site/',200);await noindex(request,'https://good-dog.makeborne.site/menu',200);
    assert.equal((await request('https://good-dog.makeborne.site/sitemap.xml')).status,404);
    assert.equal(calls.filter(call=>call.path.endsWith('read_site_paths')).length,0,'indexing off never consults the page list');
  });
  await mocked(STAGE,async({request,calls})=>{
    for(const path of ['/','/menu'])await noindex(request,'https://release-check.makeborne.site'+path,200);
    await noindex(request,'https://release-check.makeborne.site/menu',200,{method:'HEAD'});
    assert.equal(calls.filter(call=>call.path.endsWith('read_site_paths')).length,0);
  });
  await mocked(LOCAL,async({request})=>{
    for(const path of ['/','/menu'])await noindex(request,'http://good-dog.localhost:8787'+path,200);
  });
});

await check('preferred address: both hosts serve identical pages with no redirect; the stored Makeborne canonical is served unchanged on the custom host',async()=>{
  await mocked(PROD,async({request})=>{
    for(const path of ['/','/menu']) {
      const slug=await request('https://good-dog.makeborne.site'+path),custom=await request('https://www.gooddog.co.uk'+path);
      for(const response of [slug,custom]){assert.equal(response.status,200);assert.equal(response.headers.get('Location'),null,'no redirect between addresses');}
      const [a,b]=[await slug.text(),await custom.text()];assert.equal(b,a,'the custom host serves the same bytes');
      assert.match(b,/<link rel="canonical" href="https:\/\/good-dog\.makeborne\.site\/">/);assert.match(b,/<meta property="og:url" content="https:\/\/good-dog\.makeborne\.site\/">/);
      assert.ok(!/www\.gooddog\.co\.uk/.test(b),'no host rewriting');
    }
    const insecure=await request('http://www.gooddog.co.uk/menu?x=1');
    assert.equal(insecure.status,308);assert.equal(insecure.headers.get('Location'),'https://www.gooddog.co.uk/menu?x=1','HTTPS upgrade keeps the custom host');
  });
});

console.log(JSON.stringify({groups,externalNetworkCalls:0}));

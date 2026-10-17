/** Offline sitemap.xml and robots.txt checks for slug and custom hosts. Every
 * upstream call is mocked; no Supabase, Cloudflare or DNS API is contacted. */
import assert from 'node:assert/strict';
import worker from './_worker.js';
import {sitePaths,sitemapDocument,robotsDocument} from './sitemap.js';
import {PRODUCTION_SUPABASE_URL,STAGING_SUPABASE_URL,STAGING_APP_ORIGIN} from './namespace-policy.js';

const PROD={SITE_NAMESPACE:'production',SUPABASE_URL:PRODUCTION_SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_sitemap',SITES_DOMAIN:'makeborne.site',ALLOW_LOCAL_SUPABASE:'false',APP_ORIGIN:'https://makeborne.com',LEGACY_SITES_HOST:'sites.makeborne.com',FORMS_SIGNING_SECRET:'synthetic-secret-'.repeat(3)};
const STAGE={...PROD,SITE_NAMESPACE:'staging',SUPABASE_URL:STAGING_SUPABASE_URL,APP_ORIGIN:STAGING_APP_ORIGIN,LEGACY_SITES_HOST:'legacy-disabled.makeborne.site',SITE_INDEXING_ENABLED:'false'};
const SITES=new Map([['good-dog',{paths:['/visit','/','/menu','/menu'],updated_at:'2026-10-14T09:30:00+00:00'}],['broken',{paths:'nope'}]]);
let groups=0;
const check=async(name,fn)=>{await fn();groups++;console.log('PASS '+name);};

async function mocked(env,fn) {
  const previous={fetch:globalThis.fetch,caches:globalThis.caches},calls=[];
  globalThis.fetch=async(url,init)=>{
    const body=JSON.parse(init.body),path=new URL(url).pathname;calls.push({path,body});
    if(path==='/rest/v1/rpc/makeborne_read_site_paths'){if(body.p_slug==='down')return Response.json({message:'x'},{status:500});return Response.json(SITES.get(body.p_slug)??null);}
    if(path==='/rest/v1/rpc/makeborne_resolve_site_host')return Response.json(body.p_host==='www.gooddog.co.uk'?'good-dog':null);
    assert.fail('UNEXPECTED_UPSTREAM '+path);
  };
  const store=new Map();globalThis.caches={default:{match:async request=>store.get(request.url)?.clone(),put:async(request,response)=>{store.set(request.url,response);}}};
  try {await fn({request:(url,init)=>worker.fetch(new Request(url,init),env,{waitUntil(){}}),calls});}
  finally {globalThis.fetch=previous.fetch;if(previous.caches===undefined)delete globalThis.caches;else globalThis.caches=previous.caches;}
}

await check('pure helpers: paths are validated, deduplicated and sorted; XML is escaped',()=>{
  assert.deepEqual(sitePaths({paths:['/menu','/','/menu','../etc','/a b'],updated_at:'2026-10-14T09:30:00Z'}),{paths:['/','/menu'],updated:'2026-10-14'});
  assert.equal(sitePaths(null),null);
  for(const bad of [{},{paths:[]},{paths:['../x']},{paths:Array.from({length:101},(_,i)=>`/p${i}`)},'x'])assert.throws(()=>sitePaths(bad),/invalid_sitemap/);
  assert.match(sitemapDocument('https://a.example',['/a&b'],null),/<loc>https:\/\/a\.example\/a&amp;b<\/loc>/);
  assert.equal(robotsDocument('https://www.gooddog.co.uk',true),'User-agent: *\nAllow: /\nSitemap: https://www.gooddog.co.uk/sitemap.xml\n');
  assert.equal(robotsDocument('https://x',false),'User-agent: *\nDisallow: /\n');
});

await check('production slug and custom hosts serve a sitemap at their own origin, and robots points to it',async()=>{
  await mocked(PROD,async({request,calls})=>{
    const slug=await request('https://good-dog.makeborne.site/sitemap.xml');
    assert.equal(slug.status,200);assert.equal(slug.headers.get('Content-Type'),'application/xml; charset=utf-8');
    const xml=await slug.text();
    assert.equal((xml.match(/<url>/g)??[]).length,3);
    assert.match(xml,/<loc>https:\/\/good-dog\.makeborne\.site\/menu<\/loc><lastmod>2026-10-14<\/lastmod>/);
    const custom=await (await request('https://www.gooddog.co.uk/sitemap.xml')).text();
    assert.match(custom,/<loc>https:\/\/www\.gooddog\.co\.uk\/<\/loc>/,'the custom domain is the address in its own sitemap');
    assert.match(await (await request('https://www.gooddog.co.uk/robots.txt')).text(),/Sitemap: https:\/\/www\.gooddog\.co\.uk\/sitemap\.xml/);
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

console.log(JSON.stringify({groups,externalNetworkCalls:0}));

/** Offline visitor-analytics checks for the customer-site Worker: which responses
 * are counted, the exact signed payload (cross-checked against Node crypto and a
 * pgcrypto vector), referrer/device/country rules, privacy (no IP or User-Agent
 * leaves the Worker), failure isolation, and a real local workerd run. Every
 * upstream call is mocked; no Cloudflare or Supabase API is contacted. */
import assert from 'node:assert/strict';
import {mkdtemp,rm,lstat} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,createHmac} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,Response as RuntimeResponse} from 'miniflare';
import worker from './_worker.js';
import {ANALYTICS_BOT_PATTERN,deviceFromUserAgent,isBotUserAgent,siteViewMessage,hmacHex} from './analytics.js';
import {PRODUCTION_SUPABASE_URL,STAGING_SUPABASE_URL,STAGING_APP_ORIGIN} from './namespace-policy.js';

const KEY='sb_publishable_synthetic_analytics';
const SECRET='synthetic-analytics-signing-secret-'.repeat(2);
const PROD={SITE_NAMESPACE:'production',SUPABASE_URL:PRODUCTION_SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:KEY,SITES_DOMAIN:'makeborne.site',ALLOW_LOCAL_SUPABASE:'false',APP_ORIGIN:'https://makeborne.com',LEGACY_SITES_HOST:'sites.makeborne.com',ANALYTICS_SIGNING_SECRET:SECRET};
const STAGE={...PROD,SITE_NAMESPACE:'staging',SUPABASE_URL:STAGING_SUPABASE_URL,APP_ORIGIN:STAGING_APP_ORIGIN,LEGACY_SITES_HOST:'legacy-disabled.makeborne.site',SITE_INDEXING_ENABLED:'false'};
const LOCAL={...PROD,SITE_NAMESPACE:'local',SUPABASE_URL:'http://127.0.0.1:55321',ALLOW_LOCAL_SUPABASE:'true',SITES_DOMAIN:'localhost',APP_ORIGIN:'http://localhost:3205',LEGACY_SITES_HOST:'sites.localhost'};
const HTML='<!doctype html><html><head><title>Analytics fixture</title></head><body><div id="root">Analytics fixture</div></body></html>';
const IMAGE=Buffer.from('synthetic-analytics-raster'),HASH=createHash('sha256').update(IMAGE).digest('hex');
const IP='203.0.113.77';
const CHROME='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const IPAD='Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE='Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET='Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const CUBOT='Mozilla/5.0 (Linux; Android 12; CUBOT KINGKONG 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const BOTS=['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)','Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)','Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)','Twitterbot/1.0','Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)','WhatsApp/2.23.20.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36','Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)',
  'Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)','Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
  'curl/8.9.1','Wget/1.24.5','python-requests/2.32.3','Go-http-client/2.0','axios/1.7.7','node-fetch/1.0','Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 (compatible; Google-InspectionTool/1.0)','',' '];
const PEOPLE=[CHROME,IPHONE,IPAD,ANDROID_PHONE,ANDROID_TABLET,CUBOT,
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:131.0) Gecko/20100101 Firefox/131.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0]',
  'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 [LinkedInApp]/9.30',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'];
let groups=0;
const check=async(name,fn)=>{await fn();groups++;console.log('PASS '+name);};

function upstream(url,body,record) {
  const parsed=new URL(url);
  if(parsed.pathname==='/rest/v1/rpc/makeborne_resolve_site_host')return {status:200,value:body.p_host==='www.customer.com'?'good-dog':null};
  if(parsed.pathname==='/rest/v1/rpc/makeborne_read_hosted_site_v3') {
    if(body.p_slug==='broken-site')return {status:500,value:{message:'synthetic upstream failure'}};
    return {status:200,value:body.p_slug==='good-dog'?{html:HTML,script:null,interactive:false,revision:3}:null};
  }
  if(parsed.pathname==='/rest/v1/rpc/makeborne_read_hosted_site_file')return {status:200,value:{content_type:'image/webp',sha256:HASH,body:IMAGE.toString('base64')}};
  if(parsed.pathname==='/rest/v1/rpc/makeborne_record_site_view')return record(body);
  if(parsed.pathname==='/rest/v1/rpc/makeborne_read_site_paths')return {status:200,value:body.p_slug==='good-dog'?{paths:['/','/about','/pricing'],updated_at:null}:null};
  assert.fail('UNEXPECTED_UPSTREAM '+url);
}
function memoryCache() {
  const entries=new Map();
  return {default:{match:async request=>entries.get(request.url)?.clone(),put:async(request,response)=>{entries.set(request.url,response);}}};
}
/** Runs the Worker in-process with fetch, caches and console.error mocked. */
async function mocked(env,fn,{record=()=>({status:200,value:{recorded:true}})}={}) {
  const previous={fetch:globalThis.fetch,caches:globalThis.caches,error:console.error},calls=[],logs=[];
  globalThis.fetch=async(url,init)=>{
    const body=JSON.parse(init.body);calls.push({url,body,init});
    const result=await upstream(url,body,record);
    if(result instanceof Error)throw result;
    return Response.json(result.value,{status:result.status});
  };
  globalThis.caches=memoryCache();
  console.error=(...args)=>logs.push(args.join(' '));
  const pending=[];
  try {
    await fn({
      request:async(url,init={},cf)=>{
        const request=new Request(url,init);
        if(cf)Object.defineProperty(request,'cf',{value:cf});
        const response=await worker.fetch(request,env,{waitUntil:promise=>pending.push(promise)});
        await Promise.all(pending.splice(0));return response;
      },
      raw:(url,init={})=>worker.fetch(new Request(url,init),env,{waitUntil:promise=>pending.push(promise)}),
      settle:()=>Promise.all(pending.splice(0)),
      records:()=>calls.filter(call=>call.url.endsWith('/rpc/makeborne_record_site_view')),calls,logs,
    });
  } finally {
    globalThis.fetch=previous.fetch;console.error=previous.error;
    if(previous.caches===undefined)delete globalThis.caches;else globalThis.caches=previous.caches;
  }
}
const browser=(extra={})=>({headers:{'User-Agent':CHROME,'CF-Connecting-IP':IP,...extra}});
const utcDay=stamp=>new Date(stamp).toISOString().slice(0,10);
function expectedVisitor(stamp,slug,ip=IP,agent=CHROME,secret=SECRET) {
  return createHash('sha256').update(`${utcDay(stamp)}|${slug}|${ip}|${agent}|${secret}`).digest('hex');
}
function contractString(body) {
  return `${body.p_stamp}.${body.p_slug}|${body.p_path}|${body.p_referrer}|${body.p_country}|${body.p_device}|${body.p_visitor}`;
}
const FIELDS=['p_slug','p_path','p_referrer','p_country','p_device','p_visitor','p_stamp','p_signature'];

await check('signature contract matches Node crypto and the pgcrypto vector',async()=>{
  // Computed with extensions.hmac(..., 'sha256') on the local Supabase stack for this exact string.
  const vector={p_stamp:1760000000000,p_slug:'good-dog',p_path:'/about',p_referrer:'www.google.com',p_country:'DE',p_device:'mobile',p_visitor:'ab'.repeat(32)};
  const message=siteViewMessage(vector),secret='synthetic-analytics-vector-secret-0123456789';
  assert.equal(message,'1760000000000.good-dog|/about|www.google.com|DE|mobile|'+'ab'.repeat(32));
  assert.equal(await hmacHex(secret,message),'4d4fd5fe81baf9695085aa073e2e4970cc649a38f615fafd17cb7a456c5a28be');
  assert.equal(await hmacHex(secret,message),createHmac('sha256',secret).update(message).digest('hex'));
});

await check('one signed view per 200 GET document; payload has only contract fields and no IP or User-Agent',async()=>{
  await mocked(PROD,async({request,records,calls})=>{
    const before=Date.now();
    const response=await request('https://good-dog.makeborne.site/about?utm_source=news&email=a@b.example#top',browser({Referer:'https://www.google.com/search?q=dogs',Cookie:'session=secret'}),{country:'DE'});
    const after=Date.now();
    assert.equal(response.status,200);assert.match(await response.text(),/Analytics fixture/);
    assert.equal(records().length,1);
    const call=records()[0],body=call.body;
    assert.equal(call.url,PRODUCTION_SUPABASE_URL+'/rest/v1/rpc/makeborne_record_site_view');
    assert.deepEqual(Object.keys(body).sort(),[...FIELDS].sort());
    assert.deepEqual(call.init.headers,{apikey:KEY,'Content-Type':'application/json'},'publishable key only; no cookies or visitor headers forwarded');
    assert.equal(call.init.method,'POST');assert.equal(call.init.redirect,'manual');
    const list=calls.find(item=>item.url.endsWith('/rpc/makeborne_read_site_paths'));
    assert.deepEqual([list.body,list.init.headers],[{p_slug:'good-dog'},{apikey:KEY,'Content-Type':'application/json'}],'the page-list read forwards nothing from the visitor');
    assert.equal(response.headers.get('X-Robots-Tag'),null,'a listed nested page is indexable');
    assert.ok(Number.isInteger(body.p_stamp)&&body.p_stamp>=before&&body.p_stamp<=after,'stamp is the request time in ms');
    assert.equal(body.p_slug,'good-dog');assert.equal(body.p_path,'/about','query and fragment stripped');
    assert.equal(body.p_referrer,'www.google.com');assert.equal(body.p_country,'DE');assert.equal(body.p_device,'desktop');
    assert.equal(body.p_visitor,expectedVisitor(body.p_stamp,'good-dog'));
    assert.equal(body.p_signature,createHmac('sha256',SECRET).update(contractString(body)).digest('hex'));
    const serialized=JSON.stringify(body);
    for(const secret of [IP,CHROME,'Windows NT','session=secret','utm_source','a@b.example',SECRET,KEY])assert.ok(!serialized.includes(secret),'payload leaks '+secret);
    assert.ok(calls.filter(entry=>entry!==call).every(entry=>!JSON.stringify(entry.body).includes(IP)),'IP never sent anywhere');
  });
});

await check('custom hosts are counted under the resolved slug; the visitor rotates daily and per site',async()=>{
  await mocked(PROD,async({request,records})=>{
    assert.equal((await request('https://www.customer.com/',browser({Referer:'https://www.customer.com/pricing'}))).status,200);
    assert.equal(records().length,1);
    const body=records()[0].body;
    assert.equal(body.p_slug,'good-dog');assert.equal(body.p_path,'/');assert.equal(body.p_referrer,'','own host is not a referrer');
    assert.equal(body.p_visitor,expectedVisitor(body.p_stamp,'good-dog'));
    assert.notEqual(expectedVisitor(body.p_stamp,'good-dog'),expectedVisitor(body.p_stamp+86_400_000,'good-dog'),'hash rotates with the UTC day');
    assert.notEqual(expectedVisitor(body.p_stamp,'good-dog'),expectedVisitor(body.p_stamp,'other-site'),'hash differs per site');
  });
  await mocked({...STAGE,STAGING_CUSTOM_HOSTS:''},async({request,records})=>{
    assert.equal((await request('https://release-check.makeborne.site/',browser())).status,404,'fixture has no release-check site');
    assert.equal(records().length,0);
  });
});

await check('counted: 200 and 304 document views; never: HEAD, files, robots, /_mb/*, 404, 503, other methods, enquiries',async()=>{
  await mocked(PROD,async({request,records})=>{
    const head=await request('https://good-dog.makeborne.site/',{...browser(),method:'HEAD'});assert.equal(head.status,200);
    const document=await request('https://good-dog.makeborne.site/',browser());const etag=document.headers.get('ETag');
    assert.equal(records().length,1);
    const revalidated=await request('https://good-dog.makeborne.site/',browser({'If-None-Match':etag}));assert.equal(revalidated.status,304);
    assert.equal(records().length,2,'a returning visitor revalidating a cached page is a real view');
    const file=await request('https://good-dog.makeborne.site/images/hero.webp',browser());assert.equal(file.status,200);
    const robots=await request('https://good-dog.makeborne.site/robots.txt',browser());assert.equal(robots.status,200);
    const internal=await request('https://good-dog.makeborne.site/_mb/stats',browser());assert.equal(internal.status,200,'/_mb/stats is served as a document route');
    assert.equal((await request('https://missing-site.makeborne.site/',browser())).status,404);
    assert.equal((await request('https://good-dog.makeborne.site/nope.txt',browser())).status,404);
    assert.equal((await request('https://broken-site.makeborne.site/',browser())).status,503);
    assert.equal((await request('https://unknown.customer.com/',browser())).status,404);
    assert.equal((await request('https://good-dog.makeborne.site/',{...browser(),method:'OPTIONS'})).status,405);
    assert.equal((await request('https://good-dog.makeborne.site/_mb/enquiries',{...browser({Origin:'https://good-dog.makeborne.site','content-type':'application/json'}),method:'POST',body:'{}'})).status,503);
    assert.equal((await request('http://good-dog.makeborne.site/',browser())).status,308);
    assert.equal(records().length,2,'only the 200 and 304 GET documents were counted');
  });
});

await check('never counted: bots, crawlers, previews, monitors, prefetch/prerender and non-document fetches',async()=>{
  for(const agent of BOTS)assert.ok(isBotUserAgent(agent),'not a bot: '+JSON.stringify(agent));
  assert.ok(isBotUserAgent(null)&&isBotUserAgent(undefined));
  for(const agent of PEOPLE)assert.ok(!isBotUserAgent(agent),'person treated as bot: '+agent);
  assert.ok(ANALYTICS_BOT_PATTERN.flags.includes('i'));
  await mocked(PROD,async({request,records})=>{
    for(const agent of BOTS)assert.equal((await request('https://good-dog.makeborne.site/',{headers:{'User-Agent':agent,'CF-Connecting-IP':IP}})).status,200);
    assert.equal((await request('https://good-dog.makeborne.site/',{headers:{'CF-Connecting-IP':IP}})).status,200,'no User-Agent');
    for(const headers of [{'Sec-Purpose':'prefetch'},{'Sec-Purpose':'prefetch;prerender'},{'Sec-Purpose':'prefetch; anonymous-client-ip'},{Purpose:'prefetch'},{'X-Purpose':'preview'},{'X-Moz':'prefetch'},
      {'Sec-Fetch-Dest':'empty'},{'Sec-Fetch-Dest':'iframe'},{'Sec-Fetch-Dest':'script'}])
      assert.equal((await request('https://good-dog.makeborne.site/',browser(headers))).status,200,JSON.stringify(headers));
    assert.equal(records().length,0);
    assert.equal((await request('https://good-dog.makeborne.site/',browser({'Sec-Fetch-Dest':'document','Sec-Fetch-Mode':'navigate'}))).status,200);
    assert.equal(records().length,1,'a real navigation is counted');
  });
});

await check('disabled without a 32+ character secret, without a client IP, and on local unless ANALYTICS_LOCAL=true',async()=>{
  for(const env of [{...PROD,ANALYTICS_SIGNING_SECRET:undefined},{...PROD,ANALYTICS_SIGNING_SECRET:''},{...PROD,ANALYTICS_SIGNING_SECRET:'x'.repeat(31)},{...PROD,ANALYTICS_SIGNING_SECRET:42}]) {
    await mocked(env,async({request,records})=>{
      assert.equal((await request('https://good-dog.makeborne.site/',browser())).status,200);assert.equal(records().length,0);
    });
  }
  await mocked(PROD,async({request,records})=>{
    assert.equal((await request('https://good-dog.makeborne.site/',{headers:{'User-Agent':CHROME}})).status,200);assert.equal(records().length,0,'no CF-Connecting-IP in production');
  });
  await mocked(LOCAL,async({request,records})=>{
    assert.equal((await request('http://good-dog.localhost:8787/',browser())).status,200);assert.equal(records().length,0,'local is off by default');
  });
  await mocked({...LOCAL,ANALYTICS_LOCAL:'true'},async({request,records})=>{
    assert.equal((await request('http://good-dog.localhost:8787/',{headers:{'User-Agent':CHROME}})).status,200);
    assert.equal(records().length,1);assert.ok(records()[0].url.startsWith(LOCAL.SUPABASE_URL+'/'),'local records only against the local stack');
    assert.equal(records()[0].body.p_visitor,expectedVisitor(records()[0].body.p_stamp,'good-dog','local'));
  });
  // Without a waitUntil context (the in-process hosting check) nothing is scheduled and serving works.
  await mocked(PROD,async({records})=>{
    const response=await worker.fetch(new Request('https://good-dog.makeborne.site/',browser()),PROD);
    assert.equal(response.status,200);assert.equal(records().length,0);
  });
});

await check('referrer, device and country rules',async()=>{
  const cases=[
    [{Referer:'https://WWW.Google.COM/search?q=x'},'www.google.com'],[{Referer:'https://news.example.org:8443/a'},'news.example.org'],
    [{Referer:'http://192.0.2.10/'},'192.0.2.10'],[{Referer:'https://good-dog.makeborne.site/contact'},''],[{Referer:'https://makeborne.com/studio'},''],
    [{Referer:'https://app.makeborne.com/'},''],[{Referer:'https://other-site.makeborne.site/'},''],[{Referer:'https://makeborne.site/'},''],
    [{Referer:'android-app://com.google.android.gm/'},''],[{Referer:'not a url'},''],[{Referer:'https://[2001:db8::1]/'},''],
    [{Referer:'https://xn--bcher-kva.example/'},'xn--bcher-kva.example'],[{Referer:`https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.example.com/`},''],[{},''],
  ];
  await mocked(PROD,async({request,records})=>{
    for(const [headers] of cases)await request('https://good-dog.makeborne.site/',browser(headers));
    assert.deepEqual(records().map(call=>call.body.p_referrer),cases.map(([,expected])=>expected));
  });
  assert.equal(deviceFromUserAgent(CHROME),'desktop');assert.equal(deviceFromUserAgent(IPHONE),'mobile');assert.equal(deviceFromUserAgent(IPAD),'tablet');
  assert.equal(deviceFromUserAgent(ANDROID_PHONE),'mobile');assert.equal(deviceFromUserAgent(ANDROID_TABLET),'tablet');assert.equal(deviceFromUserAgent(CUBOT),'mobile');
  assert.equal(deviceFromUserAgent('Mozilla/5.0 (Linux; Android 11; KFTRWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/131.3.1 like Chrome/131.0 Safari/537.36'),'tablet');
  assert.equal(deviceFromUserAgent(CHROME,'?1'),'mobile','Sec-CH-UA-Mobile client hint');assert.equal(deviceFromUserAgent(''),'desktop');
  await mocked(PROD,async({request,records})=>{
    for(const [agent,cf] of [[IPHONE,{country:'DE'}],[IPAD,{country:'T1'}],[ANDROID_TABLET,{country:'XX'}],[ANDROID_PHONE,{country:'de'}],[CHROME,{}],[CHROME,undefined],[CHROME,{country:'USA'}]])
      await request('https://good-dog.makeborne.site/',{headers:{'User-Agent':agent,'CF-Connecting-IP':IP}},cf);
    assert.deepEqual(records().map(call=>[call.body.p_device,call.body.p_country]),[['mobile','DE'],['tablet',''],['tablet',''],['mobile',''],['desktop',''],['desktop',''],['desktop','']]);
  });
  await mocked(PROD,async({request,records})=>{
    const long='/'+'a'.repeat(230);
    assert.equal((await request('https://good-dog.makeborne.site'+long,browser())).status,200);
    assert.equal(records()[0].body.p_path,long.slice(0,200));
    await request('https://good-dog.makeborne.site/Caf%C3%A9/Menu/',browser());
    assert.equal(records()[1].body.p_path,'/Caf%C3%A9/Menu/','case kept, percent-encoded');
    await request('https://good-dog.makeborne.site/index.html',browser());assert.equal(records()[2].body.p_path,'/index.html');
  });
});

await check('serving is unaffected when recording fails, hangs or is rejected; failures log no personal data',async()=>{
  for(const [label,record,expected] of [
    ['bad signature',()=>({status:400,value:{code:'MB401',message:'Invalid site view signature',details:null,hint:null}}),{status:400,code:'MB401'}],
    ['stale',()=>({status:400,value:{code:'MB408'}}),{status:400,code:'MB408'}],
    ['server error',()=>({status:500,value:'not an object'}),{status:500,code:null}],
    ['network',()=>new TypeError('fetch failed'),{type:'TypeError'}],
    ['visitor cap',()=>({status:200,value:{recorded:false,reason:'visitor_cap'}}),null],
  ]) {
    await mocked(PROD,async({request,records,logs})=>{
      const response=await request('https://good-dog.makeborne.site/',browser({Referer:'https://www.google.com/'}),{country:'DE'});
      assert.equal(response.status,200,label);assert.match(await response.text(),/Analytics fixture/);
      assert.equal(response.headers.get('Cache-Control'),'public, max-age=0, must-revalidate');
      assert.equal(records().length,1,label);
      if(!expected){assert.deepEqual(logs,[],label);return;}
      assert.equal(logs.length,1,label);
      const event=JSON.parse(logs[0]);assert.deepEqual(event,{event:'site_view_record_error',...expected},label);
      for(const secret of [IP,CHROME,'good-dog','www.google.com',SECRET])assert.ok(!logs[0].includes(secret),label+' log leaks '+secret);
    },{record});
  }
  // The response is returned before recording finishes.
  let release,finished=false;const gate=new Promise(done=>{release=done;});
  await mocked(PROD,async({raw,settle,records})=>{
    const response=await raw('https://good-dog.makeborne.site/',browser());
    assert.equal(response.status,200);assert.match(await response.text(),/Analytics fixture/);
    assert.equal(finished,false,'the response did not wait for the recording');
    release();await settle();assert.equal(finished,true);assert.equal(records().length,1);
  },{record:async()=>{await gate;finished=true;return {status:200,value:{recorded:true}};}});
});

// Real local workerd: waitUntil, Web Crypto and the outbound call in the actual runtime.
const directory=await mkdtemp(join(tmpdir(),'makeborne-site-analytics-'));
const bundle=(await build({entryPoints:[resolve('infra/customer-sites/_worker.js')],bundle:true,format:'esm',platform:'browser',write:false,logLevel:'silent'})).outputFiles[0].text;
let workerdRequests=0;
try {
  const calls=[];
  const env=Object.fromEntries(Object.entries(PROD).map(([key,value])=>[key,{type:'json',value}]));
  const runtime=new Miniflare({host:'127.0.0.1',cf:false,logRequests:false,telemetry:{enabled:false},resourcePersistencePath:join(directory,'production'),workers:[{
    config:{name:'site-analytics-production',compatibilityDate:'2026-10-05',env,exports:{},manifest:{mainModule:'worker.mjs',modulesRoot:directory,modules:{'worker.mjs':{type:'esm',contents:bundle}}}},
    dev:{stripCfConnectingIp:false,outboundService:{type:'fetcher',handler:async request=>{
      assert.ok(request.url.startsWith(PROD.SUPABASE_URL+'/rest/v1/rpc/'),'unexpected external transport');
      const body=await request.json();calls.push({url:request.url,body,apikey:request.headers.get('apikey')});
      const {status,value}=upstream(request.url,body,()=>({status:200,value:{recorded:true}}));
      return new RuntimeResponse(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
    }}}
  }]});
  try {
    await runtime.ready;
    await check('real local workerd records once per document view with a valid signature',async()=>{
      const request=async(url,init={})=>{workerdRequests++;const response=await runtime.dispatchFetch(url,{...init,redirect:'manual'});await response.arrayBuffer();return response;};
      const records=()=>calls.filter(call=>call.url.endsWith('/makeborne_record_site_view'));
      const settle=async count=>{for(let i=0;i<40&&records().length<count;i++)await new Promise(done=>setTimeout(done,50));};
      // The runtime's request.cf carries the country, as on Cloudflare.
      assert.equal((await request('https://good-dog.makeborne.site/pricing',{cf:{country:'NL'},headers:{'User-Agent':IPHONE,'CF-Connecting-IP':IP,Referer:'https://duckduckgo.com/'}})).status,200);
      await settle(1);
      assert.equal(records().length,1);
      const body=records()[0].body;
      assert.equal(records()[0].apikey,KEY);
      assert.deepEqual({...body,p_stamp:0,p_visitor:'',p_signature:''},{p_slug:'good-dog',p_path:'/pricing',p_referrer:'duckduckgo.com',p_country:'NL',p_device:'mobile',p_visitor:'',p_stamp:0,p_signature:''});
      assert.equal(body.p_visitor,expectedVisitor(body.p_stamp,'good-dog',IP,IPHONE));
      assert.equal(body.p_signature,createHmac('sha256',SECRET).update(contractString(body)).digest('hex'));
      assert.equal((await request('https://good-dog.makeborne.site/',{method:'HEAD',headers:{'User-Agent':IPHONE,'CF-Connecting-IP':IP}})).status,200);
      assert.equal((await request('https://good-dog.makeborne.site/images/hero.webp',{headers:{'User-Agent':IPHONE,'CF-Connecting-IP':IP}})).status,200);
      assert.equal((await request('https://good-dog.makeborne.site/',{headers:{'User-Agent':BOTS[0],'CF-Connecting-IP':IP}})).status,200);
      assert.equal((await request('https://good-dog.makeborne.site/',{headers:{'User-Agent':IPHONE,'CF-Connecting-IP':IP,'Sec-Purpose':'prefetch'}})).status,200);
      await new Promise(done=>setTimeout(done,300));
      assert.equal(records().length,1,'HEAD, files, bots and prefetch were not counted');
    });
  } finally {await runtime.dispose();}
} finally {
  // Generated exact temp directory only; no project paths are removed.
  assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('makeborne-site-analytics-'));
  assert.equal((await lstat(directory)).isSymbolicLink(),false);
  await rm(directory,{recursive:true,force:true});
}
console.log(JSON.stringify({groups,workerdRequests,externalNetworkCalls:0,cloudQualified:false}));

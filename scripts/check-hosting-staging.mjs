// Runs the real Worker with an HTTP RPC shim over real anonymous-role SQL.
// This qualifies application behavior, not deployed Cloudflare DNS/TLS/cache.
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from 'pg';
import worker from '../infra/customer-sites/_worker.js';
const url=new URL(process.argv[2]??'');
assert.equal(url.hostname,'127.0.0.1'); assert.equal(url.port,'55433'); assert.equal(url.pathname,'/makeborne_populated');
const db=new pg.Client({connectionString:url.href}); await db.connect();
const server=http.createServer(async(req,res)=>{
 try {
  assert.equal(req.url,'/rest/v1/rpc/makeborne_read_hosted_site_v3');
  assert.equal(req.headers.apikey,'sb_publishable_local_fixture');
  assert.equal(req.headers.cookie,undefined);
  let body=''; for await(const chunk of req) {body+=chunk;assert(body.length<1000)}
  const args=JSON.parse(body);
  await db.query('begin'); await db.query('set local role anon');
  const {rows}=await db.query('select public.makeborne_read_hosted_site_v3($1,$2) as result',[args.p_slug,args.p_path]);
  await db.query('rollback');
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(rows[0].result));
 } catch {await db.query('rollback');res.writeHead(500);res.end('{}')}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
 const env={SUPABASE_URL:`http://127.0.0.1:${server.address().port}`,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_local_fixture',ALLOW_LOCAL_SUPABASE:'true',SITES_DOMAIN:'sites.example.test'};
 const request=(path='',method='GET',headers={})=>new Request(`https://preserve-site.sites.example.test/${path}`,{method,headers});
 const response=await worker.fetch(request('','GET',{Cookie:'private-session=must-not-forward'}),env);
 assert.equal(response.status,200);assert((await response.text()).includes('Preserve published site'));
 assert(response.headers.get('Content-Security-Policy').includes("script-src 'none'"));
 assert.equal((await worker.fetch(request('','HEAD'),env)).status,200);
 assert.equal((await worker.fetch(request('','POST'),env)).status,405);
 const cached=await worker.fetch(request('','GET',{'If-None-Match':response.headers.get('ETag')}),env);assert.equal(cached.status,304);
 assert.equal((await worker.fetch(new Request('https://missing-site.sites.example.test/'),env)).status,404);
 const redirect=await worker.fetch(new Request('https://sites.makeborne.com/preserve-site'),env);
 assert.equal(redirect.status,301);assert.equal(redirect.headers.get('Location'),'https://preserve-site.sites.example.test/');
 console.log('PASS actual Worker + HTTP + anonymous SQL: preserved publication, CSP, HEAD, ETag, missing-site 404, mutation rejection, legacy redirect; visitor cookie not forwarded');
} finally {await new Promise(resolve=>server.close(resolve));await db.end()}


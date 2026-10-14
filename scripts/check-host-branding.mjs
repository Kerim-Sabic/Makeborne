import assert from 'node:assert/strict';
import {composeSiteDocument} from '../infra/customer-sites/site-policy.js';
import {stagingGatewayHeaders} from '../infra/customer-sites/forms.js';
import worker from '../infra/customer-sites/_worker.js';
const html='<!doctype html><html><head></head><body><div id="root"><h1>Studio</h1></div></body></html>';
const staticPage=composeSiteDocument(html,{interactive:false,script:null,branding:true});
assert.match(staticPage,/href="https:\/\/makeborne.com\/" rel="nofollow noopener"/);
assert.match(staticPage,/<\/div><footer data-makeborne-attribution/);
assert.equal((staticPage.match(/data-makeborne-attribution/g)||[]).length,1);
assert(!staticPage.includes('<script'));
const live=composeSiteDocument(html,{interactive:true,script:'/_mb/app-1234567890abcdef.js',branding:true});
assert.match(live,/<script type="module"/);assert.match(live,/Made with Makeborne/);
const base={SUPABASE_URL:'https://xzwikrunwpurxnxgkznh.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SITES_DOMAIN:'makeborne.site',APP_ORIGIN:'https://makeborne-release-staging-jex4zjcir-kerimsabic-6594s-projects.vercel.app',SITE_INDEXING_ENABLED:'false'};
for(const host of ['makeborne.site','www.makeborne.site']){
 const response=await worker.fetch(new Request(`https://${host}/`),base);
 assert.equal(response.status,308);assert.equal(response.headers.get('location'),'https://makeborne.com/');
}
const robots=await worker.fetch(new Request('https://atelier.makeborne.site/robots.txt'),base);
assert.equal(await robots.text(),'User-agent: *\nDisallow: /\n');
const insecure=await worker.fetch(new Request('http://atelier.makeborne.site/contact?from=menu'),base);
assert.equal(insecure.status,308);assert.equal(insecure.headers.get('location'),'https://atelier.makeborne.site/contact?from=menu');
assert.deepEqual(stagingGatewayHeaders({}, {appOrigin:base.APP_ORIGIN}),{});
const token=`e30.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+600})).toString('base64url')}.fixture`;
const env={...base,STAGING_VERCEL_OIDC_TOKEN:token};
assert.equal(stagingGatewayHeaders(env,{appOrigin:base.APP_ORIGIN})['x-vercel-trusted-oidc-idp-token'],token);
assert.throws(()=>stagingGatewayHeaders(env,{appOrigin:'https://makeborne.com'}),/invalid_staging_gateway/);
assert.throws(()=>stagingGatewayHeaders({...env,SUPABASE_URL:'https://rklojnmmsmhwnkbzuidp.supabase.co'},{appOrigin:base.APP_ORIGIN}),/invalid_staging_gateway/);
assert.throws(()=>stagingGatewayHeaders({...env,STAGING_VERCEL_OIDC_TOKEN:'invalid'},{appOrigin:base.APP_ORIGIN}),/expired_staging_gateway/);
// The owner can remove the badge in Settings; the reader sends branding:false.
const realFetch=globalThis.fetch;
const served=async branding=>{
 globalThis.fetch=async()=>new Response(JSON.stringify({html,interactive:false,script:null,revision:3,...(branding===undefined?{}:{branding})}),{headers:{"content-type":"application/json"}});
 try{const response=await worker.fetch(new Request('https://atelier.makeborne.site/'),base);return {status:response.status,etag:response.headers.get('etag'),body:await response.text()};}
 finally{globalThis.fetch=realFetch;}
};
const shown=await served(true),hidden=await served(false),legacy=await served(undefined);
assert.equal(shown.status,200);assert.match(shown.body,/data-makeborne-attribution/);
assert.equal(hidden.status,200);assert(!hidden.body.includes('data-makeborne-attribution'));assert(!hidden.body.includes('Made with Makeborne'));
assert.notEqual(shown.etag,hidden.etag,'turning the badge off must change the document ETag');
assert.match(legacy.body,/data-makeborne-attribution/,'a reader without the flag keeps the badge');
console.log('PASS attribution (owner can remove it), static and interactive rendering, apex redirects, staging noindex, and gateway token isolation/expiry');

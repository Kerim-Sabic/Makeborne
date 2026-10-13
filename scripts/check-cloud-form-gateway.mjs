import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import worker from '../infra/customer-sites/_worker.js';
const root='work/release-auth-stack/',fixture=JSON.parse(fs.readFileSync(root+'cloud-hosting-fixture.json'));
assert.equal(fixture.base,'https://makeborne-release-staging-fxksbob3p-kerimsabic-6594s-projects.vercel.app');
const keys=JSON.parse(fs.readFileSync(root+'cloud-api-keys.json')).keys,{secret}=JSON.parse(fs.readFileSync(root+'cloud-forms-secret.json')),{token,expiresAt}=JSON.parse(fs.readFileSync(root+'cloud-forms-oidc.json'));
const env={SUPABASE_URL:'https://xzwikrunwpurxnxgkznh.supabase.co',SUPABASE_PUBLISHABLE_KEY:keys.find(k=>k.type==='publishable').api_key,SITES_DOMAIN:'makeborne.site',APP_ORIGIN:fixture.base,FORMS_SIGNING_SECRET:secret,STAGING_VERCEL_OIDC_TOKEN:token,SITE_INDEXING_ENABLED:'false'};
const origin=`https://${fixture.slug}.makeborne.site`,payload={requestId:randomUUID(),name:'Staging gateway visitor',email:'visitor@example.invalid',message:'Cloud staging form qualification: please arrange a demo.'};
const submit=async(value=payload)=>{const response=await worker.fetch(new Request(origin+'/_mb/enquiries',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.17'},body:JSON.stringify(value)}),env);return {status:response.status,body:await response.json()};};
const report={productionTouched:false,paidCalls:0,cloudApiAndSql:true,publicCloudflareTransport:false,temporaryGatewayTokenExpiresAt:expiresAt,passed:[]};
try{
 const first=await submit();assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.body.accepted,true);report.passed.push('Real signed Worker handler → protected Vercel staging gateway → staging SQL accepted');
 assert.equal((await submit()).status,200);report.passed.push('Duplicate form delivery accepted idempotently');
 assert.equal((await submit({...payload,message:'Changed retry'})).status,409);report.passed.push('Changed duplicate payload rejected');
 const cross=await worker.fetch(new Request(origin+'/_mb/enquiries',{method:'POST',headers:{Origin:'https://unrelated.example','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.17'},body:JSON.stringify(payload)}),env);assert.equal(cross.status,403);report.passed.push('Cross-origin submission denied');
 const unsigned=await fetch(fixture.base+'/api/hosting/enquiries',{method:'POST',headers:{'x-vercel-trusted-oidc-idp-token':token,'Content-Type':'application/json'},body:'{}'});assert.equal(unsigned.status,401);report.passed.push('Unsigned app-gateway request denied despite valid staging transport authentication');
 console.log(JSON.stringify(report));
}catch(error){report.error=error.message;console.error(error.message);process.exitCode=1;}finally{fs.writeFileSync('docs/release-review/cloud-form-gateway.json',JSON.stringify(report,null,2)+'\n');}

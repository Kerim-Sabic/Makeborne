import fs from 'node:fs';import https from 'node:https';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const root='work/release-auth-stack/',fixture=JSON.parse(fs.readFileSync(root+'cloud-hosting-fixture.json'));
const host=fixture.slug+'.makeborne.site';assert(/^(?:relay-demo|relay-atelier)-[a-f0-9]{8}\.makeborne\.site$/.test(host));
const dns=await fetch('https://dns.google/resolve?name='+host+'&type=A').then(r=>r.json());assert.equal(dns.Status,0);const address=dns.Answer?.find(a=>a.type===1)?.data;assert(address);
export function request(host,path='/',method='GET',body,headers={}){
 return new Promise((resolve,reject)=>{const req=https.request({hostname:host,path,method,headers,...(body?{headers:{...headers,'Content-Length':Buffer.byteLength(body)}}:{}),lookup:(_host,options,cb)=>cb(null,options.all?[{address,family:4}]:address,4),rejectUnauthorized:true,timeout:20000},res=>{const tlsAuthorized=res.socket.authorized;const chunks=[];let n=0;res.on('data',c=>{n+=c.length;if(n>6500000){req.destroy(Error('Oversized public response'));return;}chunks.push(c);});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks),tlsAuthorized}));});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Public request timed out')));if(body)req.write(body);req.end();});
}
const report={hostname:host,productionTouched:false,paidCalls:0,tlsVerification:true,systemDnsPending:true,resolution:'Public Google DNS answer used for connection; HTTPS certificate validation remained enabled',passed:[]};
try{
 const normal=await fetch('https://'+host,{redirect:'manual'});assert.equal(normal.status,200);await normal.body?.cancel();report.systemDnsPending=false;report.passed.push('Normal public DNS and HTTPS resolve without connection overrides');
 const apex=await request('makeborne.site');assert.equal(apex.status,308);assert.equal(apex.headers.location,'https://makeborne.com/');report.passed.push('Bare domain permanently redirects to makeborne.com');
 const page=await request(host);assert.equal(page.status,200);assert.equal(page.tlsAuthorized,true);const html=page.body.toString();assert.match(html,/Made with Makeborne/);assert.match(html,/href="https:\/\/makeborne.com\/" rel="nofollow noopener"/);assert.match(html,new RegExp('https://'+host.replaceAll('.','\\.')));assert.equal(page.headers['x-robots-tag'],'noindex');report.passed.push('Public Cloudflare website: valid HTTPS, correct canonical address, attribution, staging noindex');
 const script=html.match(/<script type="module" src="([^"]+)"/)?.[1];assert(script);assert.equal((await request(host,script)).status,200);
 const style=html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];assert(style);assert.equal((await request(host,style)).status,200);report.passed.push('Published JavaScript and stylesheet load through real Cloudflare host');
 const missing=await request('unpublished-'+randomUUID().slice(0,8)+'.makeborne.site');assert.equal(missing.status,404);report.passed.push('Unknown website address returns 404');
 if(fixture.oldSlug!==fixture.slug){assert.equal((await request(fixture.oldSlug+'.makeborne.site')).status,404);report.passed.push('Retired website address returns 404 after rename');}
 const payload={requestId:randomUUID(),name:'Public hosting test visitor',email:'visitor@example.invalid',message:'Actual Cloudflare transport qualification. Please arrange a demonstration.'};const body=JSON.stringify(payload),headers={Origin:'https://'+host,'Content-Type':'application/json'};
 const accepted=await request(host,'/_mb/enquiries','POST',body,headers);assert.equal(accepted.status,200,accepted.body.toString());assert.equal(JSON.parse(accepted.body).accepted,true);assert.equal((await request(host,'/_mb/enquiries','POST',body,headers)).status,200);assert.equal((await request(host,'/_mb/enquiries','POST',JSON.stringify({...payload,message:'Changed'}),headers)).status,409);report.passed.push('Real public Cloudflare Worker → protected staging Vercel → SQL accepts form once and rejects changed retry');
 assert.equal((await request(host,'/_mb/enquiries','POST',JSON.stringify({...payload,requestId:randomUUID(),email:'not-an-email'}),headers)).status,400);
 assert.equal((await request(host,'/_mb/enquiries','POST','not json',headers)).status,400);
 assert.equal((await request(host,'/_mb/enquiries','POST',JSON.stringify({...payload,requestId:randomUUID()}),{...headers,Origin:'https://attacker.example'})).status,403);
 assert.equal((await request(host,'/_mb/enquiries','GET')).status,405);
 report.passed.push('Invalid email and malformed body refused (400); cross-origin submission refused (403); GET refused (405)');
 // The gateway itself must refuse unsigned calls even from a client that can reach the protected preview.
 const gateway=await fetch(JSON.parse(fs.readFileSync('docs/release-review/staging-worker-refresh.json','utf8')).appOrigin+'/api/hosting/enquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:fixture.slug,...payload}),redirect:'manual'});
 assert([401,403].includes(gateway.status),'unsigned app gateway call returned '+gateway.status);await gateway.body?.cancel();
 report.passed.push('Direct call to the protected staging enquiry gateway without Worker credentials is refused ('+gateway.status+')');
 console.log(JSON.stringify(report));
}catch(e){report.error=e.message;console.error(e.message);process.exitCode=1;}finally{fs.writeFileSync('docs/release-review/public-hosting-http.json',JSON.stringify(report,null,2)+'\n');}

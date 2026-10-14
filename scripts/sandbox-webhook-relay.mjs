// Temporary sandbox-only ingress. Never proxy the app, login, or other APIs.
import http from 'node:http';
import {readFileSync,appendFileSync} from 'node:fs';
import {Webhook} from 'standardwebhooks';
import assert from 'node:assert/strict';
const config=JSON.parse(readFileSync('work/release-auth-stack/whop-sandbox.json','utf8'));
const local=JSON.parse(readFileSync('work/release-auth-stack/status.json','utf8').replace(/^\uFEFF/,''));
assert.equal(config.apiBase,'https://sandbox-api.whop.com/api/v1');
assert.equal(local.API_URL,'http://127.0.0.1:55435');
assert.match(config.relayPath??'',/^\/whop-sandbox\/[a-f0-9]{48}$/);
const server=http.createServer(async(req,res)=>{
  const end=(status)=>{res.writeHead(status,{'Cache-Control':'no-store'});res.end()};
  if(req.url!==config.relayPath||req.method!=='POST')return end(404);
  const names=['webhook-id','webhook-timestamp','webhook-signature'];
  if(names.some(name=>typeof req.headers[name]!=='string'))return end(400);
  if(Number(req.headers['content-length']??0)>512000)return end(413);
  req.setTimeout(10000,()=>req.destroy());
  try{
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>512000){end(413);req.destroy();return}chunks.push(chunk)}
    const body=Buffer.concat(chunks).toString('utf8');
    const headers=Object.fromEntries(names.map(n=>[n,req.headers[n]]));
    const current=JSON.parse(readFileSync('work/release-auth-stack/whop-sandbox.json','utf8'));
    try{new Webhook(Buffer.from(current.webhookSecret,'utf8').toString('base64')).verify(body,headers)}catch{return end(400)}
    const response=await fetch('http://127.0.0.1:3048/api/billing/webhook',{
      method:'POST',headers:{'Content-Type':'application/json',...Object.fromEntries(names.map(n=>[n,req.headers[n]]))},
      body,redirect:'error',signal:AbortSignal.timeout(35000),
    });
    // Do not disclose the app's response body to the public ingress.
    const result=await response.text();
    // Signed sandbox fixtures only, kept out of Git and release evidence.
    appendFileSync('work/release-auth-stack/webhook-deliveries.jsonl',JSON.stringify({at:new Date().toISOString(),headers,body,status:response.status,result})+'\n');
    end(response.status);
  }catch{if(!res.headersSent)end(503)}
});
server.requestTimeout=15000;
server.headersTimeout=10000;
server.listen(3051,'127.0.0.1',()=>console.log('Sandbox webhook-only relay listening on loopback port 3051'));

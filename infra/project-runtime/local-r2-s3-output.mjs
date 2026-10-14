/** Operator-owned local S3 protocol fixture backed by real workerd/R2.
 * Synthetic signing credentials only; all network access is loopback. */
import {createServer,request as httpRequest} from "node:http";
import {Readable} from "node:stream";
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {createLocalR2OutputRuntime} from "./local-r2-output.mjs";
const configuration=Object.freeze({accountId:"a".repeat(32),bucket:"makeborne-output-fixture",accessKeyId:"b".repeat(32),secretAccessKey:"c".repeat(64)});
const origin=`https://${configuration.accountId}.r2.cloudflarestorage.com`;
const sha=value=>createHash("sha256").update(value).digest("hex"),hmac=(key,value)=>createHmac("sha256",key).update(value).digest();
function authorized(request,body){
  const match=/^AWS4-HMAC-SHA256 Credential=([a-f0-9]{32})\/(\d{8})\/auto\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([a-f0-9]{64})$/.exec(request.headers.authorization??"");
  if(!match||match[1]!==configuration.accessKeyId||request.headers.host!==new URL(origin).host||request.headers["x-amz-content-sha256"]!==sha(body))return false;
  const [, ,date,names,signature]=match,headers=names.split(";");
  if(!headers.includes("host")||!headers.includes("x-amz-content-sha256")||!headers.includes("x-amz-date")||request.method==="PUT"&&(!headers.includes("if-none-match")||request.headers["if-none-match"]!=="*"))return false;
  if(request.headers["x-amz-date"]?.slice(0,8)!==date)return false;
  const canonicalHeaders=headers.map(name=>`${name}:${String(request.headers[name]??"").trim().replace(/\s+/g," ")}\n`).join("");
  const canonical=[request.method,request.url,"",canonicalHeaders,names,sha(body)].join("\n");
  const scope=`${date}/auto/s3/aws4_request`,toSign=["AWS4-HMAC-SHA256",request.headers["x-amz-date"],scope,sha(canonical)].join("\n");
  const key=hmac(hmac(hmac(hmac(`AWS4${configuration.secretAccessKey}`,date),"auto"),"s3"),"aws4_request");
  return timingSafeEqual(hmac(key,toSign),Buffer.from(signature,"hex"));
}
export async function createLocalR2S3OutputRuntime(directory){
  const r2=await createLocalR2OutputRuntime(directory),pending=new Set();let requests=0,denials=0;
  const server=createServer((req,res)=>{
    const run=async()=>{
      requests++;const chunks=[];let length=0;
      for await(const chunk of req){length+=chunk.length;if(length>50_000_000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
      const body=Buffer.concat(chunks);
      if(!authorized(req,body)||!req.url.startsWith(`/${configuration.bucket}/`)||!['GET','PUT'].includes(req.method)){denials++;res.writeHead(403);res.end();return;}
      const key=req.url.slice(configuration.bucket.length+2);
      if(req.method==='PUT'){
        const result=await r2.bucket.put(key,body,{onlyIf:{etagDoesNotMatch:"*"},sha256:sha(body)});
        res.writeHead(result?200:412);res.end();return;
      }
      const object=await r2.bucket.get(key);
      if(!object){res.writeHead(404,{'Content-Type':'application/xml'});res.end('<Error><Code>NoSuchKey</Code></Error>');return;}
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':object.size});
      const reader=object.body.getReader();try{while(true){const part=await reader.read();if(part.done)break;res.write(part.value);}}finally{reader.releaseLock();}res.end();
    };
    const task=run().catch(()=>{if(!res.headersSent)res.writeHead(503);res.end();});pending.add(task);task.finally(()=>pending.delete(task));
  });
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const transport=async request=>{
      const url=new URL(request.url);
      if(url.origin!==origin||url.search||!url.pathname.startsWith(`/${configuration.bucket}/`))throw Error('NONLOCAL_STORAGE_TRANSPORT_DENIED');
      const headers=Object.fromEntries(request.headers);headers.host=url.host;
      const body=request.method==='PUT'?Buffer.from(await request.arrayBuffer()):undefined;
      return new Promise((resolve,reject)=>{
        const client=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:url.pathname,method:request.method,headers,signal:request.signal},response=>{
          const responseHeaders=new Headers();for(const [name,value] of Object.entries(response.headers))if(value!==undefined)responseHeaders.set(name,Array.isArray(value)?value.join(', '):value);
          resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:responseHeaders}));
        });client.once('error',reject);client.end(body);
      });
    };
    return {configuration,transport,stats:()=>({requests,denials}),dispose:async()=>{await Promise.allSettled([...pending]);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await r2.dispose();}};
  }catch(error){server.closeAllConnections();server.close();await r2.dispose();throw error;}
}

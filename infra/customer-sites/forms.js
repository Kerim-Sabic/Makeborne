const hex=buffer=>Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,"0")).join("");
const reply=(status,message)=>Response.json({error:{message}},{status,headers:{"Cache-Control":"no-store"}});
// A short-lived token supports qualification against the protected staging
// preview. It can never be sent to production or a caller-supplied destination.
export function stagingGatewayHeaders(env,config){
 const token=env.STAGING_VERCEL_OIDC_TOKEN;
 if(!token)return {};
 if(env.SUPABASE_URL!=="https://xzwikrunwpurxnxgkznh.supabase.co"||!/^https:\/\/makeborne-release-staging-[a-z0-9]+-kerimsabic-6594s-projects\.vercel\.app$/.test(config.appOrigin))throw new Error("invalid_staging_gateway");
 try{
  const payload=JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));
  if(!Number.isFinite(payload.exp)||payload.exp*1000<=Date.now()+30_000)throw new Error("expired");
 }catch{throw new Error("expired_staging_gateway");}
 return {"x-vercel-trusted-oidc-idp-token":token};
}
async function hmac(secret,value){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return hex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value)));}
export async function submitEnquiry(request,env,config,slug){
 if(request.method!=="POST")return reply(405,"Use POST for enquiries.");
 const origin=new URL(request.url).origin;
 if(request.headers.get("Origin")!==origin)return reply(403,"Submit the form from this website.");
 const secret=env.FORMS_SIGNING_SECRET;
 if(typeof secret!=="string"||secret.length<32)return reply(503,"Enquiries are not connected yet. Please use the listed contact details.");
 if(request.headers.get("content-type")?.split(";")[0]!=="application/json")return reply(415,"Send JSON form data.");
 const reader=request.body?.getReader();if(!reader)return reply(400,"Form data is missing.");
 let text="",size=0;const decoder=new TextDecoder("utf-8",{fatal:true});
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>10_000){await reader.cancel();return reply(413,"The message is too long.");}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}catch{return reply(400,"Invalid form data.");}finally{reader.releaseLock();}
 let input;try{input=JSON.parse(text);}catch{return reply(400,"Invalid form data.");}
 if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(key=>!["requestId","name","email","message","_website"].includes(key))||input._website)return reply(400,"Invalid form data.");
 if(typeof input.requestId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)
  ||typeof input.name!=="string"||input.name.trim().length<1||input.name.length>120||typeof input.email!=="string"||input.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)
  ||typeof input.message!=="string"||input.message.trim().length<1||input.message.length>5000)return reply(400,"Check your name, email and message.");
 const ip=request.headers.get("CF-Connecting-IP")??(env.ALLOW_LOCAL_SUPABASE==="true"?"local-test":null);
 if(!ip)return reply(503,"The form gateway is unavailable.");
 const sourceHash=await hmac(secret,`visitor:${slug}:${ip}`);
 const body=JSON.stringify({slug,requestId:input.requestId,name:input.name.trim(),email:input.email.trim(),message:input.message.trim(),sourceHash});
 const stamp=String(Date.now()),signature=await hmac(secret,stamp+"."+body);
 try{
  const response=await fetch(`${config.appOrigin}/api/hosting/enquiries`,{method:"POST",headers:{"Content-Type":"application/json","x-makeborne-timestamp":stamp,"x-makeborne-signature":signature,...stagingGatewayHeaders(env,config)},body,redirect:"manual",signal:AbortSignal.timeout(12_000)});
  if(response.ok){
   const result=await response.json();
   if(result?.accepted===true)return Response.json({accepted:true},{headers:{"Cache-Control":"no-store"}});
   return reply(503,"Delivery could not be confirmed. Retry the same enquiry.");
  }
  await response.body?.cancel();
  const status=[400,404,409,429,503].includes(response.status)?response.status:503;
  return reply(status,status===429?"Too many enquiries. Please try again later.":status===409?"This submission changed. Start a new enquiry.":"Your enquiry was not confirmed. Keep your message and retry.");
 }catch{return reply(503,"Delivery could not be confirmed. Retry the same enquiry.");}
}

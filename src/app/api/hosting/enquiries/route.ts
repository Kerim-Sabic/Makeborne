import {createHmac,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {billingDatabase} from "@/lib/billing/database";
import {boundedBytes,apiError,RequestError} from "@/lib/server/http";
import {databaseError} from "@/lib/cloud/server";

export const runtime="nodejs";
const input=z.object({slug:z.string().regex(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/),requestId:z.string().uuid(),name:z.string().trim().min(1).max(120),email:z.string().trim().email().max(254),message:z.string().trim().min(1).max(5000),sourceHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
/** Only the customer-site Worker can submit here. Browser cookies grant nothing. */
export async function POST(request:Request){
 try{
  const secret=process.env.MAKEBORNE_FORMS_SIGNING_SECRET;
  if(!secret||secret.length<32)throw new RequestError("FORMS_DISABLED","Website forms are not available yet.",503);
  const stamp=request.headers.get("x-makeborne-timestamp")??"",signature=request.headers.get("x-makeborne-signature")??"";
  if(!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>60_000||!/^[a-f0-9]{64}$/.test(signature))throw new RequestError("UNAUTHORIZED","Invalid form gateway request.",401);
  const bytes=await boundedBytes(request,12_000,request.signal);
  const expected=createHmac("sha256",secret).update(stamp+".").update(bytes).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,"hex")))throw new RequestError("UNAUTHORIZED","Invalid form gateway request.",401);
  let value;try{value=input.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));}catch{throw new RequestError("INVALID_FORM","Check your name, email and message.");}
  const {data,error}=await billingDatabase().rpc("makeborne_accept_site_enquiry",{p_slug:value.slug,p_request:value.requestId,p_name:value.name,p_email:value.email,p_message:value.message,p_source:value.sourceHash});
  databaseError(error);
  return Response.json(data,{headers:{"Cache-Control":"no-store"}});
 }catch(error){return apiError(error);}
}

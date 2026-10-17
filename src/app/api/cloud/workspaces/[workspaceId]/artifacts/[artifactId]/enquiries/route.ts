import {z} from "zod";
import {cloudContext,cloudBody,cloudError,cloudJson,databaseError,validId} from "@/lib/cloud/server";
import {billingDatabase} from "@/lib/billing/database";
import {RequestError} from "@/lib/server/http";
import {clientsByEmail,normalEmail} from "@/lib/crm/enquiry-clients";
type Context={params:Promise<{workspaceId:string;artifactId:string}>};
async function owner(context:Context){const {workspaceId,artifactId}=await context.params;validId(artifactId);const account=await cloudContext(workspaceId);if(account.workspace?.role!=="owner")throw new RequestError("OWNER_REQUIRED","Only the workspace owner can read enquiries.",403);return {...account,workspaceId,artifactId};}
export async function GET(_request:Request,context:Context){try{
 const {client,workspaceId,artifactId}=await owner(context);
 const [site,items]=await Promise.all([client.from("hosted_sites").select("enquiries_enabled").eq("workspace_id",workspaceId).eq("artifact_id",artifactId).maybeSingle(),client.from("site_enquiries").select("id,name,email,message,created_at,read_at").eq("workspace_id",workspaceId).eq("artifact_id",artifactId).order("created_at",{ascending:false}).limit(100)]);
 databaseError(site.error);databaseError(items.error);
 // Senders already in Clients are matched by email, so the inbox can link them.
 const emails=[...new Set((items.data??[]).map(item=>normalEmail(item.email as string)))];
 const known=emails.length?await client.from("clients").select("id,email").eq("workspace_id",workspaceId).neq("email","").limit(5000):{data:[],error:null};databaseError(known.error);
 const byEmail=clientsByEmail((known.data??[]) as {id:string;email:string}[]);
 return cloudJson({enabled:site.data?.enquiries_enabled??false,available:Boolean(site.data),items:(items.data??[]).map(item=>({...item,clientId:byEmail.get(normalEmail(item.email as string))??null}))});
}catch(error){return cloudError(error);}}
export async function PATCH(request:Request,context:Context){try{
 const body=await cloudBody(request,z.union([z.object({enabled:z.boolean()}).strict(),z.object({readId:z.string().uuid()}).strict()]));
 const {workspaceId,artifactId}=await owner(context);const db=billingDatabase();
 if("enabled" in body){const {data,error}=await db.from("hosted_sites").update({enquiries_enabled:body.enabled}).eq("workspace_id",workspaceId).eq("artifact_id",artifactId).select("artifact_id").maybeSingle();databaseError(error);if(!data)throw new RequestError("NOT_FOUND","Publish this website first.",404);}
 else{const {data,error}=await db.from("site_enquiries").update({read_at:new Date().toISOString()}).eq("workspace_id",workspaceId).eq("artifact_id",artifactId).eq("id",body.readId).select("id").maybeSingle();databaseError(error);if(!data)throw new RequestError("NOT_FOUND","Enquiry not found.",404);}
 return cloudJson({saved:true});
}catch(error){return cloudError(error);}}

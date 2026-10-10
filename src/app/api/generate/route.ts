import { getAccountPrivileges } from "@/lib/account/privileges";
import { cloudError, cloudJson } from "@/lib/cloud/server";
import { billingUser } from "@/lib/billing/access";
import { getCapabilities } from "@/lib/capabilities/server";
import { submitGeneration } from "@/lib/generation/submission-server";
import { privatePreviewsConfigured } from "@/lib/projects/preview-session-server";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: Request) {
 try {
  return cloudJson({job:await submitGeneration(request)},202);
 } catch(error){return cloudError(error);}
}

export async function GET() {
 const user=await billingUser();
 const administrator=Boolean(user && (await getAccountPrivileges(user.id)).isAdmin);
 const {available,scope,health,budget,reason}=getCapabilities({administrator}).operations.pilot;
 const operatorSubmissionEnabled=administrator && process.env.MAKEBORNE_DURABLE_SUBMISSIONS_ENABLED==="true";
 return Response.json({available,scope,health,budget,reason,operatorSubmissionEnabled,privatePreviewsEnabled:Boolean(user)&&privatePreviewsConfigured()},{headers:{"Cache-Control":"private, no-store",Vary:"Cookie"}});
}

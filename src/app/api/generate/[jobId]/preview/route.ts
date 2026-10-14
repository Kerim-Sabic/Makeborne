import {launchPrivatePreview} from "@/lib/projects/preview-session-server";
import {cloudJson,cloudError} from "@/lib/cloud/server";
export const runtime="nodejs";
type Context={params:Promise<{jobId:string}>};
export async function POST(request:Request,context:Context) {
  try{return cloudJson({preview:await launchPrivatePreview(request,(await context.params).jobId)});}
  catch(error){return cloudError(error);}
}

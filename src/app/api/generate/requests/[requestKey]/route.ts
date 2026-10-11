import {cloudError, cloudJson} from "@/lib/cloud/server";
import {recoverGeneration} from "@/lib/generation/submission-server";
export const runtime = "nodejs";
export async function GET(request:Request,context:{params:Promise<{requestKey:string}>}) {
  try {return cloudJson({job:await recoverGeneration(request,(await context.params).requestKey)});}
  catch(error) {return cloudError(error);}
}

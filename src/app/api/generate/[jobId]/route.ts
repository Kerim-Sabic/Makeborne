import {readGeneration, cancelGeneration} from "@/lib/generation/submission-server";
import {cloudJson, cloudError} from "@/lib/cloud/server";
export const runtime = "nodejs";
type Context = {params: Promise<{jobId: string}>};
export async function GET(request: Request, context: Context) {
  try {return cloudJson({job:await readGeneration(request,(await context.params).jobId)});}
  catch(error) {return cloudError(error);}
}
export async function DELETE(request: Request, context: Context) {
  try {return cloudJson({job:await cancelGeneration(request,(await context.params).jobId)});}
  catch(error) {return cloudError(error);}
}

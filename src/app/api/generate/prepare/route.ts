import {cloudError, cloudJson} from "@/lib/cloud/server";
import {prepareGeneration} from "@/lib/generation/preparation-server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {return cloudJson({prepared: await prepareGeneration(request)});}
  catch (error) {return cloudError(error);}
}

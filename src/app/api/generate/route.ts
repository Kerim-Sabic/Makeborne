import { getAccountPrivileges } from "@/lib/account/privileges";
import { apiError, boundedJson, sameOrigin, RequestError } from "@/lib/server/http";
import { billingUser, requireCreationAccess } from "@/lib/billing/access";
import { PilotBriefSchema } from "@/lib/generation/pilot-contract";
import { generatePilotDraft } from "@/lib/generation/claude-pilot";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: Request) {
 try {
  sameOrigin(request);
  const user=await requireCreationAccess();
  const parsed=PilotBriefSchema.safeParse(await boundedJson(request,50000));
  if(!parsed.success)throw new RequestError('INVALID_BRIEF','Add a brief and choose a supported format. Testing supports up to 12,000 characters of instructions.',400);
  return Response.json(await generatePilotDraft(user.id,parsed.data,request.signal),{headers:{'Cache-Control':'no-store'}});
 } catch(error){return apiError(error);}
}

export async function GET() {
 const user=await billingUser();
 const available=Boolean(user && process.env.ANTHROPIC_API_KEY && (await getAccountPrivileges(user.id)).isAdmin);
 return Response.json({available},{headers:{"Cache-Control":"no-store"}});
}

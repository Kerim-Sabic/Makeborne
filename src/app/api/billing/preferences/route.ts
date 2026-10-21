import { requireBillingUser } from "@/lib/billing/access";
import { createClient } from "@/lib/supabase/server";
import { CreditPreferenceInput, CreditPreferencesSchema } from "@/lib/billing/preferences";
import { apiError, boundedJson, RequestError, sameOrigin } from "@/lib/server/http";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control":"private, no-store", Vary:"Cookie" };
async function read(save=false,input?: {alertBelow:number|null;monthlyLimit:number|null}) {
  await requireBillingUser();
  const client=await createClient();
  const {data,error}=await client.rpc("makeborne_credit_preferences",{p_save:save,p_alert_below:input?.alertBelow??null,p_monthly_limit:input?.monthlyLimit??null});
  if(error) throw new RequestError("CREDIT_PREFERENCES_UNAVAILABLE",error.code==="PT409"?"Your limit must cover credits already used and reserved.":"Credit settings could not be saved or loaded. Try again.",error.code==="PT409"?409:503);
  const parsed=CreditPreferencesSchema.safeParse(data);
  if(!parsed.success) throw new RequestError("CREDIT_PREFERENCES_UNAVAILABLE","Credit settings could not be verified.",503);
  return Response.json(parsed.data,{headers});
}
export async function GET(){try{return await read();}catch(error){return apiError(error);}}
export async function POST(request:Request){try{sameOrigin(request);const input=CreditPreferenceInput.safeParse(await boundedJson(request,2048));if(!input.success)throw new RequestError("INVALID_CREDIT_SETTINGS","Enter positive whole credits, or leave a setting blank to turn it off.",400);return await read(true,input.data);}catch(error){return apiError(error);}}

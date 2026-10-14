import { billingConfig } from "@/lib/billing/config";
import { billingDatabase } from "@/lib/billing/database";
import { deliverTopupPayment } from "@/lib/billing/topup-delivery";
import { listTopupPayments } from "@/lib/billing/topup-payment-list";
import { runTopupReconcileJob } from "@/lib/billing/topup-reconcile-job";
import { authorizedCron } from "@/lib/server/cron-auth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
const headers={"Cache-Control":"no-store"};
async function handle(request: Request){
  if(!authorizedCron(request))return Response.json({error:{code:"UNAUTHORIZED"}},{status:401,headers});
  if(process.env.MAKEBORNE_TOPUP_RECONCILE_ENABLED!=="true"||process.env.MAKEBORNE_TOPUP_MIGRATIONS_VERIFIED!=="true")
    return Response.json({error:{code:"JOB_DISABLED"}},{status:503,headers});
  if(!billingConfig().configured)return Response.json({error:{code:"BILLING_NOT_CONFIGURED"}},{status:503,headers});
  try {
    const db=billingDatabase();
    if(new URL(request.url).searchParams.get("health")==="1"){
      const {data,error}=await db.rpc("makeborne_topup_job_health");
      return Response.json(error?{error:{code:"HEALTH_UNAVAILABLE"}}:{health:data},{status:error?503:200,headers});
    }
    const result=await runTopupReconcileJob({rpc:(name,args)=>db.rpc(name,args),listPayments:listTopupPayments,deliver:deliverTopupPayment});
    console.info(JSON.stringify({job:"credit_topups",status:result.status,runId:result.runId,stats:result.stats}));
    return Response.json(result,{status:result.status==="failed"?500:200,headers});
  }catch{
    console.error(JSON.stringify({job:"credit_topups",status:"failed",code:"TOPUP_JOB_UNAVAILABLE"}));
    return Response.json({error:{code:"TOPUP_JOB_UNAVAILABLE"}},{status:503,headers});
  }
}
export const GET=handle;
export const POST=handle;

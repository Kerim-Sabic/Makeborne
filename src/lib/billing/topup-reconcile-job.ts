import "server-only";
import { z } from "zod";

const dueSchema = z.array(z.object({ id: z.string().uuid(), user_id: z.string().uuid(),
  merchant_id: z.string().regex(/^biz_[A-Za-z0-9]+$/), plan_id: z.string().regex(/^plan_[A-Za-z0-9]+$/),
  whop_user_id: z.string().regex(/^user_[A-Za-z0-9]+$/), checkout_id: z.string().regex(/^ch_[A-Za-z0-9]+$/).nullable(),
  payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/).nullable(), payment_scan_cursor: z.string().max(2000).nullable() }));
export type DueTopup = z.infer<typeof dueSchema>[number];
type RpcResult = { data: unknown; error: unknown };
export type TopupReconcileDeps = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
  listPayments: (order: DueTopup) => Promise<{ paymentIds: string[]; complete: boolean; nextCursor: string | null; skipped: number }>;
  deliver: (paymentId: string) => Promise<boolean>;
  now?: () => number;
};

/** Oldest checked first, persistent per-order cursor, lease shared with billing monitoring. */
export async function runTopupReconcileJob(deps: TopupReconcileDeps, options: { maxOrders?: number; budgetMs?: number } = {}) {
  const now=deps.now??Date.now, started=now(), budget=Math.min(options.budgetMs??210_000,210_000);
  const maxOrders=Math.max(1,Math.min(options.maxOrders??50,100));
  const stats={processed:0,failed:0,payments:0,incomplete:0,skippedEvidence:0,unbound:0,budgetExhausted:false,backlog:false};
  const errors: string[]=[];
  const lease=await deps.rpc("makeborne_billing_job_begin",{p_job:"credit_topups",p_lease_seconds:300});
  if(lease.error)throw new Error("Credit-pack job lease unavailable");
  if(lease.data==null)return {status:"skipped" as const,runId:null,stats,errors};
  if(typeof lease.data!=="number"||!Number.isSafeInteger(lease.data)||lease.data<=0)throw new Error("Invalid credit-pack lease");
  const runId=lease.data;
  let status: "succeeded"|"partial"|"failed"="succeeded";
  try {
    const due=await deps.rpc("makeborne_topup_due_orders",{p_limit:maxOrders+1,p_stale_seconds:3600});
    if(due.error)throw new Error("Credit-pack queue unavailable");
    const orders=dueSchema.parse(due.data);
    stats.backlog=orders.length>maxOrders;
    for(const order of orders.slice(0,maxOrders)){
      if(now()-started>=budget){stats.budgetExhausted=true;break;}
      // A stale process cannot advance the queue after its lease is reclaimed.
      const heartbeat=await deps.rpc("makeborne_billing_job_heartbeat",{p_run:runId,p_lease_seconds:300});
      if(heartbeat.error||heartbeat.data!==true)throw new Error("Credit-pack lease lost");
      let errorCode: string|null=null, cursor=order.payment_scan_cursor;
      try {
        if(!order.checkout_id){stats.unbound++;throw Object.assign(new Error(),{code:"TOPUP_CHECKOUT_BINDING_PENDING"});}
        if(order.payment_id){
          if(!await deps.deliver(order.payment_id))throw Object.assign(new Error(),{code:"TOPUP_PAYMENT_UNBOUND"});
          stats.payments++;
        }
        if(now()-started>=budget){stats.budgetExhausted=true;break;}
        const page=await deps.listPayments(order);
        const seen=new Set<string>();
        for(const id of page.paymentIds){
          if(seen.has(id)||id===order.payment_id)continue;
          seen.add(id);
          if(now()-started>=budget){stats.budgetExhausted=true;break;}
          if(!await deps.deliver(id))throw Object.assign(new Error(),{code:"TOPUP_PAYMENT_UNBOUND"});
          stats.payments++;
        }
        // Do not checkpoint past deliveries skipped by a deadline/failure.
        if(stats.budgetExhausted)break;
        cursor=page.complete?null:page.nextCursor;
        if(!page.complete){stats.incomplete++;errorCode="TOPUP_PAYMENT_SCAN_INCOMPLETE";}
        stats.skippedEvidence+=page.skipped;
        if(page.skipped)errorCode="TOPUP_PAYMENT_LIST_UNVERIFIED";
        stats.processed++;
      }catch(error){
        stats.failed++;
        const raw=(error as {code?:unknown}).code;
        errorCode=typeof raw==="string"&&/^[A-Z0-9_]{1,100}$/.test(raw)?raw:"TOPUP_RECONCILE_FAILED";
        if(errors.length<20)errors.push(`${order.id}: ${errorCode}`);
      }
      const recorded=await deps.rpc("makeborne_topup_record_check",{p_order:order.id,p_cursor:cursor,p_error:errorCode,p_run:runId});
      if(recorded.error||recorded.data!==true)throw new Error("Credit-pack check could not be saved");
    }
    if(stats.failed||stats.incomplete||stats.skippedEvidence||stats.budgetExhausted||stats.backlog)status="partial";
  }catch{
    status="failed";errors.push("TOPUP_JOB_FAILED");
  }
  const finished=await deps.rpc("makeborne_billing_job_finish",{p_run:runId,p_status:status,p_stats:stats,p_error:errors.length?errors.join("\n"):null});
  if(finished.error||finished.data!==true)throw new Error("Credit-pack job finish could not be confirmed");
  return {status,runId,stats,errors};
}

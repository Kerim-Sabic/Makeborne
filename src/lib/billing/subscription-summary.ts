import "server-only";
import { billingDatabase } from "./database";
import { creditRuleFor } from "./plan-credits";
import { CREATION_PLANS, planPrice, type PlanId } from "./plans";
export type SubscriptionSummary={name:string;tier?:PlanId;status:string;periodEnd:string|null;checkedAt:string;standardPriceCents:number;interval:"monthly"|"yearly"};
/** Stored provider observation only; never grants access or claims an upcoming invoice. */
export async function subscriptionSummaries(userId:string):Promise<SubscriptionSummary[]|null>{
  try{const {data,error}=await billingDatabase().from("billing_memberships").select("plan_id,status,period_end,checked_at").eq("user_id",userId).order("checked_at",{ascending:false}).limit(5);if(error||!Array.isArray(data))return null;
    return data.flatMap(row=>{const rule=creditRuleFor(row.plan_id),plan=rule&&CREATION_PLANS.find(p=>p.id===rule.tier);if(!rule||!plan||typeof row.status!=="string"||!Number.isFinite(Date.parse(row.checked_at)))return [];return[{name:plan.name,tier:plan.id,status:row.status,periodEnd:typeof row.period_end==="string"&&Number.isFinite(Date.parse(row.period_end))?row.period_end:null,checkedAt:row.checked_at,standardPriceCents:planPrice(rule.tier,rule.interval,false).standardCents,interval:rule.interval}];});
  }catch{return null;}
}

import "server-only";
import { z } from "zod";
import { RequestError } from "@/lib/server/http";
import { whopGet } from "./whop";
import type { DueTopup } from "./topup-reconcile-job";
const itemSchema=z.object({id:z.string().regex(/^pay_[A-Za-z0-9]+$/),company:z.object({id:z.string()}),
  plan:z.object({id:z.string()}),user:z.object({id:z.string()}),checkout_configuration_id:z.string()});
const pageSchema=z.object({data:z.array(z.unknown()),page_info:z.object({has_next_page:z.boolean(),end_cursor:z.string().max(2000).nullable()})});
/** Exact checkout filter, then exact ownership checks. List amounts never grant credits. */
export async function listTopupPayments(order: DueTopup){
  if(!order.checkout_id||!/^ch_[A-Za-z0-9]+$/.test(order.checkout_id))throw new RequestError("TOPUP_CHECKOUT_BINDING_PENDING","Checkout binding unavailable.",503);
  if(!/^biz_[A-Za-z0-9]+$/.test(order.merchant_id))throw new RequestError("WRONG_MERCHANT","Merchant binding unavailable.",503);
  const params=new URLSearchParams({company_id:order.merchant_id,first:"50",order:"created_at",direction:"asc"});
  params.append("checkout_configuration_ids[]",order.checkout_id);
  if(order.payment_scan_cursor)params.set("after",order.payment_scan_cursor);
  const parsed=pageSchema.safeParse(await whopGet(`/payments?${params}`,{attempts:2,maxDelayMs:1000}));
  if(!parsed.success)throw new RequestError("TOPUP_PAYMENT_LIST_UNVERIFIED","Payment list unavailable.",503);
  const info=parsed.data.page_info;
  if(info.has_next_page&&(!info.end_cursor||info.end_cursor===order.payment_scan_cursor))
    throw new RequestError("TOPUP_PAYMENT_LIST_UNVERIFIED","Payment cursor unavailable.",503);
  let skipped=0;const paymentIds:string[]=[];
  for(const raw of parsed.data.data){
    const item=itemSchema.safeParse(raw);
    if(!item.success||item.data.company.id!==order.merchant_id||item.data.plan.id!==order.plan_id
      ||item.data.user.id!==order.whop_user_id||item.data.checkout_configuration_id!==order.checkout_id){skipped++;continue;}
    paymentIds.push(item.data.id);
  }
  return {paymentIds,complete:!info.has_next_page,nextCursor:info.has_next_page?info.end_cursor:null,skipped};
}

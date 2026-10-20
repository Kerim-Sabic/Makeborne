"use client";
import { useEffect, useState } from "react";
import { CreditPreferencesSchema, type CreditPreferences } from "@/lib/billing/preferences";

export default function BillingControls() {
  const [value,setValue]=useState<CreditPreferences|null>(null),[alert,setAlert]=useState(""),[limit,setLimit]=useState("");
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
  async function load(signal?:AbortSignal){
    const r=await fetch("/api/billing/preferences",{cache:"no-store",signal});
    if(!r.ok)throw Error("Credit settings are unavailable. Your existing limits are unchanged.");
    const data=CreditPreferencesSchema.parse(await r.json());
    if(!signal?.aborted){setValue(data);setAlert(data.alertBelow?.toString()??"");setLimit(data.monthlyLimit?.toString()??"");}
  }
  useEffect(()=>{const c=new AbortController();void fetch("/api/billing/preferences",{cache:"no-store",signal:c.signal}).then(async r=>{if(!r.ok)throw Error("unavailable");return CreditPreferencesSchema.parse(await r.json());}).then(data=>{if(!c.signal.aborted){setValue(data);setAlert(data.alertBelow?.toString()??"");setLimit(data.monthlyLimit?.toString()??"");}}).catch(()=>{if(!c.signal.aborted)setError("Credit settings could not be loaded.");});return()=>c.abort();},[]);
  async function save(event:React.FormEvent){
    event.preventDefault();setError("");setMessage("");
    const integer=(s:string,max:number)=>s===""?null:/^[1-9][0-9]*$/.test(s)&&Number(s)<=max?Number(s):NaN;
    const alertBelow=integer(alert,1000000),monthlyLimit=integer(limit,1000000000);
    if(Number.isNaN(alertBelow)||Number.isNaN(monthlyLimit)){setError("Enter positive whole credits, or leave a setting blank to turn it off.");return;}
    setBusy(true);
    try{const r=await fetch("/api/billing/preferences",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({alertBelow,monthlyLimit})});const body=await r.json();if(!r.ok)throw Error(body?.error?.message??"Settings could not be saved.");setValue(CreditPreferencesSchema.parse(body));setMessage("Credit settings saved to your account.");}
    catch(e){setError(e instanceof Error?e.message:"The result could not be confirmed. Reload the saved settings before retrying.");}
    finally{setBusy(false);}
  }
  return <section className="billing-control-section" aria-labelledby="credit-controls-heading"><h2 id="credit-controls-heading">Stay in control.</h2>
    <p>These account settings are independent of automatic purchases.</p>
    {value&&value.alertBelow!==null&&value.available<value.alertBelow&&<p role="status" className="billing-control-notice">Low balance: {value.available} credits available, below your {value.alertBelow}-credit alert.</p>}
    <form onSubmit={save} className="billing-control-grid">
      <label>Low-balance alert<input aria-label="Low-balance alert" type="text" inputMode="numeric" value={alert} onChange={e=>setAlert(e.target.value)} disabled={!value||busy} placeholder="Off" aria-describedby="credit-alert-help"/><small id="credit-alert-help">Shows an alert here when your balance is low. No email or purchase. Blank turns it off.</small></label>
      <label>Monthly usage limit<input aria-label="Monthly usage limit" type="text" inputMode="numeric" value={limit} onChange={e=>setLimit(e.target.value)} disabled={!value||busy} placeholder="No extra limit" aria-describedby="credit-limit-help"/><small id="credit-limit-help">Credits used and reserved per UTC month. The server blocks work that would exceed it, even after a top-up. Blank removes this extra limit.</small></label>
      <div className="billing-control-actions"><button disabled={!value||busy} type="submit">{busy?"Saving…":"Save credit settings"}</button><button type="button" disabled={busy} onClick={()=>{setBusy(true);setError("");setMessage("");void load().catch(()=>setError("Credit settings could not be loaded.")).finally(()=>setBusy(false));}}>Reload saved settings</button></div>
    </form>{value&&<p>{value.used} used · {value.reserved} reserved this month. Automatic top-up has separate consent and daily/monthly purchase caps below; it cannot bypass your usage limit.</p>}
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}

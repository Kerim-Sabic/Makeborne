/* eslint-disable @typescript-eslint/no-require-imports -- Offline real helper contract. */
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
let calls=[],reply={data:true,error:null};
class RequestError extends Error { constructor(code,message,status){super(message);this.code=code;this.status=status;} }
const modules={'server-only':{},'@/lib/server/http':{RequestError},'./database':{billingDatabase:()=>({rpc:async(name,args)=>{calls.push({name,args});return reply;}})},
 './plans':{BILLING_TERMS_VERSION:'terms-v1',WITHDRAWAL_CONSENT_VERSION:'consent-v1'},
 '@/lib/legal/versions':{WITHDRAWAL_CONSENT_TEXT:'Plan text',PACK_WITHDRAWAL_CONSENT_TEXT:'Pack text'}};
const context={exports:{},require:name=>modules[name]??require(name)};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('./checkout-consent.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
(async()=>{
 const {requireCheckoutConsent:required,recordCheckoutConsent:record,prepareConsentedPlanCheckout:prepare}=context.exports;
 for(const value of [undefined,null,false,true,'','old',{}])assert.throws(()=>required(value),e=>e.code==='CHECKOUT_CONSENT_REQUIRED'&&e.status===400);
 required('consent-v1');assert.equal(calls.length,0);
 await record('owner','actual-resumed-request','plan');
 assert.equal(calls[0].name,'makeborne_record_checkout_consent');
 assert.equal(calls[0].args.p_text,'Plan text');assert.equal(calls[0].args.p_terms,'terms-v1');assert.equal(calls[0].args.p_request,'actual-resumed-request');
 await record('owner','pack-request','pack');assert.equal(calls[1].args.p_text,'Pack text');
 await prepare('owner','new-request','plan_fixture','/studio');assert.equal(calls[2].name,'makeborne_prepare_consented_checkout');assert.equal(calls[2].args.p_plan,'plan_fixture');
 reply={data:null,error:{code:'PBC03'}};assert.equal((await prepare('owner','r','plan_fixture','/studio')).error.code,'PBC03');
 reply={data:false,error:null};await assert.rejects(()=>prepare('owner','r','plan_fixture','/studio'),e=>e.code==='CHECKOUT_CONSENT_UNSAVED');
 for(const response of [{data:false,error:null},{data:null,error:null},{data:true,error:{code:'test'}}]){reply=response;await assert.rejects(()=>record('owner','r','plan'),e=>e.code==='CHECKOUT_CONSENT_UNSAVED'&&e.status===503);}
 console.log('PASS consent: exact version, server-selected text/terms, actual request binding, storage fault fails closed');
})().catch(error=>{console.error(error);process.exitCode=1;});

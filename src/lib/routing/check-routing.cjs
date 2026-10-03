/* eslint-disable @typescript-eslint/no-require-imports -- Offline TypeScript fixture loader, never bundled. */
const fs = require("node:fs");
const ts = require("typescript");
const assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { selectRoute, prepareRouteQuote } = require("./contracts.ts");
const { PLANNED_ROUTES } = require("./registry.ts");
const request = { capabilities: ["text"], usage: [{unit:"input_tokens",maximum:"1001"}], maximumAttempts:2, minimumQuality:80, allowedProviders:["openai"], externalProcessingAllowed:true, sourceRightsConfirmed:true, maximumVendorMicrousd:"100000", maximumCustomerCredits:"100", preference:"economy", now:"2026-10-03T12:00:00.000Z" };
const route = { ...PLANNED_ROUTES[0], model:"fixture-model", status:"ready",adapterVerified:true,configurationRef:"fixture-secret-ref",policyApproved:true,licenseApproved:true,evaluation:{evidenceId:"fixture-eval",quality:90},price:{version:"fixture-price",evidenceId:"fixture-cost",expiresAt:"2026-10-03T13:00:00.000Z",lines:[{unit:"input_tokens",perUnits:"1000",vendorMicrousd:"100",customerCredits:"1"}],fixedVendorMicrousd:"5",fixedCustomerCredits:"1"}};
let checks = 0;
function check(fn) { fn(); checks++; }
check(()=>assert.equal(selectRoute(request, PLANNED_ROUTES).selected,null));
check(()=>{const picked=selectRoute(request,[route]).selected;assert.equal(picked.maximumVendorMicrousd,"212");assert.equal(picked.customerCredits,"6");});
for(const [patch,reason] of [[{externalProcessingAllowed:false},"privacy"],[{sourceRightsConfirmed:false},"rights"],[{maximumCustomerCredits:"5"},"budget"],[{capabilities:["image"]},"capability"],[{allowedProviders:["anthropic"]},"provider_policy"],[{now:"2026-10-03T13:00:00.000Z"},"price_expired"],[{usage:[{unit:"images",maximum:"1"}]},"usage_unpriced"]]) check(()=>assert.ok(selectRoute({...request,...patch},[route]).rejected[0].reasons.includes(reason)));
for (const [patch,reason] of [[{licenseApproved:false},"license"],[{policyApproved:false},"policy"],[{adapterVerified:false},"adapter_unverified"],[{evaluation:null},"quality"],[{price:null},"price_missing"],[{model:null},"unconfigured"]]) check(()=>assert.ok(selectRoute(request,[{...route,...patch}]).rejected[0].reasons.includes(reason)));
check(()=>assert.throws(()=>selectRoute(request,[route,route]),/unique/));
check(()=>assert.throws(()=>selectRoute({...request,usage:[...request.usage,...request.usage]},[route])));
check(()=>assert.equal(selectRoute(request,[{...route,id:"z"},{...route,id:"a"}]).selected.route.id,"a"));
check(()=>assert.equal(selectRoute({...request,preference:"quality"},[{...route,id:"a"},{...route,id:"z",evaluation:{evidenceId:"better",quality:95}}]).selected.route.id,"z"));
const id="00000000-0000-4000-8000-000000000001";
const context={id,scope:{workspaceId:id,projectId:id,artifactId:null},version:1,inputHash:"a".repeat(64),baseVersionId:null,expiresAt:"2026-10-03T12:10:00.000Z"};
check(()=>{const {quote}=prepareRouteQuote(request,[route],context);assert.equal(quote.approvedBy,null);assert.equal(quote.approvedAt,null);assert.equal(quote.customerCredits,"6");});
check(()=>assert.throws(()=>prepareRouteQuote(request,[route],{...context,expiresAt:"2026-10-04T12:10:00.000Z"}),/expiration/));
check(()=>assert.equal(prepareRouteQuote(request,PLANNED_ROUTES,context).quote,null));
console.log(`${checks} offline routing checks passed; no provider calls.`);

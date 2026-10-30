/* eslint-disable @typescript-eslint/no-require-imports -- No HTTP: prove analytics excludes private links and removes request details. */
const assert=require("node:assert/strict"),fs=require("node:fs"),ts=require("typescript");
require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {sanitizeAnalyticsEvent:clean,analyticsPathAllowed,analyticsPrivacyAllowed}=require("./vercel-analytics.ts");
const event=url=>({type:"pageview",url});
assert.deepEqual(clean(event("https://makeborne.com/studio?workspace=private&artifact=private#secret"),{}),event("https://makeborne.com/studio"));
for(const path of ["/portal/private","/review/private","/admin","/api/private","/auth/callback","/studio/private","/callback","/r/private"])assert.equal(clean(event("https://makeborne.com"+path),{}),null,path);
for(const url of ["invalid","http://makeborne.com/","https://makeborne.com.evil.invalid/","https://preview.vercel.app/","https://secret@makeborne.com/"])assert.equal(clean(event(url),{}),null,url);
for(const preferences of [{doNotTrack:"1"},{globalPrivacyControl:true}]){assert.equal(analyticsPrivacyAllowed(preferences),false);assert.equal(clean(event("https://makeborne.com/"),preferences),null);}
assert.equal(clean({type:"event",url:"https://makeborne.com/"},{}),null);
assert.equal(analyticsPathAllowed("/help/publishing"),true);assert.equal(analyticsPathAllowed("/helpful-private"),false);
assert.deepEqual(clean({...event("https://makeborne.com/?email=private"),privateData:"do not send"},{}),event("https://makeborne.com/"));
console.log("PASS analytics: production host, public paths, query/fragment removal, private URLs, privacy preferences, no custom payloads");

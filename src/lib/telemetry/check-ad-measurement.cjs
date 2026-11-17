/* eslint-disable @typescript-eslint/no-require-imports -- No HTTP: the Whop Pixel is byte-exact, opt-in, public pages only, and never sees a private address. */
const assert=require("node:assert/strict"),fs=require("node:fs"),crypto=require("node:crypto"),path=require("node:path"),ts=require("typescript");
require.extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const m=require("./ad-measurement.ts");
const root=path.resolve(__dirname,"../../.."),read=file=>fs.readFileSync(path.join(root,file),"utf8");

// The snippet Whop issued for biz_CV9cZg1zFX3h7f, unchanged (701 characters).
assert.equal(crypto.createHash("sha256").update(m.WHOP_PIXEL_SNIPPET).digest("hex"),"9c7142d012a3d64b5b1e02b279e8cf310e0aec8814f5ad410b5cda50b8091321");
assert.equal(`<script>${m.WHOP_PIXEL_CODE}</script>`,m.WHOP_PIXEL_SNIPPET);
assert.match(m.WHOP_PIXEL_CODE,/whop\.setScope\("biz_CV9cZg1zFX3h7f"\);whop\.track\("page"\);$/);

const ok=href=>m.adPageAllowed(new URL(href));
for(const href of ["https://makeborne.com/","https://www.makeborne.com/billing","https://makeborne.com/help/publishing","https://makeborne.com/privacy#ad-measurement",
  "https://makeborne.com/?utm_source=meta&utm_campaign=launch&fbclid=x","https://makeborne.com/billing?whop_verify=x&gclid=y&ref=z"])assert.equal(ok(href),true,href);
for(const href of ["https://makeborne.com/studio","https://makeborne.com/studio?workspace=w","https://makeborne.com/chat","https://makeborne.com/portal/x","https://makeborne.com/review/token",
  "https://makeborne.com/admin","https://makeborne.com/auth/callback?code=x","https://makeborne.com/helpful","https://makeborne.com/?email=a%40b.c","https://makeborne.com/?he=x",
  "https://makeborne.com/login?next=%2Freview%2Ftoken","https://makeborne.com/billing?checkout=private","https://makeborne.com/#access_token=abc&type=recovery",
  "http://makeborne.com/","https://makeborne.com.evil.invalid/","https://makeborne.vercel.app/","https://user:pass@makeborne.com/","http://localhost:3000/"])assert.equal(ok(href),false,href);
assert.equal(m.adPageAllowed(new URL("http://localhost:3000/billing"),[...m.AD_HOSTS,"localhost"]),true);
for(const preferences of [{doNotTrack:"1"},{globalPrivacyControl:true}])assert.equal(m.adSignalsAllowed(preferences),false);
assert.equal(m.adSignalsAllowed({}),true);

const now=Date.parse("2026-11-17T12:00:00Z"),day=86_400_000;
assert.equal(m.readAdChoice(m.adChoiceRecord("granted",now),now),"granted");
assert.equal(m.readAdChoice(m.adChoiceRecord("denied",now - 181*day),now),"denied");
assert.equal(m.readAdChoice(m.adChoiceRecord("granted",now - 183*day),now),null,"a choice expires after six months");
assert.equal(m.readAdChoice(m.adChoiceRecord("granted",now + day),now),null);
for(const raw of [null,"","blocked","{}",'{"choice":"granted","at":"2026-11-17T00:00:00Z","notice":"old"}','{"choice":"yes","at":"2026-11-17T00:00:00Z","notice":"'+m.AD_NOTICE_VERSION+'"}'])assert.equal(m.readAdChoice(raw,now),null,raw);

// The fence goes in before the pixel; the pixel then wraps it exactly as t.whop.tw/s.js does (report location.href after the call).
function fakeWindow(href){
  const calls=[],assigned=[],win={location:{href,assign:url=>assigned.push(url)},history:{}};
  for(const method of ["pushState","replaceState"])win.history[method]=(state,unused,url)=>{calls.push([method,url]);if(url!=null)win.location.href=new URL(String(url),win.location.href).href;};
  return {win,calls,assigned};
}
const {win,calls,assigned}=fakeWindow("https://makeborne.com/");
m.fenceHistory(win);m.fenceHistory(win);
const reported=[],pixelPush=win.history.pushState.bind(win.history);
win.history.pushState=(...args)=>{pixelPush(...args);reported.push(win.location.href);};
win.history.pushState(null,"","/billing?utm_source=meta");
win.history.pushState(null,"","/studio?create=website&draft=d&claim=c");
win.history.replaceState({tree:1},"",null);
win.history.replaceState(null,"","https://makeborne.com/review/secret-token");
assert.deepEqual(calls,[["pushState","/billing?utm_source=meta"],["replaceState",null]]);
assert.deepEqual(assigned,["https://makeborne.com/studio?create=website&draft=d&claim=c","https://makeborne.com/review/secret-token"]);
assert.deepEqual(reported,["https://makeborne.com/billing?utm_source=meta","https://makeborne.com/billing?utm_source=meta"],"the pixel only ever sees public addresses");

const cookies=[],store=entries=>{const map=new Map(Object.entries(entries));return {get length(){return map.size;},key:i=>[...map.keys()][i]??null,removeItem:key=>map.delete(key),map};};
const local=store({"_wuid":"1","_wuid_link_domain":"x","makeborne.ad-measurement.v1":"keep","makeborne.creation-draft.v1":"keep"}),session=store({"whop_verify":"1","whop_verify_expires_at":"2","_wsc":"3","other":"keep"});
m.clearWhopStorage({document:{set cookie(value){cookies.push(value);}},localStorage:local,sessionStorage:session,location:{hostname:"www.makeborne.com"}});
assert.deepEqual([...local.map.keys()],["makeborne.ad-measurement.v1","makeborne.creation-draft.v1"]);
assert.deepEqual([...session.map.keys()],["other"]);
for(const name of m.WHOP_COOKIES)for(const scope of [""," domain=makeborne.com"," domain=.makeborne.com"])assert.ok(cookies.includes(`${name}=; path=/; max-age=0${scope?";"+scope:""}`),name+scope);

const layout=read("src/app/layout.tsx"),component=read("src/components/ad-measurement.tsx"),privacy=read("src/app/privacy/page.tsx");
assert.match(layout,/\(production \|\| adTestHost\) && <Suspense fallback=\{null\}><AdMeasurement testHost=\{adTestHost\} \/><\/Suspense>/);
assert.match(layout,/production \? undefined : process\.env\.MAKEBORNE_AD_MEASUREMENT_TEST_HOST/);
assert.match(component,/if \(!page \|\| choice !== "granted"\) return;[\s\S]*fenceHistory\(window, allowed\);\s*startWhopPixel\(document\);/,"the fence is installed before the pixel, and only after Allow");
assert.match(privacy,/id="ad-measurement"[\s\S]*<AdMeasurementSettings \/>/);
console.log("PASS ad measurement: byte-exact Whop snippet, public pages and campaign tags only, opt-in for six months, DNT/GPC off, history fence before the pixel, withdrawal clears its storage");

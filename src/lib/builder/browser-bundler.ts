/** In-browser bundler for Makeborne React/Vite projects. Runs only trusted
 * esbuild code in the app; the generated site executes solely inside an opaque
 * sandboxed iframe that cannot reach Makeborne cookies, storage or APIs. */
import { FONT_IMPORT, FONTS_BY_ID, detectFonts, fontFaceRule, fontFileName, fontSubsets, type FontEntry } from "./fonts";
import { LUCIDE, LUCIDE_CORE, lucideIconFile, lucideImports, unknownLucideIcons } from "./icons";
import { PREVIEW_START_MARKER } from "./preview-route";
import responsive from "../../../infra/project-runtime/responsive-images.cjs";
import type { ResponsiveImages } from "../hosting/snapshot";

type Esbuild = typeof import("esbuild-wasm");
type Loader = import("esbuild-wasm").Loader;

let engine: Promise<Esbuild> | null = null;
function esbuild(): Promise<Esbuild> {
  engine ??= (async () => {
    const loaded = await import("esbuild-wasm");
    await loaded.initialize({ wasmURL: "/builder-runtime/esbuild.wasm", worker: true });
    return loaded;
  })().catch(error => { engine = null; throw error; });
  return engine;
}

const VENDOR: Record<string, string> = {
  react: "react.js", "react-dom": "react-dom.js", "react-dom/client": "react-dom-client.js", "react/jsx-runtime": "jsx-runtime.js",
};
const LOADERS: Record<string, Loader> = { tsx: "tsx", ts: "ts", jsx: "jsx", js: "js", mjs: "js", css: "css", json: "json", svg: "dataurl", txt: "text", md: "text" };
const extension = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase();
const vendorCache = new Map<string, Promise<string>>();
const RUNTIME_UNAVAILABLE = "Runtime file unavailable";
const vendorSource = (url: string) => {
  // A failed fetch is not cached: Try again must reach the network again.
  if (!vendorCache.has(url)) vendorCache.set(url, fetch(url, { cache: "force-cache" }).catch(() => { throw new Error(`${RUNTIME_UNAVAILABLE}: ${url}`); }).then(response => {
    if (!response.ok) throw new Error(`${RUNTIME_UNAVAILABLE}: ${url}`);
    return response.text();
  }).catch(error => { vendorCache.delete(url); throw error; }));
  return vendorCache.get(url)!;
};

const fontCache = new Map<string, Promise<string>>();
/** Fonts are inlined as data: URLs: the sandboxed preview has an opaque origin
 * (no CORS font loads) and published snapshots must not depend on a font host. */
const fontDataUrl = (url: string) => {
  if (!fontCache.has(url)) fontCache.set(url, fetch(url, { cache: "force-cache" }).then(async response => {
    if (!response.ok) throw new Error(`Font file unavailable: ${url}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return `data:font/woff2;base64,${btoa(binary)}`;
  }).catch(error => { fontCache.delete(url); throw error; }));
  return fontCache.get(url)!;
};

/** @font-face rules (with embedded woff2) for the catalogue fonts a project uses.
 * Text with letters beyond the latin file (ć, Ł, ğ, ő...) also embeds the
 * complementary latin-ext file; each rule carries its unicode-range. A latin-ext
 * file that cannot load is left out, so only those letters use the stack. */
export async function projectFontCss(files: Map<string, string>, origin: string, importedFonts: ReadonlySet<string> = new Set()) {
  const detected = detectFonts(files);
  const fonts = [...new Map([...detected.fonts, ...[...importedFonts].flatMap(id => {
    const font = FONTS_BY_ID.get(id);
    return font ? [font] : [];
  })].map(font => [font.id, font])).values()];
  const { italic } = detected;
  if (!fonts.length) return "";
  const subsets = fontSubsets(files.values());
  const rules = await Promise.all(fonts.flatMap((font: FontEntry) => (italic && font.italic ? ["normal", "italic"] as const : ["normal"] as const)
    .flatMap(style => subsets.map(async subset => {
      const url = fontDataUrl(`${origin}/builder-runtime/fonts/${fontFileName(font, style, subset)}`);
      if (subset === "latin") return fontFaceRule(font, style, await url, subset);
      return url.then(source => fontFaceRule(font, style, source, subset), () => "");
    }))));
  return rules.filter(Boolean).join("\n");
}

/** Virtual "lucide-react" module that re-exports only the icons the project
 * imports, each from its own vendored module. */
function lucideModule(files: Map<string, string>, origin: string) {
  const names = new Set<string>(), problems: string[] = [];
  for (const [path, content] of files) {
    if (!/\.(?:tsx?|jsx?)$/.test(path) || !content.includes(LUCIDE)) continue;
    const found = lucideImports(content);
    found.names.forEach(name => names.add(name));
    problems.push(...found.problems.map(problem => `${path}: ${problem}`));
  }
  const missing = unknownLucideIcons(names);
  if (missing.length) problems.push(`Not Lucide icons: ${missing.join(", ")}. Use existing Lucide names (e.g. ArrowRight, Check, Mail, MapPin, Phone, Star); Lucide has no brand logos.`);
  const base = `${origin}/builder-runtime/vendor/lucide`;
  const lines = [`export { ${LUCIDE_CORE.join(", ")} } from "${base}/core.js";`];
  for (const name of names) {
    const file = lucideIconFile(name);
    if (file && !(LUCIDE_CORE as readonly string[]).includes(name)) lines.push(`export { default as ${name} } from "${base}/icons/${file}.js";`);
  }
  return { contents: lines.join("\n"), problems };
}

function resolveRelative(files: Map<string, string>, importer: string, specifier: string) {
  const base = importer.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "..") base.pop(); else if (part !== ".") base.push(part);
  }
  const target = base.join("/");
  for (const suffix of ["", ".tsx", ".ts", ".jsx", ".js", ".css", "/index.tsx", "/index.ts", "/index.js"]) {
    if (files.has(target + suffix)) return target + suffix;
  }
  return null;
}

/** "transport": the preview runtime could not be fetched or started (try the
 * same saved files again); "code": the project itself needs a change. */
export type BundleFailure = { ok: false; error: string; kind: "code" | "transport" };
export type BundleResult = { ok: true; html: string } | BundleFailure;

/** Escape text so it can sit inside an inline <script> element. */
const scriptSafe = (code: string) => code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

/** Small runtime injected into previews: reports errors to the editor and keeps
 * in-page links inside the sandbox (srcdoc documents inherit the parent URL).
 * Edit mode (inspect builds only, switched on by the host) outlines the element
 * under the pointer and reports the clicked element's source location and
 * computed style instead of letting the click reach the site. */
const PREVIEW_SHIM = `<script>(function(){
var post=function(m){try{parent.postMessage(Object.assign({source:"makeborne-preview"},m),"*")}catch(e){}};
var START=${PREVIEW_START_MARKER},own=false,rawReplace=history.replaceState;
// A srcdoc document resolves "#x" against the editor URL: fragments are applied to its own URL instead.
var at=function(u){return typeof u==="string"&&u.charAt(0)==="#"?location.href.split("#")[0]+u:u};
try{if(START&&typeof START.hash==="string"&&START.hash&&location.hash!==START.hash)rawReplace.call(history,null,"",at(START.hash))}catch(e){}
addEventListener("error",function(e){post({type:"runtime-error",message:String(e.message||e.error||"Script error"),stack:e.error&&e.error.stack?String(e.error.stack).slice(0,2000):""})});
addEventListener("unhandledrejection",function(e){post({type:"runtime-error",message:"Unhandled promise rejection: "+String(e.reason&&e.reason.message||e.reason)})});
var LOC="data-mb-loc",editing=false,hover=null,box=null,chosen=null,scrollWait=0;
function within(n){while(n&&n.nodeType===1){if(n.hasAttribute(LOC))return n;n=n.parentElement}return null}
function layer(line,fill){var d=document.createElement("div");d.style.cssText="position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;border:2px solid "+line+";background:"+fill+";border-radius:3px;display:none";document.documentElement.appendChild(d);return d}
function place(d,el){if(!d)return;if(!el||!el.isConnected){d.style.display="none";return}var r=el.getBoundingClientRect();d.style.display="block";d.style.left=r.left+"px";d.style.top=r.top+"px";d.style.width=r.width+"px";d.style.height=r.height+"px"}
function same(loc){try{return document.querySelectorAll("["+LOC+"='"+loc+"']")}catch(e){return[]}}
function select(el){chosen=el;if(!box)box=layer("#5b3f8c","rgba(91,63,140,.07)");place(box,el);place(hover,null);var loc=el.getAttribute(LOC),all=same(loc),cs=getComputedStyle(el);
post({type:"select",loc:loc,index:Math.max(0,Array.prototype.indexOf.call(all,el)),count:all.length,tag:el.tagName.toLowerCase(),text:(el.textContent||"").split(String.fromCharCode(10)).join(" ").replace(/ {2,}/g," ").trim().slice(0,2000),
hasParent:!!(el.parentElement&&within(el.parentElement)),style:{color:cs.color,backgroundColor:cs.backgroundColor,fontSize:cs.fontSize,fontWeight:cs.fontWeight,textAlign:cs.textAlign,padding:cs.padding,margin:cs.margin,borderRadius:cs.borderRadius}})}
function clear(){chosen=null;place(box,null)}
function edit(on){editing=on;if(on&&!hover)hover=layer("rgba(91,63,140,.55)","rgba(91,63,140,.05)");if(!on){place(hover,null);clear()}}
document.addEventListener("pointermove",function(e){if(!editing)return;var el=within(e.target);place(hover,el&&el!==chosen?el:null)},true);
document.addEventListener("pointerleave",function(){place(hover,null)});
["click","dblclick","submit","auxclick"].forEach(function(name){document.addEventListener(name,function(e){if(!editing)return;e.preventDefault();e.stopPropagation();if(name==="click"){var el=within(e.target);if(el)select(el)}},true)});
addEventListener("scroll",function(){if(!editing)return;place(box,chosen);place(hover,null);clearTimeout(scrollWait);scrollWait=setTimeout(function(){post({type:"scroll",y:scrollY})},150)},{passive:true});
addEventListener("resize",function(){place(box,chosen)});
addEventListener("keydown",function(e){if(editing&&e.key==="Escape"&&chosen){clear();post({type:"deselect"})}});
addEventListener("message",function(e){if(e.source!==parent||!e.data||e.data.source!=="makeborne-host")return;var d=e.data;
if(d.type==="edit-mode"){edit(!!d.on);if(!d.on)return;var tries=0;(function restore(){var all=d.loc?same(d.loc):[],el=all[Math.min(d.index||0,all.length-1)]||all[0];
var tall=!d.y||document.documentElement.scrollHeight>=d.y+innerHeight;if((d.loc&&!el||!tall)&&tries++<30){setTimeout(restore,100);return}
if(d.y)scrollTo(0,d.y);if(el)select(el);else if(d.loc)post({type:"deselect"})})()}
else if(d.type==="select-parent"&&chosen){var p=within(chosen.parentElement);if(p)select(p)}
else if(d.type==="deselect")clear()});
document.addEventListener("click",function(e){if(editing)return;var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href")||"";
if(h.charAt(0)==="#"){e.preventDefault();if(h.length>1){go(h,"push");var t=document.getElementById(decodeURIComponent(h.slice(1)));if(t)t.scrollIntoView({behavior:"smooth"});}else{scrollTo({top:0,behavior:"smooth"});}}
else if(h.charAt(0)==="/"||h.indexOf("about:")===0){e.preventDefault();post({type:"navigation-blocked",href:h});}
else if(!a.target){a.target="_blank";a.rel="noopener noreferrer";}},true);
addEventListener("message",function(e){if(e.source!==parent||!e.data||e.data.source!=="makeborne-host"||e.data.type!=="snapshot")return;
var h=document.documentElement.scrollHeight,y=0;(function step(){scrollTo(0,y);y+=Math.max(300,innerHeight*.6);if(y<h+innerHeight){setTimeout(step,60);return;}
scrollTo(0,0);setTimeout(function(){var c=document.documentElement.cloneNode(true);c.querySelectorAll("script,noscript,template,iframe,object,embed").forEach(function(n){n.remove()});
c.classList.remove("js");post({type:"snapshot",html:"<!doctype html>"+c.outerHTML});},900);})();});
var scrolls={},drafts={},restoring=false,pending="",reportWait=0;
function settle(test,delay){var tries=0;setTimeout(function again(){var done=false;try{done=test()}catch(e){done=true}if(!done&&tries++<40)setTimeout(again,75)},delay||0)}
function focusOf(el){if(!el||el===document.body||el===document.documentElement)return"";var s=el.tagName.toLowerCase();if(el.id)s+="#"+el.id;else if(el.getAttribute("name"))s+="[name="+el.getAttribute("name")+"]";return s.slice(0,80)}
function report(kind){if(!/^(push|native|replace)$/.test(pending))pending=kind;clearTimeout(reportWait);reportWait=setTimeout(function(){var k=pending;pending="";
post({type:"location",kind:k,hash:location.hash.slice(0,400),title:String(document.title||"").slice(0,200),y:Math.max(0,Math.round(scrollY)),focus:focusOf(document.activeElement)})},kind==="scroll"?150:40)}
function toTarget(id){var el=document.getElementById(id);if(!el)return false;el.scrollIntoView({block:"start",behavior:"instant"});report("target");return true}
function draftable(el){if(!el||!el.tagName)return false;var t=el.tagName;if(t!=="INPUT"&&t!=="TEXTAREA"&&t!=="SELECT")return false;return !/^(password|hidden|file|submit|button|reset|image)$/i.test(el.type||"")&&!!(el.name||el.id)}
function fieldKey(el){return(el.form?Array.prototype.indexOf.call(document.forms,el.form):-1)+":"+(el.name||el.id)}
function remember(e){var el=e.target;if(restoring||!draftable(el))return;var page=drafts[location.hash]||(drafts[location.hash]={}),key=fieldKey(el);if(!(key in page)&&Object.keys(page).length>=60)return;
page[key]=/^(checkbox|radio)$/i.test(el.type)?(el.checked?"1:":"0:")+el.value:String(el.value).slice(0,5000)}
function initial(el){if(el.tagName!=="SELECT")return el.defaultValue;var o=Array.prototype.filter.call(el.options,function(x){return x.defaultSelected})[0]||el.options[0];return o?o.value:""}
function setValue(el,value){var proto=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(el,value);
el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}))}
function restoreDrafts(){var page=drafts[location.hash];if(!page)return true;var fields=document.querySelectorAll("input,textarea,select"),found=0;if(!fields.length)return false;restoring=true;
try{Array.prototype.forEach.call(fields,function(el){if(!draftable(el))return;var v=page[fieldKey(el)];if(v===undefined)return;
if(/^checkbox$/i.test(el.type)){if(el.checked!==(v.charAt(0)==="1")){el.click();found++}return}
if(/^radio$/i.test(el.type)){if(v.charAt(0)==="1"&&v.slice(2)===el.value&&!el.checked){el.click();found++}return}
if(el.value===v||(el.value&&el.value!==initial(el)))return;setValue(el,v);found++})}finally{restoring=false}
if(found)post({type:"form-draft",restored:found});return true}
function restoreY(y){if(y>0&&document.documentElement.scrollHeight<y+innerHeight)return false;scrollTo(0,y);return true}
function arrived(){var y=scrolls[location.hash];settle(function(){restoreDrafts();return typeof y==="number"?restoreY(y):true},60)}
function go(h,kind){var old=location.href;if(location.hash!==h){rawReplace.call(history,history.state,"",at(h));own=true;try{dispatchEvent(new PopStateEvent("popstate",{state:history.state}))}finally{own=false}
try{dispatchEvent(new HashChangeEvent("hashchange",{oldURL:old,newURL:location.href}))}catch(e){}}report(kind)}
document.addEventListener("input",remember,true);document.addEventListener("change",remember,true);
document.addEventListener("submit",function(e){if(editing)return;var form=e.target,page=drafts[location.hash];if(page&&form&&form.elements)Array.prototype.forEach.call(form.elements,function(el){if(draftable(el))delete page[fieldKey(el)]});post({type:"form-blocked"})},true);
addEventListener("securitypolicyviolation",function(e){if(/connect-src|form-action/.test(e.effectiveDirective||e.violatedDirective||""))post({type:"request-blocked",directive:String(e.effectiveDirective||e.violatedDirective).slice(0,40)})});
history.pushState=function(state,title,url){rawReplace.call(history,state,title,at(url));report("push")};
history.replaceState=function(state,title,url){var result=rawReplace.call(history,state,title,at(url));report("replace");return result};
addEventListener("popstate",function(){if(own){settle(restoreDrafts,60);return}arrived();report("native")});
addEventListener("hashchange",function(){report("hash")});
addEventListener("scroll",function(){scrolls[location.hash]=scrollY;report("scroll")},{passive:true});
document.addEventListener("focusin",function(){report("focus")});
try{new MutationObserver(function(){report("title")}).observe(document.head||document.documentElement,{subtree:true,childList:true,characterData:true})}catch(e){}
addEventListener("message",function(e){if(e.source!==parent||!e.data||e.data.source!=="makeborne-host"||e.data.type!=="navigate"||typeof e.data.hash!=="string")return;
var target=typeof e.data.target==="string"?e.data.target.slice(0,200):"",replace=e.data.mode==="replace",y=Number(e.data.y);go(e.data.hash.slice(0,400),replace?"replace":"push");
settle(function(){if(target)return toTarget(target);if(replace&&isFinite(y)&&y>0)return restoreY(Math.round(y));scrollTo(0,0);return true},60)});
addEventListener("load",function(){report("load");settle(function(){var text=document.body?document.body.innerText.trim().length:0;if(!text)return false;post({type:"rendered",text:text});return true},0);
if(START)settle(function(){if(START.target)return toTarget(START.target);if(!START.y)return true;if(document.documentElement.scrollHeight<START.y+innerHeight)return false;scrollTo(0,START.y);return true},0)});
post({type:"ready"});})();</script>`;

/** Design-review capture runtime (only in "capture" bundles, after the
 * modern-screenshot UMD). The site runs in an opaque-origin sandbox, so it
 * rasterises itself: on request it scrolls once to trigger reveal effects,
 * measures objective layout problems and posts a JPEG of the page to the host.
 * Console errors are forwarded so the review sees them too. modern-screenshot
 * normally reads default styles from a nested srcdoc iframe, which an opaque
 * origin cannot access; an unstyled shadow root stands in for it. */
const CAPTURE_SHIM = `<script>(function(){
var post=function(m){try{parent.postMessage(Object.assign({source:"makeborne-preview"},m),"*")}catch(e){}};
var sent=0,original=console.error;console.error=function(){try{if(sent++<10)post({type:"console-error",message:Array.prototype.map.call(arguments,function(a){return a&&a.stack?String(a.stack):String(a)}).join(" ").slice(0,600)})}catch(e){}return original.apply(console,arguments)};
var wait=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
var clear=function(c){return !c||c==="transparent"||c==="rgba(0, 0, 0, 0)"};
function describe(el){var s=el.tagName.toLowerCase();if(el.id)s+="#"+el.id;var c=typeof el.className==="string"?el.className.trim().split(" ").filter(Boolean).slice(0,2):[];if(c.length)s+="."+c.join(".");var t=(el.textContent||"").trim().split(String.fromCharCode(10)).join(" ").replace(/ {2,}/g," ").slice(0,48);return t?s+' "'+t+'"':s}
function diagnose(){var de=document.documentElement,vw=de.clientWidth,d={overflowX:Math.max(0,de.scrollWidth-vw),wide:[],brokenImages:[],missingAlt:0};
if(d.overflowX>1){var all=document.body.querySelectorAll("*");for(var i=0;i<all.length&&d.wide.length<6;i++){var r=all[i].getBoundingClientRect();if(!r.width||(r.right<=vw+1&&r.left>=-1))continue;
var p=all[i].parentElement;if(p&&p!==document.body){var q=p.getBoundingClientRect();if(q.right>vw+1||q.left<-1)continue}d.wide.push(describe(all[i])+" spans x="+Math.round(r.left)+" to "+Math.round(r.right))}}
Array.prototype.forEach.call(document.images,function(img){if(!img.hasAttribute("alt"))d.missingAlt++;if(img.complete&&!img.naturalWidth&&d.brokenImages.length<6)d.brokenImages.push((img.getAttribute("src")||"(no src)").slice(0,90))});return d}
async function capture(o){var de=document.documentElement,h=de.scrollHeight,y=0,n=0;
while(y<Math.min(h,o.maxHeight)+innerHeight&&n++<60){scrollTo({top:y,behavior:"instant"});y+=Math.max(300,innerHeight*.6);await wait(90);h=de.scrollHeight}
scrollTo({top:0,behavior:"instant"});await wait(900);try{await document.fonts.ready}catch(e){}
var w=de.clientWidth,full=de.scrollHeight,height=Math.min(full,o.maxHeight),bg=getComputedStyle(document.body).backgroundColor;if(clear(bg))bg=getComputedStyle(de).backgroundColor;if(clear(bg))bg="#ffffff";
var diagnostics=diagnose(),host=document.createElement("div");host.style.cssText="all:initial;position:fixed;left:0;top:0;width:0;height:0;overflow:hidden";
var root=host.attachShadow({mode:"open"}),body=document.createElement("div");root.appendChild(body);de.appendChild(host);
var ctx=await modernScreenshot.createContext(de,{width:w,height:height,scale:o.scale,quality:o.quality,type:"image/jpeg",backgroundColor:bg,timeout:15000,filter:function(n){return n!==host}});
ctx.sandbox={remove:function(){host.remove()},contentWindow:{getComputedStyle:function(e,p){return getComputedStyle(e,p)},document:{body:body,createElement:function(t){return document.createElement(t)},createElementNS:function(n,t){return document.createElementNS(n,t)}}}};
try{var url=await modernScreenshot.domToDataUrl(ctx)}finally{try{modernScreenshot.destroyContext(ctx)}catch(e){}host.remove()}
post({type:"capture",dataUrl:url,width:w,height:height,fullHeight:full,diagnostics:diagnostics})}
addEventListener("message",function(e){if(e.source!==parent||!e.data||e.data.source!=="makeborne-host"||e.data.type!=="capture")return;
if(typeof modernScreenshot==="undefined"){post({type:"capture-error",message:"capture runtime missing"});return}
capture(e.data).catch(function(err){post({type:"capture-error",message:String(err&&err.message||err).slice(0,300)})})});})();</script>`;

type CompileResult = { ok: true; js: string; css: string } | BundleFailure;

/** Compile src/main.tsx with React inlined from the same-origin runtime.
 * Preview keeps readable output; publish minifies. Neither includes the shim.
 * `inspect` (preview only) tags HTML elements with their source location for
 * click-to-edit; published and captured output never carries those tags. */
async function compileProject(input: Record<string, string>, mode: "preview" | "publish", inspect = false, assets: Record<string, string> = {}, images: ResponsiveImages = {}): Promise<CompileResult> {
  const files = new Map(Object.entries(input));
  const artwork = new Map<string, string>();
  for (const [path, url] of Object.entries(assets)) {
    const normalized = path.replace(/^\//, "");
    if (!normalized || normalized.split("/").some(part => !part || part === "." || part === "..") || files.has(normalized)
      || url.length > 12_000_000 || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) {
      return { ok: false, error: "Project artwork must have a unique project path and a supported embedded raster image.", kind: "code" };
    }
    artwork.set(normalized, url);
    // Resolution shares the project's path rules; image bytes remain separate
    // from source files and never pass through the JSX instrumentation.
    files.set(normalized, "");
  }
  const importedFonts = new Set<string>();
  if (!files.has("src/main.tsx")) return { ok: false, error: "The project has no src/main.tsx entry yet.", kind: "code" };
  const origin = typeof location === "undefined" ? "" : location.origin;
  let build: Esbuild;
  // The JSX parser for click-to-edit loads only for inspect builds.
  let instrument: ((path: string, code: string) => string) | null = null;
  if (inspect && mode === "preview") {
    try { instrument = (await import("./visual-edit")).instrumentSource; }
    catch { return { ok: false, error: "Click-to-edit could not start in this browser.", kind: "transport" }; }
  }
  try { build = await esbuild(); }
  catch { return { ok: false, error: "The preview engine could not start in this browser.", kind: "transport" }; }
  let result;
  try {
    result = await build.build({
      entryPoints: ["src/main.tsx"], bundle: true, write: false, format: "esm", outdir: "/out",
      target: "es2022", jsx: "automatic", minify: mode === "publish", sourcemap: false, logLevel: "silent", legalComments: mode === "publish" ? "none" : "inline",
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env.MODE": '"production"', "import.meta.env.DEV": "false", "import.meta.env.PROD": "true" },
      plugins: [{
        name: "makeborne-project",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, args => {
            const specifier = args.path;
            if (args.namespace === "vendor" || args.namespace === "lucide") {
              // Vendored modules import React by bare name: map it to the one shared copy.
              if (VENDOR[specifier]) return { path: `${origin}/builder-runtime/vendor/${VENDOR[specifier]}`, namespace: "vendor" };
              return { path: args.namespace === "lucide" ? specifier : new URL(specifier, args.importer).href, namespace: "vendor" };
            }
            // React is inlined from the same-origin runtime: sandboxed documents
            // cannot rely on network access (e.g. private-network protections).
            // Project JSX reads the runtime through the responsive-image module when copies exist (same module as the trusted build).
            if (specifier === "react/jsx-runtime" && args.namespace === "project" && Object.keys(images).length) return { path: "jsx-runtime", namespace: "responsive" };
            if (VENDOR[specifier]) return { path: `${origin}/builder-runtime/vendor/${VENDOR[specifier]}`, namespace: "vendor" };
            if (args.kind === "entry-point") return { path: specifier, namespace: "project" };
            if (specifier === LUCIDE) return { path: LUCIDE, namespace: "lucide" };
            // Fonts are embedded from usage detection; the explicit import is a no-op marker.
            const marker = FONT_IMPORT.exec(specifier);
            const installed = /^(@fontsource(?:-variable)?)\/([a-z0-9-]+)(?:\/index\.css)?$/.exec(specifier);
            const fontId = marker?.[1] ?? installed?.[2];
            if (fontId) {
              const font = FONTS_BY_ID.get(fontId);
              if (font && (!installed || installed[1] === (/^\d+$/.test(font.axis) ? "@fontsource" : "@fontsource-variable"))) {
                importedFonts.add(fontId);
                return { path: fontId, namespace: "font" };
              }
              return { errors: [{ text: `"${specifier}" is not in the font library.` }] };
            }
            const imageModule = (resolved: string) => args.kind === "url-token"
              ? { path: artwork.get(resolved)!, external: true }
              : { path: resolved, namespace: "artwork" };
            if (specifier.startsWith("/") && artwork.has(specifier.slice(1))) return imageModule(specifier.slice(1));
            if (specifier.startsWith("/") || /^(?:data|https?):/.test(specifier)) return { path: specifier, external: true };
            if (specifier.startsWith(".")) {
              const resolved = resolveRelative(files, args.importer, specifier);
              if (resolved) return artwork.has(resolved) ? imageModule(resolved) : { path: resolved, namespace: "project" };
              return { errors: [{ text: `Cannot find "${specifier}" imported from ${args.importer}` }] };
            }
            return { errors: [{ text: `"${specifier}" is not installed. Only react, react-dom and lucide-react are available.` }] };
          });
          builder.onLoad({ filter: /.*/, namespace: "project" }, args => {
            const contents = files.get(args.path) ?? "";
            return { contents: instrument ? instrument(args.path, contents) : contents, loader: LOADERS[extension(args.path)] ?? "text" };
          });
          builder.onLoad({ filter: /.*/, namespace: "artwork" }, args => ({ contents: `export default ${JSON.stringify(artwork.get(args.path))};`, loader: "js" }));
          builder.onLoad({ filter: /.*/, namespace: "lucide" }, () => {
            const icons = lucideModule(files, origin);
            return icons.problems.length ? { errors: icons.problems.map(text => ({ text })) } : { contents: icons.contents, loader: "js" };
          });
          builder.onLoad({ filter: /.*/, namespace: "font" }, () => ({ contents: "", loader: "css" }));
          builder.onLoad({ filter: /.*/, namespace: "responsive" }, () => ({ contents: responsive.jsxRuntimeModule(images), loader: "js" }));
          builder.onLoad({ filter: /.*/, namespace: "vendor" }, async args => ({ contents: await vendorSource(args.path), loader: "js" }));
        },
      }],
    });
  } catch (error) {
    const failure = error as { errors?: { text: string; location?: { file: string; line: number } | null }[] };
    const messages = failure.errors?.slice(0, 5).map(item => item.location ? `${item.location.file.replace(/^project:/, "")}:${item.location.line}: ${item.text}` : item.text);
    const transport = Boolean(failure.errors?.some(item => item.text.includes(RUNTIME_UNAVAILABLE)));
    return { ok: false, error: messages?.join("\n") || "The project could not be bundled.", kind: transport ? "transport" : "code" };
  }
  // Every output (preview, review capture, static snapshot, hosted bundle)
  // carries the used fonts as embedded @font-face rules at the top of its CSS.
  let fonts = "";
  try { fonts = await projectFontCss(files, origin, importedFonts); }
  catch { /* fonts are progressive: fall back to the declared system stacks */ }
  const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  return {
    ok: true,
    js: result.outputFiles.find(file => file.path.endsWith(".js"))?.text ?? "",
    css: fonts ? `${fonts}
${css}` : css,
  };
}

/** Bundle a project into one self-contained HTML document (React inlined).
 * preview adds the editor shim; capture adds it plus the design-review
 * rasteriser; publish minifies. `inspect` adds click-to-edit locations to a
 * preview bundle only. */
export async function bundleProject(input: Record<string, string>, assets: Record<string, string>, mode: "preview" | "publish" | "capture" = "preview", options: { inspect?: boolean } = {}): Promise<BundleResult> {
  const compiled = await compileProject(input, mode === "publish" ? "publish" : "preview", mode === "preview" && options.inspect === true, assets);
  if (!compiled.ok) return compiled;
  const { js, css } = compiled;
  const source = input["index.html"] ?? '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Website</title></head><body><div id="root"></div></body></html>';
  let html = source.replace(/<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script>/gi, "").replace(/<link\b[^>]*rel=["']?(?:modulepreload|stylesheet)["']?[^>]*>/gi, "");
  if (!/<\/head>/i.test(html)) html = html.replace(/<body/i, "<head></head><body");
  // Function replacers: generated code may contain `$&`-style sequences. The
  // marker lets publishing swap this inline copy for the hosted stylesheet.
  let capture = "";
  if (mode === "capture") {
    const origin = typeof location === "undefined" ? "" : location.origin;
    try { capture = `<script>${scriptSafe(await vendorSource(`${origin}/builder-runtime/vendor/modern-screenshot.js`))}</script>${CAPTURE_SHIM}`; }
    catch { return { ok: false, error: "The screenshot runtime could not be loaded.", kind: "transport" }; }
  }
  const head = `${mode === "publish" ? "" : PREVIEW_SHIM}${capture}<style data-makeborne-bundle>${css.replace(/<\/style/gi, "<\\/style")}</style></head>`;
  html = html.replace(/<\/head>/i, () => head);
  const script = `<script type="module">${scriptSafe(js)}</script>`;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${script}</body>`) : `${html}${script}`;
  for (const [path, url] of Object.entries(assets)) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Replace complete quoted/URL references, never a matching byte sequence
    // inside an already embedded image (e.g. a short path /9 in JPEG base64).
    const reference = new RegExp("([\"'(])" + escaped + "(?=\\\\?[\"')])", "g");
    html = html.replace(reference, (_match, before: string) => before + url);
  }
  return { ok: true, html };
}

/** Production build for the isolated site host: one minified ES module plus one
 * stylesheet. Project images keep their public paths (served by the host).
 * `images` (responsive-images.cjs responsiveManifest) adds srcset to <img> of
 * originals with responsive copies, as the trusted build does. */
export async function buildPublishBundle(input: Record<string, string>, options: { images?: ResponsiveImages } = {}): Promise<{ js: string; css: string }> {
  const compiled = await compileProject(input, "publish", false, {}, options.images);
  if (!compiled.ok) throw new Error(`Fix the build before publishing: ${compiled.error}`);
  if (!compiled.js.trim()) throw new Error("The website build produced no script.");
  return { js: compiled.js, css: compiled.css };
}

/** Render the project off-screen in the same sandbox and capture its final DOM
 * as static HTML (scripts removed) for publishing to the script-free host. */
export async function captureStaticSnapshot(files: Record<string, string>, assets: Record<string, string>): Promise<string> {
  const bundle = await bundleProject(files, assets, "preview");
  if (!bundle.ok) throw new Error(`Fix the build before publishing: ${bundle.error}`);
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: "1280px", height: "900px", border: "0", opacity: "0", pointerEvents: "none" });
  return await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("The website took too long to render for publishing.")), 30_000);
    const finish = (error: Error | null, html?: string) => {
      clearTimeout(timer); window.removeEventListener("message", listen); frame.remove();
      if (error) reject(error); else resolve(html!);
    };
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.source !== "makeborne-preview") return;
      if (event.data.type === "ready") setTimeout(() => frame.contentWindow?.postMessage({ source: "makeborne-host", type: "snapshot" }, "*"), 600);
      if (event.data.type === "snapshot") finish(null, String(event.data.html));
    };
    window.addEventListener("message", listen);
    frame.srcdoc = bundle.html;
    document.body.appendChild(frame);
  });
}

/** In-browser bundler for Makeborne React/Vite projects. Runs only trusted
 * esbuild code in the app; the generated site executes solely inside an opaque
 * sandboxed iframe that cannot reach Makeborne cookies, storage or APIs. */
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
const vendorSource = (url: string) => {
  if (!vendorCache.has(url)) vendorCache.set(url, fetch(url, { cache: "force-cache" }).then(response => {
    if (!response.ok) throw new Error(`Runtime file unavailable: ${url}`);
    return response.text();
  }));
  return vendorCache.get(url)!;
};

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

export type BundleResult = { ok: true; html: string } | { ok: false; error: string };

/** Escape text so it can sit inside an inline <script> element. */
const scriptSafe = (code: string) => code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

/** Small runtime injected into previews: reports errors to the editor and keeps
 * in-page links inside the sandbox (srcdoc documents inherit the parent URL). */
const PREVIEW_SHIM = `<script>(function(){
var post=function(m){try{parent.postMessage(Object.assign({source:"makeborne-preview"},m),"*")}catch(e){}};
addEventListener("error",function(e){post({type:"runtime-error",message:String(e.message||e.error||"Script error"),stack:e.error&&e.error.stack?String(e.error.stack).slice(0,2000):""})});
addEventListener("unhandledrejection",function(e){post({type:"runtime-error",message:"Unhandled promise rejection: "+String(e.reason&&e.reason.message||e.reason)})});
document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href")||"";
if(h.charAt(0)==="#"){e.preventDefault();if(h.length>1){location.hash=h;var t=document.getElementById(decodeURIComponent(h.slice(1)));if(t)t.scrollIntoView({behavior:"smooth"});}else{scrollTo({top:0,behavior:"smooth"});}}
else if(h.charAt(0)==="/"||h.indexOf("about:")===0){e.preventDefault();post({type:"navigation-blocked",href:h});}
else if(!a.target){a.target="_blank";a.rel="noopener noreferrer";}},true);
addEventListener("message",function(e){if(e.source!==parent||!e.data||e.data.source!=="makeborne-host"||e.data.type!=="snapshot")return;
var h=document.documentElement.scrollHeight,y=0;(function step(){scrollTo(0,y);y+=Math.max(300,innerHeight*.6);if(y<h+innerHeight){setTimeout(step,60);return;}
scrollTo(0,0);setTimeout(function(){var c=document.documentElement.cloneNode(true);c.querySelectorAll("script,noscript,template,iframe,object,embed").forEach(function(n){n.remove()});
c.classList.remove("js");post({type:"snapshot",html:"<!doctype html>"+c.outerHTML});},900);})();});
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

/** Bundle a project into one self-contained HTML document (React inlined).
 * preview adds the editor shim; capture adds it plus the design-review
 * rasteriser; publish minifies. */
export async function bundleProject(input: Record<string, string>, assets: Record<string, string>, mode: "preview" | "publish" | "capture" = "preview"): Promise<BundleResult> {
  const files = new Map(Object.entries(input));
  if (!files.has("src/main.tsx")) return { ok: false, error: "The project has no src/main.tsx entry yet." };
  const origin = typeof location === "undefined" ? "" : location.origin;
  let build: Esbuild;
  try { build = await esbuild(); }
  catch { return { ok: false, error: "The preview engine could not start in this browser." }; }
  let result;
  try {
    result = await build.build({
      entryPoints: ["src/main.tsx"], bundle: true, write: false, format: "esm", outdir: "/out",
      target: "es2022", jsx: "automatic", minify: mode === "publish", sourcemap: false, logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env.MODE": '"production"', "import.meta.env.DEV": "false", "import.meta.env.PROD": "true" },
      plugins: [{
        name: "makeborne-project",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, args => {
            const specifier = args.path;
            if (args.namespace === "vendor") return { path: new URL(specifier, args.importer).href, namespace: "vendor" };
            // React is inlined from the same-origin runtime: sandboxed documents
            // cannot rely on network access (e.g. private-network protections).
            if (VENDOR[specifier]) return { path: `${origin}/builder-runtime/vendor/${VENDOR[specifier]}`, namespace: "vendor" };
            if (args.kind === "entry-point") return { path: specifier, namespace: "project" };
            if (specifier.startsWith("/") || /^(?:data|https?):/.test(specifier)) return { path: specifier, external: true };
            if (specifier.startsWith(".")) {
              const resolved = resolveRelative(files, args.importer, specifier);
              if (resolved) return { path: resolved, namespace: "project" };
              return { errors: [{ text: `Cannot find "${specifier}" imported from ${args.importer}` }] };
            }
            return { errors: [{ text: `"${specifier}" is not installed. Only react and react-dom are available.` }] };
          });
          builder.onLoad({ filter: /.*/, namespace: "project" }, args => ({
            contents: files.get(args.path) ?? "", loader: LOADERS[extension(args.path)] ?? "text",
          }));
          builder.onLoad({ filter: /.*/, namespace: "vendor" }, async args => ({ contents: await vendorSource(args.path), loader: "js" }));
        },
      }],
    });
  } catch (error) {
    const failure = error as { errors?: { text: string; location?: { file: string; line: number } | null }[] };
    const messages = failure.errors?.slice(0, 5).map(item => item.location ? `${item.location.file.replace(/^project:/, "")}:${item.location.line}: ${item.text}` : item.text);
    return { ok: false, error: messages?.join("\n") || "The project could not be bundled." };
  }
  const js = result.outputFiles.find(file => file.path.endsWith(".js"))?.text ?? "";
  const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";

  const source = files.get("index.html") ?? '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Website</title></head><body><div id="root"></div></body></html>';
  let html = source.replace(/<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script>/gi, "").replace(/<link\b[^>]*rel=["']?(?:modulepreload|stylesheet)["']?[^>]*>/gi, "");
  if (!/<\/head>/i.test(html)) html = html.replace(/<body/i, "<head></head><body");
  // Function replacers: generated code may contain `$&`-style sequences.
  let capture = "";
  if (mode === "capture") {
    try { capture = `<script>${scriptSafe(await vendorSource(`${origin}/builder-runtime/vendor/modern-screenshot.js`))}</script>${CAPTURE_SHIM}`; }
    catch { return { ok: false, error: "The screenshot runtime could not be loaded." }; }
  }
  const head = `${mode === "publish" ? "" : PREVIEW_SHIM}${capture}<style>${css.replace(/<\/style/gi, "<\\/style")}</style></head>`;
  html = html.replace(/<\/head>/i, () => head);
  const script = `<script type="module">${scriptSafe(js)}</script>`;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${script}</body>`) : `${html}${script}`;
  for (const [path, url] of Object.entries(assets)) html = html.split(path).join(url);
  return { ok: true, html };
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

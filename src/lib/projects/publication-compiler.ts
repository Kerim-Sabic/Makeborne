import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {ArtifactVersionSchema} from "../domain";
import {websiteBuildInput} from "./build-input";
import {validateBuildReceipt, type BuildReceipt} from "./build-receipt";
import {canonicalSourceJson} from "./canonical-json";
import {retainCompiledOutput, readCompiledOutputFile, type CompiledOutputStore} from "./compiled-output";
import type {resolveWebsiteSourceAssets} from "./source-assets";
import {prepareCompiledSiteFiles, type SiteFile} from "../hosting/bundle";
import {siteDocumentCsp, siteFileContentType, siteScriptPath, siteStylePath, validSiteLabel, SITE_LIMITS} from "../../../infra/customer-sites/site-policy";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const PublicationBindingSchema = z.object({preparationId:z.string().uuid(), actorId:z.string().uuid(), workspaceId:z.string().uuid(), projectId:z.string().uuid(), artifactId:z.string().uuid(), versionId:z.string().uuid(), versionNumber:z.number().int().positive(), publicationRevision:z.number().int().nonnegative(), versionContentHash:hash, slug:z.string().refine(validSiteLabel), interactive:z.boolean()}).strict();
export type PublicationBinding = z.infer<typeof PublicationBindingSchema>;
export const PUBLICATION_POLICY_HASH = sha(canonicalSourceJson({id:"retained-vite-publication-v1", csp:siteDocumentCsp({interactive:true,secure:true}), limits:SITE_LIMITS, routes:"declared-exact-max20", entries:"one-module", renderer:"isolated-world-dom-v1", network:"manifest-only-no-sockets", sanitizer:"hosted-snapshot-v2"}));
type Workload = ReturnType<typeof websiteBuildInput>;
export type PublicationCompilerDependencies = {
  qualifiedRuntimeImageId: string;
  qualifiedRendererId: string;
  /** Trusted deployment configuration. Never a browser parameter. */
  sitesDomain: string;
  compile(workload: Workload, signal: AbortSignal): Promise<{receipt: unknown; readFile(path:string,maxBytes:number,signal:AbortSignal):Promise<Uint8Array>; dispose():Promise<void>}>;
  store: CompiledOutputStore;
  render(input:{origin:string; path:string; indexHtml:string; files:SiteFile[]; signal:AbortSignal}):Promise<{html:string; rendererId:string}>;
};
const fail = (code:string):never => {throw new Error(code);};

/** Reject unsupported HTML execution before running the compiler. There must be
 * exactly one conventional Vite entry. In particular inline initializers cannot
 * run in preview but disappear silently from hosted output. */
export function publicationSourcePreflight(indexHtml:string) {
  const scripts = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  if (scripts.length !== 1 || scripts[0][2].trim()) fail("PUBLICATION_INLINE_INITIALIZER_UNSUPPORTED");
  const attrs = scripts[0][1];
  if (!/\btype\s*=\s*(["'])module\1/i.test(attrs) || !/\bsrc\s*=\s*(["'])\/?src\/main\.tsx\1/i.test(attrs)
    || /<script\b/i.test(indexHtml.replace(scripts[0][0], "")) || /\son[a-z]+\s*=/i.test(indexHtml)) fail("PUBLICATION_ENTRY_UNSUPPORTED");
}

/** Pure extraction, never execution: one retained module entry and all linked
 * styles must address exact public manifest files. Vite-generated markup only. */
export function publicationEntries(indexHtml:string, files:SiteFile[]) {
  const paths = new Set(files.map(file=>file.path)), scripts:string[] = [], stylesheets:string[] = [];
  for (const match of indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const src = /\bsrc\s*=\s*(["'])([^"']+)\1/i.exec(match[1])?.[2];
    if (match[2].trim() || !/\btype\s*=\s*(["'])module\1/i.test(match[1]) || !src || !siteScriptPath(src) || !paths.has(src)) fail("PUBLICATION_ENTRY_UNSUPPORTED");
    scripts.push(src!);
  }
  for (const match of indexHtml.matchAll(/<link\b([^>]*)>/gi)) {
    if (!/\brel\s*=\s*(["'])stylesheet\1/i.test(match[1])) continue;
    const href = /\bhref\s*=\s*(["'])([^"']+)\1/i.exec(match[1])?.[2];
    if (!href || !siteStylePath(href) || !paths.has(href)) fail("PUBLICATION_STYLE_UNSUPPORTED");
    stylesheets.push(href!);
  }
  if (scripts.length !== 1 || new Set(stylesheets).size !== stylesheets.length) fail("PUBLICATION_ENTRY_UNSUPPORTED");
  return {scripts,stylesheets};
}

/** Includes styles introduced by a Vite dynamic import for this exact route. */
function renderedStylesheets(html:string, files:SiteFile[], origin:string) {
  const paths = new Set(files.filter(file=>file.contentType.startsWith('text/css')).map(file=>file.path));
  const result:string[]=[];
  for(const match of html.matchAll(/<link\b([^>]*)>/gi)){
    if(!/\brel\s*=\s*(["'])stylesheet\1/i.test(match[1]))continue;
    const href=/\bhref\s*=\s*(["'])([^"']+)\1/i.exec(match[1])?.[2];
    if(!href)fail('PUBLICATION_STYLE_UNSUPPORTED');
    const url=new URL(href!,`${origin}/`);
    if(url.origin!==origin||url.search||url.hash||!paths.has(url.pathname))fail('PUBLICATION_STYLE_UNSUPPORTED');
    if(!result.includes(url.pathname))result.push(url.pathname);
  }
  return result;
}

/** Internal worker boundary only. Identifiers must come from a service-only
 * fenced claim; version/assets from authoritative saved records. No browser
 * output, image URL, compiled script or receipt is accepted as authority. */
export async function compileTrustedPublication(input:{binding:PublicationBinding;version:unknown;artwork:Awaited<ReturnType<typeof resolveWebsiteSourceAssets>>}, deps:PublicationCompilerDependencies, signal:AbortSignal) {
  signal.throwIfAborted();
  const binding = PublicationBindingSchema.parse(input.binding), version = ArtifactVersionSchema.parse(input.version);
  if (version.id !== binding.versionId || version.artifactId !== binding.artifactId || version.number !== binding.versionNumber) fail("PUBLICATION_VERSION_MISMATCH");
  if (!/^sha256:[a-f0-9]{64}$/.test(deps.qualifiedRuntimeImageId) || !deps.qualifiedRendererId || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(deps.sitesDomain)) fail("PUBLICATION_EXECUTOR_UNQUALIFIED");
  const workload = websiteBuildInput(version,input.artwork);
  if (workload.routes.length > 20 || workload.routes.some(route=>/^\/(?:_mb|assets)(?:\/|$)/.test(route.path))) fail("PUBLICATION_ROUTES_UNSUPPORTED");
  publicationSourcePreflight(Buffer.from(workload.files.find(file=>file.path === "index.html")!.base64,"base64").toString("utf8"));
  const result = await deps.compile(workload,signal);
  try {
    signal.throwIfAborted();
    const buildReceipt:BuildReceipt = validateBuildReceipt(result.receipt,workload);
    if (buildReceipt.runtimeImageId !== deps.qualifiedRuntimeImageId) fail("PUBLICATION_RUNTIME_UNQUALIFIED");
    await retainCompiledOutput(deps.store,binding.workspaceId,buildReceipt,result.readFile,signal);
    const read = async(path:string) => {
      const bytes = await readCompiledOutputFile(deps.store,binding.workspaceId,buildReceipt,path,signal);
      if (!bytes) return fail("PUBLICATION_FILE_MISSING");
      return bytes;
    };
    const indexHtml = Buffer.from(await read("index.html")).toString("utf8");
    if (Buffer.byteLength(indexHtml)>SITE_LIMITS.html) fail("PUBLICATION_HTML_LIMIT");
    const publicFiles = [];
    for (const file of buildReceipt.files) {
      if (file.path === "index.html" || file.path === "makeborne-materialization.json" || /^makeborne-font-licenses\/[A-Za-z0-9_-]+\.txt$/.test(file.path)) continue;
      if (!siteFileContentType(`/${file.path}`)) fail("PUBLICATION_OUTPUT_TYPE_UNSUPPORTED");
      publicFiles.push({path:file.path, bytes:await read(file.path), sha256:file.sha256});
    }
    const files = prepareCompiledSiteFiles(publicFiles), entries = publicationEntries(indexHtml,files);
    const routeSnapshots:{path:string;html:string;stylesheets:string[]}[]=[];let snapshotBytes=0;
    for(const route of workload.routes){
      signal.throwIfAborted();
      const rendered = await deps.render({origin:`https://${binding.slug}.${deps.sitesDomain}`,path:route.path,indexHtml,files,signal});
      signal.throwIfAborted();
      if (rendered.rendererId !== deps.qualifiedRendererId || typeof rendered.html !== "string" || Buffer.byteLength(rendered.html)>3_900_000) fail("PUBLICATION_RENDERER_UNQUALIFIED");
      snapshotBytes+=Buffer.byteLength(rendered.html);if(snapshotBytes>8_000_000)fail("PUBLICATION_ROUTES_LIMIT");
      routeSnapshots.push({path:route.path,html:rendered.html,stylesheets:renderedStylesheets(rendered.html,files,`https://${binding.slug}.${deps.sitesDomain}`)});
    }
    const snapshotHtml=routeSnapshots.find(route=>route.path==='/')!.html;
    const identity = {schemaVersion:1 as const,...binding,sourceHash:workload.sourceHash,assetsHash:sha(canonicalSourceJson(workload.sourceManifest.assets)),toolchainHash:workload.toolchainHash,runtimeImageId:buildReceipt.runtimeImageId,rendererId:deps.qualifiedRendererId,policyHash:PUBLICATION_POLICY_HASH,buildHash:buildReceipt.buildHash,snapshotHash:sha(snapshotHtml),routes:routeSnapshots.map(route=>({path:route.path,snapshotHash:sha(route.html),stylesheets:route.stylesheets})),files:files.map(file=>({path:file.path,bytes:file.body.length,sha256:file.sha256,contentType:file.contentType})),...entries};
    const receipt = {...identity,receiptHash:sha(canonicalSourceJson(identity))};
    // Render marker last, following immutable compiled-file retention. A failed
    // render cannot acquire a completed publication receipt.
    const key = `publication-v1/${binding.workspaceId}/${binding.preparationId}/${receipt.receiptHash}/receipt.json`, marker = Buffer.from(canonicalSourceJson(receipt));
    await deps.store.putIfAbsent(key,marker,signal);
    const retained = await deps.store.get(key,marker.length,signal); signal.throwIfAborted();
    if (!retained || sha(retained)!==sha(marker)) fail("PUBLICATION_RETENTION_UNCONFIRMED");
    return {snapshotHtml,routeSnapshots,buildReceipt,receipt,files,...entries,assetPaths:new Set(files.filter(file=>!file.contentType.startsWith("text/javascript")).map(file=>file.path))};
  } finally {await result.dispose();}
}



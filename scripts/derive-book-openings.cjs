/* eslint-disable @typescript-eslint/no-require-imports -- Offline, explicitly postprocessed book demonstration. */
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict'), crypto=require('node:crypto'), Module=require('node:module'), ts=require('typescript');
const load=Module._load;
Module._load=function(name,parent,main){return name==='server-only'?{}:load.call(this,name,parent,main);};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}}).outputText,file);
const {DocumentSourceSchema}=require('../src/lib/documents/schema.ts');
const {documentPdf}=require('../src/lib/documents/export-server.ts');
const {bookHtml}=require('../src/lib/documents/render-book.ts');
const {chromium}=require('playwright');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
async function main(){
 const [input,output]=process.argv.slice(2);assert(input&&output);assert.notEqual(path.resolve(input),path.resolve(output));assert(!fs.existsSync(output),'Output must be new; never overwrite an original');
 const bytes=fs.readFileSync(input),version=JSON.parse(bytes),original=version.content.document;assert.equal(original.kind,'book');assert.equal(original.assets.length,0);
 const doc=structuredClone(original);for(const id of ['intro','final-checklist']){const chapter=doc.chapters.find(c=>c.id===id);assert(chapter);chapter.opening='inline';}
 const restored=structuredClone(doc);for(const chapter of restored.chapters){const old=original.chapters.find(c=>c.id===chapter.id);if(old.opening===undefined)delete chapter.opening;else chapter.opening=old.opening;}assert.deepEqual(restored,original);
 DocumentSourceSchema.parse(doc);fs.mkdirSync(output,{recursive:true});version.content.document=doc;fs.writeFileSync(path.join(output,'saved-version.json'),JSON.stringify(version,null,2)+'\n');
 fs.writeFileSync(path.join(output,'document.pdf'),await documentPdf(doc,{}));
 const html=bookHtml(doc,{});fs.writeFileSync(path.join(output,'preview.html'),html);
 const browser=await chromium.launch({headless:true});const links=[];
 try{const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block',viewport:{width:660,height:1000}});await context.route('**/*',r=>r.abort());const page=await context.newPage();await page.setContent(html);
  for(const chapter of doc.chapters){const href=`#chapter-${chapter.id}`;await page.locator(`.contents a[href="${href}"]`).click();const bounds=await page.locator(href).boundingBox();assert(bounds&&bounds.y>=-1&&bounds.y<1000,'Anchor target must be visible');links.push({id:chapter.id,targetTop:bounds.y});}
  for(const id of ['intro','final-checklist'])await page.locator(`#chapter-${id}`).screenshot({path:path.join(output,`${id}-preview.png`)});
 }finally{await browser.close();}
 assert.equal(hash(fs.readFileSync(input)),hash(bytes),'Original source changed');
 const evidence={provenance:'DERIVED demonstration, not fresh model output. Original generated prose/theme/cover retained. Exactly intro and final-checklist were manually assigned opening:inline; renderer also suppresses conflicting automatic numerals and adds contents links.',original:path.resolve(input),originalSha256:hash(bytes),changedChapterFields:['intro.opening','final-checklist.opening'],previewLinks:links,providerCalls:0,pdfExport:'actual documentPdf implementation; offline Chromium',imagesQualified:false};
 fs.writeFileSync(path.join(output,'derivation-evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}
main().catch(error=>{console.error(error);process.exitCode=1;});

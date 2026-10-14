/* eslint-disable @typescript-eslint/no-require-imports -- Local saved-output qualification only. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript'),{spawnSync}=require('node:child_process');
const {chromium}=require('playwright'),JSZip=require('jszip');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}}).outputText,file);
async function main(){
 const [app,output]=process.argv.slice(2),version=JSON.parse(fs.readFileSync(path.join(output,'saved-version.json'),'utf8')),doc=version.content.document;assert(doc);assert.equal(doc.assets.length,0,'IMAGES_UNQUALIFIED');
 const {DocumentSourceSchema}=require(path.join(app,'src/lib/documents/schema.ts'));DocumentSourceSchema.parse(doc);
 const {bookHtml}=require(path.join(app,'src/lib/documents/render-book.ts')),{deckHtml}=require(path.join(app,'src/lib/documents/render-deck.ts'));
 const html=doc.kind==='book'?bookHtml(doc,{}):deckHtml(doc,{});fs.writeFileSync(path.join(output,'preview.html'),html);
 const browser=await chromium.launch({headless:true});try{const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block',viewport:doc.kind==='book'?{width:576,height:864}:{width:1280,height:720}});await context.route('**/*',route=>route.abort());const page=await context.newPage();await page.setContent(html);
  if(doc.kind==='book')await page.screenshot({path:path.join(output,'book-preview.png'),fullPage:true});
  else for(let i=0;i<doc.slides.length;i++)await page.locator('.slide').nth(i).screenshot({path:path.join(output,`slide-${i+1}.png`)});
 }finally{await browser.close();}
 const evidence={sourceOrigin:'saved application version; inspect request/events for generation provenance',sourceVersion:version.version_number,manualVisualInspectionRequired:true,imagesQualified:false,officeRenderingQualified:false};
 const poppler=path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe');
 if(fs.existsSync(poppler)){const r=spawnSync(poppler,['-r','120','-png',path.join(output,'document.pdf'),path.join(output,'pdf-page')],{windowsHide:true,encoding:'utf8',timeout:120000});assert.equal(r.status,0,'PDF_RASTERIZATION_FAILED');evidence.pdfRasterized=true;}else evidence.pdfRasterized=false;
 if(doc.kind==='deck'){const zip=await JSZip.loadAsync(fs.readFileSync(path.join(output,'document.pptx'))),names=Object.keys(zip.files);const slides=names.filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));evidence.pptx={slides:slides.length,nativeCharts:names.filter(n=>/^ppt\/charts\/chart\d+\.xml$/.test(n)).length,notes:names.filter(n=>/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).length,nativeTextCounts:[]};for(const name of slides)evidence.pptx.nativeTextCounts.push((await zip.file(name).async('string')).match(/<a:t>/g)?.length??0);assert.equal(slides.length,doc.slides.length);}
 fs.writeFileSync(path.join(output,'render-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
}
main().catch(()=>{console.error('FRESH_QUALITY_RENDER_FAILED');process.exitCode=1;});

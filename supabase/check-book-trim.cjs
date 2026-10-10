/* eslint-disable @typescript-eslint/no-require-imports -- Calls the real server PDF renderer; not browser UI automation. */
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict');
if(process.env.MAKEBORNE_VERIFY_BOOK_TRIM!=='true')throw new Error('EXPLICIT_LOCAL_PDF_CHECK_REQUIRED');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {ExportRequestSchema,htmlDocument,pdfDocument}=require('../src/lib/server/export.ts');
const output=path.resolve('../../outputs/Makeborne_Book_Quality_Check_2026-10-09');
const paragraph='A strong client project starts with listening. Ask what success means, who will use the finished work, and what information is already approved. Keep the brief specific enough to guide decisions, while leaving room for a thoughtful visual direction. Record open questions instead of presenting assumptions as facts.';
const blocks=['Begin with a clear brief','Build a useful first version','Review before sharing'].flatMap((text,chapter)=>[{id:`chapter-${chapter}`,type:'heading',text},...Array.from({length:6},(_,index)=>({id:`paragraph-${chapter}-${index}`,type:'paragraph',text:`${chapter*6+index+1}. ${paragraph}`}))]);
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 for(const dark of [false,true]){
  const input=ExportRequestSchema.parse({format:'pdf',kind:'book',title:'The Thoughtful Client Guide',author:'Makeborne QA',language:'en',styleId:'trim-fixture',style:{id:'trim-fixture',name:'Trim fixture',font:dark?'sans':'serif',color:dark?'#8FEBC8':'#45665A',background:dark?'#142824':'#F8F7F4',textColor:dark?'#F0FAF4':'#242A26'},blocks});
  const html=htmlDocument(input);assert(html.includes('size:6in 9in'));assert(!html.includes('size:A4'));assert(html.includes('height:7.8in'));
  const pdf=await pdfDocument(input);assert.equal(pdf.subarray(0,4).toString(),'%PDF');
  fs.writeFileSync(path.join(output,dark?'dark-book.pdf':'editorial-book.pdf'),pdf);
  console.log(`PASS real server PDF generated: ${dark?'dark':'editorial'} book, explicit 6x9 trim`);
 }
 const overfull=ExportRequestSchema.parse({format:'pdf',kind:'book',title:'Very long book title '.repeat(9).trim(),blocks:[{id:'cover',type:'image',text:'An excessively long cover caption. '.repeat(300),image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVuoAAAAASUVORK5CYII='}]});
 await assert.rejects(()=>pdfDocument(overfull),error=>error.code==='BOOK_COVER_OVERFLOW');
 console.log('PASS overfull cover rejected; source not clipped or altered');
 console.log('No provider calls. PDF dimensions/text/visual inspection are independent next checks.');
})().catch(()=>{console.error('LOCAL_BOOK_TRIM_CHECK_FAILED; diagnostics redacted');process.exitCode=1;});

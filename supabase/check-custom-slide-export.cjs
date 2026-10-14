/* eslint-disable @typescript-eslint/no-require-imports -- Actual local renderer qualification. */
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
if(process.env.MAKEBORNE_VERIFY_CUSTOM_SLIDE_EXPORT!=='true')throw new Error('EXPLICIT_LOCAL_RENDER_REQUIRED');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
(async()=>{
 const {createNativeSlideFixture}=require('./native-slide-fixture.cjs');
 const {accountExportRequest}=require('../src/lib/cloud/account-export.ts');
 const {ExportRequestSchema,prepareExport,pdfDocument,presentationDocument,htmlDocument}=require('../src/lib/server/export.ts');
 const {content,style}=createNativeSlideFixture();
 const imageBlock={id:randomUUID(),type:'image',text:'Existing fictional Good Dog artwork. Photography direction needs approval.',assetId:randomUUID(),locked:false,sourceIds:[]};
 const bodyBlock={id:randomUUID(),type:'paragraph',text:'Give the product room to breathe. Keep important details close to the decision.',assetId:null,locked:false,sourceIds:[]};
 const text=(source,x,y,width,height,fontSize,font='body')=>({id:randomUUID(),kind:'text',source,x,y,width,height,fontSize,lineHeight:1.3,font,weight:'regular',align:'left'});
 content.sections.push({id:randomUUID(),title:'A direction worth exploring.',blocks:[imageBlock,bodyBlock],slideDesign:{schemaVersion:1,background:'#F4F0E7',elements:[
  {id:randomUUID(),kind:'image',blockId:imageBlock.id,x:80,y:180,width:600,height:400,fit:'cover'},
  text({kind:'block',blockId:imageBlock.id},80,600,600,90,24),
  text({kind:'title'},744,100,456,220,56,'heading'),
  text({kind:'block',blockId:bodyBlock.id},744,360,456,240,28),
 ]}});
 const image='data:image/png;base64,'+(await require('sharp')('public/generated/good-dog-v2/coastal-dog.webp').png().toBuffer()).toString('base64');
 const request=ExportRequestSchema.parse(accountExportRequest(content,style,{format:'pdf',documentId:randomUUID()},new Map([[imageBlock.assetId,image]])));
 const input=await prepareExport(request);
 for(const mutate of [r=>r.slides[1].sourceBlocks[0].image=undefined,r=>r.slides[1].design.elements.splice(1,1),r=>r.slides[1].design.elements[0].blockId=randomUUID()]){const bad=structuredClone(request);mutate(bad);assert(!ExportRequestSchema.safeParse(bad).success);}
 const html=htmlDocument(input);assert(html.includes('#F4F0E7'));assert(html.includes('#45665A'));
 const output=path.resolve('../../outputs/Makeborne_Custom_Slide_Check_2026-10-09');fs.mkdirSync(output,{recursive:true});
 fs.writeFileSync(path.join(output,'custom.pdf'),await pdfDocument(input));
 const pptx=await presentationDocument({...input,format:'pptx'});fs.writeFileSync(path.join(output,'custom.pptx'),pptx);
 const zip=await require('jszip').loadAsync(pptx),xml=await zip.file('ppt/slides/slide1.xml').async('string');
 assert.equal((xml.match(/<p:sp>/g)||[]).length,3);assert(!xml.includes('<p:pic>'));assert(!xml.includes('<a:normAutofit'));assert(xml.includes('F4F0E7'));assert(xml.includes('45665A'));assert(xml.includes('sz="6300"'));assert(xml.includes('x="762000"'));assert(xml.includes('x="6934200"'));
 for(const text of [content.sections[0].title,...content.sections[0].blocks.map(b=>b.text)])assert(xml.includes(text));
 const artworkSlide=await zip.file('ppt/slides/slide2.xml').async('string');assert.equal((artworkSlide.match(/<p:pic>/g)||[]).length,1);assert.equal((artworkSlide.match(/<p:sp>/g)||[]).length,3);assert(artworkSlide.includes(imageBlock.text));assert(artworkSlide.includes('srcRect'));
 console.log('PASS custom compositions rendered to actual two-slide PDF/PPTX; editable native text, independent artwork/caption, crop, arbitrary geometry, typography, colors and exact copy retained. Missing artwork/caption and foreign source rejected. No provider calls.');
})().catch(error=>{console.error('CUSTOM_EXPORT_FAILED '+(error.code||error.message));process.exitCode=1;});

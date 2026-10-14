/* eslint-disable @typescript-eslint/no-require-imports -- Local composition and real export qualification. */
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const {composeNativeSlide,groupPresentationBlocks,SLIDE_CANVAS}=require('../src/lib/presentations/composition.ts');
let groups=0;function test(name,fn){fn();groups++;console.log('PASS '+name);}
const examples=[
 {title:'Good Dog, outdoors.',body:'A considered direction for an independent dog shop.',notes:'Fictional design review. No customer claims.'},
 {title:'Useful things. More time outside.',body:'Simple choices for everyday walks.'},
 {title:'The direction starts with the product.',body:'Warm photography, readable type and clear product details give the collection room to breathe.\n\nKeep materials, sizing and care information beside the purchase decision. Ask the owner to confirm missing details before publishing.\n\nThis is a proposed creative direction, not evidence of customer results.'},
 {title:'Made for the next walk.',body:'A coastal image establishes the mood.\n\nProduct specifications and photography still need approval.'},
];
test('distinct content roles choose opening, statement, editorial and image-led compositions',()=>assert.deepEqual(examples.map((copy,i)=>composeNativeSlide({...copy,hasImage:i===3},i,4).layout),['opening','statement','editorial','image-led']));
test('all boxes remain in fixed 1280x720 canvas without content overlap',()=>{
 for(const [i,copy]of examples.entries()){
  const scene=composeNativeSlide({...copy,hasImage:i===3},i,4),boxes=[...scene.text,...(scene.image?[scene.image]:[])];
  for(const b of boxes){assert(b.x>=0&&b.y>=0&&b.width>0&&b.height>0);assert(b.x+b.width<=SLIDE_CANVAS.width&&b.y+b.height<=SLIDE_CANVAS.height);}
  for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++)assert(!(boxes[a].x<boxes[b].x+boxes[b].width&&boxes[a].x+boxes[a].width>boxes[b].x&&boxes[a].y<boxes[b].y+boxes[b].height&&boxes[a].y+boxes[a].height>boxes[b].y));
 }
});
test('supplied text remains exact including markup, whitespace and numbers',()=>{const title='<style>Do not execute</style>',body='Exact 12.5%\n\nKeep & <these> words.  ';const scene=composeNativeSlide({title,body,hasImage:false},0,1);assert.equal(scene.text[0].text,title);assert.equal(scene.text[1].text,body);});
test('multiple images get separate slides with captions and order intact',()=>{const blocks=[{id:'h',type:'heading',text:'Approved title'},{id:'p',type:'paragraph',text:'Exact paragraph'},{id:'i1',type:'image',text:'First caption',image:'a'},{id:'i2',type:'image',text:'Second caption',image:'b'}];const before=JSON.stringify(blocks),slides=groupPresentationBlocks('Deck',blocks);assert.equal(slides.length,2);assert.equal(slides[1].title,'Approved title');assert.deepEqual(slides.flatMap(s=>s.blocks),blocks.slice(1));assert.equal(JSON.stringify(blocks),before);});
test('empty decks keep a real title slide and invalid positions fail',()=>{assert.equal(groupPresentationBlocks('Empty',[])[0].title,'Empty');assert.throws(()=>composeNativeSlide({title:'x',body:'',hasImage:false},1,1));});
console.log(`NATIVE COMPOSITION PASSED: ${groups} groups.`);
if(process.env.MAKEBORNE_VERIFY_NATIVE_SLIDES==='true') (async()=>{
 const {ExportRequestSchema,htmlDocument,pdfDocument,presentationDocument}=require('../src/lib/server/export.ts');
 const JSZip=require('jszip'),sharp=require('sharp');
 const output=path.resolve('../../outputs/Makeborne_Native_Slide_Check_2026-10-09');fs.mkdirSync(output,{recursive:true});
 const image='data:image/png;base64,'+(await sharp('public/generated/good-dog-v2/coastal-dog.webp').png().toBuffer()).toString('base64');
 for(const dark of [false,true]){
  const label=dark?'dark':'light';
  const input=ExportRequestSchema.parse({format:'pdf',kind:'presentation',title:'Good Dog creative direction',styleId:'native-fixture',style:{id:'native-fixture',name:'Native fixture',font:dark?'sans':'serif',color:dark?'#D9FF59':'#45665A',background:dark?'#17231D':'#F8F7F4',textColor:dark?'#F8F7F4':'#242A26'},slides:examples.map((copy,i)=>({...copy,id:'slide-'+i,...(i===3?{image}:{})}))});
  const html=htmlDocument(input);assert(html.includes('ap-native-editorial'));assert(!html.includes('radial-gradient'));assert(html.includes('container-type:inline-size'));
  const pdf=await pdfDocument(input);fs.writeFileSync(path.join(output,label+'.pdf'),pdf);
  const pptx=await presentationDocument({...input,format:'pptx'});fs.writeFileSync(path.join(output,label+'.pptx'),pptx);
  const zip=await JSZip.loadAsync(pptx);assert.equal(Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).length,4);
  for(let i=0;i<4;i++){
   const xml=await zip.file(`ppt/slides/slide${i+1}.xml`).async('string');
   assert(xml.includes('<p:sp>'));assert(!xml.includes('<a:normAutofit'));assert(!xml.includes('<a:spAutoFit'));
   assert(xml.includes('x="685800"'));assert.equal((xml.match(/<p:pic>/g)||[]).length,i===3?1:0);
   assert(xml.includes(examples[i].title.replace(/&/g,'&amp;')));
  }
  const notes=await zip.file('ppt/notesSlides/notesSlide1.xml').async('string');assert(notes.includes('Fictional design review'));
  console.log('PASS '+label+' real PDF and PPTX: 4 slides, editable text, shared geometry, separate artwork, notes retained, no automatic shrink');
 }
 const overfull=ExportRequestSchema.parse({format:'pdf',kind:'presentation',title:'Preserved source',slides:[{id:'overfull',title:'Full content remains available',body:'A supplied paragraph must not disappear. '.repeat(100)}]});
 for(const render of [pdfDocument,presentationDocument])await assert.rejects(()=>render(overfull),error=>error.code==='SLIDE_CONTENT_OVERFLOW');
 console.log('PASS overfull PDF and PPTX both refuse clipping; source remains intact. No provider calls.');
})().catch(error=>{console.error('NATIVE_EXPORT_CHECK_FAILED '+(error.code||error.message));process.exitCode=1;});


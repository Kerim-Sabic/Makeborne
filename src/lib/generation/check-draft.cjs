/* eslint-disable @typescript-eslint/no-require-imports -- Offline generation contract and real-SDK stub checks. */
const fs=require('node:fs'),ts=require('typescript'),Module=require('node:module'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const load=Module._load;Module._load=function(name,parent,main){if(name==='server-only')return {};return load.call(this,name,parent,main);};
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const {validateGeneratedDraft,validateDraftContext,buildDraftPrompt,DraftResponseSchema}=require('./draft-contract.ts');
const {createOpenAIDraftGenerator}=require('./openai-draft.ts');
const {buildArtworkPrompt,createOpenAIArtworkGenerator}=require('./openai-artwork.ts');
const source=randomUUID(),asset=randomUUID();
const context={input:{scope:{workspaceId:randomUUID(),projectId:randomUUID(),artifactId:randomUUID()},baseVersionId:null,brief:'Create a practical guide from supplied material.',audience:'Independent creators',purpose:'Teach a useful practice',content:{schemaVersion:1,title:'Practice',kind:'book',sections:[{id:randomUUID(),title:'Begin',blocks:[{id:randomUUID(),type:'paragraph',text:'Keep these approved words.',assetId:null,locked:true,sourceIds:[source]}]}]},style:{id:'editorial',name:'Editorial',version:1,description:'Warm paper and olive ink',typography:{headingFont:'Source Serif 4',bodyFont:'Inter'},colors:{accent:'#456749',canvas:'#FCF9F4',ink:'#232122'},referenceAssetIds:[]},sourceIds:[source]},presentationMode:null,availableAssetIds:[asset],sourceMaterial:[{id:source,title:'Approved notes',text:'Practice regularly.'}]};
const imageId=randomUUID();
const draft={content:structuredClone(context.input.content),artworkRequests:[{blockId:imageId,prompt:'Editorial botanical cover, olive ink and warm paper.',role:'book_cover',aspect:'portrait',sourceIds:[source]}],questions:[]};
draft.content.sections[0].blocks.push({id:imageId,type:'image',text:'Botanical illustration',assetId:null,locked:false,sourceIds:[source]});
let count=0;
async function check(name,fn){await fn();count++;console.log('PASS '+name);}
function rejected(change,code,ctx=context){const copy=structuredClone(draft);change(copy);assert.throws(()=>validateGeneratedDraft(ctx,copy),error=>error.code===code);}
(async()=>{
 await check('editable book and artwork request retained',()=>{const out=validateGeneratedDraft(context,draft);assert.equal(out.content.sections[0].blocks[0].text,'Keep these approved words.');assert.equal(out.needsArtwork,true);assert.equal(out.readyForPublication,false);});
 await check('source inputs never mutated',()=>{const before=JSON.stringify(context);validateGeneratedDraft(context,draft);assert.equal(JSON.stringify(context),before);});
 await check('changed format rejected',()=>rejected(d=>d.content.kind='website','format'));
 await check('duplicate structural IDs rejected',()=>rejected(d=>d.content.sections[0].blocks[1].id=d.content.sections[0].id,'structure'));
 await check('invented source rejected',()=>rejected(d=>d.content.sections[0].blocks[1].sourceIds=[randomUUID()],'sources'));
 await check('duplicate source references rejected',()=>rejected(d=>d.content.sections[0].blocks[1].sourceIds=[source,source],'sources'));
 await check('invented asset rejected',()=>rejected(d=>d.content.sections[0].blocks[1].assetId=randomUUID(),'assets'));
 await check('locked wording protected',()=>rejected(d=>d.content.sections[0].blocks[0].text='Changed','locked'));
 await check('AI cannot unlock content',()=>rejected(d=>d.content.sections[0].blocks[0].locked=false,'locked'));
 await check('AI cannot introduce new locks',()=>rejected(d=>d.content.sections[0].blocks[1].locked=true,'locked'));
 await check('locked block removal rejected',()=>rejected(d=>d.content.sections[0].blocks.shift(),'locked'));
 await check('locked block movement rejected',()=>rejected(d=>d.content.sections[0].blocks.reverse(),'locked'));
 await check('locked section title protected',()=>rejected(d=>d.content.sections[0].title='Changed','locked'));
 await check('locked section position protected',()=>rejected(d=>d.content.sections.unshift({id:randomUUID(),title:'New',blocks:[]}),'locked'));
 await check('book cannot use website art direction',()=>rejected(d=>d.artworkRequests[0].role='website_art','artwork'));
 await check('missing artwork brief rejected',()=>rejected(d=>d.artworkRequests=[],'artwork'));
 await check('orphan artwork request rejected',()=>rejected(d=>d.artworkRequests[0].blockId=randomUUID(),'artwork'));
 await check('duplicate artwork request rejected',()=>rejected(d=>d.artworkRequests.push({...d.artworkRequests[0]}),'artwork'));
 await check('book draft needs artwork',()=>rejected(d=>{d.content.sections[0].blocks.pop();d.artworkRequests=[];},'artwork'));
 await check('authorized existing artwork retained',()=>{const d=structuredClone(draft);d.content.sections[0].blocks[1].assetId=asset;d.artworkRequests=[];assert.equal(validateGeneratedDraft(context,d).needsArtwork,false);});
 await check('existing asset cannot be silently regenerated',()=>rejected(d=>d.content.sections[0].blocks[1].assetId=asset,'artwork'));
 await check('missing facts remain explicit questions',()=>{const d=structuredClone(draft);d.questions=['What verified examples should be included?'];assert.equal(validateGeneratedDraft(context,d).needsAnswers,true);});
 await check('unauthorized source material never enters prompt',()=>{const c=structuredClone(context);c.sourceMaterial.push({id:randomUUID(),title:'Outside',text:'Hidden'});assert.throws(()=>buildDraftPrompt(c),e=>e.code==='sources');});
 await check('duplicate asset authority rejected',()=>{const c=structuredClone(context);c.availableAssetIds.push(asset);assert.throws(()=>validateDraftContext(c),e=>e.code==='assets');});
 await check('presentation mode cannot apply to a book',()=>{const c=structuredClone(context);c.presentationMode='full_visual';assert.throws(()=>buildDraftPrompt(c),e=>e.code==='format');});
 await check('new chart strings rejected as unsupported structured data',()=>rejected(d=>{d.content.sections[0].blocks.push({id:randomUUID(),type:'chart',text:'Made-up chart',assetId:null,locked:false,sourceIds:[]});},'structure'));
 for (const kind of ['website','presentation']) await check(kind+' receives appropriate instructions and output',()=>{const c=structuredClone(context);c.input.content.kind=kind;c.presentationMode=kind==='presentation'?'full_visual':null;const d=structuredClone(draft);d.content.kind=kind;d.artworkRequests[0].role=kind==='presentation'?'slide_design':'website_art';assert.equal(validateGeneratedDraft(c,d).content.kind,kind);assert.match(buildDraftPrompt(c).instructions,kind==='presentation'?/one section per slide/:/website sections/);});
 await check('every full-visual slide requires artwork',()=>{const c=structuredClone(context);c.input.content.kind='presentation';c.presentationMode='full_visual';const d=structuredClone(draft);d.content.kind='presentation';d.artworkRequests[0].role='slide_design';d.content.sections.push({id:randomUUID(),title:'Missing art',blocks:[]});assert.throws(()=>validateGeneratedDraft(c,d),e=>e.code==='artwork');});
 await check('strict schema contains all required response fields',()=>{const schema=require('zod').z.toJSONSchema(DraftResponseSchema);assert.deepEqual(schema.required,['content','artworkRequests','questions']);assert.equal(schema.additionalProperties,false);});
 const config={apiKey:'offline-fixture',model:'fixture-model',maximumInputTokens:10000,maximumOutputTokens:3000,timeoutMs:1000};
 function runner(value){let calls=0;return {generate:createOpenAIDraftGenerator(config,{spendingAllowed:()=>true,countInputTokens:async()=>1000,claimDispatch:async()=>true,fetch:async()=>{calls++;return new Response(JSON.stringify({id:'resp_fixture',model:'fixture-model',status:'completed',error:null,incomplete_details:null,output:[{id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value),annotations:[]}]}],usage:{input_tokens:1000,output_tokens:500,total_tokens:1500,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}),{headers:{'content-type':'application/json','x-request-id':'req_fixture'}});}}),get calls(){return calls;}};}
 await check('SDK response becomes editable draft with usage evidence',async()=>{const r=runner(draft);const out=await r.generate(randomUUID(),context,new AbortController().signal);assert.equal(out.status,'draft_ready');assert.equal(out.draft.content.kind,'book');assert.equal(out.evidence.usage.total_tokens,1500);assert.equal(r.calls,1);});
 await check('invalid provenance rejected after SDK with evidence retained',async()=>{const d=structuredClone(draft);d.content.sections[0].blocks[1].sourceIds=[randomUUID()];const r=runner(d);const out=await r.generate(randomUUID(),context,new AbortController().signal);assert.equal(out.status,'draft_rejected');assert.equal(out.reason,'sources');assert.equal(out.evidence.usage.total_tokens,1500);assert.equal(r.calls,1);});
 await check('book artwork prompt uses approved title and palette',()=>{const out=buildArtworkPrompt(context,draft,imageId);assert.match(out.prompt,/flat editorial book-cover/);assert.match(out.prompt,/#456749/);assert.match(out.prompt,/Practice/);assert.equal(out.request.role,'book_cover');});
 await check('unknown image target cannot dispatch',()=>assert.throws(()=>buildArtworkPrompt(context,draft,randomUUID()),e=>e.code==='artwork'));
 await check('visual slide prompt retains exact authored text',()=>{const c=structuredClone(context);c.input.content.kind='presentation';c.presentationMode='full_visual';const d=structuredClone(draft);d.content.kind='presentation';d.artworkRequests[0].role='slide_design';assert.match(buildArtworkPrompt(c,d,imageId).prompt,/Keep these approved words\./);});
 await check('artwork compiler reaches SDK with correct block provenance',async()=>{
  const png=await require('sharp')({create:{width:1024,height:1536,channels:3,background:'#456749'}}).png().toBuffer();let calls=0;
  const imageConfig={apiKey:'offline-fixture',model:'gpt-image-fixture',size:'1024x1536',quality:'high',background:'opaque',maximumInputTokens:1000,maximumOutputTokens:5000,timeoutMs:1000};
  const generate=createOpenAIArtworkGenerator(imageConfig,{spendingAllowed:()=>true,countInputTokens:async()=>100,claimDispatch:async()=>true,fetch:async(url,init)=>{calls++;const body=JSON.parse(init.body);assert.match(body.prompt,/#456749/);return new Response(JSON.stringify({created:1791072000,data:[{b64_json:png.toString('base64')}],usage:{input_tokens:100,output_tokens:1000,total_tokens:1100,input_tokens_details:{image_tokens:0,text_tokens:100}}}),{headers:{'content-type':'application/json','x-request-id':'req_artwork'}});}});
  const out=await generate(randomUUID(),context,draft,imageId,new AbortController().signal);assert.equal(out.status,'image_ready');assert.equal(out.blockId,imageId);assert.deepEqual(out.sourceIds,[source]);assert.deepEqual(out.image.bytes,png);assert.equal(calls,1);
 });
 await check('wrong artwork aspect rejected before provider call',async()=>{
  let calls=0;const generate=createOpenAIArtworkGenerator({apiKey:'offline-fixture',model:'gpt-image-fixture',size:'1024x1024',quality:'high',background:'opaque',maximumInputTokens:1000,maximumOutputTokens:5000,timeoutMs:1000},{spendingAllowed:()=>true,countInputTokens:async()=>100,claimDispatch:async()=>true,fetch:async()=>{calls++;throw Error('must not call');}});
  await assert.rejects(generate(randomUUID(),context,draft,imageId,new AbortController().signal),e=>e.code==='artwork');assert.equal(calls,0);
 });
 for (const mode of ['preserve','improve','summarise']) await check(mode+' mode enforced for unlocked wording',()=>{
  const c=structuredClone(context);c.input.wording=mode;c.input.content.sections[0].blocks[0].locked=false;
  const d=structuredClone(draft);d.content.sections[0].blocks[0].locked=false;d.content.sections[0].blocks[0].text='A rewritten passage.';
  if(mode==='preserve')assert.throws(()=>validateGeneratedDraft(c,d),e=>e.code==='wording');else assert.equal(validateGeneratedDraft(c,d).content.sections[0].blocks[0].text,'A rewritten passage.');
  assert.match(buildDraftPrompt(c).instructions,new RegExp('WORDING POLICY: '+mode.toUpperCase()));
 });
 for (const [label,change] of [['whitespace',d=>{d.content.sections[0].blocks[0].text+=' ';}],['source references',d=>{d.content.sections[0].blocks[0].sourceIds=[];}],['deletion',d=>{d.content.sections[0].blocks.shift();}]]) await check('preserve mode rejects '+label+' changes',()=>{
  const c=structuredClone(context);c.input.content.sections[0].blocks[0].locked=false;const d=structuredClone(draft);d.content.sections[0].blocks[0].locked=false;change(d);assert.throws(()=>validateGeneratedDraft(c,d),e=>e.code==='wording');
 });
 await check('preserve keeps supplied reading order',()=>{
  const c=structuredClone(context);c.input.content.sections[0].blocks[0].locked=false;
  const second={id:randomUUID(),type:'paragraph',text:'Second passage.',assetId:null,locked:false,sourceIds:[]};c.input.content.sections[0].blocks.push(second);
  const d=structuredClone(draft);d.content.sections[0].blocks[0].locked=false;d.content.sections[0].blocks.unshift(second);assert.throws(()=>validateGeneratedDraft(c,d),e=>e.code==='wording');
 });
 await check('preserve permits regrouping unlocked passages',()=>{
  const c=structuredClone(context);c.input.content.sections[0].blocks[0].locked=false;const d=structuredClone(draft);d.content.sections[0].blocks[0].locked=false;
  const text=d.content.sections[0].blocks.shift();d.content.sections.unshift({id:randomUUID(),title:'A new grouping',blocks:[text]});assert.equal(validateGeneratedDraft(c,d).content.sections[0].blocks[0].text,text.text);
 });
 await check('locked content stays protected in improve mode',()=>{const c=structuredClone(context);c.input.wording='improve';const d=structuredClone(draft);d.content.sections[0].blocks[0].text='Rewritten';assert.throws(()=>validateGeneratedDraft(c,d),e=>e.code==='locked');});
 await check('oversized preserve passage rejected before dispatch',()=>{const c=structuredClone(context);c.input.content.sections[0].blocks[0].locked=false;c.input.content.sections[0].blocks[0].text='x'.repeat(20001);assert.throws(()=>buildDraftPrompt(c),e=>e.code==='bounds');});
 console.log(`${count} generation draft checks passed; zero external requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});

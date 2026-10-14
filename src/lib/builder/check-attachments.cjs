/* eslint-disable @typescript-eslint/no-require-imports -- Offline byte/contract checks; no providers or network. */
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), assert = require('node:assert/strict'), Module = require('node:module');
const load = Module._load, modelInputs = [];
let authenticationProbes = 0;
Module._load = function(name, parent, main) {
  if (name === 'server-only') return {};
  if (name === '@/lib/cloud/server') return { validId:()=>{}, databaseError:()=>{}, cloudContext:async()=>{
    authenticationProbes++;
    throw new (require('../server/http.ts').RequestError)('AUTH_PROBE', 'Fixture refuses before database/provider access', 401);
  } };
  if (name.startsWith('@/')) return load.call(this,path.resolve(process.cwd(),'src',name.slice(2)),parent,main);
  if (name === '../ai/anthropic-call') return { ContextMeter: class {}, builderModels: () => [], budgetedStream: async input => {
    modelInputs.push(input.params.messages[0].content);
    throw new (require('../ai/run-spend.ts').SpendError)('RUN_BUDGET', 'Fixture stops before any provider call');
  } };
  if (name === './images' && /builder[\\/](agent|docs-agent)\.ts$/.test(parent?.filename ?? '')) return { imageConfiguration: () => ({model:null}) };
  return load.call(this, name, parent, main);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { BuilderAttachmentsSchema, prepareBuilderAttachments, builderAttachmentBlocks, canonicalBuilderAttachments, serializeBuilderRequest, MAX_BUILDER_REQUEST_BYTES } = require('./attachments.ts');
const source = (name, content, type = '') => ({ id: name, name, type, owner: 'account:fixture', blob: new Blob([content]), size: Buffer.byteLength(content), previewType: null });
const wire = (name, mediaType, bytes) => ({ name, mediaType, data: Buffer.from(bytes).toString('base64') });
let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
async function main() {
  await check('supported sources arrive intact and become actual provider blocks', async () => {
    const originals = [source('brief.txt', 'Keep the supplied numbers: 123 and 456.'), source('design.pdf', '%PDF-1.4\nfixture'), source('logo.png', Buffer.from('89504e470d0a1a0a', 'hex'))];
    const files = await prepareBuilderAttachments(originals);
    assert(BuilderAttachmentsSchema.safeParse(files).success);
    const blocks = builderAttachmentBlocks(files);
    assert.equal(blocks[0].source.data, 'Keep the supplied numbers: 123 and 456.');
    assert.equal(blocks[1].source.media_type, 'application/pdf');
    assert.equal(blocks[1].source.data, files[1].data);
    assert.equal(blocks[2].type, 'image');
    assert.equal(blocks[2].source.data, files[2].data);
    assert(Object.isFrozen(files[0]));
    assert.equal(canonicalBuilderAttachments(files), canonicalBuilderAttachments(files.map(f => ({data:f.data, name:f.name, mediaType:f.mediaType}))));
  });
  await check('unknown MIME, binary masquerading as text and invalid UTF8 are refused', async () => {
    for (const file of [source('archive.bin', 'PK\x03\x04'), source('pretend.txt', '\x00binary'), source('bad.txt', Buffer.from([255,254]))]) await assert.rejects(prepareBuilderAttachments([file]));
    assert(!BuilderAttachmentsSchema.safeParse([wire('pretend.png', 'image/png', 'just text')]).success);
    assert(!BuilderAttachmentsSchema.safeParse([wire('bad.txt', 'text/plain', Buffer.from([0xff]))]).success);
  });
  await check('text limits refuse rather than silently truncate', async () => {
    const good = await prepareBuilderAttachments([source('at-limit.txt', 'a'.repeat(200000))]);
    assert.equal(builderAttachmentBlocks(good)[0].source.data.length, 200000);
    await assert.rejects(prepareBuilderAttachments([source('over.txt', 'a'.repeat(200001))]), /200,000/);
    assert(!BuilderAttachmentsSchema.safeParse([wire('over.txt', 'text/plain', 'a'.repeat(200001))]).success);
  });
  await check('count, decoded per-file and aggregate limits match browser and server', async () => {
    const png = size => Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'), Buffer.alloc(size-8)]);
    await assert.rejects(prepareBuilderAttachments(Array.from({length:6},(_,i)=>source(`${i}.txt`,'a'))), /five/);
    assert(!BuilderAttachmentsSchema.safeParse(Array.from({length:6},(_,i)=>wire(`${i}.txt`,'text/plain','a'))).success);
    await assert.rejects(prepareBuilderAttachments([source('large.png',png(3000001))]), /3 MB/);
    assert(!BuilderAttachmentsSchema.safeParse([wire('large.png','image/png',png(3000001))]).success);
    const files=[source('a.png',png(1500001)),source('b.png',png(1500000))];
    await assert.rejects(prepareBuilderAttachments(files), /3 MB/);
    assert(!BuilderAttachmentsSchema.safeParse([wire('a.png','image/png',png(1500001)),wire('b.png','image/png',png(1500000))]).success);
  });
  await check('serialized transport includes base64, multibyte prompts, plans and reviews', async () => {
    const bytes=Buffer.alloc(3000000);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);
    const files=[wire('source.png','image/png',bytes)];assert(BuilderAttachmentsSchema.safeParse(files).success);
    const valid=serializeBuilderRequest({attachments:files,message:'\u20ac'.repeat(8000),plan:{summary:'x'.repeat(60000)}});
    assert(Buffer.byteLength(valid)<=MAX_BUILDER_REQUEST_BYTES);
    assert.throws(()=>serializeBuilderRequest({attachments:files,message:'\u20ac'.repeat(140000)}),/too large/);
    assert.throws(()=>serializeBuilderRequest({review:{screenshots:[{data:'a'.repeat(MAX_BUILDER_REQUEST_BYTES)}]}}),/too large/);
  });
  await check('noncanonical base64 and empty files cannot reach a provider', async () => {
    for(const data of ['', 'YQ', 'YR==', 'YQ====', 'Y Q==', '=']) assert(!BuilderAttachmentsSchema.safeParse([{name:'a.txt',mediaType:'text/plain',data}]).success,data);
    await assert.rejects(prepareBuilderAttachments([source('empty.txt','')]), /empty/);
  });
  await check('website, book, deck and planner compose the exact source blocks into model messages', async () => {
    const {runBuilder}=require('./agent.ts'),{runDocumentBuilder}=require('./docs-agent.ts'),{runPlanner}=require('./planner.ts');
    const {ProjectFiles}=require('./files.ts'),{DocumentEditor,emptyDocument}=require('../documents/editor.ts');
    const files=await prepareBuilderAttachments([source('brief.txt','Use the supplied reference.'),source('reference.pdf','%PDF-1.4\nfixture'),source('logo.png',Buffer.from('89504e470d0a1a0a','hex'))]);
    const attachments=builderAttachmentBlocks(files),deadline=Date.now()+280000;
    const common={client:{},scope:{workspaceId:'fixture',projectId:'fixture'},effort:'light',request:'Make this',context:'Fixture',attachments,emit:()=>{},signal:new AbortController().signal,deadline,anthropic:{},spend:{allowanceMicrousd:1000000,remainingMicrousd:1000000,providerMicrousd:0,customerCredits:()=>0,deadline}};
    await runBuilder({...common,files:new ProjectFiles()});
    await runDocumentBuilder({...common,editor:new DocumentEditor(emptyDocument('book','Reference book'))});
    await runDocumentBuilder({...common,editor:new DocumentEditor(emptyDocument('deck','Reference deck'))});
    await runPlanner(common);
    assert.equal(modelInputs.length,4);
    for(const input of modelInputs)assert.deepEqual(input.slice(0,3),attachments);
  });
  await check('both real routes reject invalid and oversized sources before authentication, holds or providers', async () => {
    const before=process.env.ANTHROPIC_API_KEY,enabled=process.env.MAKEBORNE_LIVE_BUILDER_ENABLED;
    process.env.ANTHROPIC_API_KEY='offline-fixture-only';process.env.MAKEBORNE_LIVE_BUILDER_ENABLED='true';
    try {
      for(const route of ['../../app/api/build/route.ts','../../app/api/build/plan/route.ts']) {
        const {POST}=require(route),id='11111111-1111-4111-8111-111111111111';
        const body={workspaceId:id,artifactId:id,expectedVersion:1,message:'Use my sources',effort:'light',operation:{actionKey:id,stepKey:id},...(route.includes('/plan/')?{expectedRevision:0}:{})};
        const request=body=>new Request('http://localhost/api/build',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost'},body:JSON.stringify(body)});
        const baseline=authenticationProbes;
        const malformed=await POST(request({...body,attachments:[wire('fake.pdf','application/pdf','not a PDF')]}));assert.equal(malformed.status,400);
        const tooLarge=await POST(request({...body,attachments:[],message:'a'.repeat(MAX_BUILDER_REQUEST_BYTES)}));assert.equal(tooLarge.status,413);
        assert.equal(authenticationProbes,baseline,'Invalid sources must stop before authentication/paid operation admission');
        const valid=await POST(request({...body,attachments:[wire('brief.txt','text/plain','Supplied text')]}));assert.equal(valid.status,401);assert.equal(authenticationProbes,baseline+1,'Valid reference reaches the auth boundary');
      }
    } finally { if(before===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=before;if(enabled===undefined)delete process.env.MAKEBORNE_LIVE_BUILDER_ENABLED;else process.env.MAKEBORNE_LIVE_BUILDER_ENABLED=enabled; }
  });
  console.log(`${count} attachment contract groups passed.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});

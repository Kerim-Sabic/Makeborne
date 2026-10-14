/** Offline injected-SDK contracts only. Never calls the Vercel API. */
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {vercelPublicationExecutor,vercelSandboxTransport,readRemoteBounded,reconcileVercelPublicationSandbox,SDK_VERSION} from './vercel-publication-executor.mjs';
import {encodeRender,decodeRender} from './vercel-publication-protocol.mjs';
import {canonicalRuntimeJson as canonical} from './identity.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const uuid='11111111-1111-4111-8111-111111111111';
const config=()=>({compiler:{image:'team/project/compiler@sha256:'+'a'.repeat(64),runtimeImageId:'sha256:'+'b'.repeat(64),evidenceSha256:'c'.repeat(64)},
  renderer:{image:'team/project/renderer@sha256:'+'d'.repeat(64),rendererId:'chromium-144.0.1-controller-'+'e'.repeat(64),evidenceSha256:'f'.repeat(64)}});
const context=()=>({preparationId:uuid,workerId:uuid,fence:'2',leaseUntil:new Date(Date.now()+290000).toISOString()});
const workload=()=>({schemaVersion:1,artifactId:uuid,revisionId:uuid,version:1,sourceHash:'1'.repeat(64),sourceManifest:{},toolchainId:'react-vite-v1',toolchainHash:'2'.repeat(64),routes:[{path:'/',title:'Home'}],files:[]});
const body=Buffer.from('<html><body id="root">Synthetic adapter contract</body></html>');
function manifest(w=workload(),files=[{path:'index.html',bytes:body.length,sha256:sha(body)}]) {
  const identity={...w};delete identity.sourceManifest;delete identity.files;
  const result={...identity,runtimeImageId:config().compiler.runtimeImageId,files};return {...result,buildHash:sha(canonical(result))};
}
const signal=()=>new AbortController().signal;
function mock(overrides={}) {
  const calls=[],events=[],boxes=[];
  const transport={
    async create(params) {
      calls.push(['create',params]);
      const box={
        name:params.name,image:overrides.canonicalImage?params.image.replace(/^vcr\.vercel\.com\//,''):params.image,persistent:params.persistent,expiresAt:new Date(Date.now()+params.timeout),
        async writeFiles(files,opts){calls.push(['write',files,opts]);if(overrides.writeError)throw Error('write failed');},
        async runCommand(params) {calls.push(['command',params]);return {wait:async()=>({exitCode:overrides.exitCode??0})};},
        async readFile({path},opts) {
          calls.push(['read',path,opts]);
          if(overrides.read)return overrides.read(path);
          if(path.endsWith('makeborne-build.json'))return Readable.from([Buffer.from(JSON.stringify(overrides.receipt??manifest()))]);
          if(path.endsWith('render-result.json'))return Readable.from([Buffer.from(JSON.stringify(overrides.renderResult??{html:body.toString(),rendererId:config().renderer.rendererId}))]);
          return Readable.from([body]);
        },
        async stop(opts) {calls.push(['stop',params.name,opts]);if(overrides.stopError)throw Error('stop failed');return {id:'session-synthetic',status:overrides.stopStatus??'stopped'};},
      };
      const session={sessionId:'session-synthetic',status:'running',createdAt:new Date(box.expiresAt.getTime()-params.timeout),timeout:params.timeout,
        writeFiles:box.writeFiles,runCommand:box.runCommand,readFile:box.readFile};
      box.currentSession=()=>session;
      // Any Sandbox workload helper would invoke the real SDK's withResume.
      for(const method of ['writeFiles','runCommand','readFile'])box[method]=()=>{throw Error('SANDBOX_CONVENIENCE_FORBIDDEN');};
      if(overrides.sessionExpiryMismatch)session.createdAt=new Date(session.createdAt.getTime()+1);
      if(overrides.sessionNotRunning)session.status='stopped';
      if(overrides.wrongIdentity)box.image='wrong';
      if(overrides.lateExpiry)box.expiresAt=new Date(Date.now()+500000);
      boxes.push(box);
      if(overrides.createError)throw Error('unknown create');
      if(overrides.hangCreate)return new Promise(()=>{});
      return box;
    },
    async get(params) {calls.push(['get',params]);if(overrides.getError)throw Error('not found');return boxes.at(-1);}
  };
  const journal=async event=>{events.push(event);if(overrides.journalError)throw Error('journal failed');};
  return {transport,calls,events,boxes,journal,
    executor:()=>vercelPublicationExecutor({transport,approved:config(),context:context(),onLifecycle:journal})};
}
let passed=0;
async function test(name,fn){await fn();console.log('PASS '+name);passed++;}
await test('VCR hostname normalization preserves exact project/repository/digest',async()=>{
  const m=mock({canonicalImage:true}),approved=config();
  approved.compiler.image='vcr.vercel.com/'+approved.compiler.image;
  const executor=vercelPublicationExecutor({transport:m.transport,approved,context:context(),onLifecycle:m.journal});
  await (await executor.compile(workload(),signal())).dispose();
  assert.equal(m.calls.filter(c=>c[0]==='stop').length,1);
  const wrong=mock({canonicalImage:true,wrongIdentity:true});
  const reject=vercelPublicationExecutor({transport:wrong.transport,approved,context:context(),onLifecycle:wrong.journal});
  await assert.rejects(reject.compile(workload(),signal()));
});
await test('SDK 3.7.0 wrapper preserves exact create/get and keeps credentials outside env',async()=>{
  assert.equal(SDK_VERSION,'3.7.0');const calls=[];
  const fake={create:async p=>{calls.push(p);},get:async p=>{calls.push(p);}};
  const transport=vercelSandboxTransport(fake,{token:'synthetic-controller-token',teamId:'team',projectId:'project'});
  await transport.create({env:{},name:'x'});await transport.get({name:'x',resume:false});
  assert.equal(calls[0].token,'synthetic-controller-token');assert.deepEqual(calls[0].env,{});
  assert.equal(calls[1].resume,false);
  assert.throws(()=>vercelSandboxTransport(fake,{token:'x',teamId:'t',projectId:'p',env:{secret:'x'}}));
});
await test('compiler exact watchdog, bounded manifest, identity mapping and native bytes',async()=>{
  const m=mock(),executor=m.executor(),r=await executor.compile(workload(),signal());
  assert.equal(r.receipt.runtimeImageId,config().compiler.runtimeImageId);
  assert.deepEqual(await r.readFile('index.html',body.length,signal()),body);
  await assert.rejects(r.readFile('../escape',body.length,signal()),/NOT_LISTED/);
  await assert.rejects(r.readFile('index.html',body.length+1,signal()),/NOT_LISTED/);
  const create=m.calls.find(c=>c[0]==='create')[1];
  assert.equal(create.persistent,false);assert.equal(create.networkPolicy,'deny-all');
  assert.deepEqual(create.ports,[]);assert.deepEqual(create.mounts,{});assert.deepEqual(create.env,{});
  assert.deepEqual(create.resources,{vcpus:1});assert.equal(create.timeout,75000);
  assert.equal(m.calls.find(c=>c[0]==='command')[1].args[0],'/opt/makeborne/watchdog.mjs');
  for(const [,command] of m.calls.filter(c=>c[0]==='command')){assert.equal(command.detached,true);assert.equal(command.sudo,false);assert.ok(command.timeoutMs<=65000);assert.equal(command.stdout,undefined);}
  assert.deepEqual(m.events.map(e=>e.state),['creating','running','stopped']);
  assert.equal(m.calls.filter(c=>c[0]==='stop').length,1);
  await r.dispose();await assert.rejects(r.readFile('index.html',body.length,signal()),/NOT_LISTED/);
});
await test('render uses fresh separate VM, bounded output, actual returned renderer identity',async()=>{
  const m=mock(),executor=m.executor();
  await (await executor.compile(workload(),signal())).dispose();
  const result=await executor.render({origin:'https://synthetic.example',path:'/',indexHtml:body.toString(),files:[],signal:signal()});
  assert.equal(result.rendererId,config().renderer.rendererId);
  assert.notEqual(m.boxes[0].name,m.boxes[1].name);assert.notEqual(m.boxes[0].image,m.boxes[1].image);
  assert.equal(m.calls.filter(c=>c[0]==='stop').length,2);
  const command=m.calls.filter(c=>c[0]==='command').at(-1)[1];
  assert.deepEqual(command.args,['/opt/makeborne/vercel-publication-render-watchdog.mjs']);
  const wire=JSON.parse(m.calls.filter(c=>c[0]==='write').at(-1)[1][0].content);
  assert.equal(wire.timeoutMs,15000);assert.equal(wire.signal,undefined);
  assert.equal(command.env.VERCEL_TOKEN,undefined);
});
await test('immutable config and malformed/mutable image refs fail before create',async()=>{
  const m=mock(),approved=config();
  const e=vercelPublicationExecutor({transport:m.transport,approved,context:context(),onLifecycle:m.journal});
  approved.compiler.image='changed';
  await (await e.compile(workload(),signal())).dispose();
  assert.equal(m.boxes[0].image,config().compiler.image);
  for(const image of ['compiler:latest','compiler','https://evil/image@sha256:'+'a'.repeat(64)]) {
    const bad=config();bad.compiler.image=image;
    assert.throws(()=>vercelPublicationExecutor({transport:m.transport,approved:bad,context:context(),onLifecycle:m.journal}),/UNQUALIFIED/);
  }
});
await test('journal required and failed durable intent prevents any VM creation',async()=>{
  const m=mock({journalError:true});
  assert.throws(()=>vercelPublicationExecutor({transport:m.transport,approved:config(),context:context()}),/CONFIG_INVALID/);
  await assert.rejects(m.executor().compile(workload(),signal()),/journal failed/);
  assert.equal(m.calls.length,0);
});
await test('receipt source mismatch, path escape, duplicate and hash mismatch block transfer',async()=>{
  for(const change of [
    r=>{r.sourceHash='3'.repeat(64);},
    r=>{r.files[0].path='../index.html';},
    r=>{r.files.push({...r.files[0]});},
  ]) {
    const receipt=manifest();change(receipt);const identity={...receipt};delete identity.buildHash;receipt.buildHash=sha(canonical(identity));
    const m=mock({receipt});await assert.rejects(m.executor().compile(workload(),signal()),/IDENTITY|MANIFEST/);
    assert.equal(m.calls.filter(c=>c[0]==='read').length,1);assert.ok(m.calls.some(c=>c[0]==='stop'));
  }
  const m=mock({read:path=>Readable.from([path.endsWith('makeborne-build.json')?Buffer.from(JSON.stringify(manifest())):Buffer.from('wrong')])});
  await assert.rejects(m.executor().compile(workload(),signal()),/BYTES_MISMATCH/);
});
await test('stream limits destroy oversize/missing/stalled reads and honor cancellation',async()=>{
  let stream=Readable.from([Buffer.alloc(20)]);
  await assert.rejects(readRemoteBounded({readFile:async()=>stream},'/fixed',10,signal()),/OUTPUT_LIMIT/);
  assert.equal(stream.destroyed,true);
  await assert.rejects(readRemoteBounded({readFile:async()=>null},'/fixed',10,signal()),/OUTPUT_MISSING/);
  stream=new Readable({read(){}});const abort=new AbortController();
  const work=readRemoteBounded({readFile:async()=>stream},'/fixed',10,abort.signal);
  setTimeout(()=>abort.abort(),10);await assert.rejects(work,/CANCELLED/);assert.equal(stream.destroyed,true);
});
await test('short remaining lease rejects before create and provider overrun rejects/cleans',async()=>{
  const m=mock();
  const e=vercelPublicationExecutor({transport:m.transport,approved:config(),context:{...context(),leaseUntil:new Date(Date.now()+10000).toISOString()},onLifecycle:m.journal});
  await assert.rejects(e.compile(workload(),signal()),/LEASE_EXPIRED/);assert.equal(m.calls.length,0);
  const late=mock({lateExpiry:true});await assert.rejects(late.executor().compile(workload(),signal()),/IDENTITY_INVALID/);
  assert.ok(late.calls.some(c=>c[0]==='stop'));
});
await test('unknown creation response reconciles known name without resuming',async()=>{
  const m=mock({createError:true});await assert.rejects(m.executor().compile(workload(),signal()),/unknown create/);
  const get=m.calls.find(c=>c[0]==='get')[1];assert.equal(get.name,m.events[0].name);assert.equal(get.resume,false);
  assert.deepEqual(m.events.map(e=>e.state),['creating','stopped']);
});
await test('unknown creation and failed stop remain durable unconfirmed, never success',async()=>{
  const m=mock({createError:true,getError:true,stopError:true});
  await assert.rejects(m.executor().compile(workload(),signal()),/CLEANUP_UNCONFIRMED/);
  assert.equal(m.events.at(-1).state,'cleanup_unconfirmed');
  const stopped=mock({stopError:true});await assert.rejects(stopped.executor().compile(workload(),signal()),/CLEANUP_UNCONFIRMED/);
  assert.equal(stopped.events.at(-1).state,'cleanup_unconfirmed');
});
await test('cancellation during unknown create still performs independent cleanup',async()=>{
  const m=mock({hangCreate:true}),abort=new AbortController();
  const work=m.executor().compile(workload(),abort.signal);setTimeout(()=>abort.abort(),10);
  await assert.rejects(work,/CANCELLED/);assert.ok(m.calls.some(c=>c[0]==='get'));assert.ok(m.calls.some(c=>c[0]==='stop'));
});
await test('nonzero compiler/render command and write failure always stop',async()=>{
  for(const overrides of [{exitCode:1},{writeError:true}]) {
    const m=mock(overrides);await assert.rejects(m.executor().compile(workload(),signal()));assert.ok(m.calls.some(c=>c[0]==='stop'));
  }
  const m=mock({exitCode:1});await assert.rejects(m.executor().render({origin:'https://synthetic.example',path:'/',indexHtml:'x',files:[],signal:signal()}),/RENDER_FAILED/);
  assert.ok(m.calls.some(c=>c[0]==='stop'));
});
await test('spoofed renderer identity and excess HTML rejected',async()=>{
  for(const renderResult of [{html:'x',rendererId:'wrong'},{html:'x'.repeat(3900001),rendererId:config().renderer.rendererId}]) {
    const m=mock({renderResult});await assert.rejects(m.executor().render({origin:'https://synthetic.example',path:'/',indexHtml:'x',files:[],signal:signal()}),/UNQUALIFIED/);
    assert.ok(m.calls.some(c=>c[0]==='stop'));
  }
});
await test('render protocol rejects secrets/URLs/traversal and preserves exact public bytes',async()=>{
  const input={origin:'https://synthetic.example',path:'/',indexHtml:'x',files:[{path:'/assets/main.js',contentType:'text/javascript',body:Buffer.from('x'),sha256:sha('x')}]};
  const encoded=encodeRender(input,config().renderer.rendererId,1000),wire=JSON.parse(encoded);
  assert.deepEqual(decodeRender(wire).files[0].body,Buffer.from('x'));
  assert.throws(()=>decodeRender({...wire,token:'secret'}),/INVALID/);
  assert.throws(()=>encodeRender({...input,origin:'https://user:secret@synthetic.example'},config().renderer.rendererId,1000),/INVALID/);
  assert.throws(()=>encodeRender({...input,files:[{...input.files[0],path:'/../escape'}]},config().renderer.rendererId,1000),/INVALID/);
});
await test('abort between stages starts no later SDK calls and produces no unhandled rejection',async()=>{
  const unhandled=[];const listener=reason=>unhandled.push(reason);process.on('unhandledRejection',listener);
  try {
    const m=mock(),abort=new AbortController(),create=m.transport.create;
    m.transport.create=async params=>{
      const box=await create(params),session=box.currentSession(),write=session.writeFiles;
      session.writeFiles=async(...args)=>{await write(...args);abort.abort();};
      return box;
    };
    await assert.rejects(m.executor().compile(workload(),abort.signal));
    assert.equal(m.calls.filter(c=>c[0]==='command').length,0);
    assert.ok(m.calls.some(c=>c[0]==='stop'));
    const already=new AbortController();already.abort();let reads=0;
    await assert.rejects(readRemoteBounded({readFile:()=>{reads++;return Promise.reject(Error('should never start'));}},'/fixed',1,already.signal));
    assert.equal(reads,0);
    let next=0,destroyed=false;const between=new AbortController();
    const stream={destroy(){destroyed=true;},[Symbol.asyncIterator](){return {next:async()=>{next++;between.abort();return {done:false,value:Buffer.from('x')};}};}};
    await assert.rejects(readRemoteBounded({readFile:async()=>stream},'/fixed',10,between.signal));
    assert.equal(next,1);assert.equal(destroyed,true);
    await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(unhandled,[]);
  } finally {process.removeListener('unhandledRejection',listener);}
});
await test('journal latency consumes the same lease and invalid workload never creates',async()=>{
  const m=mock();let clock=Date.now();
  const e=vercelPublicationExecutor({transport:m.transport,approved:config(),context:{...context(),leaseUntil:new Date(clock+35000).toISOString()},now:()=>clock,
    onLifecycle:async event=>{m.events.push(event);if(event.state==='creating')clock+=12000;}});
  await assert.rejects(e.compile(workload(),signal()),/LEASE_EXPIRED/);assert.equal(m.calls.length,0);
  await assert.rejects(m.executor().compile({...workload(),token:'synthetic-secret'},signal()),/WORKLOAD_INVALID/);
  assert.equal(m.calls.length,0);
});
await test('restart cleanup uses stop only and retains unknown records',async()=>{
  const m=mock();await (await m.executor().compile(workload(),signal())).dispose();
  const before=m.calls.length;
  await reconcileVercelPublicationSandbox({transport:m.transport,record:m.events[0],onLifecycle:m.journal});
  assert.deepEqual(m.calls.slice(before).map(c=>c[0]),['get','stop']);
  m.transport.get=async()=>{throw Error('not found');};
  await assert.rejects(reconcileVercelPublicationSandbox({transport:m.transport,record:m.events[0],onLifecycle:m.journal}),/UNCONFIRMED/);
  assert.equal(m.events.at(-1).state,'cleanup_unconfirmed');
});
await test('cleanup validates retrieved identity and terminal provider stop response',async()=>{
  const wrong=mock({createError:true});wrong.transport.get=async()=>({...wrong.boxes[0],name:'different-sandbox'});
  await assert.rejects(wrong.executor().compile(workload(),signal()),/CLEANUP_UNCONFIRMED/);
  assert.equal(wrong.calls.filter(c=>c[0]==='stop').length,0);assert.equal(wrong.events.at(-1).state,'cleanup_unconfirmed');
  for(const stopStatus of ['running','stopping','snapshotting','pending']) {
    const m=mock({stopStatus});await assert.rejects(m.executor().compile(workload(),signal()),/CLEANUP_UNCONFIRMED/);
    assert.equal(m.events.at(-1).state,'cleanup_unconfirmed');
    await assert.rejects(reconcileVercelPublicationSandbox({transport:m.transport,record:m.events[0],onLifecycle:m.journal}),/CLEANUP_UNCONFIRMED/);
  }
});
await test('initial session expiry and active identity must match before workload IO',async()=>{
  for(const overrides of [{sessionExpiryMismatch:true},{sessionNotRunning:true}]) {
    const m=mock(overrides);await assert.rejects(m.executor().compile(workload(),signal()),/IDENTITY_INVALID/);
    assert.equal(m.calls.filter(c=>['write','read','command'].includes(c[0])).length,0);
    assert.ok(m.calls.some(c=>c[0]==='stop'));
  }
});
console.log(JSON.stringify({passed,providerCalls:0,cloudQualified:false,sdkVersion:SDK_VERSION}));


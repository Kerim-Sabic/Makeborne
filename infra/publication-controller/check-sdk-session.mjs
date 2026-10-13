// Actual installed SDK classes with an in-memory API client. No transport calls.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Sandbox,APIError} from '@vercel/sandbox';
import {vercelPublicationExecutor} from '../project-runtime/vercel-publication-executor.mjs';
const require=createRequire(import.meta.url);
assert.equal(require('@vercel/sandbox/package.json').version,'3.7.0');
const uuid='11111111-1111-4111-8111-111111111111';
const approved={compiler:{image:'compiler@sha256:'+'a'.repeat(64),runtimeImageId:'sha256:'+'b'.repeat(64),evidenceSha256:'c'.repeat(64)},
 renderer:{image:'renderer@sha256:'+'d'.repeat(64),rendererId:'chromium-144-controller-'+'e'.repeat(64),evidenceSha256:'f'.repeat(64)}};
function fixture(params={name:'contract',image:approved.compiler.image,timeout:75000,persistent:false}) {
 const calls=[],stamp=Date.now(),session={id:'session-original',memory:2048,vcpus:1,region:'iad1',timeout:params.timeout,status:'running',
  requestedAt:stamp,startedAt:stamp,createdAt:stamp,updatedAt:stamp,cwd:'/vercel/sandbox',networkPolicy:{mode:'deny-all'}};
 const expired=new APIError(new Response('',{status:410}),{message:'synthetic stopped session'});
 const reject=method=>async p=>{calls.push([method,p.sessionId]);throw expired;};
 const client={writeFiles:reject('write'),readFile:reject('read'),runCommand:reject('command'),
  getSandbox:async()=>{calls.push(['resume']);throw Error('SDK_IMPLICIT_RESUME');},
  stopSession:async p=>{calls.push(['stop',p.sessionId]);return {json:{session:{...session,status:'stopped'}}};}};
 const box=new Sandbox({client,routes:[],session,sandbox:{...params},projectId:'synthetic'});
 return {box,calls,expired};
}
const operations=[s=>s.writeFiles([{path:'/input/request.json',content:Buffer.from('{}'),mode:0o600}]),
 s=>s.readFile({path:'/tmp/result/file'}),s=>s.runCommand({cmd:'node',args:[],detached:true,timeoutMs:1000})];
// Canary: demonstrate the pinned SDK's actual convenience methods try resuming.
for(const operation of operations){const f=fixture();await assert.rejects(operation(f.box),/SDK_IMPLICIT_RESUME/);assert.equal(f.calls.filter(c=>c[0]==='resume').length,1);}
console.log('PASS actual SDK 3.7 convenience methods reproduce implicit resume on stopped sessions');
for(const operation of operations){const f=fixture(),session=f.box.currentSession();await assert.rejects(operation(session),error=>error===f.expired);assert.equal(f.calls.length,1);assert.equal(f.calls[0][1],'session-original');}
console.log('PASS actual pinned Session IO and commands fail on the original session without resume');
const events=[];let created;
const executor=vercelPublicationExecutor({approved,context:{preparationId:uuid,workerId:uuid,fence:'1',leaseUntil:new Date(Date.now()+290000).toISOString()},
 transport:{create:async p=>{created=fixture(p);return created.box;},get:async()=>{throw Error('UNEXPECTED_GET');}},onLifecycle:async e=>events.push(e)});
await assert.rejects(executor.compile({schemaVersion:1,artifactId:uuid,revisionId:uuid,version:1,sourceHash:'1'.repeat(64),sourceManifest:{},toolchainId:'react-vite-v1',toolchainHash:'2'.repeat(64),routes:[{path:'/',title:'Home'}],files:[]},new AbortController().signal),/synthetic stopped session/);
assert.deepEqual(created.calls,[['write','session-original'],['stop','session-original']]);
assert.deepEqual(events.map(e=>e.state),['creating','running','stopped']);assert.equal(events[1].sessionId,'session-original');
console.log('PASS executor binds actual SDK Session before IO and stops the same session after failure');
console.log(JSON.stringify({passed:3,sdkVersion:'3.7.0',networkCalls:0,providerCalls:0}));

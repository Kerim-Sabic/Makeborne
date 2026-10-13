/** Bounded wire protocol. No credentials or executable commands belong here. */
import {createHash} from 'node:crypto';
import {canonicalRuntimeJson as canonical} from './identity.mjs';
export const SDK_VERSION = '3.7.0';
export const LIMITS = Object.freeze({input:65_000_000, receipt:262144, output:50_000_000, renderInput:70_000_000, html:3_900_000, renderResult:24_000_000});
export const sha = value => createHash('sha256').update(value).digest('hex');
export const fail = code => {throw Error('PUBLICATION_'+code);};
const hash = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
export function exactKeys(value, keys) {
  return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
}
export function safePath(path) {
  return typeof path==='string' && path.length<=240 && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)
    && !path.split('/').some(part=>part==='.'||part==='..'||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
export function encodeWorkload(workload) {
  if(!exactKeys(workload,['schemaVersion','artifactId','revisionId','version','sourceHash','sourceManifest','toolchainId','toolchainHash','routes','files'])
    ||workload.schemaVersion!==1||workload.toolchainId!=='react-vite-v1'||!hash(workload.sourceHash)||!hash(workload.toolchainHash)
    ||!Array.isArray(workload.files)||workload.files.length>300||!Array.isArray(workload.routes)||workload.routes.length<1||workload.routes.length>20) fail('WORKLOAD_INVALID');
  const bytes=Buffer.from(JSON.stringify(workload));if(bytes.length>LIMITS.input)fail('INPUT_LIMIT');return bytes;
}
export function validateReceipt(receipt,workload,runtimeImageId) {
  if(!exactKeys(receipt,['schemaVersion','artifactId','revisionId','version','sourceHash','toolchainId','toolchainHash','runtimeImageId','routes','files','buildHash']))fail('BUILD_IDENTITY_MISMATCH');
  const {buildHash,...identity}=receipt;
  if(receipt.schemaVersion!==1||receipt.toolchainId!==workload.toolchainId||receipt.artifactId!==workload.artifactId||receipt.revisionId!==workload.revisionId
    ||receipt.version!==workload.version||receipt.sourceHash!==workload.sourceHash||receipt.toolchainHash!==workload.toolchainHash
    ||receipt.runtimeImageId!==runtimeImageId||canonical(receipt.routes)!==canonical(workload.routes)||buildHash!==sha(canonical(identity))
    ||!Array.isArray(receipt.files)||receipt.files.length<1||receipt.files.length>1000)fail('BUILD_IDENTITY_MISMATCH');
  const paths=new Set();let total=0;
  for(const file of receipt.files) {
    if(!exactKeys(file,['path','bytes','sha256'])||!safePath(file.path)||file.path==='makeborne-build.json'||paths.has(file.path.toLowerCase())
      ||!Number.isSafeInteger(file.bytes)||file.bytes<0||!hash(file.sha256))fail('BUILD_MANIFEST_INVALID');
    paths.add(file.path.toLowerCase());total+=file.bytes;
    if(total>LIMITS.output)fail('OUTPUT_LIMIT');
  }
  if(!paths.has('index.html'))fail('BUILD_ENTRY_MISSING');
  return receipt;
}
export function encodeRender(input,rendererId,timeoutMs) {
  const {origin,path,indexHtml,files}=input;
  let address;try{address=new URL(origin);}catch{fail('RENDER_INPUT_INVALID');}
  if(address.protocol!=='https:'||address.origin!==origin||address.port||address.username||address.password
    ||typeof path!=='string'||path.length>240||!/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(path)
    ||typeof indexHtml!=='string'||Buffer.byteLength(indexHtml)>LIMITS.html||!Array.isArray(files)||files.length>1000)fail('RENDER_INPUT_INVALID');
  let total=0;const paths=new Set();
  const encoded=files.map(file=>{
    if(typeof file.path!=='string'||!file.path.startsWith('/')||!safePath(file.path.slice(1))||paths.has(file.path)
      ||typeof file.contentType!=='string'||file.contentType.length>120||!Buffer.isBuffer(file.body)&&!(file.body instanceof Uint8Array)
      ||sha(file.body)!==file.sha256)fail('RENDER_FILE_INVALID');
    paths.add(file.path);total+=file.body.length;if(total>LIMITS.output)fail('OUTPUT_LIMIT');
    return {path:file.path,contentType:file.contentType,sha256:file.sha256,base64:Buffer.from(file.body).toString('base64')};
  });
  const bytes=Buffer.from(JSON.stringify({schemaVersion:1,origin,path,indexHtml,files:encoded,rendererId,timeoutMs}));
  if(bytes.length>LIMITS.renderInput)fail('INPUT_LIMIT');return bytes;
}
export function decodeRender(value) {
  if(!exactKeys(value,['schemaVersion','origin','path','indexHtml','files','rendererId','timeoutMs'])||value.schemaVersion!==1
    ||!/^chromium-[0-9.]+-controller-[a-f0-9]{64}$/.test(value.rendererId)||!Number.isInteger(value.timeoutMs)||value.timeoutMs<100||value.timeoutMs>15000
    ||!Array.isArray(value.files)||value.files.length>1000)fail('RENDER_INPUT_INVALID');
  const files=value.files.map(file=>{
    if(!exactKeys(file,['path','contentType','sha256','base64'])||typeof file.base64!=='string')fail('RENDER_FILE_INVALID');
    const body=Buffer.from(file.base64,'base64');if(body.toString('base64')!==file.base64)fail('RENDER_FILE_INVALID');
    return {path:file.path,contentType:file.contentType,sha256:file.sha256,body};
  });
  const input={origin:value.origin,path:value.path,indexHtml:value.indexHtml,files};
  encodeRender(input,value.rendererId,value.timeoutMs);
  return {...input,rendererId:value.rendererId,timeoutMs:value.timeoutMs};
}


/** Bake into the reviewed renderer image at /opt/makeborne/. Never run on the supervisor. */
import {open,writeFile,constants} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {renderLocalPublication} from './publication-renderer.mjs';
import {decodeRender,LIMITS,fail} from './vercel-publication-protocol.mjs';
export async function runRenderEntry() {
  const handle=await open('/vercel/sandbox/render-input.json',constants.O_RDONLY|constants.O_NOFOLLOW);
  let bytes;
  try {
    const stat=await handle.stat();if(!stat.isFile()||stat.size>LIMITS.renderInput)fail('INPUT_LIMIT');
    // A fixed upper bound prevents a growing input from bypassing stat.
    bytes=Buffer.alloc(stat.size+1);let offset=0;
    while(offset<bytes.length) {
      const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);
      if(bytesRead===0)break;
      offset+=bytesRead;
    }
    if(offset!==stat.size)fail('INPUT_LIMIT');bytes=bytes.subarray(0,offset);
  } finally {await handle.close();}
  const {rendererId,timeoutMs,...input}=decodeRender(JSON.parse(bytes.toString('utf8')));
  const result=await renderLocalPublication({...input,signal:AbortSignal.timeout(timeoutMs)},{qualifiedRendererId:rendererId,timeoutMs});
  const output=Buffer.from(JSON.stringify(result));if(output.length>LIMITS.renderResult)fail('OUTPUT_LIMIT');
  await writeFile('/vercel/sandbox/render-result.json',output,{flag:'wx',mode:0o600});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  runRenderEntry().catch(()=>{console.error('PUBLICATION_RENDER_FAILED');process.exitCode=1;});
}


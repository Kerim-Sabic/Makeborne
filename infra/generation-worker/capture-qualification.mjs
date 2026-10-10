/** Local operator inspection only: exact retained output in an opaque sandbox,
 * no Makeborne credentials, remote networking, hosting or publication. */
import assert from "node:assert/strict";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {resolve,join,dirname} from "node:path";
import {tmpdir} from "node:os";
import {createServer} from "node:http";
import {createRequire} from "node:module";
import {createLocalOutputStore} from "../project-runtime/local-output-store.mjs";
import {qualificationRound as round} from "./qualification-round.mjs";

assert(process.execArgv.includes('--conditions=react-server'));
const file=resolve(process.argv[2]??''),root=dirname(file);
assert(['M03-T01-R23','M03-T01-R25'].some(id=>root===resolve(`docs/execution/evidence/${id}`)));
assert(/^attempt-[a-f0-9-]{36}\.json$/.test(file.split(/[\\/]/).at(-1)));
const report=JSON.parse(await readFile(file,'utf8'));assert.equal(report.roundId,round.id);assert.equal(report.build?.state,'compiled');
const expectedRoot=join(tmpdir(),`makeborne-qualification-output-${round.workspaceId}`);assert.equal(report.localOutputRoot,expectedRoot);
const lib=createRequire(import.meta.url)(resolve('.env.qualification-round-1/runtime.cjs'));
const store=await createLocalOutputStore(expectedRoot),receipt=report.receipt,signal=new AbortController().signal;
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',webp:'image/webp',woff2:'font/woff2'};
let origin;const failures=[];
const server=createServer(async(req,res)=>{
  try {
    if(req.method!=='GET'||req.headers.host!==new URL(origin).host){res.writeHead(404);res.end();return;}
    const url=new URL(req.url,origin);let path=url.pathname.slice(1);
    if(!receipt.files.some(f=>f.path===path)&&receipt.routes.some(r=>r.path===url.pathname))path='index.html';
    const bytes=await lib.readCompiledOutputFile(store,round.workspaceId,receipt,path,signal);
    if(bytes===null){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':types[path.split('.').at(-1)]??'application/octet-stream','Content-Length':bytes.byteLength,
      'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow',
      'Access-Control-Allow-Origin':'*',
      'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; worker-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-forms"});res.end(bytes);
  }catch{failures.push('RETAINED_READ_FAILED');res.writeHead(503);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
// Browser interaction stays in the computer-use tool. This process only serves
// exact receipt-bound files, in an opaque sandbox. Local form events work;
// native form destinations and all fetch connections remain blocked.
console.log(JSON.stringify({jobId:report.jobId,buildHash:receipt.buildHash,origin}));
await new Promise(resolve=>{
  const timer=setTimeout(resolve,10*60_000);
  const stop=()=>{clearTimeout(timer);resolve();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  if(process.stdin.isTTY)process.stdin.once('data',stop);
});
process.stdin.pause();
await new Promise(resolve=>server.close(resolve));
await mkdir(root,{recursive:true});
await writeFile(join(root,`preview-server-${report.jobId}.json`),JSON.stringify({jobId:report.jobId,buildHash:receipt.buildHash,failures,closed:true},null,2)+'\n');

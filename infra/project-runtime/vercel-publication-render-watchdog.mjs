/** Fixed renderer process watchdog. OCI ENTRYPOINT/CMD are not run by Sandbox. */
import {spawn} from 'node:child_process';
const ttl=Number(process.env.MAKEBORNE_RENDER_TTL_MS);
if(!Number.isInteger(ttl)||ttl<1100||ttl>16000)throw Error('PUBLICATION_RENDER_LEASE_INVALID');
const child=spawn(process.execPath,['/opt/makeborne/vercel-publication-render-entry.mjs'],{stdio:'ignore',detached:true});
let expired=false;
const timer=setTimeout(()=>{
  expired=true;
  try{process.kill(-child.pid,'SIGKILL');}catch{}
},ttl);
child.once('error',()=>{clearTimeout(timer);process.exit(1);});
child.once('exit',code=>{clearTimeout(timer);process.exit(expired?124:code??1);});


import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import pg from 'pg';
import {Sandbox} from '@vercel/sandbox';
import sharp from 'sharp';
import {readControllerConfig} from './config.mjs';
import {runService,safeEvent} from './service.mjs';
import {publicationControl} from '../project-runtime/publication-control.mjs';
import {runPublicationController} from '../project-runtime/publication-controller.mjs';
import {vercelSandboxTransport} from '../project-runtime/vercel-publication-executor.mjs';
import {runPublicationPreparation} from '../../src/lib/projects/publication-worker';
import {publicationArtworkResolver} from '../../src/lib/projects/publication-assets';
import {publicationSourceDownloader} from '../../src/lib/projects/publication-download';
import {createR2S3OutputStore} from '../../src/lib/projects/r2-s3-output-store';
import {verifyStillRaster} from '../../src/lib/media/verified-raster';

const runtimeRequire=createRequire(__filename);
function version(name){
 let dir=dirname(runtimeRequire.resolve(name));
 for(let i=0;i<5;i++,dir=dirname(dir)){
  try{const p=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));if(p.name===name)return p.version;}catch{}
 }
 throw Error('PUBLICATION_CONTROLLER_DEPENDENCY_INVALID');
}
function dependencies(){
 if(Number(process.versions.node.split('.')[0])!==24||version('pg')!=='8.23.1'||version('@vercel/sandbox')!=='3.7.0'||version('sharp')!=='0.35.5')throw Error('PUBLICATION_CONTROLLER_DEPENDENCY_INVALID');
}
async function main(){
 dependencies();const arg=process.argv[2];
 if(arg==='--self-check'){
  const pixel=await sharp({create:{width:1,height:1,channels:4,background:{r:0,g:0,b:0,alpha:1}}}).png().toBuffer();
  await verifyStillRaster(pixel,'image/png');
  process.stdout.write(JSON.stringify({type:'self_check',ok:true,nodeMajor:24,sdkVersion:'3.7.0'})+'\n');return;
 }
 if(arg!==undefined&&arg!=='--check-config')throw Error('PUBLICATION_CONTROLLER_CONFIG_INVALID');
 const config=readControllerConfig();if(arg==='--check-config'){process.stdout.write('{"type":"config_valid"}\n');return;}
 const stop=new AbortController();let hardStop;
 const requestStop=()=>{if(stop.signal.aborted)return;stop.abort();hardStop=setTimeout(()=>{process.stderr.write('{"type":"shutdown_timeout"}\n');process.exit(1);},26000);hardStop.unref();};
 const fatal=()=>{process.stderr.write('{"type":"fatal","code":"PUBLICATION_CONTROLLER_FAILED"}\n');process.exitCode=1;requestStop();};
 process.on('SIGTERM',requestStop);process.on('SIGINT',requestStop);process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
 try{
  await runService(config,{Pool:pg.Pool,Sandbox,publicationControl,runPublicationController,vercelSandboxTransport,
   runPublicationPreparation,publicationArtworkResolver,publicationSourceDownloader,createR2S3OutputStore},stop.signal,
  {emit:(event)=>process.stdout.write(JSON.stringify(safeEvent(event))+'\n')});
 }finally{
  process.removeListener('SIGTERM',requestStop);process.removeListener('SIGINT',requestStop);process.removeListener('uncaughtException',fatal);process.removeListener('unhandledRejection',fatal);
  if(hardStop)clearTimeout(hardStop);
 }
}
// The service has already given active cleanup20s and pool close5s. An ignored
// SDK abort may retain sockets; it cannot keep the executable alive forever.
main().then(()=>{const exit=setTimeout(()=>process.exit(process.exitCode??0),100);exit.unref();},()=>{
 process.stderr.write('{"type":"fatal","code":"PUBLICATION_CONTROLLER_FAILED"}\n');process.exitCode=1;
 const exit=setTimeout(()=>process.exit(1),100);exit.unref();
});

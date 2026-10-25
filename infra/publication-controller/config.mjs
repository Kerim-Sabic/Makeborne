import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';

import {publicationProfile,publicationBrokerOriginAllowed,publicationWorkspaces} from './profiles.mjs';
export {STAGING,PRODUCTION} from './profiles.mjs';
const invalid=()=>{throw Error('PUBLICATION_CONTROLLER_CONFIG_INVALID');};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const image=/^(?:vcr\.vercel\.com\/)?[a-z0-9][a-z0-9_/-]*@sha256:[a-f0-9]{64}$/;
const secret=(env,key,pattern)=>{const v=env[key];if(typeof v!=='string'||!pattern.test(v))invalid();return v;};
function file(path,maxBytes,read){if(typeof path!=='string'||!isAbsolute(path))invalid();const bytes=read(path);if(!(bytes instanceof Uint8Array)||bytes.length>maxBytes)invalid();return Buffer.from(bytes);}
export function parseControllerConfig(value,env,{read=readFileSync,nodeMajor=Number(process.versions.node.split('.')[0])}={}){
 if(nodeMajor!==24||env.NODE_ENV!=='production')invalid();
 // Dedicated environment only. Explicit fields below prevent pg/SDK fallback;
 // rejecting ambient credentials also catches a mistakenly reused app service.
 if(Object.keys(env).some(k=>/^(PG|SUPABASE|NEXT_PUBLIC_SUPABASE|POSTGRES|AWS_|R2_|VERCEL_)/.test(k)
  ||['DATABASE_URL','NODE_OPTIONS','NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','NODE_USE_ENV_PROXY','NODE_USE_SYSTEM_CA','SSL_CERT_FILE','SSL_CERT_DIR','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'].includes(k.toUpperCase())))invalid();
 const profile=publicationProfile(value?.namespace),production=profile.namespace==='production';
 // Production schema 2: exact workspace list. Schema 3: every workspace the
 // database authority admits (verified plan access, migration 20261025200000).
 const entitled=production&&value?.schemaVersion===3;
 const scopeKey=!production?'qaWorkspaceId':entitled?'workspaceScope':'workspaceAllowlist';
 if(!exact(value,['schemaVersion','namespace','supabaseProjectRef',scopeKey,'database','vercel','broker','output','approvedFile','approvedSha256'])
  ||value.schemaVersion!==(production?(entitled?3:2):1)||value.supabaseProjectRef!==profile.projectRef||!production&&!uuid.test(value.qaWorkspaceId)
  ||entitled&&value.workspaceScope!=='entitled'
  ||!exact(value.database,['host','port','database','user','caFile'])||value.database.host!==profile.databaseHost||value.database.port!==5432||value.database.database!=='postgres'
  ||!new RegExp(`^makeborne_publication_controller_${profile.namespace}(?:_[a-z0-9]{1,16})?$`).test(value.database.user)
  ||!exact(value.vercel,['teamId','projectId'])||value.vercel.teamId!==profile.teamId||value.vercel.projectId!==profile.projectId
  ||!exact(value.broker,['origin','protectionBypassRequired'])||value.broker.protectionBypassRequired!==!production
  ||!publicationBrokerOriginAllowed(value.broker.origin,profile.namespace)
  ||production&&Object.hasOwn(env,'MBPUB_BROKER_PROTECTION_BYPASS')
  ||!exact(value.output,['accountId','bucket'])||!/^[a-f0-9]{32}$/.test(value.output.accountId)||value.output.bucket!==profile.bucket
  ||!hash.test(value.approvedSha256))invalid();
 const workspaces=entitled?Object.freeze([]):production?publicationWorkspaces(value.workspaceAllowlist):Object.freeze([value.qaWorkspaceId]);
 const approvedBytes=file(value.approvedFile,8192,read);
 if(createHash('sha256').update(approvedBytes).digest('hex')!==value.approvedSha256)invalid();
 const approved=JSON.parse(approvedBytes.toString('utf8'));
 if(!exact(approved,['compiler','renderer'])||!exact(approved.compiler,['image','runtimeImageId','evidenceSha256'])
  ||!exact(approved.renderer,['image','rendererId','evidenceSha256'])||!image.test(approved.compiler.image)||!image.test(approved.renderer.image)
  ||approved.compiler.image.length>512||approved.renderer.image.length>512||!/^sha256:[a-f0-9]{64}$/.test(approved.compiler.runtimeImageId)
  ||!/^chromium-[0-9.]+-controller-[a-f0-9]{64}$/.test(approved.renderer.rendererId)||approved.renderer.rendererId.length>180
  ||!hash.test(approved.compiler.evidenceSha256)||!hash.test(approved.renderer.evidenceSha256))invalid();
 if([approved.compiler.image,approved.renderer.image].some(ref=>!ref.replace(/^vcr\.vercel\.com\//,'').startsWith(profile.imagePrefix)))invalid();
 const ca=file(value.database.caFile,131072,read).toString('utf8');
 if(!/^\s*-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(ca)||ca.includes('PRIVATE KEY'))invalid();
 return Object.freeze({namespace:profile.namespace,qaWorkspaceId:production?undefined:value.qaWorkspaceId,workspaceScope:entitled?'entitled':'allowlist',workspaceAllowlist:workspaces,sitesDomain:profile.sitesDomain,
  database:Object.freeze({host:profile.databaseHost,port:5432,database:'postgres',user:value.database.user,
   password:secret(env,'MBPUB_DB_PASSWORD',/^[^\x00-\x1f\x7f]{16,1024}$/),ssl:Object.freeze({ca,rejectUnauthorized:true,servername:profile.databaseHost,minVersion:'TLSv1.2'}),
   max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:1000,application_name:'makeborne-publication-controller-'+profile.namespace}),
  vercel:Object.freeze({...value.vercel,token:secret(env,'MBPUB_VERCEL_TOKEN',/^[\x21-\x7e]{16,4096}$/)}),
  broker:Object.freeze({namespace:profile.namespace,origin:value.broker.origin,secret:secret(env,'MBPUB_BROKER_SECRET',hash),...(production?{}:{protectionBypassSecret:secret(env,'MBPUB_BROKER_PROTECTION_BYPASS',/^[\x21-\x7e]{1,512}$/)})}),
  output:Object.freeze({...value.output,accessKeyId:secret(env,'MBPUB_R2_ACCESS_KEY_ID',/^[a-f0-9]{32}$/),secretAccessKey:secret(env,'MBPUB_R2_SECRET_ACCESS_KEY',hash)}),
  approved:Object.freeze({compiler:Object.freeze(approved.compiler),renderer:Object.freeze(approved.renderer)})});
}
export function readControllerConfig(env=process.env,options={}){
 try{const read=options.read??readFileSync;const bytes=file(env.MBPUB_CONFIG_FILE,32768,read);return parseControllerConfig(JSON.parse(bytes.toString('utf8')),env,{...options,read});}
 catch{invalid();}
}

// New local package only; default preflight never changes DB or contacts providers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {MODEL,CAP,PORT,ROOT,STATE,CASES,COPY_ENTRIES,json,save,hash,canonical,localConfig,reservation,cleanEnv,providerKey,ledger,sourceInventory,hasState} from './fresh-quality-common.mjs';

function windowsProcessSnapshot({pid,app,port,startedAt,known=[]},run=spawnSync){
 const quotedApp=path.resolve(app).toLowerCase().replaceAll('/','\\').replaceAll("'","''");
 const script=`$ErrorActionPreference='Stop'
$rows=@(Get-CimInstance Win32_Process -ErrorAction Stop)
$ids=[System.Collections.Generic.HashSet[int]]::new()
$null=$ids.Add(${pid})
${known.map(id=>`$null=$ids.Add(${id})`).join('\n')}
do { $added=$false; foreach($row in $rows) { if($ids.Contains([int]$row.ParentProcessId)) { if($ids.Add([int]$row.ProcessId)) { $added=$true } } } } while($added)
$matched=@($rows | Where-Object { $ids.Contains([int]$_.ProcessId) -or ($_.Name -eq 'node.exe' -and ($_.CommandLine.ToLowerInvariant().Replace('/','\\').Contains('${quotedApp}') -or $_.CommandLine -match '(?:--port(?:=|\\s+)|-p\\s+)${port}(?:\\s|$|\")')) } | ForEach-Object { [int]$_.ProcessId })
$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq ${port})
$root=@($rows | Where-Object ProcessId -eq ${pid})
$identity=$false
if($root.Count -eq 1 -and $root[0].Name -eq 'node.exe' -and $root[0].CommandLine -match '(?:--port(?:=|\\s+)|-p\\s+)${port}(?:\\s|$|\")') {
 $created=([DateTimeOffset]$root[0].CreationDate).ToUnixTimeMilliseconds()
 $identity=($created -ge ${Number.isSafeInteger(startedAt)?startedAt-2000:0} -and $created -le ${Number.isSafeInteger(startedAt)?startedAt+5000:0})
}
@{processIds=$matched;listening=($listeners.Count -gt 0);rootIdentityMatches=$identity} | ConvertTo-Json -Compress`;
 try{
  const result=run(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:65536});
  if(result.status!==0||result.error)return null;
  const state=JSON.parse(result.stdout);
  if(!Array.isArray(state.processIds)||state.processIds.some(id=>!Number.isSafeInteger(id)||id<=0)||typeof state.listening!=='boolean'||typeof state.rootIdentityMatches!=='boolean')return null;
  return state;
 }catch{return null;}
}

export function stopFreshQualityProcessTree(child,{platform=process.platform,run=spawnSync,snapshot=windowsProcessSnapshot,app=path.join(STATE,'app'),port=PORT,startedAt}={}){
 if(!child?.pid)return null;
 if(!Number.isSafeInteger(child.pid)||child.pid<=0)return false;
 if(platform!=='win32'){child.kill();return false;}
 const before=snapshot({pid:child.pid,app,port,startedAt},run);
 // Do not target a possibly reused PID after Node has observed the child exit.
 const exited=child.exitCode!=null||child.signalCode!=null;
 if(!exited&&before?.rootIdentityMatches){
  try{run(path.join(process.env.SystemRoot,'System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:5000});}catch{}
 }
 const after=snapshot({pid:child.pid,app,port,startedAt,known:before?.processIds??[]},run);
 // Exit codes are only an attempted kill receipt. A fresh process/listener
 // readback decides success, including an already stopped child. TIME_WAIT
 // connections do not indicate a surviving listener. Unknown stays failure.
 return before!==null&&after!==null&&after.processIds.length===0&&!after.listening;
}

async function main(){
const live=process.argv.includes('--start');
assert(process.argv.slice(2).every(arg=>['--start','--dry-run'].includes(arg)));
const local=localConfig(),db=new pg.Client({connectionString:local.DB_URL,connectionTimeoutMillis:5000,query_timeout:10000});
let child,childStartedAt,lock,heartbeat,stopTimer,activated=false,closed=false;
async function close(){
 if(closed)return;closed=true;clearInterval(heartbeat);clearTimeout(stopTimer);
 if(activated){
  try{await db.query('update makeborne_quality_local.package set enabled=false,active_action=null where singleton');}catch{}
  try{await db.query("update makeborne_private.live_provider_limits set enabled=false where scope in ('global','anthropic')");}catch{}
 }
 const processTreeStopped=stopFreshQualityProcessTree(child,{startedAt:childStartedAt});
 if(activated){try{const current=await ledger(db),state=json(path.join(STATE,'session.json')),old=new Set(state.baseline.map(call=>call.id));
   const unchanged=canonical(current.filter(call=>old.has(call.id)))===canonical(state.baseline);
   const guard=(await db.query('select enabled from makeborne_quality_local.package where singleton')).rows[0];
   const scopes=(await db.query('select scope,enabled from makeborne_private.live_provider_limits order by scope')).rows;
   const limitsDisabled=guard?.enabled===false&&scopes.every(row=>row.enabled===false);
   save(path.join(state.output,'shutdown-ledger.json'),{observedAt:new Date().toISOString(),historicalRowsUnchanged:unchanged,calls:current.filter(call=>!old.has(call.id)),limitsDisabled,scopes,processTreeStopped});
   if(!unchanged||!limitsDisabled||processTreeStopped===false)process.exitCode=1;
  }catch{process.exitCode=1;try{const state=json(path.join(STATE,'session.json'));save(path.join(state.output,'shutdown-ledger.json'),{observedAt:new Date().toISOString(),limitsDisabled:null,historicalRowsUnchanged:null,readback:'failed; explicit operator recovery required',processTreeStopped});}catch{}}}
 await db.end().catch(()=>{});if(lock)fs.closeSync(lock);
 // Retain lock marker and disabled SQL guard. No implicit restart/reuse.
}
try{
 await db.connect();await db.query('begin read only');
 const baseline=await ledger(db),limits=(await db.query('select scope,enabled,emergency_stop from makeborne_private.live_provider_limits order by scope')).rows;
 const priorGuard=(await db.query("select to_regnamespace('makeborne_quality_local') is not null present")).rows[0].present;
 const runtime=(await db.query("select to_regclass('makeborne_private.ai_operations') is not null and to_regclass('makeborne_private.ai_operation_runs') is not null ready")).rows[0].ready;
 await db.query('rollback');
 assert(baseline.every(call=>call.status!=='open'),'UNRESOLVED_PRIOR_CALLS');assert(limits.every(item=>!item.enabled),'OVERLAPPING_PROVIDER_CONSUMER');assert(!priorGuard,'EXPLICIT_GUARD_RECOVERY_REQUIRED');
 const env=cleanEnv(local),sourceHashes=sourceInventory();
 const preflight={dryRun:!live,providerRequests:0,dbWrites:0,model:MODEL,capMicrousd:CAP,port:PORT,runtimeContractReady:runtime,actionsSha256:hash(canonical(CASES)),sourceHashes,priorCalls:baseline.length,allProvidersDisabled:true,
  credentialPresenceOnly:{anthropic:Boolean(providerKey()),openai:false},environmentKeys:Object.keys(env).sort(),rootReservationRequired:true};
 if(!live){console.log(JSON.stringify(preflight,null,2));}
 else{
  assert(runtime,'CURRENT_OPERATION_SCHEMA_REQUIRED');
  const approved=reservation();assert(!hasState(),'FRESH_PACKAGE_ALREADY_STARTED');
  const midnight=new Date();midnight.setUTCHours(24,0,0,0);const deadline=Math.min(Date.parse(approved.expiresAt),midnight.getTime()-60000);assert(deadline>Date.now()+360000,'TOO_CLOSE_TO_UTC_BOUNDARY');
  await new Promise((resolve,reject)=>{const socket=createServer();socket.once('error',reject);socket.listen(PORT,'127.0.0.1',()=>socket.close(resolve));});
  fs.mkdirSync(STATE,{recursive:true});lock=fs.openSync(path.join(STATE,'exclusive.lock'),'wx');
  const output=path.resolve('outputs',`fresh-product-quality-${approved.packageId}`),app=path.join(STATE,'app');
  assert(!fs.existsSync(output)&&!fs.existsSync(app),'FRESH_OUTPUT_REQUIRED');fs.mkdirSync(output,{recursive:true});fs.mkdirSync(app);
  // Whitelist source roots. No .env files, old output, credentials or .next copied.
  for(const entry of COPY_ENTRIES)if(fs.existsSync(entry)){fs.mkdirSync(path.dirname(path.join(app,entry)),{recursive:true});fs.cpSync(entry,path.join(app,entry),{recursive:true,errorOnExist:true});}
  assert.equal(canonical(sourceInventory(app)),canonical(sourceHashes),'SOURCE_CHANGED_DURING_COPY');
  fs.symlinkSync(path.join(ROOT,'node_modules'),path.join(app,'node_modules'),'junction');
  const nextConfig=path.join(app,'next.config.ts'),config=fs.readFileSync(nextConfig,'utf8');assert(config.includes('const nextConfig: NextConfig = {'));fs.writeFileSync(nextConfig,config.replace('const nextConfig: NextConfig = {','const nextConfig: NextConfig = {\n  distDir: ".next-fresh-quality",'));
  assert(!fs.existsSync(path.join(app,'.env.local')));
  const admin=createClient(local.API_URL,local.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const email=`fresh-quality-${randomUUID()}@example.invalid`,password=`Fresh-${randomUUID()}!`;
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert(!created.error&&created.data.user,'LOCAL_FIXTURE_CREATION_FAILED');
  const actor=created.data.user.id,actions=Object.fromEntries(Object.entries(CASES).map(([name,value])=>[name,{actionKey:randomUUID(),stepKey:randomUUID(),cap:value.cap,effort:value.effort,status:'pending'}]));
  const state={packageId:approved.packageId,port:PORT,deadline:new Date(deadline).toISOString(),actor,email,password,output,app,baseline,sourceHashes,actions};
  // Ignored work state contains only local fixture credentials; public evidence omits them.
  save(path.join(STATE,'session.json'),state);save(path.join(output,'preflight.json'),preflight);save(path.join(output,'baseline-ledger.json'),baseline);
  await db.query('begin');
  try{
   await db.query("select pg_advisory_xact_lock(6140313068)");
   const check=(await db.query('select enabled from makeborne_private.live_provider_limits for update')).rows;assert(check.every(row=>!row.enabled));assert((await ledger(db)).every(row=>row.status!=='open'));
   assert.equal(canonical(await ledger(db)),canonical(baseline),'LEDGER_CHANGED_DURING_PREP');
   await db.query(fs.readFileSync('scripts/fresh-quality-guard.sql','utf8'));
   await db.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,true,'Fresh isolated qualification; provider guard remains authoritative')",[actor]);
   await db.query("insert into makeborne_quality_local.package values(true,$1,$2,true,(clock_timestamp() at time zone 'UTC')::date,$3,6000000,null,pg_backend_pid(),clock_timestamp()+interval '15 seconds')",[approved.packageId,actor,state.deadline]);
   for(const [name,action] of Object.entries(actions))await db.query('insert into makeborne_quality_local.actions(name,action_key,step_key,cap,effort) values($1,$2,$3,$4,$5)',[name,action.actionKey,action.stepKey,action.cap,action.effort]);
   for(const scope of ['global','anthropic'])await db.query("select makeborne_private.set_live_provider_limit($1,true,(select (coalesce(sum(spent_microusd+reserved_microusd),0)+6000000)::bigint from makeborne_private.live_provider_days where scope=$1 and day=(clock_timestamp() at time zone 'UTC')::date),false,'Reserved fresh quality package; local trigger enforces exact actions')",[scope]);
   activated=true;await db.query('commit');
  }catch(error){await db.query('rollback');throw error;}
  heartbeat=setInterval(()=>{void db.query("update makeborne_quality_local.package set heartbeat_until=clock_timestamp()+interval '15 seconds' where singleton and enabled").catch(()=>{void close();});},5000);
  stopTimer=setTimeout(()=>{void close();},Math.max(1,deadline-Date.now()));
  for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>{void close();});
  const childEnv=cleanEnv(local,providerKey()),log=fs.openSync(path.join(STATE,'server.log'),'a');
  childStartedAt=Date.now();
  child=spawn(process.execPath,[path.join(ROOT,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(PORT)],{cwd:app,env:childEnv,stdio:['ignore',log,log],windowsHide:true});
  fs.closeSync(log);console.log(JSON.stringify({started:true,origin:`http://127.0.0.1:${PORT}`,packageId:approved.packageId,deadline:state.deadline,providerCalls:0,guard:'exact actions only; fails closed within 15 seconds after controller loss'}));
  await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
 }
}catch{console.error('FRESH_QUALITY_PREFLIGHT_OR_START_FAILED (inspect local state; no automatic retry)');process.exitCode=1;}
finally{await close();}
}
// Importing the focused shutdown helper never reads status, opens SQL, or starts
// a package. The normal explicit CLI invocation retains the existing lifecycle.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

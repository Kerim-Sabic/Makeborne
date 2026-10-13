// Exactly one explicit action per invocation. Default is a file-only dry-run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {chromium} from 'playwright';
import {STATE,PORT,CASES,json,save,hash,canonical,localConfig,reservation,ledger,sourceInventory,cleanEnv} from './fresh-quality-common.mjs';
const name=process.argv[2],live=process.argv.includes('--run');
assert(Object.hasOwn(CASES,name),'Choose book, deck, or deck-edit');assert(process.argv.slice(3).every(arg=>['--run','--dry-run'].includes(arg)));
if(!live){console.log(JSON.stringify({dryRun:true,dbWrites:0,providerRequests:0,name,...CASES[name],operationEnvelope:'persisted fresh actionKey and stepKey',styleId:'automatic',reservationRequired:true},null,2));}
else{
 const approved=reservation(),state=json(path.join(STATE,'session.json')),c=CASES[name],action=state.actions[name];
 assert.equal(state.packageId,approved.packageId);assert.equal(state.port,PORT);assert(Date.parse(state.deadline)>Date.now()+360000);assert.equal(action.status,'pending','NO_AUTOMATIC_RETRY');assert.equal(canonical(sourceInventory()),canonical(state.sourceHashes),'SOURCE_CHANGED_SINCE_SNAPSHOT');
 const local=localConfig(),db=new pg.Client({connectionString:local.DB_URL,connectionTimeoutMillis:5000,query_timeout:10000});let browser,armed=false;
 const origin=`http://127.0.0.1:${PORT}`,output=path.join(state.output,name);assert(!fs.existsSync(output),'UNTOUCHED_OUTPUT_REQUIRED');fs.mkdirSync(output);
 try{
  await db.connect();const guard=(await db.query('select enabled,package_id,heartbeat_until,deadline from makeborne_quality_local.package where singleton')).rows[0];assert(guard.enabled&&guard.package_id===state.packageId&&Date.parse(guard.heartbeat_until)>Date.now());
  const childEnv=cleanEnv(local,'');delete childEnv.SUPABASE_SECRET_KEY;delete childEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  browser=await chromium.launch({headless:true,env:childEnv});const page=await browser.newPage();
  await page.goto(origin+'/login');await page.locator('#account-email').fill(state.email);await page.locator('#account-password').fill(state.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(url=>!url.pathname.includes('/login'),{timeout:30000});
  const api=async(url,body)=>{const r=await page.request.post(origin+url,{data:body,headers:{Origin:origin,'Idempotency-Key':randomUUID(),'x-makeborne-crm-protocol':'2'}});assert.equal(r.status(),201,'LOCAL_FIXTURE_API_FAILED');return r.json();};
  if(!state.workspaceId){const r=await api('/api/workspaces',{name:`Fresh product quality ${state.packageId}`});state.workspaceId=r.workspace.id;save(path.join(STATE,'session.json'),state);}
  let target,message=c.prompt,previous;
  if(name==='deck-edit'){
   assert.equal(state.actions.deck.status,'completed','INSPECT_DECK_BEFORE_EDIT');target=state.actions.deck;
   previous=json(path.join(state.output,'deck','saved-version.json'));const slides=previous.content.document.slides;
   const charts=slides.filter(slide=>slide.chart?.series?.[0]?.values?.join(',')==='12,18,25,30');assert.equal(charts.length,1,'REQUESTED_CHART_MISSING_OR_AMBIGUOUS');
   const index=slides.findIndex(slide=>slide.id===charts[0].id)+1;
   message=`On slide ${index}, titled ${JSON.stringify(charts[0].title)}, change the second quarterly visit count from 18 to 21. Update that slide's explanatory text and speaker notes only where needed. Preserve all other slides, the deck theme, slide order and cover composition.`;
   action.projectId=target.projectId;action.artifactId=target.artifactId;
  }else{
   const p=await api(`/api/cloud/workspaces/${state.workspaceId}/projects`,{title:c.title,kind:c.kind,styleId:'automatic',brief:message});
   const a=await api(`/api/cloud/workspaces/${state.workspaceId}/projects/${p.project.id}/artifacts`,{title:c.title,kind:c.kind});
   action.projectId=p.project.id;action.artifactId=a.artifact.id;target=action;
  }
  const current=(await db.query('select current_version from public.artifacts where id=$1 and workspace_id=$2',[target.artifactId,state.workspaceId])).rows[0].current_version;
  assert.equal(current,name==='deck-edit'?previous.version_number:0,'EXACT_FRESH_VERSION_REQUIRED');
  const request={workspaceId:state.workspaceId,artifactId:target.artifactId,expectedVersion:current,message,effort:c.effort,attachments:[],mode:'build'};
  const digest=hash(canonical(request));save(path.join(output,'request.json'),{...request,operation:{actionKey:action.actionKey,stepKey:action.stepKey}});
  await db.query('begin');try{
   const q=await db.query('update makeborne_quality_local.actions set workspace_id=$2,artifact_id=$3,input_hash=$4,expected_version=$5,attempted=true where name=$1 and not attempted returning name',[name,state.workspaceId,target.artifactId,digest,current]);assert.equal(q.rowCount,1,'ACTION_ALREADY_ATTEMPTED');
   const armedRow=await db.query('update makeborne_quality_local.package set active_action=$1 where singleton and enabled and active_action is null and heartbeat_until>clock_timestamp() and deadline>clock_timestamp()+interval \'360 seconds\' returning package_id',[name]);assert.equal(armedRow.rowCount,1,'PACKAGE_NOT_READY');await db.query('commit');armed=true;
  }catch(error){await db.query('rollback');throw error;}
  action.status='attempted';save(path.join(STATE,'session.json'),state);
  const response=await page.request.post(origin+'/api/build',{headers:{Origin:origin,'Content-Type':'application/json'},data:{...request,operation:{actionKey:action.actionKey,stepKey:action.stepKey}},timeout:330000});
  const eventsText=await response.text();fs.writeFileSync(path.join(output,'events.txt'),eventsText,{flag:'wx'});
  const events=eventsText.split('\n').filter(line=>line.startsWith('data: ')).flatMap(line=>{try{return [JSON.parse(line.slice(6))];}catch{return [];}});
  const terminal=events.filter(event=>['done','error'].includes(event.type)).at(-1);
  const rows=(await db.query('select version_number,content,style_snapshot,change_summary from public.artifact_versions where artifact_id=$1 and version_number>$2 order by version_number',[target.artifactId,current])).rows;
  save(path.join(output,'all-saved-versions.json'),rows);save(path.join(output,'terminal.json'),{httpStatus:response.status(),terminal});
  if(rows.length){assert.equal(rows.length,1,'UNEXPECTED_ADDITIONAL_VERSION');const saved=rows[0];save(path.join(output,'saved-version.json'),saved);
   for(const format of c.kind==='book'?['pdf']:['pdf','pptx']){
    const r=await page.request.get(`${origin}/api/cloud/workspaces/${state.workspaceId}/artifacts/${target.artifactId}/document-export?format=${format}&version=${saved.version_number}`,{timeout:120000});
    assert.equal(r.status(),200,'EXPORT_FAILED');fs.writeFileSync(path.join(output,`document.${format}`),await r.body(),{flag:'wx'});
   }
   if(previous){const before=previous.content.document,after=saved.content.document;
    const changed=before.slides.filter((slide,index)=>canonical(slide)!==canonical(after.slides[index])).map(slide=>slide.id);
    save(path.join(output,'edit-diff.json'),{changedSlideIds:changed,themeUnchanged:canonical(before.theme)===canonical(after.theme),slideOrderUnchanged:canonical(before.slides.map(s=>s.id))===canonical(after.slides.map(s=>s.id)),before,after});
   }
   const rendered=spawnSync(process.execPath,['scripts/render-fresh-quality.cjs',state.app,output],{stdio:'inherit',windowsHide:true,env:childEnv});assert.equal(rendered.status,0,'LOCAL_RENDER_FAILED');
  }
  assert.equal(response.status(),200);assert.equal(terminal?.type,'done');assert.equal(terminal.finished,true,'GENERATION_INCOMPLETE');assert.equal(rows.length,1,'NO_SAVED_RESULT');
  action.status='completed';save(path.join(STATE,'session.json'),state);console.log(JSON.stringify({name,completed:true,output,manualVisualReviewRequired:true,imagesQualified:false}));
 }catch{console.error('FRESH_QUALITY_ACTION_FAILED; inspect preserved events/source/ledger before any new authorization');process.exitCode=1;}
 finally{
  if(armed)await db.query('update makeborne_quality_local.package set active_action=null where singleton and active_action=$1',[name]).catch(()=>{});
  try{const calls=await ledger(db),baseline=new Set(state.baseline.map(x=>x.id));const historicalRowsUnchanged=canonical(calls.filter(x=>baseline.has(x.id)))===canonical(state.baseline);save(path.join(output,'ledger.json'),{observedAt:new Date().toISOString(),historicalRowsUnchanged,calls:calls.filter(x=>!baseline.has(x.id))});assert(historicalRowsUnchanged);}catch{process.exitCode=1;}
  if(browser)await browser.close();await db.end().catch(()=>{});
 }
}

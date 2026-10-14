import fs from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {chromium} from 'playwright';
const cfg=JSON.parse(fs.readFileSync('work/release-auth-stack/status.json','utf8').replace(/^\uFEFF/,''));
assert(cfg.DB_URL.includes('@127.0.0.1:55438/'));
const fixture=JSON.parse(fs.readFileSync('work/release-auth-stack/quality-fixture.json','utf8'));
const db=new pg.Client({connectionString:cfg.DB_URL});await db.connect();
const browser=await chromium.launch();const owner=await browser.newPage();
const project=fixture.cases.presentation;let link;
const stage=(await db.query('select delivery_stage from public.projects where id=$1',[project.projectId])).rows[0].delivery_stage;
const root=`/api/cloud/workspaces/${fixture.workspaceId}/artifacts/${project.artifactId}/reviews`;
const api=(path,body,method='POST')=>owner.evaluate(async({path,body,method})=>{const r=await fetch(path,{method,headers:{'Content-Type':'application/json','x-makeborne-crm-protocol':'2'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}},{path,body,method});
try {
 await owner.goto('http://localhost:3048/login');await owner.locator('#account-email').fill(fixture.email);await owner.locator('#account-password').fill(fixture.password);await owner.getByRole('button',{name:'Sign in',exact:true}).click();await owner.waitForURL(u=>!u.pathname.includes('/login'));
 const version=(await db.query('select current_version from public.artifacts where id=$1',[project.artifactId])).rows[0].current_version;
 const created=await api(root,{scope:'version',version,days:1,recipientName:'Local review test'});assert.equal(created.status,201,JSON.stringify(created));link=created.body.link;
 const url=new URL(created.body.url);const token=url.pathname.split('/').pop();
 const guest=await browser.newPage();await guest.goto(`http://localhost:3048${url.pathname}`);
 assert((await guest.locator('body').innerText()).includes('From Brief to Better Work'));
 const post=async(path,body)=>{const r=await guest.request.post(`http://localhost:3048/api/review/${token}/${path}`,{data:body,headers:{Origin:'http://localhost:3048'}});assert.equal(r.status(),200,(await r.text()).slice(0,500));};
 await post('comments',{name:'Test Reviewer',body:'Make the next step clearer.',anchor:{kind:'point',ref:'closing',x:0.5,y:0.5,label:'Closing slide'}});
 await post('decision',{name:'Test Reviewer',decision:'changes_requested',note:'Please revise the closing slide.'});
 assert.equal((await db.query('select delivery_stage from public.projects where id=$1',[project.projectId])).rows[0].delivery_stage,'changes_requested');
 await post('decision',{name:'Test Reviewer',decision:'approved',note:'Approved for this local test.'});
 assert.equal((await db.query('select delivery_stage from public.projects where id=$1',[project.projectId])).rows[0].delivery_stage,'delivered');
 const revoked=await api(`${root}/${link.id}`,null,'DELETE');assert.equal(revoked.status,200);
 const denied=await guest.request.post(`http://localhost:3048/api/review/${token}/comments`,{data:{name:'Test',body:'Must be refused',anchor:{kind:'general'}},headers:{Origin:'http://localhost:3048'}});assert(denied.status()>=400);
 fs.writeFileSync('docs/release-review/quality-review.json',JSON.stringify({environment:'isolated local',guestView:true,pinnedComment:true,changesRequested:true,approvalUpdatesProject:true,revocationBlocksWrites:true,productionTouched:false},null,2));console.log('PASS guest view, pinned comment, changes requested, approval, project stage, revoked write rejected');
} finally {
 if(link)await api(`${root}/${link.id}`,null,'DELETE');
 await db.query('update public.projects set delivery_stage=$1 where id=$2',[stage,project.projectId]);
 await browser.close();await db.end();
}

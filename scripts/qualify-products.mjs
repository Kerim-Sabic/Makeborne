import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import {chromium} from 'playwright';
import {createClient} from '@supabase/supabase-js';
const cases={
 restaurant:{kind:'website',title:'Saffron Table',prompt:'Build a complete premium restaurant website for Saffron Table, a contemporary neighborhood restaurant in Bristol. Warm editorial art direction, exceptional typography, original CSS/SVG food-inspired art (image API is unavailable), seasonal menu with prices, opening hours, location, accessible mobile navigation and reservation enquiry form with real validation. Do not pretend a reservation has been sent without a backend. Make all navigation and buttons useful. No template or fake awards.'},
 saas:{kind:'website',title:'Relay Operations',prompt:'Build a complete polished B2B SaaS website for Relay Operations: a shared handoff and issue tracker for small logistics teams. Distinctive precise industrial design, interactive product demonstration built from real HTML and CSS, clear features, transparent fictional sample pricing, FAQ and accessible mobile menu. Demo request form must validate and honestly state when it is only a demo. No fake customer logos, unsupported claims, or stock gradients everywhere. Use original SVG illustrations; image API unavailable.'},
 portfolio:{kind:'website',title:'Mira Objects',prompt:'Build a complete editorial portfolio and enquiry website for Mira Objects, an independent ceramic artist. Warm ivory and charcoal, oversized serif typography, asymmetric but readable layout, original SVG illustrations of ceramic objects with distinct silhouettes, collection filtering, work detail interaction and commission enquiry form with accessible validation. All links useful, outstanding mobile layout. No fake form delivery, no image API available. Make it visually distinct from typical SaaS sites.'},
 book:{kind:'book',title:'The Useful Client Brief',prompt:'Create a COMPLETE practical ebook titled The Useful Client Brief, for freelance designers. Portrait 6 by 9 inch ebook proportions, premium restrained editorial typography, cover, contents, introduction, five substantive chapters, useful examples, reusable brief worksheet and final checklist. At least 2500 words of useful original material; no filler, no about-the-design section. Use original typographic diagrams and varied page structures; image API is unavailable so do not include missing image placeholders. Ready for readable PDF export.'},
 presentation:{kind:'presentation',title:'From Brief to Better Work',prompt:'Create a complete 10-slide presentation From Brief to Better Work for freelance designers selling their process to clients. 16:9, exceptional editorial art direction, varied intentional layouts, clear readable typography, one editable chart with explicitly illustrative data, process diagram, case example, timeline and persuasive next step. Write useful speaker notes. Use editable native text and shapes, not flattened slide images. No invented testimonials or real business performance claims. Image API is unavailable.'},
};
const name=process.argv[2];assert(cases[name],'Choose a named qualification case');
const root='work/release-auth-stack/';const local=JSON.parse(readFileSync(root+'status.json','utf8').replace(/^\uFEFF/,''));
assert.equal(local.API_URL,'http://127.0.0.1:55435');assert(local.DB_URL.includes('@127.0.0.1:55438/'));
const db=new pg.Client({connectionString:local.DB_URL});await db.connect();
const admin=createClient(local.API_URL,local.SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
let fixture;
if(existsSync(root+'quality-fixture.json'))fixture=JSON.parse(readFileSync(root+'quality-fixture.json','utf8'));
else{const email=`quality-${randomUUID()}@example.invalid`,password=`Quality-${randomUUID()}!`;const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert(!created.error,created.error?.message);fixture={email,password,userId:created.data.user.id,cases:{}};await db.query("insert into makeborne_private.account_privileges(user_id,is_admin,unlimited_credits,reason) values($1,true,true,'Isolated paid product qualification; provider limits still apply')",[fixture.userId]);writeFileSync(root+'quality-fixture.json',JSON.stringify(fixture));}
const browser=await chromium.launch({headless:true});const page=await browser.newPage();
const api=async(path,body)=>page.evaluate(async({path,body})=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),'x-makeborne-crm-protocol':'2'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}},{path,body});
try{
 await page.goto('http://localhost:3048/login');await page.locator('#account-email').fill(fixture.email);await page.locator('#account-password').fill(fixture.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:30000});
 if(!fixture.workspaceId){const r=await api('/api/workspaces',{name:'Product quality qualification'});assert.equal(r.status,201,JSON.stringify(r));fixture.workspaceId=r.body.workspace.id;}
 const c=cases[name],wid=fixture.workspaceId;
 if(!fixture.cases[name]){const p=await api(`/api/cloud/workspaces/${wid}/projects`,{title:c.title,kind:c.kind});assert.equal(p.status,201,JSON.stringify(p));const a=await api(`/api/cloud/workspaces/${wid}/projects/${p.body.project.id}/artifacts`,{title:c.title,kind:c.kind});assert.equal(a.status,201,JSON.stringify(a));fixture.cases[name]={projectId:p.body.project.id,artifactId:a.body.artifact.id};}
 writeFileSync(root+'quality-fixture.json',JSON.stringify(fixture));
 const aid=fixture.cases[name].artifactId;const v=(await db.query('select current_version from public.artifacts where id=$1',[aid])).rows[0].current_version;
 const customPrompt=process.argv[4]?readFileSync(process.argv[4],'utf8'):null;const effort=process.argv[5]??'high';assert(['light','medium','high'].includes(effort));
 const continuation=process.argv[3]==='continue';assert(v===0||continuation,'Case already generated: inspect before spending on another request');
 const result=await page.evaluate(async body=>{const r=await fetch('/api/build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,text:await r.text()}},{workspaceId:wid,artifactId:aid,expectedVersion:v,message:customPrompt??(continuation?`Continue the unfinished project. Preserve completed work. Finish the original brief: ${c.prompt} Write one complete chapter or component per tool call; do not combine multiple JSON objects in a single tool input.`:c.prompt),effort});
 mkdirSync('outputs/product-qualification',{recursive:true});writeFileSync(`outputs/product-qualification/${name}-v${v+1}-events.txt`,result.text);
 const versions=(await db.query('select version_number,content from public.artifact_versions where artifact_id=$1 order by version_number desc',[aid])).rows;
 writeFileSync(`outputs/product-qualification/${name}.json`,JSON.stringify(versions,null,2));
 console.log(JSON.stringify({case:name,status:result.status,savedVersions:versions.length,ending:result.text.slice(-1200)}));
}finally{await browser.close();await db.end();}

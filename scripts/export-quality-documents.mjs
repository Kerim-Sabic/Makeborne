import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const name=process.argv[2];assert(['book','presentation'].includes(name));
const f=JSON.parse(readFileSync('work/release-auth-stack/quality-fixture.json','utf8'));
const browser=await chromium.launch({headless:true});const page=await browser.newPage();
try{
 await page.goto('http://localhost:3048/login');await page.locator('#account-email').fill(f.email);await page.locator('#account-password').fill(f.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>!u.pathname.includes('/login'),{timeout:30000});
 for(const format of name==='book'?['pdf']:['pdf','pptx']){
  const r=await page.request.get(`http://localhost:3048/api/cloud/workspaces/${f.workspaceId}/artifacts/${f.cases[name].artifactId}/document-export?format=${format}`,{timeout:120000});
  assert.equal(r.status(),200,`Export failed: ${(await r.text()).slice(0,300)}`);
  const bytes=await r.body();writeFileSync(`outputs/product-qualification/${name}.${format}`,bytes);console.log(`${name}.${format}: ${bytes.length} bytes`);
 }
}finally{await browser.close();}

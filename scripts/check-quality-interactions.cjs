/* eslint-disable @typescript-eslint/no-require-imports -- Isolated generated-site checks. */
const fs = require('node:fs'), assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async () => {
 const browser = await chromium.launch(); const results = [];
 try { for (const name of ['restaurant','saas','portfolio']) {
  for (const width of [1440,390]) {
   const page = await browser.newPage({viewport:{width,height:1000}});
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>route.abort());
   await page.setContent(fs.readFileSync(`outputs/product-qualification/${name}.html`,'utf8'));
   await page.waitForFunction(()=>document.querySelector('#root')?.children.length);
   const submit=page.getByRole('button',{name:name==='restaurant'?'Check my request':name==='saas'?'Send request':'Send enquiry'});
   await submit.click();assert(await page.locator('[aria-invalid="true"]').count()>0,`${name}: invalid input must be announced`);
   const prefix=name==='restaurant'?'f-':'';
   await page.locator(`#${prefix}name`).fill('Test Visitor');await page.locator(`#${prefix}email`).fill('visitor@example.invalid');
   if(name==='restaurant') {
    const date=new Date();date.setDate(date.getDate()+14);while(date.getDay()!==3)date.setDate(date.getDate()+1);
    await page.locator('#f-date').fill(date.toISOString().slice(0,10));
    await page.locator('#f-time').selectOption({index:1});await page.locator('#f-guests').selectOption({index:2});
   } else if(name==='saas')await page.locator('#size').selectOption({index:1});
   else {await page.locator('#type').selectOption({index:1});await page.locator('#message').fill('Please discuss a custom ceramic bowl for our dining room.');}
   await submit.click();assert.equal(await page.locator('[aria-invalid="true"]').count(),0,`${name}: valid data accepted`);
   const text=await page.locator('body').innerText();assert(/not (?:been )?sent|nothing.{0,30}sent|not.{0,20}booking|not.{0,20}submit|demo/i.test(text),`${name}: demo disclosed`);
   if(name==='saas') {
    await page.getByRole('button',{name:'Blocking',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:/RL-215/}).count(),0,'Blocking filter removes non-blocking stock issue');
    await page.getByRole('button',{name:'All',exact:true}).click();
    await page.getByRole('button',{name:'Resolved',exact:true}).click();
    await page.locator('#demo-note').fill('Checked during qualification');await page.getByRole('button',{name:'Add update',exact:true}).click();
    assert((await page.locator('body').innerText()).includes('Checked during qualification'),'Board update appears');
   }
   if(name==='portfolio') {
    await page.getByRole('button',{name:'Ash',exact:true}).click();assert.equal(await page.getByRole('button',{name:/Moon Jar/}).count(),0);
    await page.getByRole('button',{name:'All',exact:true}).click();
    await page.getByRole('button',{name:/Moon Jar/}).click();await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0,'Escape closes work detail');
   }
   assert.deepEqual(errors,[]);results.push({name,width,validation:'passed',interactions:'passed',runtimeErrors:errors});await page.close();
  }
 } } finally {await browser.close();}
 fs.writeFileSync('docs/release-review/quality-interactions.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1});


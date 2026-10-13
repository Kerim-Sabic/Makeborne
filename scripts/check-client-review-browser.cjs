/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local browser fixture; no provider or account calls. */
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict");
const ts = require("typescript"), Module = require("node:module");
const load = Module._load;
Module._load = function(name, parent, main) { return name === "server-only" ? {} : load.call(this, name, parent, main); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { emptyDocument } = require("../src/lib/documents/editor.ts");
const { DocumentSourceSchema } = require("../src/lib/documents/schema.ts");
const { projectDocument } = require("../src/lib/documents/project.ts");
const { chromium } = require("playwright");
const out = path.resolve("work/client-review-browser"); fs.mkdirSync(out, { recursive: true });
const assetId = "11111111-1111-4111-8111-111111111111", token = "b".repeat(43);
const docs = {};
const deck = emptyDocument("deck", "The client presentation");
deck.slides = [{ id: "growth", layout: "chart", title: "Growth by quarter", notes: "Presenter notes are private.", chart: { type: "column", categories: ["Q1", "Q2"], series: [{ name: "Growth", values: [15, 30] }] } }, { id: "art", layout: "image", title: "Brand direction", image: "artwork", notes: "Presenter notes are private." }];
deck.assets = [{ id: assetId, name: "artwork", aspect: "landscape", alt: "A warm orange abstract field", prompt: "" }];
docs.deck = DocumentSourceSchema.parse(deck);
const book = emptyDocument("book", "The client book");
book.assets = deck.assets; book.cover.image = "artwork"; book.author = "A. Author";
book.chapters = [{ id: "opening", title: "A clear beginning", image: "artwork", text: "A **clear** opening paragraph.\n\n## What matters\n\nA thoughtful explanation with real visual hierarchy." }];
docs.book = DocumentSourceSchema.parse(book);
const reviews = Object.fromEntries(Object.entries(docs).map(([kind, doc]) => [kind, { status: "active", kind: kind === "deck" ? "presentation" : "book", title: doc.title, version: 4, pinned: true, mode: "content", html: null, content: { schemaVersion: 1, kind: kind === "deck" ? "presentation" : "book", title: doc.title, sections: projectDocument(doc), document: doc }, style: null, recipientName: "Client", message: "Review this saved version.", expiresAt: "2030-01-01T00:00:00Z", decision: null, comments: [] }]));
fs.writeFileSync(path.join(out,"entry.tsx"), `import React from 'react'; import {createRoot} from 'react-dom/client'; import ClientReviewPage from '../../src/components/client-review-page'; const reviews=${JSON.stringify(reviews)}; const kind=new URL(location.href).searchParams.get('kind')||'deck';createRoot(document.getElementById('root')!).render(<ClientReviewPage token=${JSON.stringify(token)} review={reviews[kind] as any}/>);`);
(async () => {
 await require("esbuild").build({ entryPoints: [path.join(out,"entry.tsx")], bundle: true, outfile: path.join(out,"bundle.js"), platform: "browser", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent" });
 const image = await require("sharp")({ create: { width: 800, height: 450, channels: 3, background: "#e38f55" } }).webp().toBuffer();
 const css=fs.readFileSync("src/app/client-review.css","utf8");
 const server=http.createServer((req,res)=>{ if(req.url==='/bundle.js'){res.setHeader('content-type','application/javascript');res.end(fs.readFileSync(path.join(out,'bundle.js')));}else{res.setHeader('content-type','text/html');res.end(`<html><head><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);} });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 let browser;
 try {
  browser=await chromium.launch({headless:true});
  for(const kind of ['deck','book']){
   const page=await browser.newPage({viewport:{width:1440,height:1100}});
   let release; const gate=new Promise(resolve=>{release=resolve;}); let requested=false;
   await page.route('**/api/review/**',async route=>{assert.ok(route.request().url().endsWith(`/assets/${assetId}?version=4`));requested=true;await gate;await route.fulfill({status:200,contentType:'image/webp',body:image});});
   await page.goto(`${base}/?kind=${kind}`);
   await page.getByText('Loading the saved document and artwork…').waitFor();
   assert.ok(await page.getByRole('button',{name:'Approve',exact:true}).isDisabled());
   release();
   await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Approve');return b&&!b.disabled;});
   assert.ok(requested);
   const frame=page.frames().find(frame=>frame.url()==='about:srcdoc');assert.ok(frame);
   assert.ok(await frame.locator('img').count()>0);
   assert.ok(await frame.locator('img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0)));
   assert.equal(await frame.locator('details,script').count(),0);
   const source=await page.locator('iframe').getAttribute('srcdoc');assert.ok(!source.includes('Presenter notes')&&!source.includes('Speaker notes'));
   if(kind==='deck'){assert.equal(await frame.locator('.slide').count(),2);assert.ok(await frame.locator('svg rect').count()>0);}
   else{assert.equal(await frame.locator('.cover-art').count(),1);assert.equal(await frame.locator('#chapter-opening').count(),1);assert.ok(await frame.locator('.chapter strong').count()>0);}
   await page.getByRole('button',{name:'Pin to a spot',exact:true}).click();
   await frame.locator(kind==='deck'?'.slide':'.cover').first().click({position:{x:100,y:100}});
   assert.ok(await page.getByRole('button',{name:'Remove pin',exact:true}).count()===1);
   await page.screenshot({path:path.join(out,`${kind}.png`),fullPage:true});
   console.log(`PASS browser ${kind}: real canonical layout, decoded artwork, notes absent, approval gate and pin placement`);
   await page.close();
  }
  const page=await browser.newPage();
  await page.route('**/api/review/**',route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:{message:'This review link was turned off.'}})}));
  await page.goto(base);
  await page.getByText('This review link was turned off.').waitFor();
  assert.ok(await page.getByRole('button',{name:'Approve',exact:true}).isDisabled());
  assert.equal(await page.locator('iframe').count(),0);
  console.log('PASS browser unavailable artwork blocks incomplete review and approval');
 } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

/* eslint-disable @typescript-eslint/no-require-imports -- standalone Node validation harness */
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const cache = {};
function load(file) {
  file = path.resolve(file);
  if (cache[file]) return cache[file].exports;
  const compiledModule = {exports: {}};
  cache[file] = compiledModule;
  const localRequire = id => {
    if (!id.startsWith('.') && !id.startsWith('@/')) return require(id);
    const base = id.startsWith('@/') ? path.resolve('src', id.slice(2)) : path.resolve(path.dirname(file), id);
    const resolved = [base, base + '.ts', base + '.js'].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!resolved) throw new Error(`Cannot resolve fixture module: ${id}`);
    return load(resolved);
  };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  new Function('require', 'module', 'exports', js)(localRequire, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const {cleanWebsite, websiteDocument} = load('src/lib/generation/website-document.ts');
const {WEBSITE_IMAGE_ASSETS, websiteAssetInstructions} = load('src/lib/generation/website-assets.ts');
const {renderHostedSite} = load('src/lib/hosting/render.ts');
assert.throws(() => renderHostedSite({schemaVersion: 1, kind: 'website', title: 'Source project', sections: [], websiteSource: {
  schemaVersion: 1, toolchainId: 'react-vite-v1', entrypoint: 'src/main.tsx', assets: [], routes: [{path: '/', title: 'Home'}],
  files: [{path: 'src/main.tsx', content: '// Source fixture'}, {path: 'index.html', content: '<div id="root"></div>'},
    {path: 'package.json', content: '{}'}, {path: 'package-lock.json', content: '{}'}],
}}, {}, 'https://fixture.example', new Map()), /verified isolated build/);
const {CUSTOMER_SITE_CSP} = load('infra/customer-sites/website-policy.js');
const design = {html: '<header><a href="#collection">Collection</a></header><main><h1>Good Dog</h1><section id="collection"><h2>Collars</h2><img src="' + WEBSITE_IMAGE_ASSETS[0].url + '" alt="Coastal dog" width="1440" height="960"></section></main>', css: 'body{background:#f7f5ee;color:#262b21;font-family:Arial,sans-serif}h1{font-size:48px}img{width:100%;height:auto}', description: 'Good Dog collection.', designNotes: 'Concept imagery.'};
assert.equal((cleanWebsite(design).html.match(/<img /g) || []).length, 1);
const bad = cleanWebsite({...design, html: design.html + '<img src="https://evil.example/test" onerror="alert(1)"><script>alert(1)</script><img src="' + WEBSITE_IMAGE_ASSETS[0].url + '?token=test"><img src="data:image/svg+xml,test">'});
assert(!bad.html.includes('evil.example'));
assert(!bad.html.includes('<script'));
assert(!bad.html.includes('onerror'));
assert(!bad.html.includes('token=test'));
assert(!bad.html.includes('data:image'));
assert.equal((bad.html.match(/<img /g) || []).length, 1);
assert.throws(() => cleanWebsite({...design, html: design.html + '<a href="#missing">Broken</a>'}));
const doc = websiteDocument('Good Dog', design);
assert(doc.includes("script-src 'none'"));
assert(doc.includes("connect-src 'none'"));
assert(doc.includes('img-src https://makeborne.com/generated/good-dog-v2/'));
assert(doc.includes('prefers-reduced-motion'));
assert(websiteDocument('Good Dog', design, true).includes('about:srcdoc#collection'));
assert(!websiteAssetInstructions('Make a dog accessories shop').startsWith('No approved'));
assert(websiteAssetInstructions('Make an architecture portfolio').startsWith('No approved'));

// The compatibility outline deliberately contradicts the generated website.
// Publishing must preserve the generated design, not rebuild the outline.
const content = {schemaVersion: 1, title: 'Good Dog', kind: 'website', website: design, sections: [{id: '10000000-0000-4000-8000-000000000001', title: 'OUTLINE ONLY', blocks: [{id: '10000000-0000-4000-8000-000000000002', type: 'paragraph', text: 'This summary must never replace the design.'}]}]};
const style = {id: 'editorial', name: 'Editorial', version: 1, typography: {headingFont: 'Georgia', bodyFont: 'Arial'}, colors: {accent: '#3358d4'}, description: ''};
const address = 'https://sites.makeborne.com/good-dog';
const published = renderHostedSite(content, style, address, new Map());
const body = value => value.slice(value.indexOf('<body>'));
const stylesheet = value => value.match(/<style>([\s\S]*?)<\/style>/)[1];
assert.equal(body(published), body(doc));
assert.equal(stylesheet(published), stylesheet(doc));
assert(!published.includes('OUTLINE ONLY'));
assert(published.includes(`<link rel="canonical" href="${address}">`));
assert(published.includes('property="og:description" content="Good Dog collection."'));
assert.equal(body(renderHostedSite({...content, sections: []}, style, address, new Map())), body(doc));
assert.throws(() => renderHostedSite({...content, website: {...design, html: '<div>' + 'invalid'.repeat(30) + '</div>'}}, style, address, new Map()), /main landmark/);
assert.throws(() => renderHostedSite({...content, kind: 'book'}, style, address, new Map()), /Only websites/);
for (const invalidUrl of ['javascript:alert(1)', 'http://sites.makeborne.com/good-dog', 'https://user:secret@sites.makeborne.com/good-dog', `${address}?tracking=1`, `${address}#fragment`]) {
  assert.throws(() => websiteDocument(content.title, design, false, invalidUrl));
}
assert(websiteDocument('<Acme & Co>', design, false, address).includes('<title>&lt;Acme &amp; Co&gt;</title>'));
assert(websiteDocument('Title', {...design, description: '"Unsafe" <description>'}, false, address).includes('content="&quot;Unsafe&quot; &lt;description&gt;"'));
const legacy = renderHostedSite({...content, website: undefined}, style, address, new Map());
assert(legacy.includes('OUTLINE ONLY'));
assert(legacy.includes('This summary must never replace the design.'));
assert(!legacy.includes('Coastal dog'));
for (const asset of WEBSITE_IMAGE_ASSETS) assert(CUSTOMER_SITE_CSP.includes(asset.url));
assert(CUSTOMER_SITE_CSP.includes("script-src 'none'"));
assert(CUSTOMER_SITE_CSP.includes("form-action 'none'"));
assert(CUSTOMER_SITE_CSP.includes("connect-src 'none'"));
assert(CUSTOMER_SITE_CSP.startsWith('sandbox;'));

async function checkDelivery() {
  const {default: worker} = load('infra/customer-sites/_worker.js');
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async (_url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(init.body), {p_slug: 'good-dog'});
    assert.equal(init.headers.apikey, 'sb_publishable_fixture');
    assert(!init.headers.cookie && !init.headers.Authorization);
    return new Response(JSON.stringify(published), {headers: {'Content-Type': 'application/json'}});
  };
  try {
    const response = await worker.fetch(new Request(address), {SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture'});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Security-Policy'), CUSTOMER_SITE_CSP);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(await response.text(), published);
    const head = await worker.fetch(new Request(address, {method: 'HEAD'}), {SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture'});
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('Content-Security-Policy'), CUSTOMER_SITE_CSP);
    const denied = await worker.fetch(new Request(address, {method: 'POST'}), {});
    assert.equal(denied.status, 405);
    const missing = await worker.fetch(new Request(address), {});
    assert.equal(missing.status, 503);
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
}

async function checkBrowser() {
  const http = require('node:http');
  const {chromium} = require('playwright');
  const errors = [];
  const sandboxDiagnostics = [];
  const encode = value => value.replace(/[&<"]/g, character => ({'&': '&amp;', '<': '&lt;', '"': '&quot;'}[character]));
  const server = http.createServer((request, response) => {
    if (request.url === '/preview') {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<html><head><style>body{margin:0}iframe{display:block;width:100%;height:1800px;border:0}</style></head><body><iframe sandbox="" srcdoc="${encode(websiteDocument(content.title, design, true))}"></iframe></body></html>`);
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.setHeader('Content-Security-Policy', CUSTOMER_SITE_CSP);
    response.end(published);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless: true});
    const context = await browser.newContext({reducedMotion: 'reduce'});
    await context.route('https://makeborne.com/generated/good-dog-v2/*', async route => {
      const asset = WEBSITE_IMAGE_ASSETS.find(item => item.url === route.request().url());
      assert(asset, 'Browser requested an unapproved image.');
      await route.fulfill({path: path.resolve('public', new URL(asset.url).pathname.slice(1)), contentType: 'image/webp'});
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      // Chromium blocks Playwright's instrumentation when fragment navigation
      // recreates an opaque sandbox context. Record it; never relax the CSP.
      // The fixture has no authored scripts, which is asserted below.
      if (/^Blocked script execution in '.+' because the document's frame is sandboxed and the 'allow-scripts' permission is not set\.$/.test(message.text())) {
        sandboxDiagnostics.push(message.text());
      } else errors.push(message.text());
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const evidence = path.resolve('docs/execution/evidence/M00-T01-R01');
    fs.mkdirSync(evidence, {recursive: true});
    const results = [];
    for (const width of [390, 1440]) {
      await page.setViewportSize({width, height: 1800});
      await page.goto(`${origin}/good-dog`, {waitUntil: 'networkidle'});
      assert.equal(await page.locator('h1').innerText(), 'Good Dog');
      assert.equal(await page.locator('script').count(), 0);
      assert(await page.locator('img').evaluate(image => image.complete && image.naturalWidth > 0), 'Published imagery must load under the HTTP CSP.');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Published page must not overflow horizontally.');
      assert.equal(await page.locator('a').first().getAttribute('href'), '#collection');
      const live = await page.locator('main').screenshot({path: path.join(evidence, `published-${width}.png`)});
      const liveLink = await page.locator('a').first().boundingBox();
      await Promise.all([
        page.waitForURL(/#collection$/),
        page.mouse.click(liveLink.x + liveLink.width / 2, liveLink.y + liveLink.height / 2),
      ]);
      assert.equal(new URL(page.url()).hash, '#collection');
      await page.goto(`${origin}/preview`, {waitUntil: 'networkidle'});
      const preview = page.frameLocator('iframe');
      assert.equal(await preview.locator('h1').innerText(), 'Good Dog');
      assert.equal(await preview.locator('script').count(), 0);
      assert(await preview.locator('img').evaluate(image => image.complete && image.naturalWidth > 0), 'Preview imagery must load.');
      const original = await preview.locator('main').screenshot({path: path.join(evidence, `preview-${width}.png`)});
      assert(live.equals(original), `Preview and publication pixels differ at ${width}px.`);
      const previewLink = await preview.locator('a').first().boundingBox();
      const previewFrame = page.frames().find(frame => frame.parentFrame());
      await Promise.all([
        previewFrame.waitForURL(/#collection$/),
        page.mouse.click(previewLink.x + previewLink.width / 2, previewLink.y + previewLink.height / 2),
      ]);
      assert.equal(new URL(previewFrame.url()).hash, '#collection');
      results.push({viewportWidth: width, mainPixelsIdentical: true, approvedImageLoaded: true, horizontalOverflow: false});
    }
    assert.deepEqual(errors, [], 'Rendering must not produce unexpected console, page or resource errors.');
    fs.writeFileSync(path.join(evidence, 'browser-results.json'), JSON.stringify({scope: 'Local fixture only; not a live Supabase/Cloudflare deployment test.', checkedAt: new Date().toISOString(), results, errors, sandboxDiagnostics, sandboxDiagnosticExplanation: 'Blocked automation instrumentation during anchor navigation; neither generated document contains script elements.'}, null, 2) + '\n');
    console.log('Browser checks passed: identical main-region pixels at 390px/1440px, approved imagery loads under hosting CSP, working anchors, no horizontal overflow or unexpected errors. Blocked sandbox instrumentation is recorded separately.');
  } finally {
    await browser?.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
if (process.argv.includes('--prepare-example')) {
  const example = cleanWebsite({...design, html: fs.readFileSync('../../outputs/good-dog-v2.html', 'utf8'), css: fs.readFileSync('../../outputs/good-dog-v2.css', 'utf8'), description: 'Good Dog collars and leads. A thoughtful collection for everyday adventures.', designNotes: 'Photography-led coastal art direction with cream, forest and terracotta. AI-generated concept imagery; prices, ordering and contact are not connected.'});
  assert.equal((example.html.match(/<img /g) || []).length, 3);
  fs.writeFileSync('../../outputs/good-dog-v2.json', JSON.stringify(example, null, 2));
  fs.writeFileSync('../../outputs/good-dog-v2-preview.html', websiteDocument('Good Dog', example));
}
checkDelivery().then(async () => {
  if (process.argv.includes('--browser')) await checkBrowser();
  console.log('Website checks passed: preview/download/publication design fidelity, canonical metadata, legacy compatibility, rejected malformed designs, approved image policy, Cloudflare GET/HEAD delivery, blocked resources/scripts, anchors and reduced motion.');
}).catch(error => {console.error(error); process.exitCode = 1;});

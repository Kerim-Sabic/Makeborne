const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const cache = {};
function load(file) {
  file = path.resolve(file);
  if (cache[file]) return cache[file].exports;
  const module = {exports: {}};
  cache[file] = module;
  const localRequire = id => id.startsWith('.') ? load(path.resolve(path.dirname(file), id + '.ts')) : require(id);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  new Function('require', 'module', 'exports', js)(localRequire, module, module.exports);
  return module.exports;
}
const {cleanWebsite, websiteDocument} = load('src/lib/generation/website-document.ts');
const {WEBSITE_IMAGE_ASSETS, websiteAssetInstructions} = load('src/lib/generation/website-assets.ts');
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
if (process.argv.includes('--prepare-example')) {
  const example = cleanWebsite({...design, html: fs.readFileSync('../../outputs/good-dog-v2.html', 'utf8'), css: fs.readFileSync('../../outputs/good-dog-v2.css', 'utf8'), description: 'Good Dog collars and leads. A thoughtful collection for everyday adventures.', designNotes: 'Photography-led coastal art direction with cream, forest and terracotta. AI-generated concept imagery; prices, ordering and contact are not connected.'});
  assert.equal((example.html.match(/<img /g) || []).length, 3);
  fs.writeFileSync('../../outputs/good-dog-v2.json', JSON.stringify(example, null, 2));
  fs.writeFileSync('../../outputs/good-dog-v2-preview.html', websiteDocument('Good Dog', example));
}
console.log('Website checks passed: approved imagery, blocked arbitrary resources/scripts, valid anchors, isolated preview and reduced motion.');

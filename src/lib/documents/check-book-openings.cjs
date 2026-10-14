/* eslint-disable @typescript-eslint/no-require-imports -- Offline book opening regression checks. */
const fs = require('node:fs'), assert = require('node:assert/strict'), Module = require('node:module'), ts = require('typescript');
const load = Module._load;
Module._load = function(name, parent, main) { return name === 'server-only' ? {} : load.call(this, name, parent, main); };
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true}}).outputText, file);
const {ChapterSchema} = require('./schema.ts');
const {DocumentEditor, emptyDocument, DocToolInputs} = require('./editor.ts');
const {bookHtml} = require('./render-book.ts');
const {BOOK_SYSTEM} = require('../builder/docs-prompt.ts');
let count = 0;
const check = (name, fn) => {fn(); count++; console.log(`PASS ${name}`);};
const base = {id:'chapter-one', title:'An opening', text:'A useful first paragraph.'};
check('old chapter remains valid without adding a new stored default', () => assert.deepEqual(ChapterSchema.parse(base), base));
check('both explicit opening modes accepted; unknown values rejected', () => {
  for (const opening of ['page','inline']) assert.equal(ChapterSchema.parse({...base, opening}).opening, opening);
  assert.equal(ChapterSchema.safeParse({...base, opening:'compact'}).success, false);
});
const make = chapter => {const editor = new DocumentEditor(emptyDocument('book','Book')); editor.apply('write_chapter', {chapter}); return editor;};
check('no-label legacy page opener still has numeral; explicit page matches omission', () => {
  const old = bookHtml(make(base).doc, {});
  assert.match(old, /class="numeral">1<\/div>/);
  assert.equal(old, bookHtml(make({...base, opening:'page'}).doc, {}));
});
check('arbitrary and multilingual supplied labels suppress competing numerals', () => {
  for (const label of ['Chapter One','Introduction','部 二','١','']) {
    const html = bookHtml(make({...base, label}).doc, {});
    assert.doesNotMatch(html, /class="numeral"/);
    assert.match(html, /class="full opener custom-label"/);
  }
});
check('inline shares heading and body section, retaining image and epigraph', () => {
  const html = bookHtml(make({...base, opening:'inline', image:'scene', epigraph:{text:'A thought',attribution:'Author'}}).doc, {scene:'data:image/png;base64,AA=='});
  assert.doesNotMatch(html, /class="full opener/);
  assert.match(html, /<section class="chapter" id="chapter-chapter-one"[^>]*>[\s\S]*<header class="inline-opener">[\s\S]*alt=""[\s\S]*A thought[\s\S]*<\/header><p>A useful first paragraph\.<\/p><\/section>/);
});
check('tool schema accepts opening and exact text edit preserves it', () => {
  const input = DocToolInputs.write_chapter.parse({chapter:{...base, opening:'inline'}});
  const editor = make(input.chapter);
  editor.apply('edit_chapter', {id:base.id, old_string:'useful', new_string:'practical'});
  assert.equal(editor.doc.chapters[0].opening, 'inline');
  assert.match(BOOK_SYSTEM, /opening:"inline"/);
});
check('all contents links target exactly one stable chapter anchor in both modes', () => {
  const editor=make({...base, opening:'inline'});
  editor.apply('write_chapter', {chapter:{...base,id:'another',label:'Part Two'}});
  for (const mode of ['preview','print']) {
    const html=bookHtml(editor.doc,{},mode);
    for (const id of ['chapter-one','another']) {
      assert.equal(html.split(`href="#chapter-${id}"`).length-1,1);
      assert.equal(html.split(`id="chapter-${id}"`).length-1,1);
    }
  }
});
console.log(`\n${count}/${count} book opening groups passed.`);

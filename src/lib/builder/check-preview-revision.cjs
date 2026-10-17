/* eslint-disable @typescript-eslint/no-require-imports -- Exact preview invalidation regression. */
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const ctx={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('./preview-revision.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,ctx);
const revision=ctx.exports.previewFileRevision;
const tail='x'.repeat(100),before={'src/App.tsx':`headline=dog;${tail}`,'src/style.css':'body{color:red}'};
const after={...before,'src/App.tsx':`headline=cat;${tail}`};
assert.equal(before['src/App.tsx'].length,after['src/App.tsx'].length);
assert.equal(before['src/App.tsx'].slice(-64),after['src/App.tsx'].slice(-64));
assert.notEqual(revision(before),revision(after),'Same-length middle edit must invalidate preview');
assert.equal(revision(before),revision({'src/style.css':before['src/style.css'],'src/App.tsx':before['src/App.tsx']}));
assert.notEqual(revision(before),revision({...before,'src/style.css':'body{color:tan}'}));
assert.notEqual(revision(before),revision({'src/App.tsx':before['src/App.tsx']}));
assert.notEqual(revision({'a':'🌕'}),revision({'a':'🌑'}));
assert.notEqual(revision({'a':'same'}),revision({'b':'same'}));
const component=fs.readFileSync(require.resolve('../../components/live-preview.tsx'),'utf8');
assert.match(component,/useMemo\(\(\) => previewFileRevision\(files\), \[files\]\)/);
assert.match(component,/\[fileKey, images, building, reloadKey, inspecting\]/,'rebuilds on full content, and when click-to-edit switches the tagged build on or off');
console.log('PASS: full-content preview invalidation, equal-length middle/style edits, Unicode, rename/removal and stable path ordering');

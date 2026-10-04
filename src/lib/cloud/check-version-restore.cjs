/* eslint-disable @typescript-eslint/no-require-imports -- Offline version integrity checks. */
const fs = require('node:fs'), ts = require('typescript'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { prepareVersionRestore } = require('./version-restore.ts');
const artifactId = randomUUID();
const content = { schemaVersion: 1, title: 'Fixture', kind: 'book', sections: [{ id: randomUUID(), title: 'Chapter', blocks: [{ id: randomUUID(), type: 'paragraph', text: 'Original', locked: false, sourceIds: [randomUUID()], assetId: null }] }] };
const style = { id: 'mint', name: 'Mint', version: 1, description: 'Fixture', typography: { headingFont: 'Inter', bodyFont: 'Inter' }, colors: { accent: '#90EDAA', canvas: '#122822', ink: '#FFFFFF' }, referenceAssetIds: [] };
const version = { id: randomUUID(), artifactId, number: 1, parentVersionId: null, content, style, assetIds: [randomUUID()], createdAt: new Date().toISOString(), createdBy: randomUUID(), changeSummary: 'Initial' };
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
const restored = prepareVersionRestore(content, version, artifactId, 3);
check('exact content and sources restored', () => assert.deepEqual(restored.content, content));
check('style restored', () => assert.deepEqual(restored.style, style));
check('asset references restored', () => assert.deepEqual(restored.assetIds, version.assetIds));
check('clear provenance note', () => assert.equal(restored.changeSummary, 'Restored from version 1'));
check('clone does not mutate saved snapshot', () => { restored.content.title = 'Changed'; assert.equal(version.content.title, 'Fixture'); });
check('different artifact rejected', () => assert.throws(() => prepareVersionRestore(content, version, randomUUID(), 3), /different/));
check('different format rejected', () => assert.throws(() => prepareVersionRestore({ ...content, kind: 'website' }, version, artifactId, 3), /different/));
check('current version rejected', () => assert.throws(() => prepareVersionRestore(content, version, artifactId, 1), /earlier/));
check('future version rejected', () => assert.throws(() => prepareVersionRestore(content, { ...version, number: 4 }, artifactId, 3), /earlier/));
const locked = structuredClone(content); locked.sections[0].blocks[0].locked = true;
check('restore cannot unlock block', () => assert.throws(() => prepareVersionRestore(locked, version, artifactId, 3), /locked/));
check('unchanged locked block accepted', () => assert.deepEqual(prepareVersionRestore(locked, { ...version, content: locked }, artifactId, 3).content, locked));
const changed = structuredClone(locked); changed.sections[0].blocks[0].text = 'Changed';
check('locked text alteration rejected', () => assert.throws(() => prepareVersionRestore(locked, { ...version, content: changed }, artifactId, 3), /locked/));
check('malformed snapshot rejected', () => assert.throws(() => prepareVersionRestore(content, { ...version, assetIds: ['invalid'] }, artifactId, 3)));
console.log(`${count} version restore checks passed.`);

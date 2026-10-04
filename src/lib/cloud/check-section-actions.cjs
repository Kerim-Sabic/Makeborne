/* eslint-disable @typescript-eslint/no-require-imports -- Offline structural checks. */
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {appendAccountSection,appendAccountBlock}=require('./section-actions.ts');
const first=randomUUID(), second=randomUUID(), block=randomUUID();
const original={schemaVersion:1,title:'Fixture',kind:'book',sections:[{id:first,title:'Original',blocks:[{id:block,type:'paragraph',text:'Locked text',locked:true,sourceIds:[randomUUID()],assetId:null}]}]};
let count=0;function check(name,fn){fn();count++;console.log(`PASS ${name}`);}
const extended=appendAccountSection(original,second,'New chapter');
check('new section appended',()=>assert.equal(extended.sections[1].id,second));
check('original content retained',()=>assert.deepEqual(extended.sections[0],original.sections[0]));
check('input not mutated',()=>assert.equal(original.sections.length,1));
const withBlock=appendAccountBlock(extended,second,randomUUID(),'quote');
check('block added only to requested section',()=>{assert.equal(withBlock.sections[1].blocks.length,1);assert.deepEqual(withBlock.sections[0],original.sections[0]);});
check('new block has no invented provenance',()=>assert.deepEqual(withBlock.sections[1].blocks[0].sourceIds,[]));
check('missing section rejected',()=>assert.throws(()=>appendAccountBlock(original,second,randomUUID(),'paragraph'),/no longer/));
check('duplicate section ID rejected',()=>assert.throws(()=>appendAccountSection(original,first,'Duplicate')));
check('block section ID collision rejected',()=>assert.throws(()=>appendAccountBlock(original,first,first,'paragraph')));
check('duplicate block ID rejected',()=>assert.throws(()=>appendAccountBlock(original,first,block,'paragraph')));
check('invalid block type rejected',()=>assert.throws(()=>appendAccountBlock(original,first,randomUUID(),'image')));
check('section title length bounded',()=>assert.throws(()=>appendAccountSection(original,second,'x'.repeat(201))));
check('empty document accepts first section',()=>assert.equal(appendAccountSection({...original,sections:[]},second,'First').sections.length,1));
console.log(`${count} section checks passed.`);

/* eslint-disable @typescript-eslint/no-require-imports -- Offline calendar checks. */
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename);
const {followUpBucket,followUpLabel,localCalendarDay}=require('./client-followups.ts');
const today='2026-10-04';
let count=0;function check(name,fn){fn();count++;console.log(`PASS ${name}`);}
check('missing outreach unscheduled',()=>assert.equal(followUpBucket(undefined,today),'unscheduled'));
check('missing date unscheduled',()=>assert.equal(followUpBucket({stage:'Lead',nextFollowUp:null},today),'unscheduled'));
check('past date overdue',()=>assert.equal(followUpBucket({stage:'Contacted',nextFollowUp:'2026-10-03'},today),'overdue'));
check('same day due',()=>assert.equal(followUpBucket({stage:'Replied',nextFollowUp:today},today),'today'));
check('future date upcoming',()=>assert.equal(followUpBucket({stage:'Meeting',nextFollowUp:'2026-10-05'},today),'upcoming'));
for(const stage of ['Won','Lost'])check(`${stage} excluded from active queues`,()=>assert.equal(followUpBucket({stage,nextFollowUp:'2020-01-01'},today),'closed'));
check('year boundary correct',()=>assert.equal(followUpBucket({stage:'Lead',nextFollowUp:'2025-12-31'},'2026-01-01'),'overdue'));
check('local calendar pads components',()=>assert.equal(localCalendarDay(new Date(2026,0,2,23,59)),'2026-01-02'));
check('due label human readable',()=>assert.equal(followUpLabel({stage:'Lead',nextFollowUp:today},today),'Due today'));
check('overdue label retains date',()=>assert.equal(followUpLabel({stage:'Lead',nextFollowUp:'2026-10-03'},today),'Overdue · 2026-10-03'));
console.log(`${count} calendar checks passed.`);

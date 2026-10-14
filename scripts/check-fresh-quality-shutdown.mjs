// No database, package startup, provider call, or real process termination.
import assert from 'node:assert/strict';
import {stopFreshQualityProcessTree} from './fresh-quality-server.mjs';
const clear={processIds:[],listening:false,rootIdentityMatches:false};
const active={processIds:[1234,1235],listening:true,rootIdentityMatches:true};
let groups=0;
function check({before=active,after=clear,exited=false,killStatus=0,expected=true,kills=1,probeError=false}={}){
 const calls=[],states=[before,after];
 const run=(file,args,options)=>{
  calls.push({file,args,options});
  if(file.endsWith('taskkill.exe'))return {status:killStatus};
  assert.equal(options.timeout,5000);assert.equal(options.windowsHide,true);
  const script=Buffer.from(args.at(-1),'base64').toString('utf16le');
  assert(script.includes('Get-NetTCPConnection -State Listen -ErrorAction Stop'));
  assert(script.includes('CreationDate'));assert(script.includes('ParentProcessId'));
  const state=states.shift();return probeError?{status:1}:{status:0,stdout:JSON.stringify(state)};
 };
 const result=stopFreshQualityProcessTree({pid:1234,exitCode:exited?0:null,signalCode:null},{platform:'win32',run,startedAt:1700000000000});
 assert.equal(result,expected);assert.equal(calls.filter(c=>c.file.endsWith('taskkill.exe')).length,kills);
 const kill=calls.find(c=>c.file.endsWith('taskkill.exe'));if(kill)assert.deepEqual(kill.args,['/PID','1234','/T','/F']);
 groups++;
}
check(); // Verified tree termination.
check({killStatus:128}); // Child exits between snapshot and taskkill; readback is decisive.
check({before:clear,exited:true,kills:0}); // Already exited: no PID reuse risk.
check({before:clear,kills:0}); // Process exits before Node delivers its exit event.
check({after:{...clear,processIds:[1235]},expected:false}); // Surviving descendant.
check({after:{...clear,listening:true},expected:false}); // Live listener even without matched process.
check({killStatus:1,after:active,expected:false}); // Actual failed stop.
check({before:{...active,rootIdentityMatches:false},after:active,expected:false,kills:0}); // Reused/unknown PID must not be killed.
check({before:active,after:active,exited:true,expected:false,kills:0}); // Exit observed: never kill by old PID.
check({before:null,after:clear,expected:false,kills:0}); // Initial discovery unknown.
check({after:{processIds:'bad',listening:false},expected:false}); // Malformed final readback.
check({probeError:true,expected:false,kills:0}); // Failed discovery never becomes success.
assert.equal(stopFreshQualityProcessTree(undefined),null);groups++;
console.log(JSON.stringify({passed:groups,processesStarted:0,processesKilled:0,dbWrites:0,providerCalls:0}));

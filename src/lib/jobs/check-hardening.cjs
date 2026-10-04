/* eslint-disable @typescript-eslint/no-require-imports -- Offline transition fixtures; no service calls. */
const fs = require("node:fs"), ts = require("typescript"), assert = require("node:assert/strict");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const c = require("./contracts.ts"), m = require("./machine.ts");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const now = "2026-10-04T12:00:00.000Z", expiry = "2026-10-04T12:30:00.000Z";
const scope = { workspaceId: id(1), projectId: id(2), artifactId: null };
const authority = { workspaceAuthorized:true, sourceProcessingAllowed:true, routeAllowed:true, spendingAuthorized:true };
const quote = { id:id(4),scope,version:1,inputHash:"a".repeat(64),baseVersionId:null,routeVersion:"fixture-v1",provider:"offline",model:"offline",maximumVendorMicrousd:"100",customerCredits:"3",repairPolicy:"included_within_bound",approvedBy:id(5),approvedAt:now,expiresAt:expiry };
const account = { workspaceId:id(1),revision:0,spendingEnabled:true,emergencyStop:false,vendorLimitMicrousd:"1000",vendorSpentMicrousd:"0",vendorReservedMicrousd:"0",customerLimitCredits:"30",customerSpentCredits:"0",customerReservedCredits:"0",activeJobs:0,concurrencyLimit:2 };
function prepared() {
  const job = m.createJob({ id:id(3),scope,kind:"book",idempotencyKey:"offline-hardening",inputHash:quote.inputHash,baseVersionId:null,routeVersion:quote.routeVersion,deadlineAt:expiry,maxAttempts:3,createdAt:now,updatedAt:now });
  const reserved = m.reserveJob(m.approveQuote(job,quote,now),account,id(6),authority,now);
  const leased = m.acquireLease(m.enqueueJob(reserved.execution,now),id(7),now,expiry);
  return { account:reserved.account,execution:m.prepareAttempt(leased,id(8),"b".repeat(64),"30",id(7),leased.job.fence,authority,now) };
}
function success() {
  const p=prepared();
  const dispatch=m.markDispatchIntent(p.execution,id(8),p.account,id(7),p.execution.job.fence,authority,now);
  return { account:p.account,execution:m.confirmAttemptOutcome(dispatch.execution,id(8),{succeeded:true,providerRequestId:"OFFLINE",actualVendorMicrousd:"20",evidenceId:id(9),ledgerId:id(10),assetIds:[id(11)],failureClass:null},now) };
}
let checks=0;
function check(name,fn){fn();checks++;console.log("PASS "+name);}
for (const value of ["abc","1.5","-1","01","","9".repeat(10000),"9223372036854775808"]) check("malformed exact amount fails safely: "+value.slice(0,25),()=>assert.equal(c.ExactAmountSchema.safeParse(value).success,false));
check("maximum database integer stays exact",()=>assert.equal(c.ExactAmountSchema.parse("9223372036854775807"),"9223372036854775807"));
for (const patch of [{vendorReservedMicrousd:"0"},{customerReservedCredits:"0"},{activeJobs:0}]) check("dispatch needs all held counters "+JSON.stringify(patch),()=>{
  const p=prepared();assert.throws(()=>m.markDispatchIntent(p.execution,id(8),{...p.account,...patch},id(7),p.execution.job.fence,authority,now),/reservation/);
});
for (const patch of [{vendorLimitMicrousd:"99"},{customerLimitCredits:"2"}]) check("lowered budget stops dispatch "+JSON.stringify(patch),()=>{
  const p=prepared();assert.throws(()=>m.markDispatchIntent(p.execution,id(8),{...p.account,...patch},id(7),p.execution.job.fence,authority,now),/ceilings/);
});
check("released reservation cannot dispatch",()=>{const p=prepared();p.execution.reservation.status="released";assert.throws(()=>m.markDispatchIntent(p.execution,id(8),p.account,id(7),p.execution.job.fence,authority,now),/reservation/);});
for (const [field,value] of [["inputHash","c".repeat(64)],["routeVersion","different"],["baseVersionId",id(30)]]) check("stored quote binding protects "+field,()=>{
  const p=prepared();p.execution.job[field]=value;assert.equal(c.ExecutionSchema.safeParse(p.execution).success,false);
});
for (const [field,value] of [["provider","different"],["model","different"],["inputHash","d".repeat(64)]]) check("attempt binding protects "+field,()=>{
  const p=prepared();p.execution.attempts[0][field]=value;assert.equal(c.ExecutionSchema.safeParse(p.execution).success,false);
});
check("successful settlement records charge once",()=>{
  const p=success(),s=m.settleExecution(p.execution,p.account,true,[id(11)],id(12),id(13),now);
  assert.equal(s.account.customerSpentCredits,"3");
  assert.equal(s.account.vendorSpentMicrousd,"20");
  const replay=m.settleExecution(s.execution,s.account,true,[id(11)],id(12),id(13),now);
  assert.equal(replay.changed,false);assert.deepEqual(replay.account,s.account);
});
check("settled replay still checks workspace",()=>{
  const p=success(),s=m.settleExecution(p.execution,p.account,true,[id(11)],id(12),id(13),now);
  assert.throws(()=>m.settleExecution(s.execution,{...s.account,workspaceId:id(99)},true,[id(11)],id(12),id(13),now),/another workspace/);
});
for(const [accepted,assets,evidence,ledger] of [[false,[],id(12),id(13)],[true,[],id(12),id(13)],[true,[id(11)],id(98),id(13)],[true,[id(11)],id(12),id(98)]]) check("changed settlement replay rejected "+[accepted,assets.length,evidence,ledger].join("/"),()=>{
  const p=success(),s=m.settleExecution(p.execution,p.account,true,[id(11)],id(12),id(13),now);
  assert.throws(()=>m.settleExecution(s.execution,s.account,accepted,assets,evidence,ledger,now),/replay/);
});
check("duplicate accepted assets rejected",()=>{const p=success();assert.throws(()=>m.settleExecution(p.execution,p.account,true,[id(11),id(11)],id(12),id(13),now),/unique/);});
check("rejected work cannot claim acceptance manifest",()=>{const p=success();assert.throws(()=>m.settleExecution(p.execution,p.account,false,[id(11)],id(12),id(13),now),/Rejected/);});
check("queued later stages cannot be prematurely accepted",()=>{const p=success(),next=m.continueAfterReview(p.execution,[id(11)],"next-stage",now);assert.throws(()=>m.settleExecution(next,p.account,true,[id(11)],id(12),id(13),now),/review/);});
console.log(`${checks} offline orchestration hardening checks passed; zero provider requests.`);

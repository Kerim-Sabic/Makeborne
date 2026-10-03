/** Run only against authorised disposable development workspaces; never logs tokens. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const ownerA = process.env.MAKEBORNE_VERIFY_OWNER_A_TOKEN;
const ownerB = process.env.MAKEBORNE_VERIFY_OWNER_B_TOKEN;
const reviewerA = process.env.MAKEBORNE_VERIFY_REVIEWER_A_TOKEN;
const workspaceA = process.env.MAKEBORNE_VERIFY_WORKSPACE_A;
const workspaceB = process.env.MAKEBORNE_VERIFY_WORKSPACE_B;
const projectA = process.env.MAKEBORNE_VERIFY_PROJECT_A;
const mutate = process.env.MAKEBORNE_VERIFY_DISPOSABLE_MUTATIONS === "true";
if (![url,key,ownerA,ownerB,reviewerA,workspaceA,workspaceB,projectA].every(Boolean)) {
  console.log("NOT RUN: provide isolated workspace IDs and owner/reviewer session tokens through environment configuration.");
  process.exit(2);
}
let failures = 0;
async function call(path, token, method="GET", body) {
  const response = await fetch(new URL(path,url), { method, redirect:"error", signal:AbortSignal.timeout(15000), headers: { apikey:key, ...(token ? { Authorization:`Bearer ${token}` }:{}), "Content-Type":"application/json", Prefer:"return=representation" }, ...(body===undefined ? {} : {body:JSON.stringify(body)}) });
  const text = await response.text();
  let data; try { data=JSON.parse(text); } catch { data=null; }
  return {ok:response.ok,status:response.status,data};
}
function check(name,condition) { console.log(`${condition ? "PASS" : "FAIL"}: ${name}`); if (!condition) failures++; }
for (const [name,token] of [["owner A",ownerA],["owner B",ownerB],["reviewer A",reviewerA]]) {
  const result=await call("/auth/v1/user",token);
  check(`${name} session verified`,result.ok && typeof result.data?.id==="string");
}
const schema=await call("/rest/v1/rpc/makeborne_cloud_schema_version",ownerA,"POST",{});
check("schema version matches",schema.ok && schema.data==="20261003_cloud_v2");
const positiveA=await call(`/rest/v1/workspaces?id=eq.${workspaceA}&select=id`,ownerA);
const positiveB=await call(`/rest/v1/workspaces?id=eq.${workspaceB}&select=id`,ownerB);
const positiveReviewer=await call(`/rest/v1/workspaces?id=eq.${workspaceA}&select=id`,reviewerA);
check("owner A can read own workspace",positiveA.ok && positiveA.data?.length===1);
check("owner B can read own workspace",positiveB.ok && positiveB.data?.length===1);
check("reviewer A can read assigned workspace",positiveReviewer.ok && positiveReviewer.data?.length===1);
const cross=await call(`/rest/v1/workspaces?id=eq.${workspaceB}&select=id`,ownerA);
check("owner A cannot read workspace B",cross.ok && Array.isArray(cross.data) && cross.data.length===0);
const anonymous=await call("/rest/v1/clients?select=id&limit=1",null);
check("anonymous private records denied",[401,403].includes(anonymous.status));
if (failures) { console.log("STOP: positive controls failed; mutation checks not run."); process.exit(1); }
if (!mutate) { console.log("SKIPPED: mutation, concurrent revision and storage overwrite checks. Set disposable-mutations flag only for authorised temporary fixtures."); process.exit(2); }

const project=await call(`/rest/v1/projects?id=eq.${projectA}&workspace_id=eq.${workspaceA}&select=id,kind`,ownerA);
check("project fixture belongs to workspace A",project.ok && project.data?.length===1);
if (failures) process.exit(1);
const deniedOwnerChange=await call(`/rest/v1/workspaces?id=eq.${workspaceA}`,ownerA,"PATCH",{owner_id:crypto.randomUUID()});
check("owner identity direct mutation denied",[401,403].includes(deniedOwnerChange.status));
const deniedReviewer=await call("/rest/v1/clients",reviewerA,"POST",{workspace_id:workspaceA,name:"Should not be created"});
check("reviewer client creation denied",[401,403].includes(deniedReviewer.status));
const crossWrite=await call("/rest/v1/clients",ownerA,"POST",{workspace_id:workspaceB,name:"Should not be created"});
check("cross-workspace client creation denied",[401,403].includes(crossWrite.status));
const creationKey=crypto.randomUUID();
const artifactCreate={p_workspace_id:workspaceA,p_request_key:creationKey,p_operation:"create_artifact",p_payload:{project_id:projectA,kind:project.data[0].kind,title:"Disposable isolation verification"}};
const creations=await Promise.all([call("/rest/v1/rpc/makeborne_create_record",ownerA,"POST",artifactCreate),call("/rest/v1/rpc/makeborne_create_record",ownerA,"POST",artifactCreate)]);
check("concurrent artifact creation replays one record",creations.every(result=>result.ok) && creations[0].data?.record?.id===creations[1].data?.record?.id && creations.some(result=>result.data?.replayed===true));
if (failures) process.exit(1);
const artifact=creations[0].data.record;
const changedCreate=await call("/rest/v1/rpc/makeborne_create_record",ownerA,"POST",{...artifactCreate,p_payload:{...artifactCreate.p_payload,title:"Different content"}});
check("same creation key with changed payload rejected",!changedCreate.ok && changedCreate.data?.code==="MB409");
const versionRequest={ p_workspace_id:workspaceA,p_artifact_id:artifact.id,p_expected_version:0,
  p_content:{schemaVersion:1,title:"Disposable isolation verification",kind:artifact.kind,sections:[]},
  p_style:{id:"editorial",name:"Editorial",version:1,typography:{headingFont:"Inter",bodyFont:"Inter"},colors:{ink:"#16181D"},description:"Isolated verification",referenceAssetIds:[]},
  p_asset_ids:[],p_change_summary:"Concurrent save verification" };
const versionRequests=[{...versionRequest,p_request_key:crypto.randomUUID()},{...versionRequest,p_request_key:crypto.randomUUID()}];
const concurrent=await Promise.all(versionRequests.map(body=>call("/rest/v1/rpc/makeborne_save_artifact_version",ownerA,"POST",body)));
check("exactly one concurrent revision accepted",concurrent.filter(result=>result.ok).length===1 && concurrent.some(result=>!result.ok && result.data?.code==="40001"));
const acceptedIndex=concurrent.findIndex(result=>result.ok);
if (acceptedIndex>=0) {
  const replay=await call("/rest/v1/rpc/makeborne_save_artifact_version",ownerA,"POST",versionRequests[acceptedIndex]);
  check("committed version replays after simulated lost response",replay.ok && replay.data?.replayed===true && replay.data?.version?.id===concurrent[acceptedIndex].data?.version?.id);
}
const versions=await call(`/rest/v1/artifact_versions?artifact_id=eq.${artifact.id}&select=id,version_number`,ownerA);
check("one coherent snapshot persisted",versions.ok && versions.data?.length===1 && versions.data[0].version_number===1);
const deniedPointer=await call(`/rest/v1/artifacts?id=eq.${artifact.id}`,ownerA,"PATCH",{current_version:99});
check("direct revision pointer changes denied",[401,403].includes(deniedPointer.status));
const deniedSnapshot=await call(`/rest/v1/artifact_versions?artifact_id=eq.${artifact.id}`,ownerA,"PATCH",{change_summary:"Should not change"});
check("snapshot updates denied",[401,403].includes(deniedSnapshot.status));
for (const [name,token] of [["reviewer",reviewerA],["other owner",ownerB]]) {
  const result=await call("/rest/v1/rpc/makeborne_save_artifact_version",token,"POST",{...versionRequest,p_expected_version:1,p_request_key:crypto.randomUUID()});
  check(`${name} snapshot save denied`,!result.ok && result.data?.code==="42501");
}
const removed=await call(`/rest/v1/projects?id=eq.${projectA}`,ownerA,"DELETE");
check("parent deletion cannot remove snapshots",[401,403].includes(removed.status));
const freshOwner=process.env.MAKEBORNE_VERIFY_FRESH_OWNER_TOKEN;
let skippedWorkspace=false;
if (freshOwner) {
  const createWorkspace={p_request_key:crypto.randomUUID(),p_name:"Disposable setup verification"};
  const results=await Promise.all([call("/rest/v1/rpc/makeborne_create_workspace",freshOwner,"POST",createWorkspace),call("/rest/v1/rpc/makeborne_create_workspace",freshOwner,"POST",createWorkspace)]);
  check("fresh account setup returns exactly one private workspace",results.every(result=>result.ok) && results[0].data?.workspace?.id===results[1].data?.workspace?.id && results.some(result=>result.data?.replayed===true));
  const duplicate=await call("/rest/v1/rpc/makeborne_create_workspace",freshOwner,"POST",{...createWorkspace,p_request_key:crypto.randomUUID()});
  check("another setup key cannot create a second private workspace",!duplicate.ok && duplicate.data?.code==="MB412");
} else { skippedWorkspace=true; console.log("SKIPPED: workspace setup race requires MAKEBORNE_VERIFY_FRESH_OWNER_TOKEN for an authorised account without an existing workspace."); }
console.log("Storage upload/overwrite, membership revocation, cross-project assets, browser API and restoration checks still require the documented activation matrix. This script is not full production acceptance.");
console.log(`RESULT: ${failures ? "FAILED" : "EXECUTED CHECKS PASSED"}. Disposable artifact remains for inspection; use approved privileged retention for cleanup.`);
process.exit(failures ? 1 : skippedWorkspace ? 2 : 0);

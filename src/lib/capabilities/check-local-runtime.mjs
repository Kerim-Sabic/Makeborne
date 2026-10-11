/** Own one bounded local production server; never stop an existing process. */
import {spawn} from "node:child_process";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

if (process.env.MAKEBORNE_VERIFY_LOCAL_HTTP !== "true") {
  console.log("NOT RUN: enable MAKEBORNE_VERIFY_LOCAL_HTTP for the local production verification server."); process.exit(2);
}
const root = process.cwd(), origin = "http://localhost:3036";
const evidence = path.resolve(process.argv[2] ?? "docs/execution/evidence/M03-T03-R01");
assert(evidence.startsWith(`${path.join(root,"docs","execution","evidence")}${path.sep}`));
let server, verifier, timer, output = "", errors = "", expired = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill();
  await Promise.race([exited,pause(1500)]);
  if (child.exitCode===null && child.signalCode===null) {
    child.kill("SIGKILL"); await Promise.race([exited,pause(1500)]);
  }
  assert(child.exitCode!==null || child.signalCode!==null,"Owned process cleanup unconfirmed");
}
try {
  let occupied = false;
  try {await fetch(`${origin}/api/capabilities`, {signal:AbortSignal.timeout(500)}); occupied=true;} catch {}
  assert(!occupied, "Verification port is occupied; do not reuse or stop an unowned server");
  await mkdir(evidence, {recursive:true});
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3036"], {cwd:root, stdio:["ignore","pipe","pipe"], windowsHide:true});
  server.stdout.on("data", chunk => {output += chunk;}); server.stderr.on("data", chunk => {errors += chunk;});
  server.on("error", () => {});
  timer = setTimeout(() => {expired=true; verifier?.kill(); server.kill();}, 60_000);
  let ready = false;
  for (let attempt=0; attempt<80; attempt++) {
    assert.equal(server.exitCode,null,"Owned server stopped before readiness");
    try {if ((await fetch(`${origin}/api/capabilities`, {signal:AbortSignal.timeout(500)})).ok) {ready=true; break;}} catch {}
    await pause(100);
  }
  assert(ready,"Owned local production server did not become ready");
  const completed = new Promise((resolve,reject) => {
    verifier = spawn(process.execPath,["src/lib/capabilities/check-runtime.cjs",origin,evidence],{cwd:root,stdio:["ignore","pipe","pipe"],windowsHide:true});
    verifier.stdout.on("data",chunk=>process.stdout.write(chunk)); verifier.stderr.on("data",chunk=>process.stderr.write(chunk));
    verifier.once("error",reject); verifier.once("exit",(code)=>resolve(code));
  });
  assert.equal(await completed,0,"Local HTTP verifier failed"); assert(!expired,"Local HTTP watchdog expired");
} catch {console.error("FAIL owned local production HTTP verification; see scoped evidence, no external service invoked"); process.exitCode=1;}
finally {
  clearTimeout(timer);
  await stop(verifier); await stop(server);
  await mkdir(evidence,{recursive:true});
  await writeFile(path.join(evidence,"http-server.txt"),output);
  await writeFile(path.join(evidence,"http-server-error.txt"),errors);
  if(server) console.log("PASS owned verification server stopped");
}

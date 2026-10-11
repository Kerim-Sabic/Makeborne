/* eslint-disable @typescript-eslint/no-require-imports -- Disposable local crash fixture. */
const {Client}=require('pg');
process.once('message',async({url,jobId,workerId})=>{
 const db=new Client({connectionString:url,options:'-c role=makeborne_project_builder',query_timeout:5000});
 db.on('error',()=>{});
 try {
  await db.connect();
  const lease=(await db.query('select makeborne_private.lease_project_build($1,$2,1) as lease',[jobId,workerId])).rows[0].lease;
  process.send({lease});
  // Parent forcibly terminates this process before any build or acknowledgment.
 } catch {process.send({code:'BUILD_CRASH_FIXTURE_FAILED'});await db.end();process.exitCode=1;}
});

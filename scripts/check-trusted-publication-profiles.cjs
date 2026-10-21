/* eslint-disable @typescript-eslint/no-require-imports -- Offline publication profile entry point. */
const {spawnSync}=require('node:child_process');
for(const file of ['infra/publication-controller/check-profiles.mjs','src/lib/projects/check-publication-download.cjs']){
 const r=spawnSync(process.execPath,[file],{stdio:'inherit',timeout:60000});if(r.status!==0)process.exit(r.status??1);
}

// Local-only build/server runner. Never inherits saved provider keys.
// The explicit sandbox mode loads only the guarded, ignored sandbox config.
import {readFileSync, existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
const mode=process.argv[2];
if(!['build','start','maintenance','sandbox'].includes(mode)) throw new Error('Choose build, start, maintenance, or sandbox');
const env={...process.env};
for(const file of ['.env','.env.local','.env.production','.env.production.local']) {
  if(!existsSync(file)) continue;
  for(const match of readFileSync(file,'utf8').matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) env[match[1]]='';
}
for(const key of Object.keys(env)) if(/^(ANTHROPIC_|OPENAI_|WHOP_|SUPABASE_|NEXT_PUBLIC_SUPABASE_|MAKEBORNE_|VERCEL|CRON_SECRET|AWS_|RESEND_|GOOGLE_|GITHUB_)/.test(key)) env[key]='';
Object.assign(env,{NODE_ENV:'production',MAKEBORNE_CLOUD_ENABLED:'true',MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED:'true',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:55435',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_local_release_fixture',MAKEBORNE_RELEASE_MAINTENANCE:mode==='maintenance'?'on':'off'});
const statusFile='work/release-auth-stack/status.json';
if(existsSync(statusFile)) {
  const local=JSON.parse(readFileSync(statusFile,'utf8').replace(/^\uFEFF/,''));
  if(local.API_URL!=='http://127.0.0.1:55435' || !local.DB_URL?.includes('@127.0.0.1:55438/')) throw new Error('Isolated local stack required');
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local.PUBLISHABLE_KEY;
  env.SUPABASE_SECRET_KEY=local.SECRET_KEY;
}
if(mode==='sandbox') {
  if(!existsSync(statusFile)) throw new Error('Local stack credentials required');
  const sandbox=JSON.parse(readFileSync('work/release-auth-stack/whop-sandbox.json','utf8').replace(/^\uFEFF/,''));
  if(sandbox.apiBase!=='https://sandbox-api.whop.com/api/v1' || sandbox.companyId!=='biz_e4w3EGe3izP67k' || !/^ws_[A-Za-z0-9]+$/.test(sandbox.webhookSecret??'')) throw new Error('Sandbox-only configuration required');
  Object.assign(env,{CRON_SECRET:sandbox.cronSecret,MAKEBORNE_BILLING_RECONCILE_ENABLED:'true',WHOP_API_KEY:sandbox.apiKey,WHOP_COMPANY_ID:sandbox.companyId,WHOP_SANDBOX_COMPANY_ID:sandbox.companyId,WHOP_API_BASE_URL:sandbox.apiBase,WHOP_WEBHOOK_SECRET:sandbox.webhookSecret,MAKEBORNE_WHOP_SANDBOX:'true',WHOP_CREATION_ENABLED:'true',MAKEBORNE_BILLING_MIGRATIONS_VERIFIED:'true',WHOP_ACCESS_PLAN_IDS:'plan_00mHHGVMtYzRL,plan_9B9KMOqqdJXv4',WHOP_PLAN_CREDIT_MAP:'plan_00mHHGVMtYzRL:create:monthly,plan_9B9KMOqqdJXv4:create:yearly'});
}
// Optional port (third argument) so several local servers can run side by side.
const port=process.argv[3]??(mode==='maintenance'?'3049':'3048');if(!/^\d{4,5}$/.test(port))throw new Error('Port must be numeric');
const args=mode==='build'?['build']:['start','--hostname','127.0.0.1','--port',port];
const child=spawn(process.execPath,['node_modules/next/dist/bin/next',...args],{env,stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));

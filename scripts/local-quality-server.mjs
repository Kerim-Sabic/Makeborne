// Explicitly authorized paid qualification. Isolated DB only; no production settings.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
const local=JSON.parse(readFileSync('work/release-auth-stack/status.json','utf8').replace(/^\uFEFF/,''));
assert.equal(local.API_URL,'http://127.0.0.1:55435');assert(local.DB_URL.includes('@127.0.0.1:55438/'));
const env={...process.env};
for(const file of ['.env','.env.local','.env.production','.env.production.local'])if(existsSync(file))for(const m of readFileSync(file,'utf8').matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm))env[m[1]]='';
for(const key of Object.keys(env))if(/^(ANTHROPIC_|OPENAI_|WHOP_|SUPABASE_|NEXT_PUBLIC_SUPABASE_|MAKEBORNE_|VERCEL|CRON_SECRET|AWS_|RESEND_|GOOGLE_|GITHUB_)/.test(key))env[key]='';
const match=readFileSync('.env.local','utf8').match(/^ANTHROPIC_API_KEY\s*=\s*["']?([^\s"'\r\n]+)["']?\s*$/m);assert(match,'Missing approved Claude key');
Object.assign(env,{NODE_ENV:'development',ANTHROPIC_API_KEY:match[1],MAKEBORNE_BUILDER_MODEL:'claude-opus-5-5',MAKEBORNE_CLOUD_ENABLED:'true',MAKEBORNE_CLOUD_MIGRATIONS_VERIFIED:'true',MAKEBORNE_LIVE_BUILDER_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:local.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:local.PUBLISHABLE_KEY,SUPABASE_SECRET_KEY:local.SECRET_KEY});
const db=new pg.Client({connectionString:local.DB_URL});await db.connect();
// The total budget includes prior pilot spend. Count all isolated spend, including
// uncertain/open reservations, across all days, so restarting cannot reset it.
const total=Number((await db.query("select coalesce(sum(spent_microusd+reserved_microusd),0) n from makeborne_private.live_provider_days where scope='global'")).rows[0].n);
const today=Number((await db.query("select coalesce(sum(spent_microusd+reserved_microusd),0) n from makeborne_private.live_provider_days where scope='global' and day=(now() at time zone 'UTC')::date")).rows[0].n);
const remaining=25_000_000-12_580_000-total;assert(remaining>0,'Approved testing cap exhausted');
for(const scope of ['global','anthropic'])await db.query('select makeborne_private.set_live_provider_limit($1,true,$2,false,$3)',[scope,today+remaining,'Owner-approved $25 cumulative qualification budget, prior spend $12.58']);
await db.query("select makeborne_private.set_live_provider_limit('openai',false,0,false,'No OpenAI credential: image qualification blocked')");
writeFileSync('docs/release-review/quality-budget.json',JSON.stringify({approvedUsd:25,priorConfirmedUsd:12.58,isolatedSpentAndReservedUsd:total/1e6,remainingUsd:remaining/1e6,model:'claude-opus-5-5',imageApiConfigured:false,startedAt:new Date().toISOString()},null,2)+'\n');
console.log(`Isolated quality server: remaining authorized budget $${remaining/1e6}`);
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3048'],{env,stdio:'inherit'});
// End before UTC rollover: daily limits must never reset an active test budget.
const midnight=new Date();midnight.setUTCHours(24,0,0,0);
const timer=setTimeout(()=>child.kill(),Math.max(1,midnight.getTime()-Date.now()-60_000));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
await new Promise(resolve=>child.on('exit',resolve));clearTimeout(timer);
for(const scope of ['global','anthropic'])await db.query('select makeborne_private.set_live_provider_limit($1,false,0,false,$2)',[scope,'Quality session ended']);
await db.end();

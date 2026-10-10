/* eslint-disable @typescript-eslint/no-require-imports -- Rolled-back local database qualification. */
const fs=require('node:fs'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
if(process.env.MAKEBORNE_VERIFY_SLIDE_AUTHORITY!=='true')throw new Error('EXPLICIT_LOCAL_DATABASE_CHECK_REQUIRED');
const {createNativeSlideFixture}=require('./native-slide-fixture.cjs'),{content}=createNativeSlideFixture();
const migrations=fs.readdirSync('supabase/migrations').filter(name=>name.endsWith('_saved_native_slide_designs.sql'));assert.equal(migrations.length,1);
const migration=fs.readFileSync('supabase/migrations/'+migrations[0],'utf8').replace(/^begin;\s*/,'').replace(/commit;\s*$/,'');
const quote=value=>"'"+JSON.stringify(value).replace(/'/g,"''")+"'::jsonb";
const body=migration.match(/as \$\$([\s\S]*?)\$\$/)[1];
const literal=value=>"'"+value.replace(/'/g,"''")+"'";
const installed=spawnSync('docker',['exec','-i','supabase_db_makeborne-local','psql','-U','postgres','-d','postgres','-At'],{input:`select case when to_regprocedure('makeborne_private.validate_native_slide_design_revision()') is null then 'absent' when (select prosrc=${literal(body)} from pg_proc where oid=to_regprocedure('makeborne_private.validate_native_slide_design_revision()')) then 'matches' else 'drift' end;`,encoding:'utf8',windowsHide:true,timeout:15000});
assert.equal(installed.status,0);const state=installed.stdout.trim();assert(['absent','matches'].includes(state));
let sql='begin;\n'+(state==='absent'?migration:'')+'\ncreate temp table native_slide_probe(content jsonb,parent_version_id uuid,artifact_id uuid,workspace_id uuid);\ncreate trigger native_probe before insert on native_slide_probe for each row execute function makeborne_private.validate_native_slide_design_revision();\n';
sql+='insert into native_slide_probe(content) values('+quote(content)+');\n';let count=1;
for(const [name,mutate]of [
 ['wrong kind',c=>c.kind='book'],['outside canvas',c=>c.sections[0].slideDesign.elements[0].x=1200],['negative box',c=>c.sections[0].slideDesign.elements[0].height=-1],['tiny text',c=>c.sections[0].slideDesign.elements[0].fontSize=10],['executable field',c=>c.sections[0].slideDesign.elements[0].html='<script>run()</script>'],['remote background',c=>c.sections[0].slideDesign.background='url(https://example.com)'],['foreign source',c=>c.sections[0].slideDesign.elements[1].source.blockId=randomUUID()],['omitted source',c=>c.sections[0].slideDesign.elements.pop()],['duplicate source',c=>c.sections[0].slideDesign.elements.push({...c.sections[0].slideDesign.elements[1],id:randomUUID()})],['duplicate element',c=>c.sections[0].slideDesign.elements[1].id=c.sections[0].slideDesign.elements[0].id],['invalid source shape',c=>c.sections[0].slideDesign.elements[0].source.script='run'],['null font',c=>c.sections[0].slideDesign.elements[0].font=null],
]){
 const copy=structuredClone(content);mutate(copy);count++;
 sql+=`do $$ begin begin insert into native_slide_probe(content) values(${quote(copy)}); raise exception 'Expected rejection: ${name}'; exception when sqlstate '22023' then null; end; end $$;\n`;
}
sql+=`do $$ begin if has_function_privilege('authenticated','makeborne_private.validate_native_slide_design_revision()','execute') or has_function_privilege('service_role','makeborne_private.validate_native_slide_design_revision()','execute') then raise exception 'Trigger function execute remains exposed'; end if; if (select count(*) from native_slide_probe)<>1 then raise exception 'Invalid content committed'; end if; end $$;\nrollback;`;
const result=spawnSync('docker',['exec','-i','supabase_db_makeborne-local','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q'],{input:sql,encoding:'utf8',windowsHide:true,timeout:30000});
if(result.status!==0){console.error(result.stderr);process.exitCode=1;}else console.log(`PASS ${count} actual local SQL validation groups plus closed execute grants; all DDL/data rolled back.`);

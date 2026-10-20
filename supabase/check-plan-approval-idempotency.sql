-- M08: one plan approval is one operation and one credit hold, however often it is sent.
-- Local stack only (for example: docker exec -i <local db container> psql -U postgres -d postgres < this file).
-- Every fixture is fictional and the whole transaction rolls back. No provider call.
\set ON_ERROR_STOP on
begin;
do $$
declare u uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); a uuid:=gen_random_uuid();
 action uuid:=gen_random_uuid(); step uuid:=gen_random_uuid(); rate bigint:=30000;
 approved text:=repeat('a',64); edited text:=repeat('b',64);
 ctx jsonb:='{"message":"Build the approved plan: Fictional Atelier","plan":{"title":"Fictional Atelier"}}';
 op jsonb; again jsonb; first jsonb; second jsonb; busy jsonb; holds bigint; ops bigint;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@plan-approval.invalid',now());
 update makeborne_private.billing_settings set free_tier_enabled=true where singleton;
 insert into public.workspaces(id,name,owner_id) values(w,'Plan approval fixture',u);
 insert into public.projects(id,workspace_id,title,kind) values(p,w,'Fixture','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Fixture','website');
 perform public.makeborne_credit_grant(u,500,'topup','plan-approval-fixture','{}');

 -- The same approval identity sent twice (double click, or Build again after a lost reply).
 op:=public.makeborne_ai_operation_create(u,w,a,action,'build','medium',approved,0,50,rate,ctx);
 again:=public.makeborne_ai_operation_create(u,w,a,action,'build','medium',approved,0,50,rate,ctx);
 assert again->>'id'=op->>'id','repeat approval created a second operation';
 first:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,step,'build',approved,0,50);
 second:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,step,'build',approved,0,50);
 assert not (first->>'replayed')::boolean and (second->>'replayed')::boolean,'repeat step was not a replay';
 assert first->'run'->>'id'=second->'run'->>'id','repeat step reserved a second run';
 -- A different step for the same running approval cannot reserve another hold either.
 busy:=public.makeborne_ai_operation_begin(u,(op->>'id')::uuid,gen_random_uuid(),'continuation',approved,0,50);
 assert busy->'error'->>'code'='OPERATION_BUSY',busy::text;
 select count(*) into ops from makeborne_private.ai_operations where actor=u and artifact_id=a;
 select count(*) into holds from makeborne_private.credit_reservations where user_id=u;
 assert ops=1,format('expected one operation, found %s',ops);
 assert holds=1,format('expected one credit hold, found %s',holds);

 -- The same identity cannot be reused for an edited plan or another effort (a new quote needs a new approval).
 begin perform public.makeborne_ai_operation_create(u,w,a,action,'build','medium',edited,0,50,rate,ctx); raise exception 'edited plan reused the old approval';
 exception when sqlstate 'PT409' then null; end;
 begin perform public.makeborne_ai_operation_create(u,w,a,action,'build','high',approved,0,90,rate,ctx); raise exception 'changed effort reused the old approval';
 exception when sqlstate 'PT409' then null; end;
 -- A new approval written for a version that is no longer current is refused before any hold.
 begin perform public.makeborne_ai_operation_create(u,w,a,gen_random_uuid(),'build','medium',approved,7,50,rate,ctx); raise exception 'stale base version accepted';
 exception when sqlstate 'PT409' then null; end;
 select count(*) into ops from makeborne_private.ai_operations where actor=u and artifact_id=a;
 select count(*) into holds from makeborne_private.credit_reservations where user_id=u;
 assert ops=1 and holds=1,format('refusals added state: %s operations, %s holds',ops,holds);
 raise notice 'PASS plan approval idempotency: 1 operation, 1 hold after repeat create/begin, busy step, edited plan, changed effort and stale base';
end $$;
rollback;

begin;
do $$
declare
 u uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); q uuid:=gen_random_uuid(); q2 uuid:=gen_random_uuid(); k uuid:=gen_random_uuid(); r uuid; r2 uuid; result jsonb; first_dispatch uuid; s jsonb; t timestamptz:=clock_timestamp();
begin
 insert into auth.users(id,email) values(u,'reserve-'||u||'@example.invalid'),(stranger,'reserve-'||stranger||'@example.invalid');
 insert into public.workspaces(id,name,owner_id) values(w,'Reservation fixture',u);
 insert into public.projects(id,workspace_id,title,kind) values(p,w,'Fixture','website');
 insert into public.artifacts(id,workspace_id,project_id,title,kind) values(a,w,p,'Fixture','website');
 s:=jsonb_build_object('version','generation-proposal-v1','inputHash',repeat('a',64),'approvalHash',repeat('b',64),'input',jsonb_build_object('scope',jsonb_build_object('workspaceId',w,'projectId',p,'artifactId',a),'baseVersionId',null),'workflow',jsonb_build_object('version','workflow-v1','output','website','approved',false,'maximumVendorMicrousd','12','maximumCustomerCredits','3','preparedAt',t,'expiresAt',t+interval '1 hour','stages',jsonb_build_array('{}'::jsonb,'{}'::jsonb,'{}'::jsonb)));
 insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at) values(q,w,p,a,repeat('a',64),repeat('b',64),s,12,3,t,t+interval '1 hour');
 insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at) values(q2,w,p,a,repeat('a',64),repeat('c',64),jsonb_set(s,'{approvalHash}',to_jsonb(repeat('c',64))),12,3,t,t+interval '1 hour');
 insert into makeborne_private.generation_budgets(workspace_id,vendor_limit,credit_limit) values(w,20,5);
 update makeborne_private.generation_budgets set spending_enabled=true where workspace_id=w;
 r:=makeborne_private.reserve_generation_proposal(q,k,u,repeat('b',64),repeat('a',64));
 set local role authenticated;
 begin perform makeborne_private.claim_generation_dispatch(r,k,u,repeat('b',64),repeat('a',64)); raise exception 'unexpected browser dispatch'; exception when insufficient_privilege then raise notice 'PASS browser dispatch denied'; end;
 reset role;
 begin perform makeborne_private.claim_generation_dispatch(r,k,stranger,repeat('b',64),repeat('a',64)); raise exception 'unexpected nonmember dispatch'; exception when insufficient_privilege then raise notice 'PASS nonmember dispatch denied'; end;
 insert into public.workspace_members(workspace_id,user_id,role) values(w,stranger,'editor');
 begin perform makeborne_private.claim_generation_dispatch(r,k,stranger,repeat('b',64),repeat('a',64)); raise exception 'unexpected different approving actor'; exception when insufficient_privilege then raise notice 'PASS another editor cannot dispatch approval'; end;
 begin perform makeborne_private.claim_generation_dispatch(r,null,u,repeat('b',64),repeat('a',64)); raise exception 'unexpected missing request key'; exception when invalid_parameter_value then raise notice 'PASS request key required'; end;
 begin perform makeborne_private.claim_generation_dispatch(r,k,u,repeat('c',64),repeat('a',64)); raise exception 'unexpected changed approval'; exception when sqlstate 'PT409' then raise notice 'PASS changed approval denied'; end;
 begin perform makeborne_private.claim_generation_dispatch(r,k,u,repeat('b',64),repeat('d',64)); raise exception 'unexpected changed input'; exception when sqlstate 'PT409' then raise notice 'PASS changed input denied'; end;
 update makeborne_private.generation_budgets set spending_enabled=false where workspace_id=w;
 begin perform makeborne_private.claim_generation_dispatch(r,k,u,repeat('b',64),repeat('a',64)); raise exception 'unexpected spending'; exception when insufficient_privilege then raise notice 'PASS spending rechecked at dispatch'; end;
 update makeborne_private.generation_budgets set spending_enabled=true,emergency_stop=true where workspace_id=w;
 begin perform makeborne_private.claim_generation_dispatch(r,k,u,repeat('b',64),repeat('a',64)); raise exception 'unexpected emergency bypass'; exception when insufficient_privilege then raise notice 'PASS emergency stop rechecked at dispatch'; end;
 update makeborne_private.generation_budgets set emergency_stop=false where workspace_id=w;
 begin
 insert into public.artifact_versions(workspace_id,artifact_id,version_number,content,style_snapshot,created_by)
 values(w,a,1,jsonb_build_object('schemaVersion',1,'title','Fixture','kind','website','sections','[]'::jsonb),jsonb_build_object('id','fixture','name','Fixture','version',1,'typography',jsonb_build_object('headingFont','Inter','bodyFont','Inter'),'colors',jsonb_build_object('ink','#111111'),'description','','referenceAssetIds','[]'::jsonb),u);
 perform makeborne_private.claim_generation_dispatch(r,k,u,repeat('b',64),repeat('a',64)); raise exception 'unexpected stale version';
 exception when sqlstate 'PT409' then if sqlerrm<>'Project version changed' then raise; end if; raise notice 'PASS edited project cannot dispatch old approval'; end;
 begin
 update makeborne_private.generation_proposals set prepared_at=t-interval '2 hours',expires_at=t-interval '1 hour',snapshot=jsonb_set(jsonb_set(snapshot,'{workflow,preparedAt}',to_jsonb(t-interval '2 hours')),'{workflow,expiresAt}',to_jsonb(t-interval '1 hour')) where id=q;
 perform makeborne_private.claim_generation_dispatch(r,k,u,repeat('b',64),repeat('a',64)); raise exception 'unexpected expired dispatch';
 exception when sqlstate 'PT409' then if sqlerrm<>'Proposal expired' then raise; end if; raise notice 'PASS expiry rechecked at dispatch'; end;
 begin
 update makeborne_private.generation_budgets set credit_reserved=0 where workspace_id=w;
 perform makeborne_private.claim_generation_dispatch(r,k,u,repeat('b',64),repeat('a',64)); raise exception 'unexpected inconsistent counters';
 exception when sqlstate 'PT409' then if sqlerrm<>'Reservation counters require reconciliation' then raise; end if; raise notice 'PASS inconsistent counters denied'; end;
 begin
 perform makeborne_private.release_generation_reservation(r,u,'Fixture cancellation');
 perform makeborne_private.claim_generation_dispatch(r,k,u,repeat('b',64),repeat('a',64)); raise exception 'unexpected cancelled dispatch';
 exception when sqlstate 'PT409' then raise notice 'PASS cancelled reservation cannot dispatch'; end;
 begin
 update public.workspaces set owner_id=stranger where id=w;
 perform makeborne_private.claim_generation_dispatch(r,k,u,repeat('b',64),repeat('a',64)); raise exception 'unexpected revoked access';
 exception when insufficient_privilege then raise notice 'PASS access revoked after reservation blocks dispatch'; end;
 if exists(select 1 from makeborne_private.generation_dispatches where reservation_id=r) then raise exception 'rejected dispatch persisted'; end if;
 raise notice 'PASS rejected dispatches leave no records';
 set local role service_role;
 begin perform makeborne_private.claim_generation_dispatch(r,k,u,repeat('b',64),repeat('a',64)); raise exception 'Legacy worker bypass'; exception when insufficient_privilege then raise notice 'PASS runtime worker cannot use legacy dispatch'; end;
 reset role;
 result:=makeborne_private.claim_generation_dispatch(r,k,u,repeat('b',64),repeat('a',64));
 if (result->>'claimed')::boolean is distinct from true then raise exception 'first claim missing'; end if;
 first_dispatch:=(result->>'dispatchId')::uuid;
 raise notice 'PASS operator-only legacy regression gets first claim';
 result:=makeborne_private.claim_generation_dispatch(r,k,u,repeat('b',64),repeat('a',64));
 if (result->>'claimed')::boolean is distinct from false or (result->>'dispatchId')::uuid<>first_dispatch then raise exception 'retry can redispatch'; end if;
 raise notice 'PASS same-key retry never redispatches';
 result:=makeborne_private.claim_generation_dispatch(r,gen_random_uuid(),u,repeat('b',64),repeat('a',64));
 if (result->>'claimed')::boolean is distinct from false or (result->>'dispatchId')::uuid<>first_dispatch then raise exception 'new key can redispatch'; end if;
 raise notice 'PASS new-key retry never redispatches';
 begin perform makeborne_private.release_generation_reservation(r,u,'Unsafe release'); raise exception 'unexpected release'; exception when sqlstate 'PT409' then raise notice 'PASS dispatched reservation cannot be released as unused'; end;
 reset role;
 if not exists(select 1 from makeborne_private.generation_reservations where id=r and status='uncertain' and dispatch_started_at is not null) then raise exception 'missing uncertainty state'; end if;
 if not exists(select 1 from makeborne_private.generation_budgets where workspace_id=w and vendor_reserved=12 and credit_reserved=3 and active_reservations=1 and vendor_spent=0 and credit_spent=0 and revision=1) then raise exception 'dispatch changed balances'; end if;
 raise notice 'PASS dispatch retains both holds without inventing charges';
 if (select count(*) from makeborne_private.generation_dispatches where reservation_id=r)<>1 then raise exception 'duplicate dispatch audit'; end if;
 raise notice 'PASS one immutable dispatch audit record';
 set local role service_role;
 begin update makeborne_private.generation_dispatches set request_key=gen_random_uuid() where id=first_dispatch; raise exception 'unexpected worker mutation'; exception when insufficient_privilege then raise notice 'PASS worker cannot rewrite dispatch audit'; end;
 reset role;
end $$;
rollback;

begin;
-- Read only this worker's actual canonical result, never reconstruct a saved
-- revision from provider output or grant unrestricted artifact-table reads.
create function makeborne_private.load_generation_worker_result(p_job uuid,p_worker uuid,p_fence bigint,p_version uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.generation_jobs%rowtype; result public.artifact_versions%rowtype;
begin
 job:=makeborne_private.lock_generation_job(p_job);
 perform makeborne_private.load_generation_worker_input(p_job,p_worker,p_fence);
 if job.status<>'running' or p_version is null then
   raise exception 'Live result review required' using errcode='PT409';
 end if;
 select v.* into result from public.artifact_versions v
   join makeborne_private.generation_provider_outcomes o on o.result_version_id=v.id
     and o.workspace_id=v.workspace_id and o.artifact_id=v.artifact_id
   where o.job_id=job.id and o.succeeded and v.id=p_version
     and v.artifact_id=job.artifact_id and v.workspace_id=job.workspace_id for share of v;
 if not found then raise exception 'Confirmed scoped result required' using errcode='PT409'; end if;
 return to_jsonb(result);
end $$;
revoke all on function makeborne_private.load_generation_worker_result(uuid,uuid,bigint,uuid)
 from public,anon,authenticated,service_role,makeborne_generation_publisher;
grant execute on function makeborne_private.load_generation_worker_result(uuid,uuid,bigint,uuid) to makeborne_generation_worker;

-- Canonical questions survive reopen/export; old clients may omit the field.
-- This is content metadata, never an acceptance or publication permission.
create function makeborne_private.validate_artifact_review_questions() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.content ? 'reviewQuestions' then
   if jsonb_typeof(new.content->'reviewQuestions') is distinct from 'array' then
     raise exception 'Review questions must be a bounded list' using errcode='22023';
   end if;
   if jsonb_array_length(new.content->'reviewQuestions')>20 or exists(
     select 1 from jsonb_array_elements(new.content->'reviewQuestions') q
       where jsonb_typeof(q) is distinct from 'string' or length(q#>>'{}') not between 1 and 1000
   ) then raise exception 'Review questions must be a bounded list' using errcode='22023'; end if;
 end if;
 return new;
end $$;
revoke all on function makeborne_private.validate_artifact_review_questions()
 from public,anon,authenticated,service_role,makeborne_generation_worker,makeborne_generation_publisher;
create trigger artifact_review_questions_guard before insert on public.artifact_versions
 for each row execute function makeborne_private.validate_artifact_review_questions();
commit;

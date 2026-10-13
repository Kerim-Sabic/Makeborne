-- LOCAL-ONLY ephemeral qualification authority. Never a deployment migration.
-- Installed only after root reservation. Retained closed after shutdown/crash.
create schema makeborne_quality_local;
revoke all on schema makeborne_quality_local from public,anon,authenticated,service_role;
create table makeborne_quality_local.package (
 singleton boolean primary key check(singleton), package_id uuid not null, actor uuid not null,
 enabled boolean not null default false, day date not null, deadline timestamptz not null,
 cap bigint not null check(cap=6000000), active_action text, controller_pid integer not null, heartbeat_until timestamptz not null
);
create table makeborne_quality_local.actions (
 name text primary key check(name in ('book','deck','deck-edit')), action_key uuid not null unique,step_key uuid not null unique,
 cap bigint not null, effort text not null, workspace_id uuid,artifact_id uuid,input_hash text,expected_version integer,
 attempted boolean not null default false,
 check((name='deck-edit' and cap=600000 and effort='light') or (name in ('book','deck') and cap=2700000 and effort='high'))
);
create table makeborne_quality_local.calls (id uuid primary key,action text not null references makeborne_quality_local.actions(name));
revoke all on all tables in schema makeborne_quality_local from public,anon,authenticated,service_role;
create function makeborne_quality_local.admit() returns trigger language plpgsql security definer set search_path='' as $$
declare g makeborne_quality_local.package; a makeborne_quality_local.actions; o makeborne_private.ai_operations; r makeborne_private.ai_operation_runs; total numeric; action_total numeric;
begin
 select * into g from makeborne_quality_local.package where singleton for update;
 if not found or not g.enabled or g.heartbeat_until<=clock_timestamp() or not exists(select 1 from pg_catalog.pg_stat_activity where pid=g.controller_pid)
  or g.day<>(clock_timestamp() at time zone 'UTC')::date or clock_timestamp()+interval '300 seconds'>g.deadline
  or new.user_id is distinct from g.actor or new.provider<>'anthropic' or new.model<>'claude-opus-5-5' or new.bound_microusd<=0 or new.source<>'live' then
  raise exception 'Local qualification is closed' using errcode='MB423'; end if;
 select * into a from makeborne_quality_local.actions where name=g.active_action;
 if not found or not a.attempted or a.input_hash is null then raise exception 'Qualification action unavailable' using errcode='MB423'; end if;
 select * into r from makeborne_private.ai_operation_runs where reference=new.run_reference;
 if not found or r.step_key is distinct from a.step_key or r.kind<>'build' or r.status<>'active' or r.expires_at<=clock_timestamp()
  or r.input_hash is distinct from a.input_hash or r.expected_version is distinct from a.expected_version then
  raise exception 'Qualification run differs' using errcode='MB423'; end if;
 select * into o from makeborne_private.ai_operations where id=r.operation_id;
 if not found or o.actor is distinct from g.actor or o.action_key is distinct from a.action_key or o.kind<>'build' or o.effort is distinct from a.effort
  or o.workspace_id is distinct from a.workspace_id or o.artifact_id is distinct from a.artifact_id or o.input_hash is distinct from a.input_hash
  or o.initial_version is distinct from a.expected_version or o.rate_microusd<>30000 or o.authorized_credits*o.rate_microusd<>a.cap
  or o.status<>'active' or o.expires_at<=clock_timestamp() then raise exception 'Qualification authorization differs' using errcode='MB423'; end if;
 select coalesce(sum(coalesce(c.charged_microusd,c.bound_microusd)),0),coalesce(sum(case when q.action=a.name then coalesce(c.charged_microusd,c.bound_microusd) else 0 end),0)
 into total,action_total from makeborne_quality_local.calls q join makeborne_private.live_provider_calls c on c.id=q.id;
 if total+new.bound_microusd>g.cap or action_total+new.bound_microusd>a.cap then raise exception 'Qualification budget exhausted' using errcode='MB402'; end if;
 insert into makeborne_quality_local.calls values(new.id,a.name);
 return new;
end $$;
revoke all on function makeborne_quality_local.admit() from public,anon,authenticated,service_role;
create trigger fresh_quality_admit before insert on makeborne_private.live_provider_calls for each row execute function makeborne_quality_local.admit();

-- CRM research: writes the browser must not make (launch security review 26 Oct, S9).
-- Forward-only, on top of 20261025300000_crm_research.sql. Feature flag MAKEBORNE_CRM_RESEARCH stays off.
--
-- * crm_site_checks: an owner or editor could INSERT a row straight through the Data API, with
--   any score and findings and a caller-chosen checked_at (so a prospect check could be kept until
--   2099). Checks are now stored only by the server, through makeborne_crm_site_check_save
--   (service role), which takes the actor from the server's verified session, re-checks that
--   person's editor role and creation membership here, bounds checked_at to the last hour and
--   sets the 30-day expiry itself. Attaching a check to a client and deleting a check are
--   unchanged (owners and editors, under RLS).
-- * crm_next_steps: a direct INSERT or full-row UPDATE under RLS bypassed the revision
--   compare-and-set. Direct writes are revoked; makeborne_crm_next_step_set is the only writer.
--   It becomes SECURITY DEFINER with the same checks (editor via can_edit, the client in that
--   workspace, the expected revision), so it no longer needs table privileges of its own.
-- Impact of the old gap stayed inside one workspace (composite foreign keys).
begin;

-- ---------- website checks: server-only inserts ----------
drop policy crm_editor_insert on public.crm_site_checks;
revoke insert on public.crm_site_checks from authenticated;

-- Defence in depth for every writer (service role included). NOT VALID: enforced for new and
-- changed rows; rows made by the browser before this migration are not re-validated here.
alter table public.crm_site_checks
 add constraint crm_site_checks_checked_url check (status <> 'checked' or (url ~ '^https?://' and final_url is not null)) not valid,
 add constraint crm_site_checks_checked_at_bound check (checked_at <= created_at + interval '5 minutes') not valid,
 add constraint crm_site_checks_expiry_bound check (expires_at is null or expires_at <= created_at + interval '31 days') not valid;

-- p_check is the server's own check: {url, finalUrl, status, reason, score, checkerVersion, checkedAt, result}.
create function public.makeborne_crm_site_check_save(p_actor uuid, p_workspace uuid, p_client uuid, p_check jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_role text := makeborne_private.knowledge_role(p_actor, p_workspace); v_checked timestamptz; v_id uuid;
begin
 if v_role is null or v_role not in ('owner','editor') or not makeborne_private.has_creation_membership_for_actor(p_actor) then
  raise exception 'Editors only' using errcode='42501'; end if;
 if p_client is not null and not exists(select 1 from public.clients c where c.id = p_client and c.workspace_id = p_workspace) then
  raise exception 'Client unavailable' using errcode='P0002'; end if;
 if p_check is null or jsonb_typeof(p_check) <> 'object' or jsonb_typeof(p_check->'result') is distinct from 'object' then
  raise exception 'Invalid check' using errcode='22023'; end if;
 begin v_checked := (p_check->>'checkedAt')::timestamptz;
 exception when others then raise exception 'Invalid check time' using errcode='22023'; end;
 if v_checked is null or v_checked > now() + interval '5 minutes' or v_checked < now() - interval '1 hour' then
  raise exception 'Invalid check time' using errcode='22023'; end if;
 insert into public.crm_site_checks(workspace_id, client_id, url, final_url, status, reason, score, result, checker_version, checked_at, expires_at, created_by, created_at)
 values (p_workspace, p_client, p_check->>'url', nullif(p_check->>'finalUrl', ''), p_check->>'status', nullif(p_check->>'reason', ''),
  (p_check->>'score')::integer, p_check->'result', p_check->>'checkerVersion', v_checked,
  -- A prospect check (no client yet) expires 30 days after it was made; a client's check is kept with the client.
  case when p_client is null then least(v_checked, now()) + interval '30 days' end, p_actor, now())
 returning id into v_id;
 return v_id;
end $$;
revoke all on function public.makeborne_crm_site_check_save(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.makeborne_crm_site_check_save(uuid, uuid, uuid, jsonb) to service_role;

-- ---------- next steps: the compare-and-set function is the only writer ----------
drop policy crm_editor_insert on public.crm_next_steps;
drop policy crm_editor_update on public.crm_next_steps;
drop policy crm_editor_delete on public.crm_next_steps;
revoke insert, update, delete on public.crm_next_steps from authenticated;

-- Same body as 20261025300000; now SECURITY DEFINER, so the checks below are the whole authority.
create or replace function public.makeborne_crm_next_step_set(p_workspace uuid, p_client uuid, p_text text, p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row public.crm_next_steps; v_text text := btrim(coalesce(p_text, ''));
begin
 if p_expected_revision is null or p_expected_revision < 0 then raise exception 'Expected revision required' using errcode='22023'; end if;
 -- can_edit reads the caller's session (auth.uid()): owners and editors with a verified creation membership.
 if auth.uid() is null or not makeborne_private.can_edit(p_workspace) then raise exception 'Editors only' using errcode='42501'; end if;
 if not exists(select 1 from public.clients c where c.id = p_client and c.workspace_id = p_workspace) then raise exception 'Client unavailable' using errcode='P0002'; end if;
 if p_expected_revision = 0 then
  insert into public.crm_next_steps(client_id, workspace_id, text, revision, updated_by, updated_at)
  values (p_client, p_workspace, v_text, 1, auth.uid(), now())
  on conflict (client_id) do nothing
  returning * into v_row;
 else
  update public.crm_next_steps s set text = v_text, revision = s.revision + 1, updated_by = auth.uid(), updated_at = now()
  where s.client_id = p_client and s.workspace_id = p_workspace and s.revision = p_expected_revision
  returning * into v_row;
 end if;
 if v_row.client_id is null then raise exception 'Next step changed' using errcode='PT409'; end if;
 return jsonb_build_object('text', v_row.text, 'revision', v_row.revision, 'updatedAt', v_row.updated_at);
end $$;
revoke all on function public.makeborne_crm_next_step_set(uuid, uuid, text, integer) from public, anon;
grant execute on function public.makeborne_crm_next_step_set(uuid, uuid, text, integer) to authenticated, service_role;

commit;

-- Forward repair: hosted Supabase default privileges can directly grant the
-- service role EXECUTE when a public function is created. Title search is a
-- caller-session read: the application never needs its administrative key.
-- Keep the original additive migration intact and narrow only this function.
begin;
revoke all on function public.makeborne_artifact_title_search(uuid,text,text,timestamptz,uuid) from public, anon, service_role;
grant execute on function public.makeborne_artifact_title_search(uuid,text,text,timestamptz,uuid) to authenticated;
commit;

-- The dashboard's optional automatic-RLS event trigger is administrative only.
-- It may not exist in CLI-created local environments. Keep automatic RLS intact.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END
$$;

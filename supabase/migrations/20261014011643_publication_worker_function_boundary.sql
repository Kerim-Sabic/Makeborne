-- Additive correction: 260000 introduced a CHECK helper with PostgreSQL's
-- default PUBLIC EXECUTE. A dedicated publication login must have no unrelated
-- function authority, even when the helper itself is a harmless pure validator.
begin;
revoke all on function makeborne_private.valid_lead_tags(text[]) from public, anon, makeborne_publication_worker;
grant execute on function makeborne_private.valid_lead_tags(text[]) to authenticated, service_role;
-- Keep the predicate and clients CHECK constraint unchanged. PostgreSQL's owner
-- retains execution; authenticated/client and service writes retain validation.
commit;

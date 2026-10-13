#!/bin/sh
# Copies Supabase's per-database role grants (schema usage, default privileges
# and object ACLs) from the LOCAL main database into a disposable database built
# from the same migrations, so privilege and browser-role checks behave there as
# they do in a real Supabase database. Reads the main database (schema only);
# writes only to the named disposable database.
# - Application schemas (public, makeborne_private, makeborne_hosting, auth,
#   storage, extensions) and all default privileges: one transaction, all or nothing.
# - Supabase-internal schemas (realtime, vault, graphql, ...): best effort; objects
#   that differ in the disposable database are listed and skipped.
# Usage: sh supabase/sync-disposable-grants.sh makeborne_crm_isolated
set -eu
target="${1:?usage: sync-disposable-grants.sh <disposable-database>}"
case "$target" in
  postgres|template0|template1) echo "Refusing: the target must be a disposable database, not $target." >&2; exit 2 ;;
esac
case "$target" in
  *[!A-Za-z0-9_]*) echo "Refusing: invalid database name." >&2; exit 2 ;;
esac
docker exec supabase_db_makeborne-local sh -c "
  set -e
  pg_dump -U postgres -d postgres --schema-only | grep -E '^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES)' > /tmp/makeborne-acl.sql
  app='( ON (FUNCTION|TABLE|SEQUENCE|SCHEMA) (public|makeborne_private|makeborne_hosting|auth|storage|extensions)[ .(])|^ALTER DEFAULT PRIVILEGES'
  grep -E \"\$app\" /tmp/makeborne-acl.sql > /tmp/makeborne-acl-app.sql || true
  grep -vE \"\$app\" /tmp/makeborne-acl.sql > /tmp/makeborne-acl-internal.sql || true
  { echo 'begin;'; cat /tmp/makeborne-acl-app.sql; echo 'commit;'; } | psql -U supabase_admin -d '$target' -v ON_ERROR_STOP=1 -q
  echo \"Applied \$(wc -l < /tmp/makeborne-acl-app.sql) application grant statements to $target.\"
  psql -U supabase_admin -d '$target' -q -f /tmp/makeborne-acl-internal.sql 2> /tmp/makeborne-acl-internal.err || true
  echo \"Internal schemas: \$(wc -l < /tmp/makeborne-acl-internal.sql) statements, \$(grep -c ERROR /tmp/makeborne-acl-internal.err || true) skipped:\"
  grep ERROR /tmp/makeborne-acl-internal.err | sed 's/^.*ERROR: */  - /' | sort | uniq | head -20 || true
"

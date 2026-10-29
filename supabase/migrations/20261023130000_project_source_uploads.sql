-- AI source uploads (agency workflow §2, 2026-10-23). Additive only; NOT applied anywhere yet.
--
-- Large AI source files (over the 3 MB inline limit) are uploaded by the editor's browser to
-- project-assets at <workspace>/<project>/sources/<sha256>.<ext>, then verified and registered
-- by the server (src/lib/ingest/storage.ts, /api/cloud/workspaces/[id]/artifacts/[id]/sources).
-- PDF and PPTX are already allowed by the bucket; this adds Word, Excel and CSV originals.
--
-- Unchanged: the storage policies (editors may only INSERT under their own workspace prefix,
-- no browser SELECT/UPDATE/DELETE since 20261020203000), the 50 MB per-object limit, the
-- assets table and its immutability. The upload route and register route are behind
-- MAKEBORNE_SOURCE_INGESTION_ENABLED (off by default).
--
-- DEPLOY ORDER: either order is safe. Without this migration the browser upload of a large
-- .docx/.xlsx/.csv is refused by storage and the builder shows the upload error.
begin;

update storage.buckets
set allowed_mime_types = array(
  select distinct unnest(coalesce(allowed_mime_types, array[]::text[]) || array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ]::text[])
  order by 1
)
where id = 'project-assets' and allowed_mime_types is not null;

commit;

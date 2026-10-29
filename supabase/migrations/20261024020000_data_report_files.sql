-- Data-to-deliverable reports (agency workflow §7, 2026-10-24). Additive only; NOT applied anywhere yet.
--
-- A generated report saves its facts sheet (every figure with its value, unit/currency and the
-- exact spreadsheet cells it came from, plus the chart data) as an immutable JSON file next to
-- its PDF/PPTX in project-assets at <workspace>/<project>/reports/<sha256>.<ext>, registered as
-- an asset and referenced by the new version's asset manifest (src/lib/data/persist.ts).
-- PDF and PPTX are already allowed by the bucket; this adds application/json.
--
-- Unchanged: the storage policies (editors may only INSERT under their own workspace prefix,
-- no browser SELECT/UPDATE/DELETE since 20261020203000), the 50 MB per-object limit, the
-- assets table and its immutability, the version save function. Reads go through the existing
-- document-export route (signed-in member, RLS-visible asset row, server-side download).
-- The feature is behind MAKEBORNE_DATA_REPORTS=on (off by default, set nowhere).
--
-- DEPLOY ORDER: either order is safe. Without this migration the JSON upload is refused by
-- storage, so generation stops before saving anything ("The report files couldn't be stored.
-- Nothing was changed") and no version is created without its facts sheet.
begin;

update storage.buckets
set allowed_mime_types = array(
  select distinct unnest(coalesce(allowed_mime_types, array[]::text[]) || array['application/json']::text[])
  order by 1
)
where id = 'project-assets' and allowed_mime_types is not null;

commit;

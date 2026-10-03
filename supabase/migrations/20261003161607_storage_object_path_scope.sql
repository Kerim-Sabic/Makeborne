DROP POLICY "project_assets_insert" ON "storage"."objects";

DROP POLICY "project_assets_read" ON "storage"."objects";

CREATE POLICY "project_assets_insert" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'project-assets'::text) AND (EXISTS ( SELECT 1
   FROM public.workspaces w
  WHERE (((w.id)::text = (storage.foldername(objects.name))[1]) AND makeborne_private.can_edit(w.id))))));

CREATE POLICY "project_assets_read" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'project-assets'::text) AND (EXISTS ( SELECT 1
   FROM public.workspaces w
  WHERE (((w.id)::text = (storage.foldername(objects.name))[1]) AND makeborne_private.can_read(w.id))))));

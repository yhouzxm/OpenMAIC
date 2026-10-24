-- UNAPPLIED Native provisioning delta. Native owner transaction ONLY.
DO $$ BEGIN
 IF current_user<>'zhiban_openmaic_owner' OR current_database()<>'zhiban_m5_native'
  OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999 THEN RAISE EXCEPTION 'Native proof ACL rejected'; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO zhiban_reconcile_native_proof;
GRANT SELECT ON public.document_stages,public.document_scenes,public.document_outlines,
 public.document_stage_revision,public.document_scene_revision TO zhiban_reconcile_native_proof;
GRANT UPDATE(id) ON public.document_stages TO zhiban_reconcile_native_proof;
-- This is actual id-write privilege, NOT PG READ ONLY. Closed worker is trusted.
-- No SQL/HTTP endpoint, no write-method adapter; no role membership/default ACL.
-- Role remains NOLOGIN until an explicitly authorized private maintenance bootstrap.

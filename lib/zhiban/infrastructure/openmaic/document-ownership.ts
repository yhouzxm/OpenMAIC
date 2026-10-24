import type { DocumentOwnershipRelation } from '@openmaic/storage/document/pg';

// Opaque Native partition only. Business authorization and revocation still run
// before dispatch and before commit in the Bridge transaction.
export const documentOwnership: Readonly<DocumentOwnershipRelation> = Object.freeze({
  table: 'public.zhiban_document_ownership',
  claimOnCreate: true,
});

// Additive host relation; old owner_id remains available for backup rollback.
// This runs only under the offline Native owner, never in a request handler.
export const ownershipSchema = `
CREATE TABLE IF NOT EXISTS public.zhiban_document_ownership (
  stage_id text PRIMARY KEY REFERENCES public.document_stages(id) ON DELETE CASCADE,
  owner_id text NOT NULL CHECK (octet_length(owner_id) BETWEEN 1 AND 256),
  lock_anchor boolean NOT NULL DEFAULT false
);
DO $ownership_backfill$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.document_stages'::regclass
             AND attname='owner_id' AND NOT attisdropped) THEN
    INSERT INTO public.zhiban_document_ownership(stage_id,owner_id)
      SELECT id,owner_id FROM public.document_stages WHERE owner_id IS NOT NULL
      ON CONFLICT(stage_id) DO NOTHING;
    IF EXISTS (SELECT 1 FROM public.document_stages s
      LEFT JOIN public.zhiban_document_ownership o ON o.stage_id=s.id
      WHERE o.owner_id IS NULL OR (s.owner_id IS NOT NULL AND o.owner_id<>s.owner_id)) THEN
      RAISE EXCEPTION 'Native ownership backfill rejected';
    END IF;
  ELSIF EXISTS(SELECT 1 FROM public.document_stages s
      LEFT JOIN public.zhiban_document_ownership o ON o.stage_id=s.id WHERE o.stage_id IS NULL) THEN
    RAISE EXCEPTION 'Unowned Native documents rejected';
  END IF;
END $ownership_backfill$;
REVOKE ALL ON public.zhiban_document_ownership FROM PUBLIC,zhiban_openmaic_runtime;
GRANT SELECT,INSERT ON public.zhiban_document_ownership TO zhiban_openmaic_runtime;
-- PostgreSQL FOR SHARE requires one UPDATE column. Grant only this inert
-- lock column; owner_id and stage_id remain immutable to the runtime role.
GRANT UPDATE(lock_anchor) ON public.zhiban_document_ownership TO zhiban_openmaic_runtime;
`;

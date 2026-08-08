import type { ZhibanMigration } from './001-initial-identity';

export const postgresClassroomDocumentsMigration: ZhibanMigration = {
  version: '019',
  description: 'PostgreSQL authoritative storage for OpenMAIC classroom documents',
  checksum: 'zhiban-019-postgres-classroom-documents-v1',
  up: [
    `CREATE TABLE zhiban.openmaic_classroom_documents (
      classroom_id VARCHAR(160) PRIMARY KEY,
      tenant_id UUID REFERENCES zhiban.tenants(id) ON DELETE RESTRICT,
      stage JSONB NOT NULL,scenes JSONB NOT NULL,document_state JSONB NOT NULL DEFAULT '{}'::jsonb,
      revision BIGINT NOT NULL DEFAULT 1 CHECK(revision>0),created_by UUID,updated_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK(jsonb_typeof(stage)='object'),CHECK(jsonb_typeof(scenes)='array'),CHECK(jsonb_typeof(document_state)='object'))`,
    `CREATE INDEX openmaic_classroom_documents_tenant_idx ON zhiban.openmaic_classroom_documents(tenant_id,updated_at DESC)`,
  ],
  down: [`DROP TABLE IF EXISTS zhiban.openmaic_classroom_documents`],
};

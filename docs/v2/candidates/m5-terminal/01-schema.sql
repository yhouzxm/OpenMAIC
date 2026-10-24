-- UNAPPLIED candidate: append-only content 0002, NOT an active migration path.
-- Future installer must run all ordered Business components in ONE transaction.
DO $$ BEGIN
 IF current_user <> 'zhiban_identity_owner' OR current_database() <> 'zhiban_m1_dev'
    OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999
    OR (SELECT count(*) FROM zhiban_content.schema_migrations) <> 1
    OR NOT EXISTS(SELECT 1 FROM zhiban_content.schema_migrations WHERE version='0001'
      AND checksum='e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324') THEN
  RAISE EXCEPTION 'Terminal candidate prerequisite rejected';
 END IF;
END $$;
CREATE SCHEMA zhiban_reconcile AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_reconcile FROM PUBLIC;
CREATE DOMAIN zhiban_reconcile.sha256 AS text CHECK(VALUE ~ '^[a-f0-9]{64}$');
CREATE DOMAIN zhiban_reconcile.v7 AS uuid CHECK(VALUE IS NULL OR zhiban_identity.is_uuid_v7(VALUE));
CREATE DOMAIN zhiban_reconcile.millis AS bigint CHECK(VALUE BETWEEN 0 AND 8640000000000000);
CREATE TABLE zhiban_reconcile.installations(
 deployment_id uuid PRIMARY KEY REFERENCES zhiban_bridge.deployment_registry(deployment_id),
 profile text NOT NULL CHECK(profile='terminal-reconciliation-local-v1'),
 cluster_identifier text NOT NULL CHECK(cluster_identifier ~ '^[0-9]+$'),
 business_oid oid NOT NULL,native_oid oid NOT NULL CHECK(native_oid<>business_oid),
 migration_digest zhiban_reconcile.sha256 NOT NULL,implementation_digest zhiban_reconcile.sha256 NOT NULL,
 receipt_digest zhiban_reconcile.sha256 NOT NULL,acl_digest zhiban_reconcile.sha256 NOT NULL,
 storage_digest zhiban_reconcile.sha256 NOT NULL,ready boolean NOT NULL DEFAULT false
);
-- No installation/service/control authorization is seeded by this migration.
CREATE TABLE zhiban_reconcile.services(
 service_ref text COLLATE "C" PRIMARY KEY CHECK(octet_length(service_ref) BETWEEN 1 AND 256 AND service_ref !~ '[[:cntrl:]]'),
 deployment_id uuid NOT NULL REFERENCES zhiban_reconcile.installations(deployment_id),
 purpose text NOT NULL CHECK(purpose='RECONCILE'),authorization_version bigint NOT NULL CHECK(authorization_version>0),
 status text NOT NULL CHECK(status IN('ACTIVE','REVOKED')),
 executor_role text NOT NULL CHECK(executor_role='zhiban_reconcile_executor')
);
CREATE TABLE zhiban_reconcile.service_versions(
 service_ref text NOT NULL REFERENCES zhiban_reconcile.services(service_ref),authorization_version bigint NOT NULL,
 status text NOT NULL CHECK(status IN('ACTIVE','REVOKED')),provenance_digest zhiban_reconcile.sha256 NOT NULL,
 occurred_at zhiban_reconcile.millis NOT NULL,PRIMARY KEY(service_ref,authorization_version)
);
ALTER TABLE zhiban_reconcile.services ADD CONSTRAINT current_service_version_fk FOREIGN KEY(service_ref,authorization_version)
 REFERENCES zhiban_reconcile.service_versions(service_ref,authorization_version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE zhiban_reconcile.controller_authorizations(
 deployment_id uuid PRIMARY KEY REFERENCES zhiban_reconcile.installations(deployment_id),
 token_digest zhiban_reconcile.sha256 NOT NULL,backend_pid integer NOT NULL,backend_start timestamptz NOT NULL,
 nonce_digest zhiban_reconcile.sha256 NOT NULL,expires_at zhiban_reconcile.millis NOT NULL,
 provenance_digest zhiban_reconcile.sha256 NOT NULL,status text NOT NULL CHECK(status IN('ACTIVE','REVOKED'))
);
CREATE TABLE zhiban_reconcile.epoch_counters(
 deployment_id uuid PRIMARY KEY REFERENCES zhiban_reconcile.installations(deployment_id),epoch bigint NOT NULL CHECK(epoch>=0)
);
CREATE TABLE zhiban_reconcile.windows(
 window_id zhiban_reconcile.v7 PRIMARY KEY,service_ref text NOT NULL REFERENCES zhiban_reconcile.services(service_ref),
 deployment_id uuid NOT NULL REFERENCES zhiban_reconcile.installations(deployment_id),epoch bigint NOT NULL CHECK(epoch>0),
 phase text NOT NULL CHECK(phase IN('PREPARING','DRAINED','PROVING','SETTLING','RESUMING','BLOCKED','SUPERSEDED','CLOSED')),
 predecessor_id uuid REFERENCES zhiban_reconcile.windows(window_id) DEFERRABLE INITIALLY DEFERRED,
 successor_id uuid REFERENCES zhiban_reconcile.windows(window_id) DEFERRABLE INITIALLY DEFERRED,
 takeover_request_id zhiban_reconcile.v7 UNIQUE,
 cluster_identifier text NOT NULL,business_oid oid NOT NULL,native_oid oid NOT NULL,postmaster_start timestamptz NOT NULL,
 nonce_digest zhiban_reconcile.sha256 NOT NULL,build_digest zhiban_reconcile.sha256 NOT NULL,
 allowlist jsonb NOT NULL CHECK(jsonb_typeof(allowlist)='array' AND jsonb_array_length(allowlist) BETWEEN 1 AND 8),
 barrier_seq bigint NOT NULL DEFAULT 0 CHECK(barrier_seq>=0),barrier_at zhiban_reconcile.millis,
 lease_until zhiban_reconcile.millis NOT NULL,created_at zhiban_reconcile.millis NOT NULL,
 UNIQUE(deployment_id,epoch),CHECK((phase='SUPERSEDED')=(successor_id IS NOT NULL)),
 CHECK(window_id IS DISTINCT FROM predecessor_id AND window_id IS DISTINCT FROM successor_id)
);
CREATE UNIQUE INDEX reconcile_active_window ON zhiban_reconcile.windows(deployment_id)
 WHERE phase NOT IN('CLOSED','SUPERSEDED');
CREATE TABLE zhiban_reconcile.window_database_claims(
 cluster_identifier text NOT NULL,database_oid oid NOT NULL,
 current_window_id uuid REFERENCES zhiban_reconcile.windows(window_id) DEFERRABLE INITIALLY DEFERRED,
 PRIMARY KEY(cluster_identifier,database_oid)
);
CREATE TABLE zhiban_reconcile.grants(
 tenant_id uuid NOT NULL,grant_id zhiban_reconcile.v7 NOT NULL,resource_id uuid NOT NULL,offering_id uuid NOT NULL,
 content_operation_id uuid NOT NULL,prepare_operation_id uuid NOT NULL,slot_id uuid NOT NULL,generation_id uuid NOT NULL,
 window_id uuid NOT NULL REFERENCES zhiban_reconcile.windows(window_id),epoch bigint NOT NULL,
 service_ref text NOT NULL,authorization_version bigint NOT NULL,
 capability text NOT NULL CHECK(capability='CANCEL_UNPUBLISHED_NATIVE_RETAINED_V1'),
 request_id zhiban_reconcile.v7 NOT NULL,token_digest zhiban_reconcile.sha256 NOT NULL,
 proposal_digest zhiban_reconcile.sha256 NOT NULL,approval_digest zhiban_reconcile.sha256 NOT NULL,
 source_revision bigint NOT NULL CHECK(source_revision>0),source_digest zhiban_reconcile.sha256 NOT NULL,
 expected_native_digest zhiban_reconcile.sha256 NOT NULL,key_digest zhiban_reconcile.sha256 NOT NULL,intent_digest zhiban_reconcile.sha256 NOT NULL,
 content_state text NOT NULL CHECK(content_state IN('RESERVED','OUTCOME_UNKNOWN')),
 prepare_state text NOT NULL CHECK(prepare_state IN('RESERVED','OUTCOME_UNKNOWN')),
 prepare_revision bigint NOT NULL CHECK(prepare_revision>0),generation_revision bigint NOT NULL CHECK(generation_revision>0),slot_revision bigint NOT NULL CHECK(slot_revision>0),
 owner_handle text NOT NULL,stage_ref text NOT NULL,scene_digest zhiban_reconcile.sha256 NOT NULL,
 source_snapshot jsonb NOT NULL,bindings_digest zhiban_reconcile.sha256 NOT NULL,
 issued_at zhiban_reconcile.millis NOT NULL,expires_at zhiban_reconcile.millis NOT NULL,
 status text NOT NULL CHECK(status IN('ISSUED','REVOKED','CONSUMED')),consumed_resolution_id uuid,
 PRIMARY KEY(tenant_id,grant_id),UNIQUE(tenant_id,request_id),
 FOREIGN KEY(service_ref,authorization_version) REFERENCES zhiban_reconcile.service_versions(service_ref,authorization_version),
 FOREIGN KEY(tenant_id,resource_id,offering_id) REFERENCES zhiban_content.resources(tenant_id,id,offering_id),
 FOREIGN KEY(tenant_id,content_operation_id) REFERENCES zhiban_content.operations(tenant_id,id),
 FOREIGN KEY(tenant_id,prepare_operation_id) REFERENCES zhiban_bridge.operations(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,slot_id,generation_id) REFERENCES zhiban_bridge.resource_generations(tenant_id,slot_id,generation_id),
 CHECK(expires_at>issued_at AND expires_at-issued_at<=300000),
 CHECK((status='CONSUMED')=(consumed_resolution_id IS NOT NULL))
);
CREATE TABLE zhiban_reconcile.proofs(
 tenant_id uuid NOT NULL,proof_id zhiban_reconcile.v7 NOT NULL,grant_id uuid NOT NULL,
 window_id uuid NOT NULL REFERENCES zhiban_reconcile.windows(window_id),epoch bigint NOT NULL,
 classification text NOT NULL CHECK(classification='FULL_PUBLIC_DOCUMENT_MATCH'),
 expected_digest zhiban_reconcile.sha256 NOT NULL,document_digest zhiban_reconcile.sha256 NOT NULL,
 manifest_digest zhiban_reconcile.sha256 NOT NULL,observations jsonb NOT NULL,
 observed_at zhiban_reconcile.millis NOT NULL,expires_at zhiban_reconcile.millis NOT NULL,
 PRIMARY KEY(tenant_id,proof_id),UNIQUE(tenant_id,grant_id),
 FOREIGN KEY(tenant_id,grant_id) REFERENCES zhiban_reconcile.grants(tenant_id,grant_id),
 CHECK(document_digest=expected_digest AND expires_at>=observed_at)
);
CREATE TABLE zhiban_reconcile.resolutions(
 tenant_id uuid NOT NULL,resolution_id zhiban_reconcile.v7 NOT NULL,grant_id uuid NOT NULL,proof_id uuid NOT NULL,
 resource_id uuid NOT NULL,content_operation_id uuid NOT NULL,prepare_operation_id uuid NOT NULL,generation_id uuid NOT NULL,slot_id uuid NOT NULL,
 service_ref text NOT NULL,authorization_version bigint NOT NULL,request_id uuid NOT NULL,
 state text NOT NULL CHECK(state='COMMITTED'),reason text NOT NULL CHECK(reason='CANCELLED_UNPUBLISHED_NATIVE_RETAINED'),
 completed_at zhiban_reconcile.millis NOT NULL,content_audit_id zhiban_reconcile.v7 NOT NULL,bridge_audit_id zhiban_reconcile.v7 NOT NULL,
 prepare_revision_after bigint NOT NULL,generation_revision_after bigint NOT NULL,slot_revision bigint NOT NULL,
 PRIMARY KEY(tenant_id,resolution_id),UNIQUE(tenant_id,grant_id),UNIQUE(tenant_id,proof_id),UNIQUE(tenant_id,content_operation_id),UNIQUE(service_ref,request_id),
 FOREIGN KEY(tenant_id,grant_id) REFERENCES zhiban_reconcile.grants(tenant_id,grant_id),
 FOREIGN KEY(tenant_id,proof_id) REFERENCES zhiban_reconcile.proofs(tenant_id,proof_id),
 FOREIGN KEY(tenant_id,resource_id) REFERENCES zhiban_content.resources(tenant_id,id),
 FOREIGN KEY(tenant_id,content_operation_id) REFERENCES zhiban_content.operations(tenant_id,id),
 FOREIGN KEY(tenant_id,prepare_operation_id) REFERENCES zhiban_bridge.operations(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,slot_id,generation_id) REFERENCES zhiban_bridge.resource_generations(tenant_id,slot_id,generation_id),
 FOREIGN KEY(service_ref,authorization_version) REFERENCES zhiban_reconcile.service_versions(service_ref,authorization_version)
);
ALTER TABLE zhiban_reconcile.grants ADD CONSTRAINT reconcile_consumed_fk
 FOREIGN KEY(tenant_id,consumed_resolution_id) REFERENCES zhiban_reconcile.resolutions(tenant_id,resolution_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE zhiban_reconcile.lookup_permissions(
 tenant_id uuid NOT NULL,lookup_id zhiban_reconcile.v7 NOT NULL,deployment_id uuid NOT NULL,
 resource_id uuid NOT NULL,content_operation_id uuid NOT NULL,request_id uuid NOT NULL,
 caller_role text NOT NULL CHECK(caller_role IN('zhiban_reconcile_issuer','zhiban_reconcile_executor')),
 token_digest zhiban_reconcile.sha256 NOT NULL,provenance_digest zhiban_reconcile.sha256 NOT NULL,
 status text NOT NULL CHECK(status IN('ACTIVE','REVOKED')),issued_at zhiban_reconcile.millis NOT NULL,expires_at zhiban_reconcile.millis NOT NULL,
 PRIMARY KEY(tenant_id,lookup_id),FOREIGN KEY(deployment_id) REFERENCES zhiban_reconcile.installations(deployment_id),
 FOREIGN KEY(tenant_id,resource_id) REFERENCES zhiban_content.resources(tenant_id,id),
 FOREIGN KEY(tenant_id,content_operation_id) REFERENCES zhiban_content.operations(tenant_id,id),CHECK(expires_at>issued_at AND expires_at-issued_at<=300000)
);
CREATE TABLE zhiban_reconcile.control_events(
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,deployment_id uuid NOT NULL,window_id uuid,
 event_type text NOT NULL CHECK(event_type IN('WINDOW_OPENED','BARRIER_CHECKED','WINDOW_BLOCKED','WINDOW_SUPERSEDED','RESUMING','CLOSED','SERVICE_VERSION','LOOKUP_ISSUED','LOOKUP_REVOKED')),
 actor_role text NOT NULL,occurred_at zhiban_reconcile.millis NOT NULL,provenance_digest zhiban_reconcile.sha256 NOT NULL,facts jsonb NOT NULL
);
CREATE TABLE zhiban_reconcile.attempts(
 tenant_id uuid NOT NULL,attempt_id zhiban_reconcile.v7 NOT NULL,grant_id uuid NOT NULL,event_type text NOT NULL
 CHECK(event_type IN('GRANT_ISSUED','GRANT_REVOKED','STARTED','DENIED','ACK_UNKNOWN','COMMITTED','ACKNOWLEDGED')),
 actor_role text NOT NULL,occurred_at zhiban_reconcile.millis NOT NULL,PRIMARY KEY(tenant_id,attempt_id),
 FOREIGN KEY(tenant_id,grant_id) REFERENCES zhiban_reconcile.grants(tenant_id,grant_id)
);
-- Private transaction capability. No client can INSERT/SELECT this table.
CREATE TABLE zhiban_reconcile.write_scopes(
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,tenant_id uuid NOT NULL,resource_id uuid NOT NULL,
 content_operation_id uuid NOT NULL,prepare_operation_id uuid NOT NULL,generation_id uuid NOT NULL,
 resolution_id uuid NOT NULL,content_audit_id uuid NOT NULL,bridge_audit_id uuid NOT NULL,completed_at bigint NOT NULL,
 PRIMARY KEY(backend_pid,transaction_id)
);
ALTER TABLE zhiban_content.audit_events ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE zhiban_content.audit_events ADD COLUMN actor_kind text NOT NULL DEFAULT 'USER',
 ADD COLUMN service_ref text,ADD COLUMN reconciliation_id uuid;
ALTER TABLE zhiban_content.audit_events DROP CONSTRAINT audit_events_event_type_check;
ALTER TABLE zhiban_content.audit_events ADD CONSTRAINT content_audit_event_v2 CHECK(event_type IN(
 'CONTENT_CREATED','DRAFT_SAVED','COMMAND_NOOP','PUBLISH_RESERVED','CONTENT_PUBLISHED','CONTENT_WITHDRAWN','OPERATION_FAILED','OUTCOME_QUARANTINED','CONTENT_RECONCILED_UNPUBLISHED')),
 ADD CONSTRAINT content_audit_actor_v2 CHECK(
 (actor_kind='USER' AND actor_id IS NOT NULL AND service_ref IS NULL AND reconciliation_id IS NULL AND event_type<>'CONTENT_RECONCILED_UNPUBLISHED') OR
 (actor_kind='SERVICE_RECONCILE' AND actor_id IS NULL AND service_ref IS NOT NULL AND reconciliation_id IS NOT NULL AND event_type='CONTENT_RECONCILED_UNPUBLISHED')),
 ADD CONSTRAINT content_resolution_fk FOREIGN KEY(tenant_id,reconciliation_id) REFERENCES zhiban_reconcile.resolutions(tenant_id,resolution_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE zhiban_bridge.audit_events ADD COLUMN reconciliation_id uuid;
ALTER TABLE zhiban_bridge.audit_events ADD CONSTRAINT bridge_resolution_fk
 FOREIGN KEY(tenant_id,reconciliation_id) REFERENCES zhiban_reconcile.resolutions(tenant_id,resolution_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE zhiban_reconcile.resolutions ADD CONSTRAINT resolution_content_audit_fk
 FOREIGN KEY(tenant_id,content_audit_id) REFERENCES zhiban_content.audit_events(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT resolution_bridge_audit_fk FOREIGN KEY(tenant_id,bridge_audit_id) REFERENCES zhiban_bridge.audit_events(tenant_id,event_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE zhiban_content.schema_migrations DROP CONSTRAINT schema_migrations_version_check;
ALTER TABLE zhiban_content.schema_migrations ADD CONSTRAINT schema_migrations_version_check CHECK(version IN('0001','0002'));
-- Future installer inserts the computed 0002 aggregate only AFTER all components.

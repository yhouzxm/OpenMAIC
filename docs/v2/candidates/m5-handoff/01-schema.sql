-- UNAPPLIED additive handoff ledger v0001; no Content/terminal migration rewrite.
-- Future installer: one owner transaction for 01..03, then computed ledger INSERT.
DO $$ BEGIN
 IF current_database()<>'zhiban_m1_dev' OR current_user<>'zhiban_identity_owner'
  OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999
  OR (SELECT count(*) FROM zhiban_content.schema_migrations)<>2
  OR NOT EXISTS(SELECT 1 FROM zhiban_content.schema_migrations WHERE version='0001' AND checksum='e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324')
  OR NOT EXISTS(SELECT 1 FROM zhiban_content.schema_migrations WHERE version='0002' AND checksum='ec2aa8066aae0455127522df40a32b86249a98417391dc714d243f366e592548') THEN
  RAISE EXCEPTION 'Exact handoff prerequisites rejected';
 END IF;
END $$;
CREATE SCHEMA zhiban_handoff AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_handoff FROM PUBLIC;
CREATE TABLE zhiban_handoff.schema_migrations(version text PRIMARY KEY CHECK(version='0001'),checksum zhiban_reconcile.sha256 NOT NULL);
CREATE TABLE zhiban_handoff.host_read_authorizations(
 deployment_id uuid NOT NULL REFERENCES zhiban_reconcile.installations(deployment_id),
 release_id zhiban_reconcile.v7 NOT NULL,credential_generation_id zhiban_reconcile.v7 NOT NULL,
 epoch bigint NOT NULL CHECK(epoch>0),token_digest zhiban_reconcile.sha256 NOT NULL,
 artifact_manifest_digest zhiban_reconcile.sha256 NOT NULL,handoff_receipt_digest zhiban_reconcile.sha256,
 configuration_digest zhiban_reconcile.sha256 NOT NULL,profile_digest zhiban_reconcile.sha256 NOT NULL,
 source_digest zhiban_reconcile.sha256 NOT NULL,status text NOT NULL CHECK(status IN('REGISTERED','ACTIVE','REVOKED')),
 CHECK((status='REGISTERED' AND handoff_receipt_digest IS NULL) OR (status='ACTIVE' AND handoff_receipt_digest IS NOT NULL) OR status='REVOKED'),
 PRIMARY KEY(deployment_id,release_id)
);
CREATE TABLE zhiban_handoff.clear_authorizations(
 approval_id zhiban_reconcile.v7 PRIMARY KEY,deployment_id uuid NOT NULL,release_id zhiban_reconcile.v7 NOT NULL,
 window_id zhiban_reconcile.v7 NOT NULL REFERENCES zhiban_reconcile.windows(window_id),epoch bigint NOT NULL CHECK(epoch>0),
 fence_id zhiban_reconcile.v7 NOT NULL,fence_sequence bigint NOT NULL CHECK(fence_sequence>0),
 token_digest zhiban_reconcile.sha256 NOT NULL,approval_digest zhiban_reconcile.sha256 NOT NULL,
 target_gate_digest zhiban_reconcile.sha256 NOT NULL,pointer_digest zhiban_reconcile.sha256 NOT NULL,
 fence_history_digest zhiban_reconcile.sha256 NOT NULL,
 backend_pid integer NOT NULL,backend_start timestamptz NOT NULL,postmaster_start timestamptz NOT NULL,
 issued_at zhiban_reconcile.millis NOT NULL,expires_at zhiban_reconcile.millis NOT NULL,
 status text NOT NULL CHECK(status IN('ISSUED','CONSUMED','REVOKED')),
 CHECK(expires_at>issued_at AND expires_at-issued_at<=300000),
 FOREIGN KEY(deployment_id,release_id) REFERENCES zhiban_handoff.host_read_authorizations(deployment_id,release_id),
 UNIQUE(deployment_id,fence_sequence),UNIQUE(fence_id)
);
CREATE TABLE zhiban_handoff.clear_commits(
 approval_id zhiban_reconcile.v7 PRIMARY KEY REFERENCES zhiban_handoff.clear_authorizations(approval_id),
 deployment_id uuid NOT NULL,release_id zhiban_reconcile.v7 NOT NULL,
 window_id zhiban_reconcile.v7 NOT NULL,epoch bigint NOT NULL CHECK(epoch>0),
 fence_id zhiban_reconcile.v7 NOT NULL,fence_sequence bigint NOT NULL CHECK(fence_sequence>0),
 target_gate_digest zhiban_reconcile.sha256 NOT NULL,approval_digest zhiban_reconcile.sha256 NOT NULL,
 actor_role text NOT NULL CHECK(actor_role='zhiban_reconcile_controller'),
 backend_pid integer NOT NULL,backend_start timestamptz NOT NULL,postmaster_start timestamptz NOT NULL,
 recorded_at zhiban_reconcile.millis NOT NULL,
 FOREIGN KEY(deployment_id,release_id) REFERENCES zhiban_handoff.host_read_authorizations(deployment_id,release_id),
 UNIQUE(deployment_id,fence_sequence),UNIQUE(fence_id)
);
CREATE TABLE zhiban_handoff.guard_scopes(
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,approval_id zhiban_reconcile.v7 NOT NULL REFERENCES zhiban_handoff.clear_authorizations(approval_id),
 PRIMARY KEY(backend_pid,transaction_id)
);
-- No read authorization, clear approval, ready/service/grant or commit is seeded.

CREATE TABLE zhiban_handoff.authorization_events(
 event_sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 authorization_kind text NOT NULL CHECK(authorization_kind IN('HOST','CLEAR')),
 deployment_id uuid NOT NULL,scope_id uuid NOT NULL,
 old_status text,new_status text NOT NULL,binding_digest zhiban_reconcile.sha256 NOT NULL,
 actor_role text NOT NULL,occurred_at zhiban_reconcile.millis NOT NULL
);

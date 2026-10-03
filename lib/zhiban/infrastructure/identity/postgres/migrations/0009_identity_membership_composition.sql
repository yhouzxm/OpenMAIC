-- C8-S01--S08. New migration; applied 0001--0008 remain byte-for-byte unchanged.
-- Approval/consent/outcome references close at checked COMMIT, never partial success.
CREATE TABLE zhiban_identity.identity_control_approvals (
  approval_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(approval_id)),
  PRIMARY KEY (approval_id),
  purpose text NOT NULL CHECK (purpose IN ('USER_CREATE','USER_DISABLE','USER_RESTORE','TENANT_CREATE','TENANT_DISABLE','TENANT_RESTORE','MEMBER_ADMISSION','FIRST_TENANT_ADMIN')),
  environment_ref text COLLATE "C" NOT NULL CHECK (environment_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  approval_ref text COLLATE "C" NOT NULL CHECK (approval_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  operator_ref text COLLATE "C" NOT NULL CHECK (operator_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  approver_ref text COLLATE "C" NOT NULL CHECK (approver_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  UNIQUE (approval_ref),
  CHECK (operator_ref<>approver_ref),
  operator_user_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(operator_user_id)),
  expected_operator_user_revision bigint NOT NULL CHECK (expected_operator_user_revision>0),
  system_admin_grant_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(system_admin_grant_id)),
  expected_admin_grant_revision bigint NOT NULL CHECK (expected_admin_grant_revision>0),
  command_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(command_id)),
  UNIQUE (command_id),
  manifest_digest text NOT NULL CHECK (octet_length(manifest_digest)=64 AND manifest_digest ~ '^[a-f0-9]{64}$'),
  catalog_digest text NOT NULL CHECK (octet_length(catalog_digest)=64 AND catalog_digest ~ '^[a-f0-9]{64}$'),
  action_version text NOT NULL CHECK (action_version='identity-v1'),
  delegation_version text NOT NULL CHECK (delegation_version='identity-v1'),
  target_user_id uuid CHECK (target_user_id IS NULL OR zhiban_identity.is_uuid_v7(target_user_id)),
  tenant_id uuid CHECK (tenant_id IS NULL OR zhiban_identity.is_uuid_v7(tenant_id)),
  planned_user_id uuid CHECK (planned_user_id IS NULL OR zhiban_identity.is_uuid_v7(planned_user_id)),
  planned_tenant_id uuid CHECK (planned_tenant_id IS NULL OR zhiban_identity.is_uuid_v7(planned_tenant_id)),
  target_membership_id uuid CHECK (target_membership_id IS NULL OR zhiban_identity.is_uuid_v7(target_membership_id)),
  planned_membership_id uuid CHECK (planned_membership_id IS NULL OR zhiban_identity.is_uuid_v7(planned_membership_id)),
  planned_grant_id uuid CHECK (planned_grant_id IS NULL OR zhiban_identity.is_uuid_v7(planned_grant_id)),
  expected_user_revision bigint CHECK (expected_user_revision>0),
  expected_tenant_revision bigint CHECK (expected_tenant_revision>0),
  expected_member_revision bigint CHECK (expected_member_revision>0),
  expected_auth_version bigint CHECK (expected_auth_version BETWEEN 0 AND 9007199254740991),
  valid_until bigint CHECK (valid_until BETWEEN 0 AND 8640000000000000),
  tenant_code text COLLATE "C" CHECK (tenant_code ~ '^[a-z][a-z0-9_-]{0,63}$'),
  tenant_display_name text CHECK (octet_length(tenant_display_name) BETWEEN 1 AND 256 AND length(btrim(tenant_display_name))>0),
  admission_purpose text CHECK (admission_purpose IN ('INVITE','REACTIVATE','REJOIN')),
  issued_at bigint NOT NULL CHECK (issued_at BETWEEN 0 AND 8640000000000000),
  expires_at bigint NOT NULL CHECK (expires_at BETWEEN 0 AND 8640000000000000),
  CHECK (expires_at>issued_at AND expires_at-issued_at<=86400000),
  consumed_at bigint CHECK (consumed_at BETWEEN 0 AND 8640000000000000),
  UNIQUE (tenant_id,approval_id,target_user_id),
  FOREIGN KEY (operator_user_id) REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (system_admin_grant_id) REFERENCES zhiban_identity.system_admin_grants(grant_id) ON DELETE RESTRICT,
  FOREIGN KEY (target_user_id) REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id) REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,target_membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id) ON DELETE RESTRICT,
  CHECK ((CASE purpose
    WHEN 'USER_CREATE' THEN planned_user_id IS NOT NULL AND target_user_id IS NULL AND expected_user_revision IS NULL AND tenant_id IS NULL
    WHEN 'USER_DISABLE' THEN target_user_id IS NOT NULL AND expected_user_revision IS NOT NULL AND planned_user_id IS NULL AND tenant_id IS NULL AND target_user_id<>operator_user_id
    WHEN 'USER_RESTORE' THEN target_user_id IS NOT NULL AND expected_user_revision IS NOT NULL AND planned_user_id IS NULL AND tenant_id IS NULL AND target_user_id<>operator_user_id
    WHEN 'TENANT_CREATE' THEN planned_tenant_id IS NOT NULL AND tenant_id IS NULL AND expected_tenant_revision IS NULL AND tenant_code IS NOT NULL AND tenant_display_name IS NOT NULL AND target_user_id IS NULL
    WHEN 'TENANT_DISABLE' THEN tenant_id IS NOT NULL AND expected_tenant_revision IS NOT NULL AND planned_tenant_id IS NULL AND target_user_id IS NULL
    WHEN 'TENANT_RESTORE' THEN tenant_id IS NOT NULL AND expected_tenant_revision IS NOT NULL AND planned_tenant_id IS NULL AND target_user_id IS NULL
    WHEN 'MEMBER_ADMISSION' THEN tenant_id IS NOT NULL AND target_user_id IS NOT NULL AND expected_user_revision IS NOT NULL AND expected_tenant_revision IS NOT NULL AND admission_purpose IS NOT NULL AND
      ((admission_purpose='INVITE' AND target_membership_id IS NULL AND expected_member_revision IS NULL AND expected_auth_version IS NULL)
       OR (admission_purpose IN ('REACTIVATE','REJOIN') AND target_membership_id IS NOT NULL AND expected_member_revision IS NOT NULL AND expected_auth_version IS NOT NULL))
    WHEN 'FIRST_TENANT_ADMIN' THEN tenant_id IS NOT NULL AND target_user_id IS NOT NULL AND target_user_id<>operator_user_id AND expected_user_revision IS NOT NULL AND expected_tenant_revision IS NOT NULL AND planned_membership_id IS NOT NULL AND planned_grant_id IS NOT NULL AND target_membership_id IS NULL
    ELSE false END) IS TRUE),
  CHECK ((purpose='USER_CREATE')=(planned_user_id IS NOT NULL)),
  CHECK ((purpose='TENANT_CREATE')=(planned_tenant_id IS NOT NULL)),
  CHECK ((purpose='TENANT_CREATE')=(tenant_code IS NOT NULL) AND (purpose='TENANT_CREATE')=(tenant_display_name IS NOT NULL)),
  CHECK ((purpose='FIRST_TENANT_ADMIN')=(planned_membership_id IS NOT NULL) AND (purpose='FIRST_TENANT_ADMIN')=(planned_grant_id IS NOT NULL)),
  CHECK ((purpose='MEMBER_ADMISSION')=(admission_purpose IS NOT NULL)),
  CHECK (purpose IN ('MEMBER_ADMISSION','FIRST_TENANT_ADMIN') OR (target_membership_id IS NULL AND expected_member_revision IS NULL AND expected_auth_version IS NULL)),
  CHECK (purpose='FIRST_TENANT_ADMIN' OR valid_until IS NULL),
  CHECK (valid_until IS NULL OR valid_until>issued_at),
  CHECK (consumed_at IS NULL OR (consumed_at>=issued_at AND consumed_at<expires_at))
);
ALTER TABLE zhiban_identity.identity_control_approvals OWNER TO zhiban_identity_owner;
REVOKE ALL ON TABLE zhiban_identity.identity_control_approvals FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;

CREATE TABLE zhiban_identity.identity_member_admissions (
  admission_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(admission_id)),
  PRIMARY KEY (admission_id),
  tenant_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(tenant_id)),
  user_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(user_id)),
  FOREIGN KEY (tenant_id) REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  subject_user_revision bigint NOT NULL CHECK (subject_user_revision>0),
  purpose text NOT NULL CHECK (purpose IN ('INVITE','REACTIVATE','REJOIN')),
  source_kind text NOT NULL CHECK (source_kind='OPERATOR_IMPORT'),
  control_approval_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(control_approval_id)),
  UNIQUE (control_approval_id),
  expected_member_revision bigint CHECK (expected_member_revision>0),
  expected_auth_version bigint CHECK (expected_auth_version BETWEEN 0 AND 9007199254740991),
  issued_at bigint NOT NULL CHECK (issued_at BETWEEN 0 AND 8640000000000000),
  expires_at bigint NOT NULL CHECK (expires_at BETWEEN 0 AND 8640000000000000),
  CHECK (expires_at>issued_at AND expires_at-issued_at<=86400000),
  repository_revision bigint NOT NULL DEFAULT 1 CHECK (repository_revision IN (1,2)),
  consumed_at bigint CHECK (consumed_at BETWEEN 0 AND 8640000000000000),
  membership_id uuid CHECK (membership_id IS NULL OR zhiban_identity.is_uuid_v7(membership_id)),
  command_id uuid CHECK (command_id IS NULL OR zhiban_identity.is_uuid_v7(command_id)),
  audit_event_id bigint CHECK (audit_event_id>0) REFERENCES zhiban_identity.audit_events(event_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (tenant_id,admission_id),
  UNIQUE (tenant_id,admission_id,user_id),
  FOREIGN KEY (tenant_id,control_approval_id,user_id) REFERENCES zhiban_identity.identity_control_approvals(tenant_id,approval_id,target_user_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (((purpose='INVITE' AND expected_member_revision IS NULL AND expected_auth_version IS NULL)
    OR (purpose IN ('REACTIVATE','REJOIN') AND membership_id IS NOT NULL AND expected_member_revision IS NOT NULL AND expected_auth_version IS NOT NULL)) IS TRUE),
  CHECK (((repository_revision=1 AND consumed_at IS NULL AND command_id IS NULL AND audit_event_id IS NULL AND (purpose<>'INVITE' OR membership_id IS NULL))
    OR (repository_revision=2 AND consumed_at IS NOT NULL AND membership_id IS NOT NULL AND command_id IS NOT NULL AND audit_event_id IS NOT NULL AND consumed_at>=issued_at AND consumed_at<expires_at)) IS TRUE)
);
ALTER TABLE zhiban_identity.identity_member_admissions OWNER TO zhiban_identity_owner;
REVOKE ALL ON TABLE zhiban_identity.identity_member_admissions FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;

CREATE TABLE zhiban_identity.identity_member_consents (
  consent_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(consent_id)),
  PRIMARY KEY (consent_id),
  tenant_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(tenant_id)),
  user_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(user_id)),
  FOREIGN KEY (tenant_id) REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  subject_user_revision bigint NOT NULL CHECK (subject_user_revision>0),
  purpose text NOT NULL CHECK (purpose IN ('ACTIVATE','REACTIVATE','REJOIN','FIRST_TENANT_ADMIN')),
  admission_id uuid CHECK (admission_id IS NULL OR zhiban_identity.is_uuid_v7(admission_id)),
  membership_id uuid CHECK (membership_id IS NULL OR zhiban_identity.is_uuid_v7(membership_id)),
  control_approval_id uuid CHECK (control_approval_id IS NULL OR zhiban_identity.is_uuid_v7(control_approval_id)),
  expected_member_revision bigint CHECK (expected_member_revision>0),
  expected_auth_version bigint CHECK (expected_auth_version BETWEEN 0 AND 9007199254740991),
  manifest_digest text NOT NULL CHECK (octet_length(manifest_digest)=64 AND manifest_digest ~ '^[a-f0-9]{64}$'),
  issued_at bigint NOT NULL CHECK (issued_at BETWEEN 0 AND 8640000000000000),
  expires_at bigint NOT NULL CHECK (expires_at BETWEEN 0 AND 8640000000000000),
  CHECK (expires_at>issued_at AND expires_at-issued_at<=86400000),
  request_id text COLLATE "C" NOT NULL CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  command_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(command_id)),
  audit_event_id bigint CHECK (audit_event_id>0) REFERENCES zhiban_identity.audit_events(event_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (audit_event_id IS NOT NULL),
  UNIQUE (tenant_id,consent_id),
  UNIQUE (tenant_id,admission_id),
  FOREIGN KEY (tenant_id,admission_id,user_id) REFERENCES zhiban_identity.identity_member_admissions(tenant_id,admission_id,user_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id,control_approval_id,user_id) REFERENCES zhiban_identity.identity_control_approvals(tenant_id,approval_id,target_user_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (((purpose='FIRST_TENANT_ADMIN' AND control_approval_id IS NOT NULL AND admission_id IS NULL AND membership_id IS NULL AND expected_member_revision IS NULL AND expected_auth_version IS NULL)
    OR (purpose IN ('ACTIVATE','REACTIVATE','REJOIN') AND control_approval_id IS NULL AND admission_id IS NOT NULL AND membership_id IS NOT NULL AND expected_member_revision IS NOT NULL AND expected_auth_version IS NOT NULL)) IS TRUE)
);
ALTER TABLE zhiban_identity.identity_member_consents OWNER TO zhiban_identity_owner;
REVOKE ALL ON TABLE zhiban_identity.identity_member_consents FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;

CREATE TABLE zhiban_identity.identity_tenant_commands (
  command_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(command_id)),
  PRIMARY KEY (command_id),
  tenant_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(tenant_id)),
  actor_user_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(actor_user_id)),
  actor_membership_id uuid CHECK (actor_membership_id IS NULL OR zhiban_identity.is_uuid_v7(actor_membership_id)),
  action text NOT NULL CHECK (action IN ('MEMBERSHIP_PENDING_CREATE','MEMBERSHIP_CONSENT_RECORD','MEMBERSHIP_ACTIVATE','MEMBERSHIP_DISABLE','MEMBERSHIP_LEAVE_ADMIN','MEMBERSHIP_REACTIVATE','MEMBERSHIP_REJOIN','ROLE_GRANT','ROLE_REVOKE','ROLE_REPLACE','MEMBERSHIP_ATOMIC_TRANSFER')),
  idempotency_key text COLLATE "C" NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{1,128}$'),
  intent_digest text NOT NULL CHECK (octet_length(intent_digest)=64 AND intent_digest ~ '^[a-f0-9]{64}$'),
  request_id text COLLATE "C" NOT NULL CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  completed_at bigint NOT NULL CHECK (completed_at BETWEEN 0 AND 8640000000000000),
  outcome_kind text NOT NULL CHECK (outcome_kind IN ('APPLIED','TRUE_NO_OP')),
  UNIQUE (tenant_id,command_id),
  UNIQUE (tenant_id,actor_user_id,action,idempotency_key),
  FOREIGN KEY (tenant_id) REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id) REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,actor_membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (actor_membership_id IS NOT NULL OR action='MEMBERSHIP_CONSENT_RECORD')
);
ALTER TABLE zhiban_identity.identity_tenant_commands OWNER TO zhiban_identity_owner;
REVOKE ALL ON TABLE zhiban_identity.identity_tenant_commands FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;

CREATE TABLE zhiban_identity.identity_member_approvals (
  approval_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(approval_id)),
  PRIMARY KEY (approval_id),
  tenant_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(tenant_id)),
  command_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(command_id)),
  target_ordinal smallint NOT NULL CHECK (target_ordinal BETWEEN 0 AND 1),
  target_user_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(target_user_id)),
  membership_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(membership_id)),
  action text NOT NULL CHECK (action IN ('MEMBERSHIP_ACTIVATE','MEMBERSHIP_REACTIVATE','MEMBERSHIP_REJOIN','ROLE_GRANT','ROLE_REPLACE')),
  mode text CHECK (mode IN ('PRESERVE_EXISTING_VALID_GRANTS','REPLACE_GRANTS')),
  expected_member_revision bigint NOT NULL CHECK (expected_member_revision>0),
  expected_auth_version bigint NOT NULL CHECK (expected_auth_version BETWEEN 0 AND 9007199254740991),
  approver_user_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(approver_user_id)),
  approver_membership_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(approver_membership_id)),
  approver_member_revision bigint NOT NULL CHECK (approver_member_revision>0),
  approver_auth_version bigint NOT NULL CHECK (approver_auth_version BETWEEN 0 AND 9007199254740991),
  approver_user_revision bigint NOT NULL CHECK (approver_user_revision>0),
  authority_grant_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(authority_grant_id)),
  tenant_revision bigint NOT NULL CHECK (tenant_revision>0),
  catalog_digest text NOT NULL CHECK (octet_length(catalog_digest)=64 AND catalog_digest ~ '^[a-f0-9]{64}$'),
  action_version text NOT NULL CHECK (action_version='identity-v1'),
  delegation_version text NOT NULL CHECK (delegation_version='identity-v1'),
  intent_digest text NOT NULL CHECK (octet_length(intent_digest)=64 AND intent_digest ~ '^[a-f0-9]{64}$'),
  consent_id uuid CHECK (consent_id IS NULL OR zhiban_identity.is_uuid_v7(consent_id)),
  approved_at bigint NOT NULL CHECK (approved_at BETWEEN 0 AND 8640000000000000),
  consumed_at bigint NOT NULL CHECK (consumed_at BETWEEN 0 AND 8640000000000000),
  CHECK (approved_at=consumed_at),
  UNIQUE (tenant_id,approval_id),
  UNIQUE (tenant_id,command_id,target_ordinal),
  FOREIGN KEY (tenant_id,command_id) REFERENCES zhiban_identity.identity_tenant_commands(tenant_id,command_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (target_user_id) REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (approver_user_id) REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,approver_membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (authority_grant_id) REFERENCES zhiban_identity.role_grants(grant_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id,consent_id) REFERENCES zhiban_identity.identity_member_consents(tenant_id,consent_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK ((action='MEMBERSHIP_REACTIVATE')=(mode IS NOT NULL)),
  CHECK ((action IN ('MEMBERSHIP_ACTIVATE','MEMBERSHIP_REACTIVATE','MEMBERSHIP_REJOIN'))=(consent_id IS NOT NULL))
);
ALTER TABLE zhiban_identity.identity_member_approvals OWNER TO zhiban_identity_owner;
REVOKE ALL ON TABLE zhiban_identity.identity_member_approvals FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;

CREATE TABLE zhiban_identity.identity_member_approval_grants (
  tenant_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(tenant_id)),
  approval_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(approval_id)),
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 15),
  grant_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(grant_id)),
  grant_mode text NOT NULL CHECK (grant_mode IN ('NEW','PRESERVE')),
  role_code text NOT NULL CHECK (role_code IN ('STUDENT','TEACHER','TENANT_ADMIN')),
  scope_kind text NOT NULL CHECK (scope_kind IN ('SELF','CLASS','COURSE','TENANT')),
  scope_id uuid CHECK (scope_id IS NULL OR zhiban_identity.is_uuid_v7(scope_id)),
  created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
  valid_from bigint NOT NULL CHECK (valid_from BETWEEN 0 AND 8640000000000000),
  valid_until bigint CHECK (valid_until BETWEEN 0 AND 8640000000000000),
  PRIMARY KEY (tenant_id,approval_id,ordinal),
  UNIQUE (tenant_id,approval_id,grant_id),
  FOREIGN KEY (tenant_id,approval_id) REFERENCES zhiban_identity.identity_member_approvals(tenant_id,approval_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (grant_id) REFERENCES zhiban_identity.role_grants(grant_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (((scope_kind IN ('SELF','TENANT') AND scope_id IS NULL) OR (scope_kind IN ('CLASS','COURSE') AND scope_id IS NOT NULL)) IS TRUE),
  CHECK (valid_from>=created_at AND (valid_until IS NULL OR valid_until>valid_from))
);
ALTER TABLE zhiban_identity.identity_member_approval_grants OWNER TO zhiban_identity_owner;
REVOKE ALL ON TABLE zhiban_identity.identity_member_approval_grants FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;

CREATE TABLE zhiban_identity.identity_tenant_command_effects (
  tenant_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(tenant_id)),
  command_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(command_id)),
  target_ordinal smallint NOT NULL CHECK (target_ordinal BETWEEN 0 AND 1),
  target_user_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(target_user_id)),
  membership_id uuid CHECK (membership_id IS NULL OR zhiban_identity.is_uuid_v7(membership_id)),
  before_revision bigint CHECK (before_revision>0),
  after_revision bigint CHECK (after_revision>0),
  before_auth_version bigint CHECK (before_auth_version BETWEEN 0 AND 9007199254740991),
  after_auth_version bigint CHECK (after_auth_version BETWEEN 0 AND 9007199254740991),
  after_status text CHECK (after_status IN ('PENDING','ACTIVE','DISABLED','LEFT')),
  admission_id uuid CHECK (admission_id IS NULL OR zhiban_identity.is_uuid_v7(admission_id)),
  consent_id uuid CHECK (consent_id IS NULL OR zhiban_identity.is_uuid_v7(consent_id)),
  approval_id uuid CHECK (approval_id IS NULL OR zhiban_identity.is_uuid_v7(approval_id)),
  audit_event_id bigint CHECK (audit_event_id>0) REFERENCES zhiban_identity.audit_events(event_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY (tenant_id,command_id,target_ordinal),
  FOREIGN KEY (tenant_id,command_id) REFERENCES zhiban_identity.identity_tenant_commands(tenant_id,command_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (target_user_id) REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id,admission_id) REFERENCES zhiban_identity.identity_member_admissions(tenant_id,admission_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id,consent_id) REFERENCES zhiban_identity.identity_member_consents(tenant_id,consent_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id,approval_id) REFERENCES zhiban_identity.identity_member_approvals(tenant_id,approval_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (((membership_id IS NULL AND before_revision IS NULL AND after_revision IS NULL AND before_auth_version IS NULL AND after_auth_version IS NULL AND after_status IS NULL AND consent_id IS NOT NULL AND audit_event_id IS NOT NULL)
   OR (membership_id IS NOT NULL AND after_revision IS NOT NULL AND after_auth_version IS NOT NULL AND after_status IS NOT NULL AND
     ((before_revision IS NULL AND before_auth_version IS NULL AND after_revision=1 AND after_auth_version=0 AND after_status='PENDING' AND audit_event_id IS NOT NULL)
      OR (before_revision IS NOT NULL AND before_auth_version IS NOT NULL AND
        ((after_revision=before_revision AND after_auth_version=before_auth_version)
         OR (after_revision=before_revision+1 AND after_auth_version=before_auth_version+1 AND audit_event_id IS NOT NULL)))))) IS TRUE)
);
ALTER TABLE zhiban_identity.identity_tenant_command_effects OWNER TO zhiban_identity_owner;
REVOKE ALL ON TABLE zhiban_identity.identity_tenant_command_effects FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;

CREATE TABLE zhiban_identity.identity_control_commands (
  command_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(command_id)),
  PRIMARY KEY (command_id),
  actor_user_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(actor_user_id)),
  action text NOT NULL CHECK (action IN ('USER_CREATE','USER_DISABLE','USER_RESTORE','TENANT_CREATE','TENANT_DISABLE','TENANT_RESTORE','MEMBER_ADMISSION','FIRST_TENANT_ADMIN')),
  idempotency_key text COLLATE "C" NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{1,128}$'),
  intent_digest text NOT NULL CHECK (octet_length(intent_digest)=64 AND intent_digest ~ '^[a-f0-9]{64}$'),
  approval_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(approval_id)),
  UNIQUE (approval_id),
  request_id text COLLATE "C" NOT NULL CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  completed_at bigint NOT NULL CHECK (completed_at BETWEEN 0 AND 8640000000000000),
  outcome_kind text NOT NULL CHECK (outcome_kind IN ('APPLIED','TRUE_NO_OP')),
  UNIQUE (actor_user_id,action,idempotency_key),
  FOREIGN KEY (actor_user_id) REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (approval_id) REFERENCES zhiban_identity.identity_control_approvals(approval_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE zhiban_identity.identity_control_commands OWNER TO zhiban_identity_owner;
REVOKE ALL ON TABLE zhiban_identity.identity_control_commands FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;

CREATE TABLE zhiban_identity.identity_control_command_effects (
  command_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(command_id)),
  PRIMARY KEY (command_id),
  target_kind text NOT NULL CHECK (target_kind IN ('USER','TENANT','ADMISSION','FIRST_TENANT_ADMIN')),
  target_user_id uuid CHECK (target_user_id IS NULL OR zhiban_identity.is_uuid_v7(target_user_id)),
  tenant_id uuid CHECK (tenant_id IS NULL OR zhiban_identity.is_uuid_v7(tenant_id)),
  membership_id uuid CHECK (membership_id IS NULL OR zhiban_identity.is_uuid_v7(membership_id)),
  grant_id uuid CHECK (grant_id IS NULL OR zhiban_identity.is_uuid_v7(grant_id)),
  admission_id uuid CHECK (admission_id IS NULL OR zhiban_identity.is_uuid_v7(admission_id)),
  before_revision bigint CHECK (before_revision>0),
  after_revision bigint CHECK (after_revision>0),
  after_auth_version bigint CHECK (after_auth_version BETWEEN 0 AND 9007199254740991),
  after_status text CHECK (after_status IN ('ACTIVE','DISABLED','PENDING','LEFT')),
  audit_event_id bigint CHECK (audit_event_id>0) REFERENCES zhiban_identity.audit_events(event_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  additional_audit_event_id bigint CHECK (additional_audit_event_id>0) REFERENCES zhiban_identity.audit_events(event_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (command_id) REFERENCES zhiban_identity.identity_control_commands(command_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (target_user_id) REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id) REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (grant_id) REFERENCES zhiban_identity.role_grants(grant_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id,admission_id) REFERENCES zhiban_identity.identity_member_admissions(tenant_id,admission_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK ((CASE target_kind
WHEN 'USER' THEN target_user_id IS NOT NULL AND tenant_id IS NULL AND membership_id IS NULL AND grant_id IS NULL AND admission_id IS NULL AND after_revision IS NOT NULL AND after_status IN ('ACTIVE','DISABLED') AND after_auth_version IS NULL AND (audit_event_id IS NOT NULL OR (before_revision IS NOT NULL AND after_revision=before_revision)) AND additional_audit_event_id IS NULL
 WHEN 'TENANT' THEN tenant_id IS NOT NULL AND target_user_id IS NULL AND membership_id IS NULL AND grant_id IS NULL AND admission_id IS NULL AND after_revision IS NOT NULL AND after_status IN ('ACTIVE','DISABLED') AND after_auth_version IS NULL AND (audit_event_id IS NOT NULL OR (before_revision IS NOT NULL AND after_revision=before_revision)) AND additional_audit_event_id IS NULL
 WHEN 'ADMISSION' THEN tenant_id IS NOT NULL AND target_user_id IS NOT NULL AND admission_id IS NOT NULL AND membership_id IS NULL AND grant_id IS NULL AND before_revision IS NULL AND after_revision IS NULL AND after_auth_version IS NULL AND after_status IS NULL AND audit_event_id IS NULL AND additional_audit_event_id IS NULL
 WHEN 'FIRST_TENANT_ADMIN' THEN tenant_id IS NOT NULL AND target_user_id IS NOT NULL AND membership_id IS NOT NULL AND grant_id IS NOT NULL AND admission_id IS NULL AND before_revision IS NULL AND after_revision=2 AND after_auth_version=1 AND after_status='ACTIVE' AND audit_event_id IS NOT NULL AND additional_audit_event_id IS NOT NULL AND audit_event_id<>additional_audit_event_id
 ELSE false END) IS TRUE)
);
ALTER TABLE zhiban_identity.identity_control_command_effects OWNER TO zhiban_identity_owner;
REVOKE ALL ON TABLE zhiban_identity.identity_control_command_effects FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;

CREATE TABLE zhiban_identity.identity_tenant_onboarding (
  tenant_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(tenant_id)),
  PRIMARY KEY (tenant_id),
  repository_revision bigint NOT NULL CHECK (repository_revision>0),
  created_command_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(created_command_id)),
  UNIQUE (created_command_id),
  completed_at bigint CHECK (completed_at BETWEEN 0 AND 8640000000000000),
  approval_id uuid CHECK (approval_id IS NULL OR zhiban_identity.is_uuid_v7(approval_id)),
  UNIQUE (approval_id),
  command_id uuid CHECK (command_id IS NULL OR zhiban_identity.is_uuid_v7(command_id)),
  UNIQUE (command_id),
  consent_id uuid CHECK (consent_id IS NULL OR zhiban_identity.is_uuid_v7(consent_id)),
  user_id uuid CHECK (user_id IS NULL OR zhiban_identity.is_uuid_v7(user_id)),
  membership_id uuid CHECK (membership_id IS NULL OR zhiban_identity.is_uuid_v7(membership_id)),
  grant_id uuid CHECK (grant_id IS NULL OR zhiban_identity.is_uuid_v7(grant_id)),
  pending_event_id bigint CHECK (pending_event_id>0) REFERENCES zhiban_identity.audit_events(event_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  activation_event_id bigint CHECK (activation_event_id>0) REFERENCES zhiban_identity.audit_events(event_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id) REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_command_id) REFERENCES zhiban_identity.identity_control_commands(command_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (approval_id) REFERENCES zhiban_identity.identity_control_approvals(approval_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (command_id) REFERENCES zhiban_identity.identity_control_commands(command_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id,consent_id) REFERENCES zhiban_identity.identity_member_consents(tenant_id,consent_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (user_id) REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (grant_id) REFERENCES zhiban_identity.role_grants(grant_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (((repository_revision=1 AND completed_at IS NULL AND approval_id IS NULL AND command_id IS NULL AND consent_id IS NULL AND user_id IS NULL AND membership_id IS NULL AND grant_id IS NULL AND pending_event_id IS NULL AND activation_event_id IS NULL)
 OR (repository_revision=2 AND completed_at IS NOT NULL AND approval_id IS NOT NULL AND command_id IS NOT NULL AND consent_id IS NOT NULL AND user_id IS NOT NULL AND membership_id IS NOT NULL AND grant_id IS NOT NULL AND pending_event_id IS NOT NULL AND activation_event_id IS NOT NULL AND pending_event_id<>activation_event_id)) IS TRUE)
);
ALTER TABLE zhiban_identity.identity_tenant_onboarding OWNER TO zhiban_identity_owner;
REVOKE ALL ON TABLE zhiban_identity.identity_tenant_onboarding FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;

ALTER TABLE zhiban_identity.identity_member_admissions ADD FOREIGN KEY (tenant_id,command_id)
  REFERENCES zhiban_identity.identity_tenant_commands(tenant_id,command_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE zhiban_identity.identity_member_consents ADD FOREIGN KEY (tenant_id,command_id)
  REFERENCES zhiban_identity.identity_tenant_commands(tenant_id,command_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX identity_member_consents_first_approval_unique ON zhiban_identity.identity_member_consents(control_approval_id) WHERE purpose='FIRST_TENANT_ADMIN';
CREATE INDEX identity_member_admissions_available_idx ON zhiban_identity.identity_member_admissions(tenant_id,user_id,purpose,expires_at) WHERE consumed_at IS NULL;
CREATE INDEX identity_member_consents_member_idx ON zhiban_identity.identity_member_consents(tenant_id,membership_id,purpose,issued_at) WHERE purpose<>'FIRST_TENANT_ADMIN';
CREATE INDEX identity_member_approvals_member_idx ON zhiban_identity.identity_member_approvals(tenant_id,membership_id,consumed_at);
CREATE INDEX identity_member_approval_grants_grant_idx ON zhiban_identity.identity_member_approval_grants(tenant_id,grant_id);
CREATE INDEX identity_control_approvals_available_idx ON zhiban_identity.identity_control_approvals(purpose,tenant_id,target_user_id,expires_at) WHERE consumed_at IS NULL;

CREATE FUNCTION zhiban_identity.identity_session_step_up_guard(p_digest text,p_expected_user_id uuid,p_expected_user_revision bigint,p_expected_slot_revision bigint,p_expected_epoch bigint,p_proof_at bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on
AS $body$
DECLARE v_user_revision bigint; v_epoch bigint; v_slot bigint; v_at bigint;
BEGIN
  IF session_user NOT IN ('zhiban_runtime','zhiban_control_runtime') THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
  IF p_expected_user_revision IS NULL OR p_expected_slot_revision IS NULL OR p_expected_epoch IS NULL OR p_proof_at IS NULL
    OR p_expected_user_revision<=0 OR p_expected_slot_revision<=0 OR p_expected_epoch<=0 THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
  SELECT g.user_revision,g.security_epoch INTO STRICT v_user_revision,v_epoch
    FROM zhiban_identity.identity_session_guard(p_digest,p_expected_user_id) AS g;
  SELECT s.repository_revision INTO STRICT v_slot FROM zhiban_identity.credential_slots AS s
    WHERE s.user_id=p_expected_user_id FOR SHARE;
  v_at := floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
  IF v_user_revision<>p_expected_user_revision OR v_slot<>p_expected_slot_revision OR v_epoch<>p_expected_epoch
    OR p_proof_at<0 OR v_at<p_proof_at OR v_at-p_proof_at>=300000 THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501';
END;
$body$;
ALTER FUNCTION zhiban_identity.identity_session_step_up_guard(text,uuid,bigint,bigint,bigint,bigint) OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_session_step_up_guard(text,uuid,bigint,bigint,bigint,bigint) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_session_step_up_guard(text,uuid,bigint,bigint,bigint,bigint) TO zhiban_runtime,zhiban_control_runtime;

CREATE FUNCTION zhiban_identity.identity_member_admission_state(p_tenant_id uuid,p_actor_membership_id uuid,p_admission_id uuid) RETURNS TABLE(fact_kind text,tenant_id uuid,tenant_status text,tenant_revision bigint,membership_id uuid,user_id uuid,user_status text,user_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on
AS $body$
DECLARE v_t zhiban_identity.tenants%ROWTYPE; v_a zhiban_identity.identity_member_admissions%ROWTYPE;
 v_ids uuid[]; v_id uuid; v_actor uuid;
BEGIN
 IF session_user NOT IN ('zhiban_runtime') THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 IF p_tenant_id IS NULL OR p_actor_membership_id IS NULL OR p_admission_id IS NULL
   OR NOT zhiban_identity.is_uuid_v7(p_tenant_id) OR NOT zhiban_identity.is_uuid_v7(p_actor_membership_id)
   OR NOT zhiban_identity.is_uuid_v7(p_admission_id) OR zhiban_identity.current_tenant_id() IS DISTINCT FROM p_tenant_id THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 SELECT t.* INTO STRICT v_t FROM zhiban_identity.tenants AS t WHERE t.tenant_id=p_tenant_id FOR UPDATE;
 IF v_t.status<>'ACTIVE' THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 SELECT a.* INTO STRICT v_a FROM zhiban_identity.identity_member_admissions AS a WHERE a.tenant_id=p_tenant_id AND a.admission_id=p_admission_id;
 SELECT m.user_id INTO STRICT v_actor FROM zhiban_identity.memberships AS m WHERE m.tenant_id=p_tenant_id AND m.membership_id=p_actor_membership_id AND m.status='ACTIVE';
 SELECT array_agg(DISTINCT candidates.uid ORDER BY candidates.uid) INTO v_ids FROM (
   SELECT v_actor AS uid UNION ALL SELECT v_a.user_id
   UNION ALL SELECT m.user_id FROM zhiban_identity.memberships AS m JOIN zhiban_identity.role_grants AS g
     ON g.tenant_id=m.tenant_id AND g.membership_id=m.membership_id
     WHERE m.tenant_id=p_tenant_id AND m.status='ACTIVE' AND g.role_code='TENANT_ADMIN' AND g.revoked_at IS NULL
 ) AS candidates;
 IF cardinality(v_ids)>256 THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 FOREACH v_id IN ARRAY v_ids LOOP
   PERFORM u.user_id FROM zhiban_identity.users AS u WHERE u.user_id=v_id FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 END LOOP;
 RETURN QUERY SELECT 'TENANT'::text,v_t.tenant_id,v_t.status,v_t.repository_revision,NULL::uuid,NULL::uuid,NULL::text,NULL::bigint;
 RETURN QUERY SELECT 'USER'::text,v_t.tenant_id,NULL::text,NULL::bigint,m.membership_id,u.user_id,u.status,u.repository_revision
   FROM zhiban_identity.memberships AS m JOIN zhiban_identity.users AS u ON u.user_id=m.user_id
   WHERE m.tenant_id=p_tenant_id AND m.user_id=ANY(v_ids) ORDER BY u.user_id;
 RETURN QUERY SELECT 'ADMISSION_USER'::text,v_t.tenant_id,NULL::text,NULL::bigint,v_a.membership_id,u.user_id,u.status,u.repository_revision
   FROM zhiban_identity.users AS u WHERE u.user_id=v_a.user_id;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501';
END;
$body$;
ALTER FUNCTION zhiban_identity.identity_member_admission_state(uuid,uuid,uuid) OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_member_admission_state(uuid,uuid,uuid) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_member_admission_state(uuid,uuid,uuid) TO zhiban_runtime;

CREATE FUNCTION zhiban_identity.identity_member_consent_context(p_digest text,p_expected_user_id uuid,p_tenant_id uuid,p_admission_id uuid,p_control_approval_id uuid) RETURNS TABLE(membership_id uuid,member_revision bigint,auth_version bigint,purpose text,expires_at bigint)
LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on
AS $body$
DECLARE v_at bigint; v_previous text; v_a zhiban_identity.identity_member_admissions%ROWTYPE;
 v_c zhiban_identity.identity_control_approvals%ROWTYPE; v_m zhiban_identity.memberships%ROWTYPE; v_t zhiban_identity.tenants%ROWTYPE;
BEGIN
 IF session_user NOT IN ('zhiban_runtime') THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 IF p_tenant_id IS NULL OR zhiban_identity.current_tenant_id() IS DISTINCT FROM p_tenant_id
   OR (p_admission_id IS NULL)=(p_control_approval_id IS NULL) THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 SELECT t.* INTO STRICT v_t FROM zhiban_identity.tenants AS t WHERE t.tenant_id=p_tenant_id FOR UPDATE;
 IF v_t.status<>'ACTIVE' THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 PERFORM u.user_id FROM zhiban_identity.users AS u WHERE u.user_id=p_expected_user_id AND u.status='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 PERFORM g.user_id FROM zhiban_identity.identity_session_guard(p_digest,p_expected_user_id) AS g;
 v_at := floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
 IF p_admission_id IS NOT NULL THEN
   SELECT a.* INTO STRICT v_a FROM zhiban_identity.identity_member_admissions AS a WHERE a.tenant_id=p_tenant_id AND a.admission_id=p_admission_id AND a.user_id=p_expected_user_id;
   SELECT m.* INTO STRICT v_m FROM zhiban_identity.memberships AS m WHERE m.tenant_id=p_tenant_id AND m.membership_id=v_a.membership_id AND m.user_id=p_expected_user_id;
   IF v_at<v_a.issued_at OR v_at>=v_a.expires_at
     OR (SELECT u.repository_revision FROM zhiban_identity.users AS u WHERE u.user_id=p_expected_user_id)<>v_a.subject_user_revision
     OR NOT ((v_a.purpose='INVITE' AND v_a.consumed_at IS NOT NULL AND v_m.status='PENDING')
       OR (v_a.purpose='REACTIVATE' AND v_a.consumed_at IS NULL AND v_m.status='DISABLED')
       OR (v_a.purpose='REJOIN' AND v_a.consumed_at IS NULL AND v_m.status='LEFT'))
     OR (v_a.purpose<>'INVITE' AND (v_m.repository_revision<>v_a.expected_member_revision OR v_m.authorization_version<>v_a.expected_auth_version)) THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
   RETURN QUERY SELECT v_m.membership_id,v_m.repository_revision,v_m.authorization_version,
     (CASE WHEN v_a.purpose='INVITE' THEN 'ACTIVATE' ELSE v_a.purpose END)::text,v_a.expires_at;
 ELSE
   SELECT a.* INTO STRICT v_c FROM zhiban_identity.identity_control_approvals AS a WHERE a.tenant_id=p_tenant_id AND a.approval_id=p_control_approval_id AND a.target_user_id=p_expected_user_id AND a.purpose='FIRST_TENANT_ADMIN';
   IF v_at<v_c.issued_at OR v_at>=v_c.expires_at OR v_c.consumed_at IS NOT NULL OR v_t.repository_revision<>v_c.expected_tenant_revision
     OR (SELECT u.repository_revision FROM zhiban_identity.users AS u WHERE u.user_id=p_expected_user_id)<>v_c.expected_user_revision
     OR NOT EXISTS (SELECT 1 FROM zhiban_identity.identity_tenant_onboarding AS o WHERE o.tenant_id=p_tenant_id AND o.repository_revision=1)
     OR EXISTS (SELECT 1 FROM zhiban_identity.memberships AS m WHERE m.tenant_id=p_tenant_id)
     OR EXISTS (SELECT 1 FROM zhiban_identity.role_grants AS g WHERE g.tenant_id=p_tenant_id) THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
   RETURN QUERY SELECT NULL::uuid,NULL::bigint,NULL::bigint,'FIRST_TENANT_ADMIN'::text,v_c.expires_at;
 END IF;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501';
END;
$body$;
ALTER FUNCTION zhiban_identity.identity_member_consent_context(text,uuid,uuid,uuid,uuid) OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_member_consent_context(text,uuid,uuid,uuid,uuid) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_member_consent_context(text,uuid,uuid,uuid,uuid) TO zhiban_runtime;

CREATE FUNCTION zhiban_identity.identity_tenant_restore_guard(p_tenant_id uuid,p_actor_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on
AS $body$
DECLARE v_previous text; v_t zhiban_identity.tenants%ROWTYPE; v_ids uuid[]; v_id uuid;
 v_at bigint; v_governance bigint; v_operational bigint;
BEGIN
 v_previous := current_setting('app.tenant_id',true);
 IF session_user NOT IN ('zhiban_control_runtime') THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 IF p_tenant_id IS NULL OR p_actor_user_id IS NULL OR NOT zhiban_identity.is_uuid_v7(p_tenant_id) OR NOT zhiban_identity.is_uuid_v7(p_actor_user_id) THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 SELECT t.* INTO STRICT v_t FROM zhiban_identity.tenants AS t WHERE t.tenant_id=p_tenant_id FOR UPDATE;
 IF v_t.status NOT IN ('ACTIVE','DISABLED') THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 PERFORM set_config('app.tenant_id',p_tenant_id::text,true);
 SELECT array_agg(DISTINCT candidates.uid ORDER BY candidates.uid) INTO v_ids FROM (
   SELECT p_actor_user_id AS uid UNION ALL
   SELECT m.user_id FROM zhiban_identity.memberships AS m JOIN zhiban_identity.role_grants AS g ON g.tenant_id=m.tenant_id AND g.membership_id=m.membership_id
   WHERE m.tenant_id=p_tenant_id AND m.status='ACTIVE' AND g.role_code='TENANT_ADMIN' AND g.revoked_at IS NULL
 ) AS candidates;
 IF cardinality(v_ids)>256 THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 FOREACH v_id IN ARRAY v_ids LOOP
   PERFORM u.user_id FROM zhiban_identity.users AS u WHERE u.user_id=v_id FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 END LOOP;
 v_at := floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
 SELECT count(DISTINCT m.membership_id),count(DISTINCT m.membership_id) FILTER (WHERE u.status='ACTIVE' AND g.scope_kind='TENANT')
   INTO v_governance,v_operational
   FROM zhiban_identity.memberships AS m JOIN zhiban_identity.role_grants AS g ON g.tenant_id=m.tenant_id AND g.membership_id=m.membership_id
   JOIN zhiban_identity.users AS u ON u.user_id=m.user_id
   WHERE m.tenant_id=p_tenant_id AND m.status='ACTIVE' AND g.role_code='TENANT_ADMIN' AND g.revoked_at IS NULL
     AND g.valid_from<=v_at AND (g.valid_until IS NULL OR v_at<g.valid_until);
 IF v_governance<1 OR v_operational<1 THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 PERFORM set_config('app.tenant_id',coalesce(v_previous,''),true);
 RETURN;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.tenant_id',coalesce(v_previous,''),true); RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501';
END;
$body$;
ALTER FUNCTION zhiban_identity.identity_tenant_restore_guard(uuid,uuid) OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_tenant_restore_guard(uuid,uuid) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_tenant_restore_guard(uuid,uuid) TO zhiban_control_runtime;

CREATE FUNCTION zhiban_identity.identity_member_admission_register(p_digest text,p_actor_user_id uuid,p_approval_id uuid,p_admission_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on
AS $body$
DECLARE v_a zhiban_identity.identity_control_approvals%ROWTYPE; v_t zhiban_identity.tenants%ROWTYPE;
 v_source zhiban_identity.identity_member_admissions%ROWTYPE;
 v_command zhiban_identity.identity_control_commands%ROWTYPE;
 v_effect zhiban_identity.identity_control_command_effects%ROWTYPE;
 v_id uuid; v_at bigint; v_previous text; v_capacity text; v_count bigint;
BEGIN
 v_previous := current_setting('app.tenant_id',true);
 IF session_user NOT IN ('zhiban_control_runtime') THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 IF p_admission_id IS NULL OR NOT zhiban_identity.is_uuid_v7(p_admission_id) THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 SELECT a.* INTO STRICT v_a FROM zhiban_identity.identity_control_approvals AS a WHERE a.approval_id=p_approval_id AND a.operator_user_id=p_actor_user_id AND a.purpose='MEMBER_ADMISSION';
 SELECT t.* INTO STRICT v_t FROM zhiban_identity.tenants AS t WHERE t.tenant_id=v_a.tenant_id FOR UPDATE;
 IF v_t.status<>'ACTIVE' OR v_t.repository_revision<>v_a.expected_tenant_revision THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 FOR v_id IN SELECT DISTINCT x.uid FROM unnest(ARRAY[p_actor_user_id,v_a.target_user_id]) AS x(uid) ORDER BY x.uid LOOP
   PERFORM u.user_id FROM zhiban_identity.users AS u WHERE u.user_id=v_id AND u.status='ACTIVE' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 END LOOP;
 PERFORM g.user_id FROM zhiban_identity.identity_session_guard(p_digest,p_actor_user_id) AS g;
 SELECT a.* INTO STRICT v_a FROM zhiban_identity.identity_control_approvals AS a WHERE a.approval_id=p_approval_id FOR SHARE;
 PERFORM g.grant_id FROM zhiban_identity.system_admin_grants AS g WHERE g.grant_id=v_a.system_admin_grant_id AND g.user_id=p_actor_user_id
   AND g.repository_revision=v_a.expected_admin_grant_revision AND g.revoked_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 v_at := floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
 IF v_at<v_a.issued_at OR v_at>=v_a.expires_at
   OR (SELECT u.repository_revision FROM zhiban_identity.users AS u WHERE u.user_id=p_actor_user_id)<>v_a.expected_operator_user_revision
   OR (SELECT u.repository_revision FROM zhiban_identity.users AS u WHERE u.user_id=v_a.target_user_id)<>v_a.expected_user_revision
   OR NOT EXISTS (SELECT 1 FROM zhiban_identity.system_admin_grants AS g WHERE g.grant_id=v_a.system_admin_grant_id
     AND g.valid_from<=v_at AND (g.valid_until IS NULL OR v_at<g.valid_until)) THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 v_previous := current_setting('app.tenant_id',true); PERFORM set_config('app.tenant_id',v_a.tenant_id::text,true);
 IF v_a.consumed_at IS NOT NULL THEN
   -- Already consumed approval: strict read-only confirmation of the original,
   -- still-unconsumed source. Never re-run INSERT or allocate a new identifier.
   SELECT c.* INTO STRICT v_command FROM zhiban_identity.identity_control_commands AS c WHERE c.command_id=v_a.command_id;
   SELECT e.* INTO STRICT v_effect FROM zhiban_identity.identity_control_command_effects AS e WHERE e.command_id=v_command.command_id;
   SELECT a.* INTO STRICT v_source FROM zhiban_identity.identity_member_admissions AS a
     WHERE a.tenant_id=v_a.tenant_id AND a.admission_id=p_admission_id;
   IF (v_command.actor_user_id=p_actor_user_id AND v_command.action='MEMBER_ADMISSION'
     AND v_command.approval_id=v_a.approval_id AND v_command.outcome_kind='APPLIED'
     AND v_command.completed_at=v_a.consumed_at AND v_a.issued_at<=v_command.completed_at AND v_command.completed_at<=v_at
     AND v_effect.target_kind='ADMISSION' AND v_effect.target_user_id=v_a.target_user_id AND v_effect.tenant_id=v_a.tenant_id
     AND v_effect.admission_id=p_admission_id AND v_effect.membership_id IS NULL AND v_effect.grant_id IS NULL
     AND v_effect.before_revision IS NULL AND v_effect.after_revision IS NULL AND v_effect.after_auth_version IS NULL
     AND v_effect.after_status IS NULL AND v_effect.audit_event_id IS NULL AND v_effect.additional_audit_event_id IS NULL
     AND v_source.control_approval_id=v_a.approval_id AND v_source.user_id=v_a.target_user_id
     AND v_source.subject_user_revision=v_a.expected_user_revision AND v_source.purpose=v_a.admission_purpose
     AND v_source.source_kind='OPERATOR_IMPORT' AND v_source.repository_revision=1 AND v_source.consumed_at IS NULL
     AND v_source.command_id IS NULL AND v_source.audit_event_id IS NULL
     AND v_source.membership_id IS NOT DISTINCT FROM v_a.target_membership_id
     AND v_source.expected_member_revision IS NOT DISTINCT FROM v_a.expected_member_revision
     AND v_source.expected_auth_version IS NOT DISTINCT FROM v_a.expected_auth_version
     AND v_source.issued_at=v_a.issued_at AND v_source.expires_at=v_a.expires_at) IS NOT TRUE
   THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
   IF v_a.admission_purpose='INVITE' THEN
     IF EXISTS (SELECT 1 FROM zhiban_identity.memberships AS m WHERE m.tenant_id=v_a.tenant_id AND m.user_id=v_a.target_user_id)
     THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
   ELSE
     IF NOT EXISTS (SELECT 1 FROM zhiban_identity.memberships AS m WHERE m.tenant_id=v_a.tenant_id AND m.membership_id=v_a.target_membership_id
       AND m.user_id=v_a.target_user_id AND m.repository_revision=v_a.expected_member_revision AND m.authorization_version=v_a.expected_auth_version
       AND m.status=(CASE WHEN v_a.admission_purpose='REACTIVATE' THEN 'DISABLED' ELSE 'LEFT' END))
     THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
   END IF;
   PERFORM set_config('app.tenant_id',coalesce(v_previous,''),true);
   RETURN p_admission_id;
 END IF;
 v_capacity:=current_setting('app.identity_member_capacity',true);
 IF v_capacity IS NULL OR v_capacity !~ '^[1-9][0-9]{0,6}$' THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 IF v_capacity::bigint>1000000 THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO v_count FROM (
   SELECT 1 FROM zhiban_identity.identity_member_admissions AS x WHERE x.tenant_id=v_a.tenant_id
   UNION ALL SELECT 1 FROM zhiban_identity.identity_member_consents AS x WHERE x.tenant_id=v_a.tenant_id
   UNION ALL SELECT 1 FROM zhiban_identity.identity_member_approvals AS x WHERE x.tenant_id=v_a.tenant_id
   UNION ALL SELECT 1 FROM zhiban_identity.identity_member_approval_grants AS x WHERE x.tenant_id=v_a.tenant_id
   UNION ALL SELECT 1 FROM zhiban_identity.identity_tenant_commands AS x WHERE x.tenant_id=v_a.tenant_id
   UNION ALL SELECT 1 FROM zhiban_identity.identity_tenant_command_effects AS x WHERE x.tenant_id=v_a.tenant_id
   LIMIT (v_capacity::bigint+1)) AS bounded_records;
 IF v_count+1>v_capacity::bigint THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 IF v_a.admission_purpose='INVITE' THEN
   IF EXISTS (SELECT 1 FROM zhiban_identity.memberships AS m WHERE m.tenant_id=v_a.tenant_id AND m.user_id=v_a.target_user_id) THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 ELSE
   IF NOT EXISTS (SELECT 1 FROM zhiban_identity.memberships AS m WHERE m.tenant_id=v_a.tenant_id AND m.membership_id=v_a.target_membership_id
     AND m.user_id=v_a.target_user_id AND m.repository_revision=v_a.expected_member_revision AND m.authorization_version=v_a.expected_auth_version
     AND m.status=(CASE WHEN v_a.admission_purpose='REACTIVATE' THEN 'DISABLED' ELSE 'LEFT' END)) THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 END IF;
 INSERT INTO zhiban_identity.identity_member_admissions
 (admission_id,tenant_id,user_id,subject_user_revision,purpose,source_kind,control_approval_id,expected_member_revision,expected_auth_version,issued_at,expires_at,repository_revision,membership_id)
 VALUES (p_admission_id,v_a.tenant_id,v_a.target_user_id,v_a.expected_user_revision,v_a.admission_purpose,'OPERATOR_IMPORT',v_a.approval_id,v_a.expected_member_revision,v_a.expected_auth_version,v_a.issued_at,v_a.expires_at,1,v_a.target_membership_id);
 PERFORM set_config('app.tenant_id',coalesce(v_previous,''),true);
 RETURN p_admission_id;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.tenant_id',coalesce(v_previous,''),true); RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501';
END;
$body$;
ALTER FUNCTION zhiban_identity.identity_member_admission_register(text,uuid,uuid,uuid) OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_member_admission_register(text,uuid,uuid,uuid) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_member_admission_register(text,uuid,uuid,uuid) TO zhiban_control_runtime;

CREATE FUNCTION zhiban_identity.identity_first_tenant_admin_lock(p_tenant_id uuid,p_approval_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on
AS $body$
DECLARE v_a zhiban_identity.identity_control_approvals%ROWTYPE; v_t zhiban_identity.tenants%ROWTYPE;
 v_id uuid; v_previous text; v_at bigint;
 v_o zhiban_identity.identity_tenant_onboarding%ROWTYPE;
 v_c zhiban_identity.identity_member_consents%ROWTYPE;
 v_cc zhiban_identity.identity_control_commands%ROWTYPE;
 v_ce zhiban_identity.identity_control_command_effects%ROWTYPE;
 v_tc zhiban_identity.identity_tenant_commands%ROWTYPE;
 v_te zhiban_identity.identity_tenant_command_effects%ROWTYPE;
 v_m zhiban_identity.memberships%ROWTYPE; v_g zhiban_identity.role_grants%ROWTYPE;
 v_pending zhiban_identity.audit_events%ROWTYPE; v_active zhiban_identity.audit_events%ROWTYPE;
 v_consent_event zhiban_identity.audit_events%ROWTYPE;
BEGIN
 v_previous := current_setting('app.tenant_id',true);
 IF session_user NOT IN ('zhiban_control_runtime') THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 IF p_tenant_id IS NULL OR p_approval_id IS NULL OR NOT zhiban_identity.is_uuid_v7(p_tenant_id)
   OR NOT zhiban_identity.is_uuid_v7(p_approval_id) THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 SELECT t.* INTO STRICT v_t FROM zhiban_identity.tenants AS t WHERE t.tenant_id=p_tenant_id FOR UPDATE;
 SELECT a.* INTO STRICT v_a FROM zhiban_identity.identity_control_approvals AS a WHERE a.tenant_id=p_tenant_id AND a.approval_id=p_approval_id AND a.purpose='FIRST_TENANT_ADMIN';
 PERFORM set_config('app.tenant_id',p_tenant_id::text,true);
 FOR v_id IN SELECT DISTINCT x.uid FROM unnest(ARRAY[v_a.operator_user_id,v_a.target_user_id]) AS x(uid) ORDER BY x.uid LOOP
   PERFORM u.user_id FROM zhiban_identity.users AS u WHERE u.user_id=v_id AND u.status='ACTIVE' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 END LOOP;
 SELECT o.* INTO STRICT v_o FROM zhiban_identity.identity_tenant_onboarding AS o WHERE o.tenant_id=p_tenant_id FOR UPDATE;
 -- Fresh reread after all serialization locks, never a caller-selected branch.
 SELECT a.* INTO STRICT v_a FROM zhiban_identity.identity_control_approvals AS a WHERE a.tenant_id=p_tenant_id AND a.approval_id=p_approval_id AND a.purpose='FIRST_TENANT_ADMIN';
 v_at := floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
 IF NOT (v_t.status='ACTIVE' AND v_t.repository_revision=v_a.expected_tenant_revision
   AND v_a.operator_user_id<>v_a.target_user_id AND v_a.issued_at<=v_at AND v_at<v_a.expires_at
   AND (SELECT u.repository_revision FROM zhiban_identity.users AS u WHERE u.user_id=v_a.operator_user_id)=v_a.expected_operator_user_revision
   AND (SELECT u.repository_revision FROM zhiban_identity.users AS u WHERE u.user_id=v_a.target_user_id)=v_a.expected_user_revision) IS TRUE
   THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 IF v_o.repository_revision=1 THEN
   IF v_a.consumed_at IS NOT NULL OR v_o.completed_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM zhiban_identity.memberships AS m WHERE m.tenant_id=p_tenant_id)
     OR EXISTS (SELECT 1 FROM zhiban_identity.role_grants AS g WHERE g.tenant_id=p_tenant_id)
     THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 ELSIF v_o.repository_revision=2 THEN
   -- Terminal branch is SELECT-only. It does not authorize apply or consume anything.
   SELECT c.* INTO STRICT v_cc FROM zhiban_identity.identity_control_commands AS c WHERE c.command_id=v_o.command_id;
   SELECT e.* INTO STRICT v_ce FROM zhiban_identity.identity_control_command_effects AS e WHERE e.command_id=v_cc.command_id;
   SELECT c.* INTO STRICT v_c FROM zhiban_identity.identity_member_consents AS c WHERE c.tenant_id=p_tenant_id AND c.consent_id=v_o.consent_id;
   SELECT c.* INTO STRICT v_tc FROM zhiban_identity.identity_tenant_commands AS c WHERE c.tenant_id=p_tenant_id AND c.command_id=v_c.command_id;
   SELECT e.* INTO STRICT v_te FROM zhiban_identity.identity_tenant_command_effects AS e WHERE e.tenant_id=p_tenant_id AND e.command_id=v_tc.command_id AND e.target_ordinal=0;
   SELECT m.* INTO STRICT v_m FROM zhiban_identity.memberships AS m WHERE m.tenant_id=p_tenant_id AND m.membership_id=v_o.membership_id;
   SELECT g.* INTO STRICT v_g FROM zhiban_identity.role_grants AS g WHERE g.tenant_id=p_tenant_id AND g.grant_id=v_o.grant_id;
   SELECT e.* INTO STRICT v_pending FROM zhiban_identity.audit_events AS e WHERE e.event_id=v_o.pending_event_id;
   SELECT e.* INTO STRICT v_active FROM zhiban_identity.audit_events AS e WHERE e.event_id=v_o.activation_event_id;
   SELECT e.* INTO STRICT v_consent_event FROM zhiban_identity.audit_events AS e WHERE e.event_id=v_c.audit_event_id;
   IF NOT (v_o.approval_id=p_approval_id AND v_o.command_id=v_a.command_id AND v_o.user_id=v_a.target_user_id
     AND v_o.membership_id=v_a.planned_membership_id AND v_o.grant_id=v_a.planned_grant_id
     AND v_a.consumed_at=v_o.completed_at AND v_cc.completed_at=v_o.completed_at
     AND v_cc.actor_user_id=v_a.operator_user_id AND v_cc.action='FIRST_TENANT_ADMIN' AND v_cc.outcome_kind='APPLIED'
     AND v_cc.approval_id=p_approval_id AND v_ce.target_kind='FIRST_TENANT_ADMIN'
     AND v_ce.tenant_id=p_tenant_id AND v_ce.target_user_id=v_o.user_id AND v_ce.membership_id=v_o.membership_id AND v_ce.grant_id=v_o.grant_id
     AND v_ce.after_revision=2 AND v_ce.after_auth_version=1 AND v_ce.after_status='ACTIVE'
     AND v_ce.audit_event_id=v_o.pending_event_id AND v_ce.additional_audit_event_id=v_o.activation_event_id
     AND v_c.purpose='FIRST_TENANT_ADMIN' AND v_c.control_approval_id=p_approval_id AND v_c.user_id=v_o.user_id
     AND v_c.subject_user_revision=v_a.expected_user_revision AND v_c.manifest_digest=v_a.manifest_digest
     AND v_c.issued_at<=v_o.completed_at AND v_o.completed_at<v_c.expires_at AND v_c.issued_at<=v_at AND v_at<v_c.expires_at
     AND v_a.issued_at<=v_o.completed_at AND v_o.completed_at<v_a.expires_at
     AND v_tc.actor_user_id=v_o.user_id AND v_tc.actor_membership_id IS NULL AND v_tc.action='MEMBERSHIP_CONSENT_RECORD'
     AND v_tc.outcome_kind='APPLIED' AND v_tc.completed_at=v_c.issued_at AND v_tc.request_id=v_c.request_id
     AND v_te.target_user_id=v_o.user_id AND v_te.membership_id IS NULL AND v_te.consent_id=v_c.consent_id AND v_te.audit_event_id=v_c.audit_event_id
     AND v_m.user_id=v_o.user_id AND v_m.status='ACTIVE' AND v_m.repository_revision=2 AND v_m.authorization_version=1
     AND v_m.created_at=v_o.completed_at AND v_m.updated_at=v_o.completed_at AND v_m.disabled_at IS NULL AND v_m.disabled_reason IS NULL
     AND v_g.membership_id=v_m.membership_id AND v_g.grant_ordinal=0 AND v_g.role_code='TENANT_ADMIN'
     AND v_g.scope_kind='TENANT' AND v_g.scope_id IS NULL AND v_g.revoked_at IS NULL
     AND v_g.created_at=v_o.completed_at AND v_g.valid_from=v_o.completed_at AND v_g.valid_until IS NOT DISTINCT FROM v_a.valid_until
     AND v_g.valid_from<=v_at AND (v_g.valid_until IS NULL OR v_at<v_g.valid_until)
     AND v_pending.event_scope='TENANT' AND v_pending.tenant_id=p_tenant_id AND v_pending.subject_user_id=v_o.user_id
     AND v_pending.subject_membership_id=v_o.membership_id AND v_pending.event_type='MEMBERSHIP_PENDING_CREATED'
     AND v_pending.actor_type='SERVICE' AND v_pending.actor_service_code='identity_tenant_onboarding'
     AND v_pending.occurred_at=v_o.completed_at AND v_pending.request_id=v_cc.request_id
     AND v_pending.authorization_version_before IS NULL AND v_pending.authorization_version_after=0 AND v_pending.event_payload='{}'::jsonb
     AND v_active.event_scope='TENANT' AND v_active.tenant_id=p_tenant_id AND v_active.subject_user_id=v_o.user_id
     AND v_active.subject_membership_id=v_o.membership_id AND v_active.event_type='MEMBERSHIP_ACTIVATED'
     AND v_active.actor_type='SERVICE' AND v_active.actor_service_code='identity_tenant_onboarding'
     AND v_active.occurred_at=v_o.completed_at AND v_active.request_id=v_cc.request_id
     AND v_active.authorization_version_before=0 AND v_active.authorization_version_after=1
     AND v_active.event_payload=jsonb_build_object('priorGrantIds','[]'::jsonb,'approvedGrants',jsonb_build_array(jsonb_build_object(
       'id',v_g.grant_id::text,'roleCode','TENANT_ADMIN','scope',jsonb_build_object('type','TENANT','scopeId',NULL),
       'validFrom',v_g.valid_from,'validUntil',v_g.valid_until)))
     AND v_consent_event.event_scope='TENANT' AND v_consent_event.tenant_id=p_tenant_id AND v_consent_event.subject_user_id=v_o.user_id
     AND v_consent_event.subject_membership_id IS NULL AND v_consent_event.event_type='MEMBERSHIP_CONSENT_RECORDED'
     AND v_consent_event.actor_type='USER' AND v_consent_event.actor_user_id=v_o.user_id AND v_consent_event.occurred_at=v_c.issued_at
     AND v_consent_event.request_id=v_c.request_id AND v_consent_event.authorization_version_before IS NULL
     AND v_consent_event.authorization_version_after IS NULL AND v_consent_event.event_payload=jsonb_build_object('purpose','FIRST_TENANT_ADMIN')) IS TRUE
     OR EXISTS (SELECT 1 FROM zhiban_identity.role_grants AS g WHERE g.tenant_id=p_tenant_id AND g.membership_id=v_m.membership_id AND g.grant_id<>v_g.grant_id)
     OR (SELECT count(*) FROM zhiban_identity.identity_tenant_command_effects AS e WHERE e.tenant_id=p_tenant_id AND e.command_id=v_tc.command_id)<>1
     THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501';
 END IF;
 PERFORM set_config('app.tenant_id',coalesce(v_previous,''),true);
 RETURN;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.tenant_id',coalesce(v_previous,''),true); RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501';
END;
$body$;
ALTER FUNCTION zhiban_identity.identity_first_tenant_admin_lock(uuid,uuid) OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_first_tenant_admin_lock(uuid,uuid) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_first_tenant_admin_lock(uuid,uuid) TO zhiban_control_runtime;

CREATE FUNCTION zhiban_identity.identity_first_tenant_admin_apply(p_tenant_id uuid,p_approval_id uuid,p_consent_id uuid,p_at bigint) RETURNS TABLE(membership_id uuid,member_revision bigint,authorization_version bigint,grant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on
AS $body$
DECLARE v_a zhiban_identity.identity_control_approvals%ROWTYPE; v_c zhiban_identity.identity_member_consents%ROWTYPE;
 v_at bigint; v_previous text; v_previous_approval text;
BEGIN
 v_previous := current_setting('app.tenant_id',true);
 v_previous_approval := current_setting('app.onboarding_approval_id',true);
 IF session_user NOT IN ('zhiban_control_runtime') THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 PERFORM zhiban_identity.identity_first_tenant_admin_lock(p_tenant_id,p_approval_id);
 SELECT a.* INTO STRICT v_a FROM zhiban_identity.identity_control_approvals AS a WHERE a.approval_id=p_approval_id AND a.tenant_id=p_tenant_id FOR SHARE;
 PERFORM set_config('app.tenant_id',p_tenant_id::text,true); PERFORM set_config('app.onboarding_approval_id',p_approval_id::text,true);
 -- Lock success may mean read-only terminal confirmation; apply never accepts it.
 IF v_a.consumed_at IS NOT NULL
   OR NOT EXISTS (SELECT 1 FROM zhiban_identity.identity_tenant_onboarding AS o WHERE o.tenant_id=p_tenant_id AND o.repository_revision=1 AND o.completed_at IS NULL)
   OR EXISTS (SELECT 1 FROM zhiban_identity.memberships AS m WHERE m.tenant_id=p_tenant_id)
   OR EXISTS (SELECT 1 FROM zhiban_identity.role_grants AS g WHERE g.tenant_id=p_tenant_id)
   THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 SELECT c.* INTO STRICT v_c FROM zhiban_identity.identity_member_consents AS c WHERE c.tenant_id=p_tenant_id AND c.consent_id=p_consent_id
   AND c.control_approval_id=p_approval_id AND c.user_id=v_a.target_user_id AND c.purpose='FIRST_TENANT_ADMIN';
 v_at := floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
 IF p_at IS NULL OR p_at<0 OR p_at>v_at OR v_at-p_at>=300000 OR p_at<v_a.issued_at OR v_at>=v_a.expires_at
   OR p_at<v_c.issued_at OR v_at>=v_c.expires_at OR v_c.manifest_digest<>v_a.manifest_digest
   OR (v_a.valid_until IS NOT NULL AND v_at>=v_a.valid_until)
   OR (SELECT u.repository_revision FROM zhiban_identity.users AS u WHERE u.user_id=v_a.target_user_id)<>v_a.expected_user_revision
   OR v_c.subject_user_revision<>v_a.expected_user_revision
   OR (SELECT u.repository_revision FROM zhiban_identity.users AS u WHERE u.user_id=v_a.operator_user_id)<>v_a.expected_operator_user_revision
   OR NOT EXISTS (SELECT 1 FROM zhiban_identity.system_admin_grants AS g WHERE g.grant_id=v_a.system_admin_grant_id AND g.user_id=v_a.operator_user_id
     AND g.repository_revision=v_a.expected_admin_grant_revision AND g.revoked_at IS NULL AND g.valid_from<=v_at AND (g.valid_until IS NULL OR v_at<g.valid_until)) THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 INSERT INTO zhiban_identity.memberships(membership_id,tenant_id,user_id,status,created_at,updated_at,authorization_version,repository_revision)
 VALUES(v_a.planned_membership_id,p_tenant_id,v_a.target_user_id,'PENDING',p_at,p_at,0,1);
 UPDATE zhiban_identity.memberships AS m SET status='ACTIVE',updated_at=p_at,authorization_version=1,repository_revision=2
 WHERE m.tenant_id=p_tenant_id AND m.membership_id=v_a.planned_membership_id AND m.status='PENDING' AND m.repository_revision=1 AND m.authorization_version=0;
 IF NOT FOUND THEN RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501'; END IF;
 INSERT INTO zhiban_identity.role_grants(grant_id,tenant_id,membership_id,grant_ordinal,role_code,scope_kind,scope_id,created_at,valid_from,valid_until,revoked_at)
 VALUES(v_a.planned_grant_id,p_tenant_id,v_a.planned_membership_id,0,'TENANT_ADMIN','TENANT',NULL,p_at,p_at,v_a.valid_until,NULL);
 PERFORM set_config('app.tenant_id',coalesce(v_previous,''),true); PERFORM set_config('app.onboarding_approval_id',coalesce(v_previous_approval,''),true);
 RETURN QUERY SELECT v_a.planned_membership_id,2::bigint,1::bigint,v_a.planned_grant_id;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.tenant_id',coalesce(v_previous,''),true); PERFORM set_config('app.onboarding_approval_id',coalesce(v_previous_approval,''),true); RAISE EXCEPTION 'Identity command rejected.' USING ERRCODE='42501';
END;
$body$;
ALTER FUNCTION zhiban_identity.identity_first_tenant_admin_apply(uuid,uuid,uuid,bigint) OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_first_tenant_admin_apply(uuid,uuid,uuid,bigint) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_first_tenant_admin_apply(uuid,uuid,uuid,bigint) TO zhiban_control_runtime;

-- Exact C8 table/column grants and 25 RLS policy additions.
ALTER TABLE zhiban_identity.identity_member_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_identity.identity_member_admissions FORCE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE zhiban_identity.identity_member_admissions TO zhiban_runtime;
CREATE POLICY identity_member_admissions_tenant_select ON zhiban_identity.identity_member_admissions FOR SELECT TO zhiban_runtime USING (tenant_id=zhiban_identity.current_tenant_id());
CREATE POLICY identity_member_admissions_owner_select ON zhiban_identity.identity_member_admissions FOR SELECT TO zhiban_identity_owner USING (tenant_id=zhiban_identity.current_tenant_id());
ALTER TABLE zhiban_identity.identity_member_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_identity.identity_member_consents FORCE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE zhiban_identity.identity_member_consents TO zhiban_runtime;
CREATE POLICY identity_member_consents_tenant_select ON zhiban_identity.identity_member_consents FOR SELECT TO zhiban_runtime USING (tenant_id=zhiban_identity.current_tenant_id());
CREATE POLICY identity_member_consents_owner_select ON zhiban_identity.identity_member_consents FOR SELECT TO zhiban_identity_owner USING (tenant_id=zhiban_identity.current_tenant_id());
GRANT INSERT (consent_id,tenant_id,user_id,subject_user_revision,purpose,admission_id,membership_id,control_approval_id,expected_member_revision,expected_auth_version,manifest_digest,issued_at,expires_at,request_id,command_id,audit_event_id) ON zhiban_identity.identity_member_consents TO zhiban_runtime;
CREATE POLICY identity_member_consents_tenant_insert ON zhiban_identity.identity_member_consents FOR INSERT TO zhiban_runtime WITH CHECK (tenant_id=zhiban_identity.current_tenant_id());
ALTER TABLE zhiban_identity.identity_tenant_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_identity.identity_tenant_commands FORCE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE zhiban_identity.identity_tenant_commands TO zhiban_runtime;
CREATE POLICY identity_tenant_commands_tenant_select ON zhiban_identity.identity_tenant_commands FOR SELECT TO zhiban_runtime USING (tenant_id=zhiban_identity.current_tenant_id());
CREATE POLICY identity_tenant_commands_owner_select ON zhiban_identity.identity_tenant_commands FOR SELECT TO zhiban_identity_owner USING (tenant_id=zhiban_identity.current_tenant_id());
GRANT INSERT (command_id,tenant_id,actor_user_id,actor_membership_id,action,idempotency_key,intent_digest,request_id,completed_at,outcome_kind) ON zhiban_identity.identity_tenant_commands TO zhiban_runtime;
CREATE POLICY identity_tenant_commands_tenant_insert ON zhiban_identity.identity_tenant_commands FOR INSERT TO zhiban_runtime WITH CHECK (tenant_id=zhiban_identity.current_tenant_id());
ALTER TABLE zhiban_identity.identity_member_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_identity.identity_member_approvals FORCE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE zhiban_identity.identity_member_approvals TO zhiban_runtime;
CREATE POLICY identity_member_approvals_tenant_select ON zhiban_identity.identity_member_approvals FOR SELECT TO zhiban_runtime USING (tenant_id=zhiban_identity.current_tenant_id());
CREATE POLICY identity_member_approvals_owner_select ON zhiban_identity.identity_member_approvals FOR SELECT TO zhiban_identity_owner USING (tenant_id=zhiban_identity.current_tenant_id());
GRANT INSERT (approval_id,tenant_id,command_id,target_ordinal,target_user_id,membership_id,action,mode,expected_member_revision,expected_auth_version,approver_user_id,approver_membership_id,approver_member_revision,approver_auth_version,approver_user_revision,authority_grant_id,tenant_revision,catalog_digest,action_version,delegation_version,intent_digest,consent_id,approved_at,consumed_at) ON zhiban_identity.identity_member_approvals TO zhiban_runtime;
CREATE POLICY identity_member_approvals_tenant_insert ON zhiban_identity.identity_member_approvals FOR INSERT TO zhiban_runtime WITH CHECK (tenant_id=zhiban_identity.current_tenant_id());
ALTER TABLE zhiban_identity.identity_member_approval_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_identity.identity_member_approval_grants FORCE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE zhiban_identity.identity_member_approval_grants TO zhiban_runtime;
CREATE POLICY identity_member_approval_grants_tenant_select ON zhiban_identity.identity_member_approval_grants FOR SELECT TO zhiban_runtime USING (tenant_id=zhiban_identity.current_tenant_id());
CREATE POLICY identity_member_approval_grants_owner_select ON zhiban_identity.identity_member_approval_grants FOR SELECT TO zhiban_identity_owner USING (tenant_id=zhiban_identity.current_tenant_id());
GRANT INSERT (tenant_id,approval_id,ordinal,grant_id,grant_mode,role_code,scope_kind,scope_id,created_at,valid_from,valid_until) ON zhiban_identity.identity_member_approval_grants TO zhiban_runtime;
CREATE POLICY identity_member_approval_grants_tenant_insert ON zhiban_identity.identity_member_approval_grants FOR INSERT TO zhiban_runtime WITH CHECK (tenant_id=zhiban_identity.current_tenant_id());
ALTER TABLE zhiban_identity.identity_tenant_command_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_identity.identity_tenant_command_effects FORCE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE zhiban_identity.identity_tenant_command_effects TO zhiban_runtime;
CREATE POLICY identity_tenant_command_effects_tenant_select ON zhiban_identity.identity_tenant_command_effects FOR SELECT TO zhiban_runtime USING (tenant_id=zhiban_identity.current_tenant_id());
CREATE POLICY identity_tenant_command_effects_owner_select ON zhiban_identity.identity_tenant_command_effects FOR SELECT TO zhiban_identity_owner USING (tenant_id=zhiban_identity.current_tenant_id());
GRANT INSERT (tenant_id,command_id,target_ordinal,target_user_id,membership_id,before_revision,after_revision,before_auth_version,after_auth_version,after_status,admission_id,consent_id,approval_id,audit_event_id) ON zhiban_identity.identity_tenant_command_effects TO zhiban_runtime;
CREATE POLICY identity_tenant_command_effects_tenant_insert ON zhiban_identity.identity_tenant_command_effects FOR INSERT TO zhiban_runtime WITH CHECK (tenant_id=zhiban_identity.current_tenant_id());
GRANT UPDATE (consumed_at,membership_id,command_id,audit_event_id,repository_revision) ON zhiban_identity.identity_member_admissions TO zhiban_runtime;
CREATE POLICY identity_member_admissions_tenant_update ON zhiban_identity.identity_member_admissions FOR UPDATE TO zhiban_runtime
 USING (tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK (tenant_id=zhiban_identity.current_tenant_id());
CREATE POLICY identity_member_admissions_owner_insert ON zhiban_identity.identity_member_admissions FOR INSERT TO zhiban_identity_owner
 WITH CHECK (session_user='zhiban_control_runtime' AND tenant_id=zhiban_identity.current_tenant_id() AND repository_revision=1 AND consumed_at IS NULL AND command_id IS NULL AND audit_event_id IS NULL
 AND EXISTS (SELECT 1 FROM zhiban_identity.identity_control_approvals AS a WHERE a.approval_id=control_approval_id AND a.tenant_id=identity_member_admissions.tenant_id
   AND a.target_user_id=identity_member_admissions.user_id AND a.purpose='MEMBER_ADMISSION' AND a.consumed_at IS NULL
   AND a.expected_user_revision=subject_user_revision AND a.admission_purpose=identity_member_admissions.purpose
   AND a.target_membership_id IS NOT DISTINCT FROM identity_member_admissions.membership_id
   AND a.expected_member_revision IS NOT DISTINCT FROM identity_member_admissions.expected_member_revision
   AND a.expected_auth_version IS NOT DISTINCT FROM identity_member_admissions.expected_auth_version
   AND a.issued_at=identity_member_admissions.issued_at AND a.expires_at=identity_member_admissions.expires_at));
GRANT SELECT,INSERT (approval_id,purpose,environment_ref,approval_ref,operator_ref,approver_ref,operator_user_id,expected_operator_user_revision,system_admin_grant_id,expected_admin_grant_revision,command_id,manifest_digest,catalog_digest,action_version,delegation_version,target_user_id,tenant_id,planned_user_id,planned_tenant_id,target_membership_id,planned_membership_id,planned_grant_id,expected_user_revision,expected_tenant_revision,expected_member_revision,expected_auth_version,valid_until,tenant_code,tenant_display_name,admission_purpose,issued_at,expires_at) ON zhiban_identity.identity_control_approvals TO zhiban_control_runtime;
GRANT SELECT,INSERT (command_id,actor_user_id,action,idempotency_key,intent_digest,approval_id,request_id,completed_at,outcome_kind) ON zhiban_identity.identity_control_commands TO zhiban_control_runtime;
GRANT SELECT,INSERT (command_id,target_kind,target_user_id,tenant_id,membership_id,grant_id,admission_id,before_revision,after_revision,after_auth_version,after_status,audit_event_id,additional_audit_event_id) ON zhiban_identity.identity_control_command_effects TO zhiban_control_runtime;
GRANT UPDATE (consumed_at) ON zhiban_identity.identity_control_approvals TO zhiban_control_runtime;
GRANT SELECT,INSERT (tenant_id,repository_revision,created_command_id),
 UPDATE (repository_revision,completed_at,approval_id,command_id,consent_id,user_id,membership_id,grant_id,pending_event_id,activation_event_id)
 ON zhiban_identity.identity_tenant_onboarding TO zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.current_tenant_id() TO zhiban_control_runtime;
CREATE POLICY memberships_identity_onboarding_owner_insert ON zhiban_identity.memberships FOR INSERT TO zhiban_identity_owner
 WITH CHECK (session_user='zhiban_control_runtime' AND tenant_id=zhiban_identity.current_tenant_id()
 AND EXISTS (SELECT 1 FROM zhiban_identity.identity_control_approvals AS a
 JOIN zhiban_identity.identity_tenant_onboarding AS o ON o.tenant_id=a.tenant_id
 WHERE a.purpose='FIRST_TENANT_ADMIN' AND a.tenant_id=memberships.tenant_id AND a.planned_membership_id=memberships.membership_id
   AND a.target_user_id=memberships.user_id AND a.consumed_at IS NULL AND o.repository_revision=1
   AND a.approval_id::text=current_setting('app.onboarding_approval_id',true)
   AND EXISTS (SELECT 1 FROM zhiban_identity.identity_member_consents AS c WHERE c.tenant_id=a.tenant_id
     AND c.control_approval_id=a.approval_id AND c.user_id=a.target_user_id AND c.purpose='FIRST_TENANT_ADMIN'
     AND c.manifest_digest=a.manifest_digest AND c.subject_user_revision=a.expected_user_revision)) AND status='PENDING' AND repository_revision=1 AND authorization_version=0
 AND created_at=updated_at AND disabled_at IS NULL AND disabled_reason IS NULL);
CREATE POLICY memberships_identity_onboarding_owner_update ON zhiban_identity.memberships FOR UPDATE TO zhiban_identity_owner
 USING (session_user='zhiban_control_runtime' AND tenant_id=zhiban_identity.current_tenant_id()
 AND EXISTS (SELECT 1 FROM zhiban_identity.identity_control_approvals AS a
 JOIN zhiban_identity.identity_tenant_onboarding AS o ON o.tenant_id=a.tenant_id
 WHERE a.purpose='FIRST_TENANT_ADMIN' AND a.tenant_id=memberships.tenant_id AND a.planned_membership_id=memberships.membership_id
   AND a.target_user_id=memberships.user_id AND a.consumed_at IS NULL AND o.repository_revision=1
   AND a.approval_id::text=current_setting('app.onboarding_approval_id',true)
   AND EXISTS (SELECT 1 FROM zhiban_identity.identity_member_consents AS c WHERE c.tenant_id=a.tenant_id
     AND c.control_approval_id=a.approval_id AND c.user_id=a.target_user_id AND c.purpose='FIRST_TENANT_ADMIN'
     AND c.manifest_digest=a.manifest_digest AND c.subject_user_revision=a.expected_user_revision)) AND status='PENDING' AND repository_revision=1 AND authorization_version=0)
 WITH CHECK (session_user='zhiban_control_runtime' AND tenant_id=zhiban_identity.current_tenant_id()
 AND EXISTS (SELECT 1 FROM zhiban_identity.identity_control_approvals AS a
 JOIN zhiban_identity.identity_tenant_onboarding AS o ON o.tenant_id=a.tenant_id
 WHERE a.purpose='FIRST_TENANT_ADMIN' AND a.tenant_id=memberships.tenant_id AND a.planned_membership_id=memberships.membership_id
   AND a.target_user_id=memberships.user_id AND a.consumed_at IS NULL AND o.repository_revision=1
   AND a.approval_id::text=current_setting('app.onboarding_approval_id',true)
   AND EXISTS (SELECT 1 FROM zhiban_identity.identity_member_consents AS c WHERE c.tenant_id=a.tenant_id
     AND c.control_approval_id=a.approval_id AND c.user_id=a.target_user_id AND c.purpose='FIRST_TENANT_ADMIN'
     AND c.manifest_digest=a.manifest_digest AND c.subject_user_revision=a.expected_user_revision)) AND status='ACTIVE' AND repository_revision=2 AND authorization_version=1
 AND created_at=updated_at AND disabled_at IS NULL AND disabled_reason IS NULL);
CREATE POLICY role_grants_identity_onboarding_owner_insert ON zhiban_identity.role_grants FOR INSERT TO zhiban_identity_owner
 WITH CHECK (session_user='zhiban_control_runtime' AND tenant_id=zhiban_identity.current_tenant_id()
 AND role_code='TENANT_ADMIN' AND scope_kind='TENANT' AND scope_id IS NULL AND revoked_at IS NULL AND grant_ordinal=0 AND created_at=valid_from
 AND EXISTS (SELECT 1 FROM zhiban_identity.identity_control_approvals AS a JOIN zhiban_identity.identity_tenant_onboarding AS o ON o.tenant_id=a.tenant_id
   WHERE a.purpose='FIRST_TENANT_ADMIN' AND a.tenant_id=role_grants.tenant_id AND a.planned_membership_id=role_grants.membership_id
     AND a.planned_grant_id=role_grants.grant_id AND a.valid_until IS NOT DISTINCT FROM role_grants.valid_until AND a.consumed_at IS NULL
     AND role_grants.created_at>=a.issued_at AND role_grants.created_at<a.expires_at AND o.repository_revision=1
     AND a.approval_id::text=current_setting('app.onboarding_approval_id',true)
     AND EXISTS (SELECT 1 FROM zhiban_identity.identity_member_consents AS c WHERE c.tenant_id=a.tenant_id AND c.control_approval_id=a.approval_id
       AND c.user_id=a.target_user_id AND c.purpose='FIRST_TENANT_ADMIN' AND c.manifest_digest=a.manifest_digest)));
GRANT INSERT (event_id) ON zhiban_identity.audit_events TO zhiban_runtime;
CREATE POLICY audit_identity_member_insert ON zhiban_identity.audit_events FOR INSERT TO zhiban_runtime
 WITH CHECK (event_scope='TENANT' AND tenant_id=zhiban_identity.current_tenant_id()
 AND ((event_type='MEMBERSHIP_PENDING_CREATED' AND actor_type='USER' AND subject_user_id IS NOT NULL AND subject_membership_id IS NOT NULL AND authorization_version_before IS NULL AND authorization_version_after=0)
 OR (event_type='MEMBERSHIP_CONSENT_RECORDED' AND actor_type='USER' AND actor_user_id=subject_user_id)));
CREATE POLICY audit_identity_onboarding_insert ON zhiban_identity.audit_events FOR INSERT TO zhiban_control_runtime
 WITH CHECK (event_scope='TENANT' AND tenant_id=zhiban_identity.current_tenant_id() AND actor_type='SERVICE' AND actor_service_code='identity_tenant_onboarding'
 AND event_type IN ('MEMBERSHIP_PENDING_CREATED','MEMBERSHIP_ACTIVATED')
 AND EXISTS (SELECT 1 FROM zhiban_identity.identity_control_approvals AS a JOIN zhiban_identity.identity_tenant_onboarding AS o ON o.tenant_id=a.tenant_id
   WHERE a.purpose='FIRST_TENANT_ADMIN' AND a.tenant_id=audit_events.tenant_id AND a.target_user_id=audit_events.subject_user_id
   AND a.planned_membership_id=audit_events.subject_membership_id AND a.consumed_at IS NULL AND o.repository_revision=1
   AND a.approval_id::text=current_setting('app.onboarding_approval_id',true)));
CREATE POLICY audit_identity_member_provenance_owner_read ON zhiban_identity.audit_events FOR SELECT TO zhiban_identity_owner
 USING (event_scope='TENANT' AND tenant_id=zhiban_identity.current_tenant_id()
 AND ((EXISTS (SELECT 1 FROM zhiban_identity.identity_tenant_command_effects AS e JOIN zhiban_identity.identity_tenant_commands AS c
     ON c.tenant_id=e.tenant_id AND c.command_id=e.command_id
     WHERE e.tenant_id=audit_events.tenant_id AND e.audit_event_id=audit_events.event_id AND e.target_user_id=audit_events.subject_user_id
       AND e.membership_id IS NOT DISTINCT FROM audit_events.subject_membership_id AND audit_events.actor_type='USER'
       AND audit_events.actor_user_id=c.actor_user_id))
   OR (EXISTS (SELECT 1 FROM zhiban_identity.identity_member_consents AS s WHERE s.tenant_id=audit_events.tenant_id AND s.audit_event_id=audit_events.event_id
     AND s.user_id=audit_events.subject_user_id AND s.membership_id IS NOT DISTINCT FROM audit_events.subject_membership_id
     AND audit_events.actor_type='USER' AND audit_events.actor_user_id=s.user_id AND audit_events.event_type='MEMBERSHIP_CONSENT_RECORDED'))
   OR (EXISTS (SELECT 1 FROM zhiban_identity.identity_tenant_onboarding AS o WHERE o.tenant_id=audit_events.tenant_id AND o.user_id=audit_events.subject_user_id
     AND o.membership_id=audit_events.subject_membership_id AND audit_events.actor_type='SERVICE' AND audit_events.actor_service_code='identity_tenant_onboarding'
     AND ((o.pending_event_id=audit_events.event_id AND audit_events.event_type='MEMBERSHIP_PENDING_CREATED')
       OR (o.activation_event_id=audit_events.event_id AND audit_events.event_type='MEMBERSHIP_ACTIVATED')))))
 OR (event_scope='GLOBAL' AND EXISTS (
   SELECT 1 FROM zhiban_identity.identity_control_command_effects AS e JOIN zhiban_identity.identity_control_commands AS c ON c.command_id=e.command_id
   WHERE e.audit_event_id=audit_events.event_id AND e.target_kind IN ('USER','TENANT') AND audit_events.event_type=c.action || 'D'
     AND audit_events.tenant_id IS NOT DISTINCT FROM e.tenant_id AND audit_events.subject_user_id IS NOT DISTINCT FROM e.target_user_id
     AND audit_events.subject_membership_id IS NULL AND audit_events.actor_type='USER' AND audit_events.actor_user_id=c.actor_user_id)));

-- New closed audit branches; every existing ownership/payload branch is retained.
CREATE OR REPLACE FUNCTION zhiban_identity.audit_payload_valid(kind text, p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp AS $$
DECLARE keys text[];
BEGIN
  IF kind='MEMBERSHIP_PENDING_CREATED' THEN RETURN jsonb_typeof(p)='object' AND p='{}'::jsonb; END IF;
  IF kind='MEMBERSHIP_CONSENT_RECORDED' THEN RETURN jsonb_typeof(p)='object' AND p ? 'purpose' AND (p-'purpose')='{}'::jsonb AND jsonb_typeof(p->'purpose')='string'
    AND p->>'purpose' IN ('ACTIVATE','REACTIVATE','REJOIN','FIRST_TENANT_ADMIN'); END IF;
  IF kind NOT IN ('CREDENTIAL_CREATED','CREDENTIAL_REPLACED','CREDENTIAL_REVOKED','CREDENTIAL_REHASHED') THEN
    RETURN zhiban_identity.audit_payload_valid_pre_credentials(kind, p);
  END IF;
  IF jsonb_typeof(p) <> 'object' OR NOT zhiban_identity.audit_uuid_json(p->'credentialId') THEN RETURN false; END IF;
  keys := CASE kind
    WHEN 'CREDENTIAL_CREATED' THEN ARRAY['credentialId','repositoryRevisionAfter','securityEpochAfter']
    WHEN 'CREDENTIAL_REPLACED' THEN ARRAY['priorCredentialId','credentialId','repositoryRevisionBefore','repositoryRevisionAfter','securityEpochBefore','securityEpochAfter']
    WHEN 'CREDENTIAL_REVOKED' THEN ARRAY['credentialId','repositoryRevisionBefore','repositoryRevisionAfter','securityEpochBefore','securityEpochAfter']
    ELSE ARRAY['credentialId','repositoryRevisionBefore','repositoryRevisionAfter','securityEpoch'] END;
  IF NOT p ?& keys OR p - keys <> '{}'::jsonb OR NOT zhiban_identity.credential_decimal(p->'repositoryRevisionAfter', true) THEN RETURN false; END IF;
  IF kind = 'CREDENTIAL_CREATED' THEN RETURN p->>'repositoryRevisionAfter' = '1'
    AND zhiban_identity.credential_decimal(p->'securityEpochAfter', false) AND p->>'securityEpochAfter' = '1'; END IF;
  IF NOT zhiban_identity.credential_decimal(p->'repositoryRevisionBefore', true)
    OR (p->>'repositoryRevisionAfter')::numeric <> (p->>'repositoryRevisionBefore')::numeric + 1 THEN RETURN false; END IF;
  IF kind = 'CREDENTIAL_REHASHED' THEN RETURN zhiban_identity.credential_decimal(p->'securityEpoch', false); END IF;
  IF kind = 'CREDENTIAL_REPLACED' AND NOT (p->'priorCredentialId' = 'null'::jsonb OR
    (zhiban_identity.audit_uuid_json(p->'priorCredentialId') AND p->>'priorCredentialId' <> p->>'credentialId')) THEN RETURN false; END IF;
  RETURN zhiban_identity.credential_decimal(p->'securityEpochBefore', false)
    AND zhiban_identity.credential_decimal(p->'securityEpochAfter', false)
    AND (p->>'securityEpochAfter')::numeric = (p->>'securityEpochBefore')::numeric + 1;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE zhiban_identity.audit_events DROP CONSTRAINT audit_events_event_type_check;
ALTER TABLE zhiban_identity.audit_events ADD CONSTRAINT audit_events_event_type_check CHECK (event_type IN ('USER_CREATED','USER_DISABLED','USER_RESTORED','TENANT_CREATED','TENANT_DISABLED','TENANT_RESTORED','MEMBERSHIP_DISABLED','MEMBERSHIP_LEFT','MEMBERSHIP_REACTIVATED','MEMBERSHIP_ACTIVATED','MEMBERSHIP_REJOINED','ROLE_GRANTS_REPLACED','ROLE_GRANT_GRANTED','ROLE_GRANT_REVOKED','SYSTEM_ADMIN_GRANT_GRANTED','SYSTEM_ADMIN_GRANT_REVOKED','SESSION_REVOKED','AUTHENTICATION_REJECTED','CREDENTIAL_CREATED','CREDENTIAL_REPLACED','CREDENTIAL_REVOKED','CREDENTIAL_REHASHED','MEMBERSHIP_PENDING_CREATED','MEMBERSHIP_CONSENT_RECORDED'));
ALTER TABLE zhiban_identity.audit_events DROP CONSTRAINT audit_ownership_shape;
ALTER TABLE zhiban_identity.audit_events ADD CONSTRAINT audit_ownership_shape CHECK ((
  (event_type='MEMBERSHIP_PENDING_CREATED' AND event_scope='TENANT' AND tenant_id IS NOT NULL AND subject_user_id IS NOT NULL AND subject_membership_id IS NOT NULL
    AND authorization_version_before IS NULL AND authorization_version_after=0 AND (actor_type='USER' OR (actor_type='SERVICE' AND actor_service_code='identity_tenant_onboarding')))
  OR (event_type='MEMBERSHIP_CONSENT_RECORDED' AND event_scope='TENANT' AND tenant_id IS NOT NULL AND subject_user_id IS NOT NULL AND actor_type='USER' AND actor_user_id=subject_user_id
    AND ((event_payload->>'purpose'='FIRST_TENANT_ADMIN' AND subject_membership_id IS NULL AND authorization_version_before IS NULL AND authorization_version_after IS NULL)
      OR (event_payload->>'purpose' IN ('ACTIVATE','REACTIVATE','REJOIN') AND subject_membership_id IS NOT NULL AND authorization_version_before BETWEEN 0 AND 9007199254740991 AND authorization_version_after=authorization_version_before)))
  OR
  (event_type IN ('MEMBERSHIP_DISABLED','MEMBERSHIP_LEFT','MEMBERSHIP_REACTIVATED','MEMBERSHIP_ACTIVATED','MEMBERSHIP_REJOINED','ROLE_GRANTS_REPLACED','ROLE_GRANT_GRANTED','ROLE_GRANT_REVOKED')
    AND event_scope = 'TENANT' AND tenant_id IS NOT NULL AND subject_user_id IS NOT NULL AND subject_membership_id IS NOT NULL
    AND authorization_version_before BETWEEN 0 AND 9007199254740991 AND authorization_version_after BETWEEN 0 AND 9007199254740991 AND authorization_version_after > authorization_version_before)
  OR (event_type NOT IN ('MEMBERSHIP_PENDING_CREATED','MEMBERSHIP_CONSENT_RECORDED','MEMBERSHIP_DISABLED','MEMBERSHIP_LEFT','MEMBERSHIP_REACTIVATED','MEMBERSHIP_ACTIVATED','MEMBERSHIP_REJOINED','ROLE_GRANTS_REPLACED','ROLE_GRANT_GRANTED','ROLE_GRANT_REVOKED')
    AND event_scope = 'GLOBAL' AND subject_membership_id IS NULL AND authorization_version_before IS NULL AND authorization_version_after IS NULL
    AND ((event_type IN ('TENANT_CREATED','TENANT_DISABLED','TENANT_RESTORED') AND tenant_id IS NOT NULL AND subject_user_id IS NULL)
      OR (event_type IN ('USER_CREATED','USER_DISABLED','USER_RESTORED','SYSTEM_ADMIN_GRANT_GRANTED','SYSTEM_ADMIN_GRANT_REVOKED','SESSION_REVOKED',
        'CREDENTIAL_CREATED','CREDENTIAL_REPLACED','CREDENTIAL_REVOKED','CREDENTIAL_REHASHED') AND tenant_id IS NULL AND subject_user_id IS NOT NULL)
      OR (event_type = 'AUTHENTICATION_REJECTED' AND tenant_id IS NULL AND subject_user_id IS NULL)))
) IS TRUE);

CREATE FUNCTION zhiban_identity.identity_composition_append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,zhiban_identity,pg_temp AS $body$
BEGIN
  RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514';
END;
$body$;
ALTER FUNCTION zhiban_identity.identity_composition_append_only() OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_composition_append_only() FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;

CREATE FUNCTION zhiban_identity.identity_composition_source_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,zhiban_identity,pg_temp AS $body$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='identity_member_admissions' THEN
   IF TG_OP='INSERT' THEN
     IF NEW.repository_revision<>1 OR NEW.consumed_at IS NOT NULL OR NEW.command_id IS NOT NULL OR NEW.audit_event_id IS NOT NULL THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
   ELSE
     IF OLD.repository_revision<>1 OR NEW.repository_revision<>2 OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
       OR (to_jsonb(NEW)-ARRAY['consumed_at','membership_id','command_id','audit_event_id','repository_revision'])
          IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['consumed_at','membership_id','command_id','audit_event_id','repository_revision'])
       OR (OLD.membership_id IS NOT NULL AND NEW.membership_id IS DISTINCT FROM OLD.membership_id) THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
   END IF;
 ELSIF TG_TABLE_NAME='identity_control_approvals' THEN
   IF TG_OP='INSERT' THEN
     IF NEW.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
   ELSIF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL OR (to_jsonb(NEW)-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at') THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='identity_tenant_onboarding' THEN
   IF TG_OP='INSERT' THEN
     IF NEW.repository_revision<>1 THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
   ELSIF OLD.repository_revision<>1 OR NEW.repository_revision<>2 OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.created_command_id IS DISTINCT FROM OLD.created_command_id THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$body$;
ALTER FUNCTION zhiban_identity.identity_composition_source_guard() OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_composition_source_guard() FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;

-- Read-only commit-time closure. Always reread final rows, never trust a deferred NEW image.
CREATE FUNCTION zhiban_identity.identity_membership_composition_consistency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $body$
DECLARE v_tenant uuid; v_command uuid; v_previous text;
 v_tc zhiban_identity.identity_tenant_commands%ROWTYPE; v_te zhiban_identity.identity_tenant_command_effects%ROWTYPE;
 v_cc zhiban_identity.identity_control_commands%ROWTYPE; v_ce zhiban_identity.identity_control_command_effects%ROWTYPE;
 v_ca zhiban_identity.identity_control_approvals%ROWTYPE; v_a zhiban_identity.identity_member_admissions%ROWTYPE;
 v_s zhiban_identity.identity_member_consents%ROWTYPE; v_p zhiban_identity.identity_member_approvals%ROWTYPE;
 v_o zhiban_identity.identity_tenant_onboarding%ROWTYPE; v_m zhiban_identity.memberships%ROWTYPE;
 v_e zhiban_identity.audit_events%ROWTYPE; v_g zhiban_identity.role_grants%ROWTYPE; v_pg zhiban_identity.identity_member_approval_grants%ROWTYPE;
 v_count integer; v_type text;
BEGIN
 v_previous := current_setting('app.tenant_id',true);
 IF TG_TABLE_NAME IN ('memberships','role_grants') THEN
   IF session_user<>'zhiban_control_runtime' THEN RETURN NULL; END IF;
   v_tenant:=NEW.tenant_id;
   SELECT o.* INTO STRICT v_o FROM zhiban_identity.identity_tenant_onboarding AS o WHERE o.tenant_id=v_tenant;
   IF v_o.repository_revision<>2 OR v_o.completed_at IS NULL THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
   v_command:=v_o.command_id;
 ELSIF TG_TABLE_NAME='identity_control_approvals' THEN
   SELECT a.* INTO STRICT v_ca FROM zhiban_identity.identity_control_approvals AS a WHERE a.approval_id=NEW.approval_id;
   IF v_ca.consumed_at IS NULL THEN RETURN NULL; END IF;
   v_tenant:=v_ca.tenant_id; v_command:=v_ca.command_id;
 ELSIF TG_TABLE_NAME='identity_control_commands' THEN
   v_command:=NEW.command_id;
   SELECT a.tenant_id INTO STRICT v_tenant FROM zhiban_identity.identity_control_approvals AS a WHERE a.command_id=v_command;
 ELSIF TG_TABLE_NAME='identity_control_command_effects' THEN
   v_command:=NEW.command_id; v_tenant:=NEW.tenant_id;
 ELSIF TG_TABLE_NAME='identity_tenant_onboarding' THEN
   SELECT o.* INTO STRICT v_o FROM zhiban_identity.identity_tenant_onboarding AS o WHERE o.tenant_id=NEW.tenant_id;
   v_tenant:=v_o.tenant_id;
   IF v_o.repository_revision=1 THEN
     SELECT c.* INTO STRICT v_cc FROM zhiban_identity.identity_control_commands AS c WHERE c.command_id=v_o.created_command_id AND c.action='TENANT_CREATE';
     SELECT e.* INTO STRICT v_ce FROM zhiban_identity.identity_control_command_effects AS e WHERE e.command_id=v_cc.command_id AND e.target_kind='TENANT' AND e.tenant_id=v_tenant;
     RETURN NULL;
   END IF;
   v_command:=v_o.command_id;
 ELSE
   v_tenant:=NEW.tenant_id;
   PERFORM set_config('app.tenant_id',v_tenant::text,true);
   IF TG_TABLE_NAME='identity_member_admissions' THEN
     SELECT a.* INTO STRICT v_a FROM zhiban_identity.identity_member_admissions AS a WHERE a.tenant_id=v_tenant AND a.admission_id=NEW.admission_id;
     SELECT a.* INTO STRICT v_ca FROM zhiban_identity.identity_control_approvals AS a WHERE a.approval_id=v_a.control_approval_id AND a.tenant_id=v_tenant AND a.target_user_id=v_a.user_id AND a.purpose='MEMBER_ADMISSION';
     SELECT e.* INTO STRICT v_ce FROM zhiban_identity.identity_control_command_effects AS e WHERE e.command_id=v_ca.command_id AND e.admission_id=v_a.admission_id AND e.target_kind='ADMISSION';
     IF v_ca.consumed_at IS NULL OR v_a.subject_user_revision<>v_ca.expected_user_revision OR v_a.purpose<>v_ca.admission_purpose
       OR v_a.issued_at<>v_ca.issued_at OR v_a.expires_at<>v_ca.expires_at THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
     IF v_a.consumed_at IS NULL THEN PERFORM set_config('app.tenant_id',coalesce(v_previous,''),true); RETURN NULL; END IF;
     v_command:=v_a.command_id;
   ELSIF TG_TABLE_NAME='identity_member_consents' THEN
     SELECT s.* INTO STRICT v_s FROM zhiban_identity.identity_member_consents AS s WHERE s.tenant_id=v_tenant AND s.consent_id=NEW.consent_id;
     v_command:=v_s.command_id;
   ELSIF TG_TABLE_NAME='identity_member_approvals' THEN v_command:=NEW.command_id;
   ELSIF TG_TABLE_NAME='identity_member_approval_grants' THEN
     SELECT p.command_id INTO STRICT v_command FROM zhiban_identity.identity_member_approvals AS p WHERE p.tenant_id=v_tenant AND p.approval_id=NEW.approval_id;
   ELSE v_command:=NEW.command_id;
   END IF;
 END IF;
 IF v_tenant IS NOT NULL THEN PERFORM set_config('app.tenant_id',v_tenant::text,true); END IF;
 IF TG_TABLE_NAME IN ('identity_control_approvals','identity_control_commands','identity_control_command_effects','identity_tenant_onboarding','memberships','role_grants') THEN
   SELECT c.* INTO STRICT v_cc FROM zhiban_identity.identity_control_commands AS c WHERE c.command_id=v_command;
   SELECT a.* INTO STRICT v_ca FROM zhiban_identity.identity_control_approvals AS a WHERE a.approval_id=v_cc.approval_id AND a.command_id=v_command;
   SELECT e.* INTO STRICT v_ce FROM zhiban_identity.identity_control_command_effects AS e WHERE e.command_id=v_command;
   IF v_cc.actor_user_id<>v_ca.operator_user_id OR v_cc.action<>v_ca.purpose OR v_ca.consumed_at IS DISTINCT FROM v_cc.completed_at THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
   IF v_ce.target_kind='FIRST_TENANT_ADMIN' THEN
     SELECT o.* INTO STRICT v_o FROM zhiban_identity.identity_tenant_onboarding AS o WHERE o.tenant_id=v_ce.tenant_id AND o.command_id=v_command;
     IF v_ca.purpose<>'FIRST_TENANT_ADMIN' OR v_o.repository_revision<>2 OR v_o.approval_id<>v_ca.approval_id OR v_o.user_id<>v_ca.target_user_id
       OR v_o.membership_id<>v_ca.planned_membership_id OR v_o.grant_id<>v_ca.planned_grant_id
       OR v_o.completed_at<>v_cc.completed_at OR v_o.pending_event_id<>v_ce.audit_event_id OR v_o.activation_event_id<>v_ce.additional_audit_event_id THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
     SELECT s.* INTO STRICT v_s FROM zhiban_identity.identity_member_consents AS s WHERE s.tenant_id=v_o.tenant_id AND s.consent_id=v_o.consent_id;
     IF v_s.purpose<>'FIRST_TENANT_ADMIN' OR v_s.control_approval_id<>v_ca.approval_id OR v_s.user_id<>v_ca.target_user_id OR v_s.manifest_digest<>v_ca.manifest_digest
       OR v_s.subject_user_revision<>v_ca.expected_user_revision OR v_cc.completed_at<v_s.issued_at OR v_cc.completed_at>=v_s.expires_at THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
     SELECT m.* INTO STRICT v_m FROM zhiban_identity.memberships AS m WHERE m.tenant_id=v_o.tenant_id AND m.membership_id=v_o.membership_id;
     SELECT g.* INTO STRICT v_g FROM zhiban_identity.role_grants AS g WHERE g.tenant_id=v_o.tenant_id AND g.grant_id=v_o.grant_id;
     IF v_m.user_id<>v_o.user_id OR v_m.status<>'ACTIVE' OR v_m.repository_revision<>2 OR v_m.authorization_version<>1
       OR v_m.created_at<>v_cc.completed_at OR v_m.updated_at<>v_cc.completed_at OR v_g.membership_id<>v_m.membership_id
       OR v_g.role_code<>'TENANT_ADMIN' OR v_g.scope_kind<>'TENANT' OR v_g.scope_id IS NOT NULL OR v_g.revoked_at IS NOT NULL
       OR v_g.created_at<>v_cc.completed_at OR v_g.valid_from<>v_cc.completed_at OR v_g.valid_until IS DISTINCT FROM v_ca.valid_until THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
     SELECT e.* INTO STRICT v_e FROM zhiban_identity.audit_events AS e WHERE e.event_id=v_o.pending_event_id;
     IF v_e.event_scope<>'TENANT' OR v_e.event_type<>'MEMBERSHIP_PENDING_CREATED' OR v_e.tenant_id<>v_o.tenant_id OR v_e.subject_user_id<>v_o.user_id
       OR v_e.subject_membership_id<>v_o.membership_id OR v_e.occurred_at<>v_cc.completed_at OR v_e.actor_type<>'SERVICE'
       OR v_e.actor_service_code<>'identity_tenant_onboarding' OR v_e.authorization_version_before IS NOT NULL OR v_e.authorization_version_after<>0 THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
     SELECT e.* INTO STRICT v_e FROM zhiban_identity.audit_events AS e WHERE e.event_id=v_o.activation_event_id;
     IF v_e.event_type<>'MEMBERSHIP_ACTIVATED' OR v_e.event_scope<>'TENANT' OR v_e.tenant_id<>v_o.tenant_id OR v_e.subject_user_id<>v_o.user_id
       OR v_e.subject_membership_id<>v_o.membership_id OR v_e.occurred_at<>v_cc.completed_at OR v_e.actor_type<>'SERVICE'
       OR v_e.actor_service_code<>'identity_tenant_onboarding' OR v_e.authorization_version_before<>0 OR v_e.authorization_version_after<>1
       OR v_e.event_payload->'priorGrantIds'<>'[]'::jsonb OR jsonb_array_length(v_e.event_payload->'approvedGrants')<>1
       OR v_e.event_payload->'approvedGrants'->0->>'id'<>v_o.grant_id::text THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
   ELSIF v_ce.target_kind='ADMISSION' THEN
     SELECT a.* INTO STRICT v_a FROM zhiban_identity.identity_member_admissions AS a WHERE a.tenant_id=v_ce.tenant_id AND a.admission_id=v_ce.admission_id;
     IF v_ca.purpose<>'MEMBER_ADMISSION' OR v_a.control_approval_id<>v_ca.approval_id OR v_a.user_id<>v_ce.target_user_id THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
   ELSE
     IF v_ce.before_revision IS DISTINCT FROM (CASE WHEN v_ce.target_kind='USER' THEN v_ca.expected_user_revision ELSE v_ca.expected_tenant_revision END)
       OR v_ce.after_revision IS DISTINCT FROM (CASE WHEN v_cc.outcome_kind='TRUE_NO_OP' THEN v_ce.before_revision ELSE coalesce(v_ce.before_revision+1,1) END)
       OR (v_cc.outcome_kind='TRUE_NO_OP' AND (v_ce.before_revision IS NULL OR v_ce.audit_event_id IS NOT NULL))
       OR (v_cc.outcome_kind='APPLIED' AND v_ce.audit_event_id IS NULL) THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
     IF v_cc.outcome_kind='TRUE_NO_OP' THEN PERFORM set_config('app.tenant_id',coalesce(v_previous,''),true); RETURN NULL; END IF;
     SELECT e.* INTO STRICT v_e FROM zhiban_identity.audit_events AS e WHERE e.event_id=v_ce.audit_event_id;
     IF v_e.event_type<>v_cc.action || 'D' OR v_e.event_scope<>'GLOBAL' OR v_e.actor_type<>'USER' OR v_e.actor_user_id<>v_cc.actor_user_id
       OR v_e.occurred_at<>v_cc.completed_at OR v_e.request_id<>v_cc.request_id
       OR v_e.tenant_id IS DISTINCT FROM v_ce.tenant_id OR v_e.subject_user_id IS DISTINCT FROM v_ce.target_user_id THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
   END IF;
 ELSE
   SELECT c.* INTO STRICT v_tc FROM zhiban_identity.identity_tenant_commands AS c WHERE c.tenant_id=v_tenant AND c.command_id=v_command;
   SELECT count(*) INTO v_count FROM zhiban_identity.identity_tenant_command_effects AS e WHERE e.tenant_id=v_tenant AND e.command_id=v_command;
   IF v_count<1 OR v_count>2 THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
   FOR v_te IN SELECT e.* FROM zhiban_identity.identity_tenant_command_effects AS e WHERE e.tenant_id=v_tenant AND e.command_id=v_command ORDER BY e.target_ordinal LOOP
     IF v_te.membership_id IS NOT NULL THEN
       SELECT m.* INTO STRICT v_m FROM zhiban_identity.memberships AS m WHERE m.tenant_id=v_tenant AND m.membership_id=v_te.membership_id;
       IF v_m.user_id<>v_te.target_user_id OR v_m.repository_revision<>v_te.after_revision OR v_m.authorization_version<>v_te.after_auth_version OR v_m.status<>v_te.after_status THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
     END IF;
     IF v_te.audit_event_id IS NULL THEN
       IF v_te.before_revision IS NULL OR v_te.after_revision<>v_te.before_revision OR v_te.after_auth_version<>v_te.before_auth_version THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
     ELSE
       v_type:=CASE v_tc.action WHEN 'MEMBERSHIP_PENDING_CREATE' THEN 'MEMBERSHIP_PENDING_CREATED' WHEN 'MEMBERSHIP_CONSENT_RECORD' THEN 'MEMBERSHIP_CONSENT_RECORDED'
         WHEN 'MEMBERSHIP_ACTIVATE' THEN 'MEMBERSHIP_ACTIVATED' WHEN 'MEMBERSHIP_REACTIVATE' THEN 'MEMBERSHIP_REACTIVATED' WHEN 'MEMBERSHIP_REJOIN' THEN 'MEMBERSHIP_REJOINED'
         WHEN 'MEMBERSHIP_DISABLE' THEN 'MEMBERSHIP_DISABLED' WHEN 'MEMBERSHIP_LEAVE_ADMIN' THEN 'MEMBERSHIP_LEFT' WHEN 'ROLE_GRANT' THEN 'ROLE_GRANT_GRANTED'
         WHEN 'ROLE_REVOKE' THEN 'ROLE_GRANT_REVOKED' WHEN 'ROLE_REPLACE' THEN 'ROLE_GRANTS_REPLACED' ELSE NULL END;
       SELECT e.* INTO STRICT v_e FROM zhiban_identity.audit_events AS e WHERE e.event_id=v_te.audit_event_id;
       IF (v_type IS NOT NULL AND v_e.event_type<>v_type) OR v_e.event_scope<>'TENANT' OR v_e.tenant_id<>v_tenant OR v_e.subject_user_id<>v_te.target_user_id
         OR v_e.subject_membership_id IS DISTINCT FROM v_te.membership_id OR v_e.actor_type<>'USER' OR v_e.actor_user_id<>v_tc.actor_user_id
         OR v_e.request_id<>v_tc.request_id OR v_e.occurred_at<>v_tc.completed_at
         OR v_e.authorization_version_before IS DISTINCT FROM v_te.before_auth_version OR v_e.authorization_version_after IS DISTINCT FROM v_te.after_auth_version THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
     END IF;
     IF v_te.consent_id IS NOT NULL THEN
       SELECT s.* INTO STRICT v_s FROM zhiban_identity.identity_member_consents AS s WHERE s.tenant_id=v_tenant AND s.consent_id=v_te.consent_id;
       IF v_s.user_id<>v_te.target_user_id OR v_s.membership_id IS DISTINCT FROM v_te.membership_id OR v_tc.completed_at<v_s.issued_at OR v_tc.completed_at>=v_s.expires_at THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
       IF v_tc.action='MEMBERSHIP_CONSENT_RECORD' THEN
         IF v_s.command_id<>v_command OR v_s.audit_event_id<>v_te.audit_event_id OR v_tc.actor_user_id<>v_s.user_id
           OR v_e.event_payload->>'purpose'<>v_s.purpose THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
       ELSIF v_s.expected_member_revision<>v_te.before_revision OR v_s.expected_auth_version<>v_te.before_auth_version THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
     END IF;
     IF v_te.admission_id IS NOT NULL AND v_tc.action<>'MEMBERSHIP_CONSENT_RECORD' THEN
       SELECT a.* INTO STRICT v_a FROM zhiban_identity.identity_member_admissions AS a WHERE a.tenant_id=v_tenant AND a.admission_id=v_te.admission_id;
       IF v_a.user_id<>v_te.target_user_id OR v_a.membership_id<>v_te.membership_id OR v_tc.completed_at<v_a.issued_at OR v_tc.completed_at>=v_a.expires_at
         OR v_a.consumed_at IS NULL OR (v_tc.action<>'MEMBERSHIP_ACTIVATE' AND (v_a.command_id<>v_command OR v_a.audit_event_id<>v_te.audit_event_id OR v_a.consumed_at<>v_tc.completed_at)) THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
     END IF;
     IF v_te.approval_id IS NOT NULL THEN
       SELECT p.* INTO STRICT v_p FROM zhiban_identity.identity_member_approvals AS p WHERE p.tenant_id=v_tenant AND p.approval_id=v_te.approval_id;
       IF v_p.command_id<>v_command OR v_p.target_ordinal<>v_te.target_ordinal OR v_p.target_user_id<>v_te.target_user_id OR v_p.membership_id<>v_te.membership_id
         OR v_p.expected_member_revision<>v_te.before_revision OR v_p.expected_auth_version<>v_te.before_auth_version
         OR v_p.approver_user_id<>v_tc.actor_user_id OR v_p.approver_membership_id IS DISTINCT FROM v_tc.actor_membership_id
         OR v_p.intent_digest<>v_tc.intent_digest OR v_p.consumed_at<>v_tc.completed_at OR v_p.consent_id IS DISTINCT FROM v_te.consent_id THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
       FOR v_pg IN SELECT g.* FROM zhiban_identity.identity_member_approval_grants AS g WHERE g.tenant_id=v_tenant AND g.approval_id=v_p.approval_id ORDER BY g.ordinal LOOP
         SELECT g.* INTO STRICT v_g FROM zhiban_identity.role_grants AS g WHERE g.tenant_id=v_tenant AND g.grant_id=v_pg.grant_id;
         IF v_g.membership_id<>v_te.membership_id OR v_g.role_code<>v_pg.role_code OR v_g.scope_kind<>v_pg.scope_kind OR v_g.scope_id IS DISTINCT FROM v_pg.scope_id
           OR v_g.created_at<>v_pg.created_at OR v_g.valid_from<>v_pg.valid_from OR v_g.valid_until IS DISTINCT FROM v_pg.valid_until OR v_g.revoked_at IS NOT NULL
           OR v_g.valid_from>v_tc.completed_at OR (v_g.valid_until IS NOT NULL AND v_tc.completed_at>=v_g.valid_until)
           OR (v_pg.grant_mode='NEW' AND v_g.created_at<>v_tc.completed_at) THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
         -- Preserve needs a completed prior approval, not a legacy or pending-origin ID.
         -- This check is owner-internal: runtime does not gain audit/control SELECT.
         IF v_pg.grant_mode='PRESERVE' AND NOT EXISTS (
           SELECT 1 FROM zhiban_identity.identity_member_approval_grants AS approved
           JOIN zhiban_identity.identity_member_approvals AS approval ON approval.tenant_id=approved.tenant_id AND approval.approval_id=approved.approval_id
           JOIN zhiban_identity.identity_tenant_commands AS cmd ON cmd.tenant_id=approval.tenant_id AND cmd.command_id=approval.command_id
           JOIN zhiban_identity.identity_tenant_command_effects AS effect ON effect.tenant_id=approval.tenant_id AND effect.command_id=approval.command_id AND effect.approval_id=approval.approval_id
           JOIN zhiban_identity.audit_events AS event ON event.event_id=effect.audit_event_id
           WHERE approved.tenant_id=v_tenant AND approved.grant_id=v_g.grant_id AND approval.command_id<>v_command
             AND approval.membership_id=v_g.membership_id AND approval.target_user_id=v_te.target_user_id AND approval.approved_at=approval.consumed_at
             AND approval.consumed_at=cmd.completed_at AND cmd.outcome_kind='APPLIED'
             AND approved.role_code=v_g.role_code AND approved.scope_kind=v_g.scope_kind AND approved.scope_id IS NOT DISTINCT FROM v_g.scope_id
             AND approved.created_at=v_g.created_at AND approved.valid_from=v_g.valid_from AND approved.valid_until IS NOT DISTINCT FROM v_g.valid_until
             AND event.event_scope='TENANT' AND event.tenant_id=v_tenant AND event.subject_membership_id=v_g.membership_id AND event.subject_user_id=v_te.target_user_id
             AND event.event_type IN ('MEMBERSHIP_ACTIVATED','MEMBERSHIP_REACTIVATED','MEMBERSHIP_REJOINED','ROLE_GRANT_GRANTED','ROLE_GRANTS_REPLACED'))
           AND NOT EXISTS (
             SELECT 1 FROM zhiban_identity.identity_tenant_onboarding AS anchor
             JOIN zhiban_identity.identity_control_approvals AS approval ON approval.approval_id=anchor.approval_id
             JOIN zhiban_identity.identity_control_commands AS cmd ON cmd.command_id=anchor.command_id AND cmd.approval_id=approval.approval_id
             JOIN zhiban_identity.identity_control_command_effects AS effect ON effect.command_id=cmd.command_id
             JOIN zhiban_identity.audit_events AS pending ON pending.event_id=anchor.pending_event_id
             JOIN zhiban_identity.audit_events AS activated ON activated.event_id=anchor.activation_event_id
             WHERE anchor.tenant_id=v_tenant AND anchor.repository_revision=2 AND anchor.membership_id=v_g.membership_id AND anchor.user_id=v_te.target_user_id
               AND anchor.grant_id=v_g.grant_id AND approval.purpose='FIRST_TENANT_ADMIN' AND approval.planned_grant_id=v_g.grant_id
               AND approval.planned_membership_id=v_g.membership_id AND approval.target_user_id=v_te.target_user_id
               AND cmd.action='FIRST_TENANT_ADMIN' AND cmd.outcome_kind='APPLIED' AND approval.consumed_at=cmd.completed_at AND anchor.completed_at=cmd.completed_at
               AND effect.target_kind='FIRST_TENANT_ADMIN' AND effect.tenant_id=v_tenant AND effect.membership_id=v_g.membership_id AND effect.grant_id=v_g.grant_id
               AND effect.audit_event_id=pending.event_id AND effect.additional_audit_event_id=activated.event_id
               AND pending.event_type='MEMBERSHIP_PENDING_CREATED' AND activated.event_type='MEMBERSHIP_ACTIVATED'
               AND pending.tenant_id=v_tenant AND activated.tenant_id=v_tenant AND pending.subject_user_id=v_te.target_user_id AND activated.subject_user_id=v_te.target_user_id
               AND pending.subject_membership_id=v_g.membership_id AND activated.subject_membership_id=v_g.membership_id
               AND pending.actor_service_code='identity_tenant_onboarding' AND activated.actor_service_code='identity_tenant_onboarding'
               AND v_g.role_code='TENANT_ADMIN' AND v_g.scope_kind='TENANT' AND v_g.scope_id IS NULL
               AND v_g.created_at=anchor.completed_at AND v_g.valid_from=anchor.completed_at AND v_g.valid_until IS NOT DISTINCT FROM approval.valid_until)
           THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
       END LOOP;
     ELSIF v_tc.action IN ('MEMBERSHIP_ACTIVATE','MEMBERSHIP_REACTIVATE','MEMBERSHIP_REJOIN','ROLE_GRANT','ROLE_REPLACE') THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514';
     END IF;
   END LOOP;
   IF EXISTS (SELECT 1 FROM zhiban_identity.identity_member_approvals AS p WHERE p.tenant_id=v_tenant AND p.command_id=v_command
     AND NOT EXISTS (SELECT 1 FROM zhiban_identity.identity_tenant_command_effects AS e WHERE e.tenant_id=v_tenant AND e.command_id=v_command AND e.approval_id=p.approval_id)) THEN RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM set_config('app.tenant_id',coalesce(v_previous,''),true);
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.tenant_id',coalesce(v_previous,''),true); RAISE EXCEPTION 'Identity composition incomplete.' USING ERRCODE='23514';
END;
$body$;
ALTER FUNCTION zhiban_identity.identity_membership_composition_consistency() OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_membership_composition_consistency() FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
CREATE TRIGGER identity_control_approvals_immutable_guard BEFORE INSERT OR UPDATE OR DELETE ON zhiban_identity.identity_control_approvals
 FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_composition_source_guard();
CREATE CONSTRAINT TRIGGER identity_control_approvals_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_control_approvals
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_membership_composition_consistency();
CREATE TRIGGER identity_member_admissions_immutable_guard BEFORE INSERT OR UPDATE OR DELETE ON zhiban_identity.identity_member_admissions
 FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_composition_source_guard();
CREATE CONSTRAINT TRIGGER identity_member_admissions_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_member_admissions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_membership_composition_consistency();
CREATE TRIGGER identity_member_consents_immutable_guard BEFORE UPDATE OR DELETE ON zhiban_identity.identity_member_consents
 FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_composition_append_only();
CREATE CONSTRAINT TRIGGER identity_member_consents_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_member_consents
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_membership_composition_consistency();
CREATE TRIGGER identity_tenant_commands_immutable_guard BEFORE UPDATE OR DELETE ON zhiban_identity.identity_tenant_commands
 FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_composition_append_only();
CREATE CONSTRAINT TRIGGER identity_tenant_commands_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_tenant_commands
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_membership_composition_consistency();
CREATE TRIGGER identity_member_approvals_immutable_guard BEFORE UPDATE OR DELETE ON zhiban_identity.identity_member_approvals
 FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_composition_append_only();
CREATE CONSTRAINT TRIGGER identity_member_approvals_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_member_approvals
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_membership_composition_consistency();
CREATE TRIGGER identity_member_approval_grants_immutable_guard BEFORE UPDATE OR DELETE ON zhiban_identity.identity_member_approval_grants
 FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_composition_append_only();
CREATE CONSTRAINT TRIGGER identity_member_approval_grants_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_member_approval_grants
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_membership_composition_consistency();
CREATE TRIGGER identity_tenant_command_effects_immutable_guard BEFORE UPDATE OR DELETE ON zhiban_identity.identity_tenant_command_effects
 FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_composition_append_only();
CREATE CONSTRAINT TRIGGER identity_tenant_command_effects_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_tenant_command_effects
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_membership_composition_consistency();
CREATE TRIGGER identity_control_commands_immutable_guard BEFORE UPDATE OR DELETE ON zhiban_identity.identity_control_commands
 FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_composition_append_only();
CREATE CONSTRAINT TRIGGER identity_control_commands_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_control_commands
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_membership_composition_consistency();
CREATE TRIGGER identity_control_command_effects_immutable_guard BEFORE UPDATE OR DELETE ON zhiban_identity.identity_control_command_effects
 FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_composition_append_only();
CREATE CONSTRAINT TRIGGER identity_control_command_effects_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_control_command_effects
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_membership_composition_consistency();
CREATE TRIGGER identity_tenant_onboarding_immutable_guard BEFORE INSERT OR UPDATE OR DELETE ON zhiban_identity.identity_tenant_onboarding
 FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_composition_source_guard();
CREATE CONSTRAINT TRIGGER identity_tenant_onboarding_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_tenant_onboarding
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_membership_composition_consistency();
CREATE CONSTRAINT TRIGGER memberships_identity_onboarding_consistency AFTER INSERT OR UPDATE ON zhiban_identity.memberships
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_membership_composition_consistency();
CREATE CONSTRAINT TRIGGER role_grants_identity_onboarding_consistency AFTER INSERT OR UPDATE ON zhiban_identity.role_grants
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_membership_composition_consistency();

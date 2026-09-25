CREATE SCHEMA zhiban_identity AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_identity FROM PUBLIC, zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;
GRANT USAGE ON SCHEMA zhiban_identity TO zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;

-- PostgreSQL's function EXECUTE default is global, not revocable with an
-- IN SCHEMA-only default privilege declaration.
ALTER DEFAULT PRIVILEGES FOR ROLE zhiban_identity_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE zhiban_identity.schema_migrations (
  version text PRIMARY KEY CHECK (version ~ '^[0-9]{4}$'),
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
REVOKE ALL ON zhiban_identity.schema_migrations FROM PUBLIC, zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;

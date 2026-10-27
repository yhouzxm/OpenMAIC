-- Additive private host policy; no changes to existing migrations or formal learning facts.
CREATE TABLE zhiban_classroom_ai_policy (
 tenant_id uuid NOT NULL, offering_id uuid NOT NULL, resource_id uuid NOT NULL, publication_id uuid NOT NULL,
 enabled boolean NOT NULL, revision bigint NOT NULL CHECK(revision>0), updated_by uuid NOT NULL, updated_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,offering_id,resource_id,publication_id)
);
CREATE TABLE zhiban_classroom_ai_policy_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, offering_id uuid NOT NULL, resource_id uuid NOT NULL,
 publication_id uuid NOT NULL, actor_id uuid NOT NULL, enabled boolean NOT NULL, revision bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,offering_id,resource_id,publication_id,revision)
);
CREATE TABLE zhiban_classroom_ai_schema_receipt(id boolean PRIMARY KEY CHECK(id),digest text NOT NULL CHECK(length(digest)=64));
REVOKE ALL ON zhiban_classroom_ai_policy,zhiban_classroom_ai_policy_events,zhiban_classroom_ai_schema_receipt FROM PUBLIC;
CREATE FUNCTION zhiban_classroom_ai_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Classroom policy audit is append only'; END $$;
CREATE TRIGGER zhiban_classroom_ai_audit_immutable BEFORE UPDATE OR DELETE ON zhiban_classroom_ai_policy_events FOR EACH ROW EXECUTE FUNCTION zhiban_classroom_ai_audit_immutable();
REVOKE ALL ON FUNCTION zhiban_classroom_ai_audit_immutable() FROM PUBLIC;

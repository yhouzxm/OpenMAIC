-- Additive autonomous practice storage, distinct from formal collaboration/grade facts.
CREATE TABLE zhiban_published_pbl_policy (
 tenant_id uuid NOT NULL, offering_id uuid NOT NULL, resource_id uuid NOT NULL, publication_id uuid NOT NULL,
 enabled boolean NOT NULL, revision bigint NOT NULL CHECK(revision>0), updated_by uuid NOT NULL, updated_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,offering_id,resource_id,publication_id)
);
CREATE TABLE zhiban_published_pbl_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, offering_id uuid NOT NULL, resource_id uuid NOT NULL, publication_id uuid NOT NULL,
 actor_id uuid NOT NULL, enabled boolean NOT NULL, revision bigint NOT NULL CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,offering_id,resource_id,publication_id,revision)
);
CREATE TABLE zhiban_published_pbl_state (
 owner_id text NOT NULL, stage_id text NOT NULL, scene_id text NOT NULL, source_digest text NOT NULL CHECK(length(source_digest)=64),
 revision bigint NOT NULL CHECK(revision>0), project jsonb NOT NULL CHECK(jsonb_typeof(project)='object'), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,stage_id,scene_id)
);
CREATE TABLE zhiban_published_pbl_receipt(id boolean PRIMARY KEY CHECK(id),digest text NOT NULL CHECK(length(digest)=64));
REVOKE ALL ON zhiban_published_pbl_policy,zhiban_published_pbl_events,zhiban_published_pbl_state,zhiban_published_pbl_receipt FROM PUBLIC;
CREATE FUNCTION zhiban_published_pbl_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PBL policy audit is append only'; END $$;
CREATE TRIGGER zhiban_published_pbl_audit_immutable BEFORE UPDATE OR DELETE ON zhiban_published_pbl_events FOR EACH ROW EXECUTE FUNCTION zhiban_published_pbl_audit_immutable();
REVOKE ALL ON FUNCTION zhiban_published_pbl_audit_immutable() FROM PUBLIC;

-- New private authoring storage in the dedicated lesson database. No existing migration changes.
CREATE TABLE IF NOT EXISTS zhiban_authoring_snapshots (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, offering_id uuid NOT NULL, owner_id text NOT NULL,
 stage_id text NOT NULL, document jsonb NOT NULL, digest text NOT NULL CHECK(length(digest)=64),
 assets jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,stage_id,digest)
);
CREATE TABLE IF NOT EXISTS zhiban_authoring_snapshot_bytes (
 snapshot_id uuid NOT NULL REFERENCES zhiban_authoring_snapshots(id),
 asset_id text NOT NULL, mime text NOT NULL, digest text NOT NULL CHECK(length(digest)=64), bytes bytea NOT NULL,
 PRIMARY KEY(snapshot_id,asset_id)
);
REVOKE ALL ON zhiban_authoring_snapshots,zhiban_authoring_snapshot_bytes FROM PUBLIC;
CREATE FUNCTION zhiban_authoring_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published authoring snapshots are immutable'; END $$;
CREATE TRIGGER zhiban_authoring_immutable BEFORE UPDATE OR DELETE ON zhiban_authoring_snapshots FOR EACH ROW EXECUTE FUNCTION zhiban_authoring_immutable();
CREATE TRIGGER zhiban_authoring_bytes_immutable BEFORE UPDATE OR DELETE ON zhiban_authoring_snapshot_bytes FOR EACH ROW EXECUTE FUNCTION zhiban_authoring_immutable();
REVOKE ALL ON FUNCTION zhiban_authoring_immutable() FROM PUBLIC;
CREATE TABLE zhiban_authoring_schema_receipt(id boolean PRIMARY KEY CHECK(id),digest text NOT NULL CHECK(length(digest)=64));
REVOKE ALL ON zhiban_authoring_schema_receipt FROM PUBLIC;

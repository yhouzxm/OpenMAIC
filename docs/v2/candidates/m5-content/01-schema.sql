-- UNAPPLIED 0001_content component 1/3. NOT in any active migration directory.
-- Future installer: preflight + source/receipt checks; SET LOCAL ROLE owner;
-- concatenate 01/02/03 in one explicit transaction, then write computed ledger SHA.
DO $$ BEGIN
 IF current_user<>'zhiban_identity_owner' THEN RAISE EXCEPTION 'Owner migration role required'; END IF;
END $$;
CREATE SCHEMA zhiban_content AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_content FROM PUBLIC;
CREATE TABLE zhiban_content.schema_migrations(
 version text PRIMARY KEY CHECK(version='0001'), checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$')
);
CREATE FUNCTION zhiban_content.utf16_length(p_text text) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0)::integer
 FROM regexp_split_to_table(p_text,'') AS chars(ch) WHERE ch<>'';
$$;
CREATE FUNCTION zhiban_content.valid_draft(p_draft jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SECURITY INVOKER
SET search_path=pg_catalog,zhiban_content,pg_temp AS $$
DECLARE s jsonb; e jsonb; title_value text; text_value text; key_list text[];
        slide_ids text[]:=ARRAY[]::text[]; element_ids text[]:=ARRAY[]::text[];
        x numeric; y numeric; w numeric; h numeric;
BEGIN
 IF octet_length(p_draft::text)>262144 OR jsonb_typeof(p_draft)<>'object' THEN RETURN false; END IF;
 SELECT array_agg(k ORDER BY k) INTO key_list FROM jsonb_object_keys(p_draft) AS keys(k);
 IF key_list IS DISTINCT FROM ARRAY['slides','title']::text[]
    OR jsonb_typeof(p_draft->'title')<>'string' OR jsonb_typeof(p_draft->'slides')<>'array' THEN RETURN false; END IF;
 title_value:=p_draft->>'title';
 IF btrim(title_value)<>title_value OR title_value ~ '[[:cntrl:]]'
    OR zhiban_content.utf16_length(title_value) NOT BETWEEN 1 AND 120
    OR jsonb_array_length(p_draft->'slides') NOT BETWEEN 1 AND 32 THEN RETURN false; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_draft->'slides') LOOP
   IF jsonb_typeof(s)<>'object' THEN RETURN false; END IF;
   SELECT array_agg(k ORDER BY k) INTO key_list FROM jsonb_object_keys(s) AS keys(k);
   IF key_list IS DISTINCT FROM ARRAY['elements','id']::text[] OR jsonb_typeof(s->'id')<>'string'
      OR (s->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR (s->>'id')=ANY(slide_ids) OR jsonb_typeof(s->'elements')<>'array' THEN RETURN false; END IF;
   slide_ids:=array_append(slide_ids,s->>'id');
   IF jsonb_array_length(s->'elements')>32 THEN RETURN false; END IF;
   FOR e IN SELECT value FROM jsonb_array_elements(s->'elements') LOOP
     IF jsonb_typeof(e)<>'object' THEN RETURN false; END IF;
     SELECT array_agg(k ORDER BY k) INTO key_list FROM jsonb_object_keys(e) AS keys(k);
     IF key_list IS DISTINCT FROM ARRAY['height','id','text','width','x','y']::text[]
        OR jsonb_typeof(e->'id')<>'string'
        OR (e->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR (e->>'id')=ANY(element_ids) OR (e->>'id')=ANY(slide_ids)
        OR jsonb_typeof(e->'text')<>'string'
        OR jsonb_typeof(e->'x')<>'number' OR jsonb_typeof(e->'y')<>'number'
        OR jsonb_typeof(e->'width')<>'number' OR jsonb_typeof(e->'height')<>'number' THEN RETURN false; END IF;
     element_ids:=array_append(element_ids,e->>'id'); text_value:=e->>'text';
     IF zhiban_content.utf16_length(text_value)>2000 OR text_value ~ '[<>&]'
        OR translate(text_value,E'\n\r\t','') ~ '[[:cntrl:]]' THEN RETURN false; END IF;
     x:=(e->>'x')::numeric; y:=(e->>'y')::numeric; w:=(e->>'width')::numeric; h:=(e->>'height')::numeric;
     IF x<>trunc(x) OR y<>trunc(y) OR w<>trunc(w) OR h<>trunc(h)
        OR x<0 OR y<0 OR w<1 OR h<1 OR x+w>960 OR y+h>540 THEN RETURN false; END IF;
   END LOOP;
 END LOOP;
 -- Also reject a later slide ID colliding with an earlier element ID.
 IF slide_ids && element_ids THEN RETURN false; END IF;
 RETURN true;
END;
$$;
CREATE FUNCTION zhiban_content.draft_digest(p_draft jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(sha256(convert_to(p_draft::text,'UTF8')),'hex');
$$;
CREATE TABLE zhiban_content.resources(
 tenant_id uuid NOT NULL REFERENCES zhiban_identity.tenants(tenant_id), id uuid NOT NULL CHECK(zhiban_identity.is_uuid_v7(id)),
 offering_id uuid NOT NULL, kind text NOT NULL CHECK(kind='SLIDE_CONTENT'), policy_version text NOT NULL CHECK(policy_version='content-text-v1'),
 title text NOT NULL, draft jsonb NOT NULL CHECK(zhiban_content.valid_draft(draft)),
 state text NOT NULL CHECK(state IN ('DRAFT','PUBLISHED','WITHDRAWN')), revision bigint NOT NULL CHECK(revision>0),
 active_publication_id uuid, last_publication_no integer NOT NULL CHECK(last_publication_no>=0),
 created_by uuid NOT NULL, updated_by uuid NOT NULL, created_at bigint NOT NULL CHECK(created_at BETWEEN 0 AND 8640000000000000),
 updated_at bigint NOT NULL CHECK(updated_at BETWEEN created_at AND 8640000000000000),
 CHECK(title=draft->>'title'),
 CHECK((state='DRAFT' AND active_publication_id IS NULL AND last_publication_no=0)
    OR (state IN ('PUBLISHED','WITHDRAWN') AND active_publication_id IS NOT NULL AND last_publication_no>0)),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,id,offering_id),
 FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),
 FOREIGN KEY(tenant_id,updated_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_content.publications(
 tenant_id uuid NOT NULL,id uuid NOT NULL CHECK(zhiban_identity.is_uuid_v7(id)),resource_id uuid NOT NULL,offering_id uuid NOT NULL,
 publication_no integer NOT NULL CHECK(publication_no>0),source_revision bigint NOT NULL CHECK(source_revision>0),
 bridge_slot_id uuid NOT NULL,bridge_generation_id uuid NOT NULL,prepare_operation_id uuid NOT NULL,activation_operation_id uuid NOT NULL,
 title text NOT NULL CHECK(zhiban_content.utf16_length(title) BETWEEN 1 AND 120),
 content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),policy_version text NOT NULL CHECK(policy_version='content-text-v1'),
 published_by uuid NOT NULL,published_at bigint NOT NULL CHECK(published_at BETWEEN 0 AND 8640000000000000),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,resource_id,publication_no),UNIQUE(tenant_id,id,resource_id),
 UNIQUE(tenant_id,bridge_generation_id),
 FOREIGN KEY(tenant_id,resource_id,offering_id) REFERENCES zhiban_content.resources(tenant_id,id,offering_id),
 FOREIGN KEY(tenant_id,bridge_slot_id,bridge_generation_id) REFERENCES zhiban_bridge.resource_generations(tenant_id,slot_id,generation_id),
 FOREIGN KEY(tenant_id,prepare_operation_id) REFERENCES zhiban_bridge.operations(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,activation_operation_id) REFERENCES zhiban_bridge.operations(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,published_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
ALTER TABLE zhiban_content.resources ADD CONSTRAINT content_active_publication_fk
 FOREIGN KEY(tenant_id,active_publication_id,id) REFERENCES zhiban_content.publications(tenant_id,id,resource_id)
 DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE zhiban_content.operations(
 tenant_id uuid NOT NULL,id uuid NOT NULL CHECK(zhiban_identity.is_uuid_v7(id)),resource_id uuid NOT NULL,actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('CREATE_CONTENT','SAVE_CONTENT','PUBLISH_CONTENT','WITHDRAW_CONTENT')),
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('RESERVED','SUCCEEDED','FAILED','OUTCOME_UNKNOWN')),
 source_revision bigint NOT NULL CHECK(source_revision>0),source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 expected_native_digest text CHECK(expected_native_digest ~ '^[a-f0-9]{64}$'),
 prepare_operation_id uuid,bridge_operation_id uuid,result_publication_id uuid,result_revision bigint CHECK(result_revision>0),
 created_at bigint NOT NULL CHECK(created_at BETWEEN 0 AND 8640000000000000),
 completed_at bigint CHECK(completed_at BETWEEN created_at AND 8640000000000000),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,actor_id,resource_id,key_digest),
 UNIQUE(tenant_id,prepare_operation_id),
 CHECK((action='PUBLISH_CONTENT')=(expected_native_digest IS NOT NULL)),
 FOREIGN KEY(tenant_id,resource_id) REFERENCES zhiban_content.resources(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),
 FOREIGN KEY(tenant_id,prepare_operation_id) REFERENCES zhiban_bridge.operations(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,bridge_operation_id) REFERENCES zhiban_bridge.operations(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,result_publication_id,resource_id) REFERENCES zhiban_content.publications(tenant_id,id,resource_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((state='RESERVED' AND completed_at IS NULL AND result_revision IS NULL AND result_publication_id IS NULL)
    OR (state='OUTCOME_UNKNOWN' AND action='PUBLISH_CONTENT' AND completed_at IS NULL AND result_revision IS NULL AND result_publication_id IS NULL)
    OR (state='FAILED' AND completed_at IS NOT NULL AND result_revision IS NULL AND result_publication_id IS NULL)
    OR (state='SUCCEEDED' AND completed_at IS NOT NULL AND result_revision IS NOT NULL
        AND ((action='PUBLISH_CONTENT' AND result_publication_id IS NOT NULL AND prepare_operation_id IS NOT NULL AND bridge_operation_id IS NOT NULL)
          OR (action<>'PUBLISH_CONTENT' AND result_publication_id IS NULL)))),
 CHECK(action='PUBLISH_CONTENT' OR prepare_operation_id IS NULL),
 CHECK(action NOT IN ('CREATE_CONTENT','SAVE_CONTENT') OR bridge_operation_id IS NULL),
 CHECK(action<>'WITHDRAW_CONTENT' OR (state='SUCCEEDED' AND
   ((result_revision=source_revision AND bridge_operation_id IS NULL)
    OR (result_revision=source_revision+1 AND bridge_operation_id IS NOT NULL))))
);
CREATE UNIQUE INDEX content_one_unresolved_publish ON zhiban_content.operations(tenant_id,resource_id)
 WHERE action='PUBLISH_CONTENT' AND state IN ('RESERVED','OUTCOME_UNKNOWN');
CREATE UNIQUE INDEX content_one_mutation_per_revision ON zhiban_content.operations(tenant_id,resource_id,result_revision)
 WHERE state='SUCCEEDED' AND (action='CREATE_CONTENT' OR result_revision>source_revision);
CREATE TABLE zhiban_content.audit_events(
 tenant_id uuid NOT NULL,id uuid NOT NULL CHECK(zhiban_identity.is_uuid_v7(id)),resource_id uuid NOT NULL,operation_id uuid NOT NULL,actor_id uuid NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('CONTENT_CREATED','DRAFT_SAVED','COMMAND_NOOP','PUBLISH_RESERVED','CONTENT_PUBLISHED','CONTENT_WITHDRAWN','OPERATION_FAILED','OUTCOME_QUARANTINED')),
 revision_before bigint CHECK(revision_before>0),revision_after bigint NOT NULL CHECK(revision_after>0),
 occurred_at bigint NOT NULL CHECK(occurred_at BETWEEN 0 AND 8640000000000000),
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,resource_id) REFERENCES zhiban_content.resources(tenant_id,id),
 FOREIGN KEY(tenant_id,operation_id) REFERENCES zhiban_content.operations(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);

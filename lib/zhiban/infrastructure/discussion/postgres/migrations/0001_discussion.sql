-- Independent additive discussion contract. No Native/Identity migration changes.
CREATE SCHEMA zhiban_discussion AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_discussion FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_discussion TO zhiban_academic_runtime;
CREATE TABLE zhiban_discussion.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_discussion.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_discussion.topics(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),description text NOT NULL CHECK(length(description)<=2000),
 state text NOT NULL CHECK(state IN('DRAFT','OPEN','CLOSED','ARCHIVED')),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 author_id uuid NOT NULL,created_at bigint NOT NULL CHECK(created_at>0),
 PRIMARY KEY(tenant_id,offering_id,id),
 FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id),
 FOREIGN KEY(tenant_id,author_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_discussion.posts(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,topic_id uuid NOT NULL,id uuid NOT NULL,parent_id uuid,
 author_id uuid NOT NULL,body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
 state text NOT NULL CHECK(state IN('VISIBLE','HIDDEN')),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),created_at bigint NOT NULL CHECK(created_at>0),
 PRIMARY KEY(tenant_id,offering_id,topic_id,id),
 FOREIGN KEY(tenant_id,offering_id,topic_id) REFERENCES zhiban_discussion.topics(tenant_id,offering_id,id),
 FOREIGN KEY(tenant_id,offering_id,topic_id,parent_id) REFERENCES zhiban_discussion.posts(tenant_id,offering_id,topic_id,id),
 FOREIGN KEY(tenant_id,author_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),CHECK(parent_id IS NULL OR parent_id<>id)
);
CREATE TABLE zhiban_discussion.moderation_events(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,topic_id uuid NOT NULL,id uuid NOT NULL,post_id uuid NOT NULL,actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN('HIDE_POST','RESTORE_POST')),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
 from_state text NOT NULL,to_state text NOT NULL,created_at bigint NOT NULL CHECK(created_at>0),
 CHECK((action='HIDE_POST' AND from_state='VISIBLE' AND to_state='HIDDEN') OR (action='RESTORE_POST' AND from_state='HIDDEN' AND to_state='VISIBLE')),
 PRIMARY KEY(tenant_id,offering_id,topic_id,id),
 FOREIGN KEY(tenant_id,offering_id,topic_id,post_id) REFERENCES zhiban_discussion.posts(tenant_id,offering_id,topic_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_discussion.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9_-]{16,80}$'),actor_id uuid NOT NULL,offering_id uuid NOT NULL,
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),result jsonb NOT NULL,event_type text NOT NULL,facts jsonb NOT NULL,created_at bigint NOT NULL CHECK(created_at>0),
 PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE INDEX discussion_topics_page ON zhiban_discussion.topics(tenant_id,offering_id,created_at DESC,id DESC);
CREATE INDEX discussion_posts_page ON zhiban_discussion.posts(tenant_id,offering_id,topic_id,created_at,id);
CREATE INDEX discussion_events_page ON zhiban_discussion.moderation_events(tenant_id,offering_id,topic_id,created_at,id);
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['topics','posts','moderation_events','commands'] LOOP
  EXECUTE format('ALTER TABLE zhiban_discussion.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE zhiban_discussion.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY tenant_scope ON zhiban_discussion.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',name);
  EXECUTE format('REVOKE ALL ON zhiban_discussion.%I FROM PUBLIC',name);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_discussion.%I TO zhiban_academic_runtime',name);
 END LOOP;
END $$;
GRANT UPDATE(title,description,state,revision) ON zhiban_discussion.topics TO zhiban_academic_runtime;
GRANT UPDATE(state,revision) ON zhiban_discussion.posts TO zhiban_academic_runtime;

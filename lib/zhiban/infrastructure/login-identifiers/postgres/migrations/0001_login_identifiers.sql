-- Additive LOCAL login-identifier registry. Original Identity tables, functions and ACL stay unchanged.
CREATE SCHEMA zhiban_login_identifiers AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_login_identifiers FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_login_identifiers TO zhiban_auth_runtime,zhiban_control_runtime;
CREATE TABLE zhiban_login_identifiers.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL);
CREATE TABLE zhiban_login_identifiers.approvals(
 source_ref uuid PRIMARY KEY,source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),manifest jsonb NOT NULL,
 registered_at bigint NOT NULL
);
CREATE TABLE zhiban_login_identifiers.names(
 alias text COLLATE "C" PRIMARY KEY CHECK(alias~'^@[a-z][a-z0-9._-]{3,46}[a-z0-9]$'),
 user_id uuid NOT NULL REFERENCES zhiban_identity.users(user_id),
 state text NOT NULL CHECK(state IN('PENDING','ACTIVE','RETIRED')),revision bigint NOT NULL CHECK(revision>0),
 source_ref uuid NOT NULL REFERENCES zhiban_login_identifiers.approvals(source_ref),
 updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX one_active_login_identifier ON zhiban_login_identifiers.names(user_id) WHERE state='ACTIVE';
CREATE TABLE zhiban_login_identifiers.events(
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,alias text NOT NULL REFERENCES zhiban_login_identifiers.names(alias),
 user_id uuid NOT NULL REFERENCES zhiban_identity.users(user_id),action text NOT NULL CHECK(action IN('NOMINATED','ACCEPTED','RETIRED')),
 revision bigint NOT NULL,source_ref uuid NOT NULL REFERENCES zhiban_login_identifiers.approvals(source_ref),occurred_at bigint NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES zhiban_identity.users(user_id)
);
CREATE TABLE zhiban_login_identifiers.buckets(key text COLLATE "C" PRIMARY KEY CHECK(key~'^[a-f0-9]{64}$'),start_at bigint NOT NULL,n integer NOT NULL CHECK(n>0));
REVOKE ALL ON ALL TABLES IN SCHEMA zhiban_login_identifiers FROM PUBLIC,zhiban_runtime,zhiban_academic_runtime,zhiban_auth_runtime,zhiban_control_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA zhiban_login_identifiers FROM PUBLIC,zhiban_runtime,zhiban_academic_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT SELECT ON zhiban_login_identifiers.schema_migrations TO zhiban_auth_runtime,zhiban_control_runtime;
GRANT SELECT(alias,user_id,state,revision) ON zhiban_login_identifiers.names TO zhiban_auth_runtime;
CREATE FUNCTION zhiban_login_identifiers.session_guard(p_digest text,p_expected_user_id uuid)
RETURNS TABLE(user_id uuid,user_revision bigint,security_epoch bigint,absolute_expires_at bigint,idle_expires_at bigint)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE v_session zhiban_identity.sessions%ROWTYPE; v_user zhiban_identity.users%ROWTYPE;
  v_slot zhiban_identity.credential_slots%ROWTYPE; v_now bigint;
BEGIN
  IF session_user NOT IN ('zhiban_auth_runtime','zhiban_control_runtime') OR p_digest IS NULL
    OR octet_length(p_digest)<>64 OR p_digest !~ '^[0-9a-f]{64}$'
    OR zhiban_identity.is_uuid_v7(p_expected_user_id) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Authentication rejected' USING ERRCODE='42501';
  END IF;
  SELECT s.* INTO v_session FROM zhiban_identity.sessions AS s WHERE s.token_digest=p_digest;
  IF v_session.user_id IS DISTINCT FROM p_expected_user_id THEN RAISE EXCEPTION 'Authentication rejected' USING ERRCODE='42501'; END IF;
  SELECT u.* INTO v_user FROM zhiban_identity.users AS u WHERE u.user_id=p_expected_user_id FOR SHARE;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('zhiban-session-user:' || v_session.user_id::text,0));
  SELECT c.* INTO v_slot FROM zhiban_identity.credential_slots AS c WHERE c.user_id=v_session.user_id FOR SHARE;
  SELECT s.* INTO v_session FROM zhiban_identity.sessions AS s WHERE s.token_digest=p_digest FOR SHARE;
  v_now:=floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
  IF (v_user.user_id IS NOT NULL AND v_user.status='ACTIVE' AND v_user.repository_revision>0
    AND v_user.created_at>=0 AND v_user.updated_at>=v_user.created_at AND v_user.updated_at<=8640000000000000
    AND v_user.disabled_at IS NULL AND v_user.disabled_reason IS NULL
    AND v_session.user_id=v_user.user_id AND v_session.user_revision=v_user.repository_revision
    AND v_session.security_epoch=v_slot.security_epoch AND v_session.revoked_at IS NULL
    AND v_session.repository_revision>0 AND v_session.security_epoch>0 AND v_slot.repository_revision>0
    AND v_slot.generation>0 AND v_slot.credential_type='PASSWORD' AND v_slot.active_credential_id IS NOT NULL
    AND v_slot.created_at>=0 AND v_slot.updated_at>=v_slot.created_at AND v_slot.updated_at<=8640000000000000
    AND v_session.session_id ~ '^ses_[A-Za-z0-9_-]{43}$' AND octet_length(v_session.session_id)=47
    AND v_session.token_digest=p_digest AND v_session.created_at>=0
    AND v_session.created_at<=v_session.last_seen_at AND v_now>=v_session.last_seen_at
    AND v_now<v_session.idle_expires_at AND v_session.idle_expires_at<=v_session.absolute_expires_at
    AND v_session.absolute_expires_at<=8640000000000000 AND v_now BETWEEN 0 AND 8640000000000000
    AND EXISTS (SELECT 1 FROM zhiban_identity.credentials AS c
      WHERE c.user_id=v_user.user_id AND c.credential_id=v_slot.active_credential_id AND c.status='ACTIVE'
        AND c.credential_type='PASSWORD' AND c.generation=v_slot.generation AND c.slot_revision=v_slot.repository_revision
        AND c.created_at>=v_slot.created_at AND c.updated_at>=c.created_at AND c.updated_at<=v_slot.updated_at
        AND c.replaced_at IS NULL AND c.revoked_at IS NULL AND c.replaced_by_credential_id IS NULL)) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Authentication rejected' USING ERRCODE='42501';
  END IF;
  IF v_user.user_id<>p_expected_user_id THEN RAISE EXCEPTION 'Authentication rejected' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT v_user.user_id,v_user.repository_revision,v_slot.security_epoch,
    v_session.absolute_expires_at,v_session.idle_expires_at;
END;
$$;

-- Only this module's owner calls the internal guard; public entrypoints check session_user too.
CREATE FUNCTION zhiban_login_identifiers.nominate(p_manifest jsonb,p_digest text,p_session text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,zhiban_identity,zhiban_login_identifiers,pg_temp SET row_security=on AS $$
DECLARE m jsonb:=p_manifest;u uuid;o uuid;g uuid;r uuid;a text;at bigint;n names%ROWTYPE;v bigint;op users%ROWTYPE;target users%ROWTYPE;sg system_admin_grants%ROWTYPE;uid uuid;
BEGIN
 IF session_user<>'zhiban_control_runtime' OR octet_length(m::text)>4096 OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(m) key) IS DISTINCT FROM ARRAY['alias','environment','expectedUserRevision','expiresAt','grantId','grantRevision','issuedAt','kind','operatorRevision','operatorUserId','sourceRef','subjectReference','userId']::text[]
  OR m->>'kind'<>'LOGIN_IDENTIFIER_NOMINATION' OR p_digest!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Identifier rejected' USING ERRCODE='42501';END IF;
 u:=(m->>'userId')::uuid;o:=(m->>'operatorUserId')::uuid;g:=(m->>'grantId')::uuid;r:=(m->>'sourceRef')::uuid;a:=m->>'alias';
 IF a!~'^@[a-z][a-z0-9._-]{3,46}[a-z0-9]$' OR length(m->>'subjectReference') NOT BETWEEN 1 AND 120 OR length(m->>'environment') NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'Identifier rejected' USING ERRCODE='42501';END IF;
 FOR uid IN SELECT DISTINCT x FROM unnest(ARRAY[u,o]) x ORDER BY x LOOP PERFORM 1 FROM users WHERE user_id=uid FOR UPDATE;END LOOP;
 SELECT * INTO target FROM users WHERE user_id=u;SELECT * INTO op FROM users WHERE user_id=o;
 SELECT * INTO sg FROM system_admin_grants WHERE grant_id=g FOR SHARE;
 PERFORM zhiban_login_identifiers.session_guard(p_session,o);
 at:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF (target.status='ACTIVE' AND target.repository_revision=(m->>'expectedUserRevision')::bigint AND op.status='ACTIVE' AND op.repository_revision=(m->>'operatorRevision')::bigint
  AND sg.user_id=o AND sg.repository_revision=(m->>'grantRevision')::bigint AND sg.revoked_at IS NULL AND sg.valid_from<=at AND (sg.valid_until IS NULL OR sg.valid_until>at)
  AND (m->>'issuedAt')::bigint<=at AND (m->>'expiresAt')::bigint>at AND (m->>'expiresAt')::bigint-(m->>'issuedAt')::bigint BETWEEN 1 AND 1800000) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Identifier rejected' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('zhiban-login-identifiers-registry',0));
 IF EXISTS(SELECT 1 FROM approvals WHERE source_ref=r) THEN RAISE EXCEPTION 'Identifier stale' USING ERRCODE='40001';END IF;
 IF (SELECT count(*) FROM approvals)>=20000 OR (SELECT count(*) FROM events)>=40000 THEN RAISE EXCEPTION 'Identifier capacity' USING ERRCODE='54000';END IF;
 SELECT * INTO n FROM names WHERE alias=a FOR UPDATE;
 IF FOUND THEN
  IF n.user_id<>u OR n.state='ACTIVE' THEN RAISE EXCEPTION 'Identifier unavailable' USING ERRCODE='23505';END IF;
 ELSE
  IF (SELECT count(*) FROM names)>=10000 OR (SELECT count(*) FROM names WHERE user_id=u)>=10 THEN RAISE EXCEPTION 'Identifier capacity' USING ERRCODE='54000';END IF;
 END IF;
 INSERT INTO approvals VALUES(r,p_digest,m,at);
 INSERT INTO names VALUES(a,u,'PENDING',1,r,at) ON CONFLICT(alias) DO UPDATE SET state='PENDING',revision=names.revision+1,source_ref=r,updated_at=at RETURNING revision INTO v;
 INSERT INTO events(alias,user_id,action,revision,source_ref,occurred_at,actor_user_id) VALUES(a,u,'NOMINATED',v,r,at,o);
 PERFORM zhiban_login_identifiers.session_guard(p_session,o);
 at:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF at>=(m->>'expiresAt')::bigint OR (sg.valid_until IS NOT NULL AND at>=sg.valid_until) THEN RAISE EXCEPTION 'Identifier expired' USING ERRCODE='42501';END IF;
 RETURN v;
END $$;
CREATE FUNCTION zhiban_login_identifiers.own(p_session text,p_user uuid) RETURNS TABLE(alias text,state text,revision text,expires_at bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,zhiban_identity,zhiban_login_identifiers,pg_temp SET row_security=on AS $$
BEGIN
 IF session_user<>'zhiban_auth_runtime' THEN RAISE EXCEPTION 'Identifier rejected' USING ERRCODE='42501';END IF;
 PERFORM zhiban_login_identifiers.session_guard(p_session,p_user);
 RETURN QUERY SELECT n.alias,CASE WHEN n.state='PENDING' AND (a.manifest->>'expiresAt')::bigint<=floor(extract(epoch FROM clock_timestamp())*1000)::bigint THEN 'EXPIRED' WHEN n.state='PENDING' AND (a.manifest->>'expectedUserRevision')::bigint<>(SELECT repository_revision FROM users WHERE user_id=p_user) THEN 'STALE' ELSE n.state END,n.revision::text,(a.manifest->>'expiresAt')::bigint FROM names n JOIN approvals a USING(source_ref) WHERE n.user_id=p_user ORDER BY n.alias LIMIT 10;
END $$;
CREATE FUNCTION zhiban_login_identifiers.mutate(p_session text,p_fresh text,p_user uuid,p_alias text,p_revision bigint,p_action text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,zhiban_identity,zhiban_login_identifiers,pg_temp SET row_security=on AS $$
DECLARE n names%ROWTYPE;m jsonb;op users%ROWTYPE;target users%ROWTYPE;sg system_admin_grants%ROWTYPE;uid uuid;at bigint;v bigint;prior names%ROWTYPE;
BEGIN
 IF session_user<>'zhiban_auth_runtime' OR p_session IS NOT DISTINCT FROM p_fresh OR p_action NOT IN('ACCEPT','RETIRE') OR p_revision<1 THEN RAISE EXCEPTION 'Identifier rejected' USING ERRCODE='42501';END IF;
 SELECT x.* INTO n FROM names x WHERE x.alias=p_alias AND x.user_id=p_user;IF NOT FOUND THEN RAISE EXCEPTION 'Identifier rejected' USING ERRCODE='42501';END IF;
 SELECT manifest INTO m FROM approvals WHERE source_ref=n.source_ref;
 FOR uid IN SELECT DISTINCT x FROM unnest(ARRAY[p_user,(m->>'operatorUserId')::uuid]) x ORDER BY x LOOP PERFORM 1 FROM users WHERE user_id=uid FOR UPDATE;END LOOP;
 SELECT * INTO target FROM users WHERE user_id=p_user;
 IF p_action='ACCEPT' THEN
  SELECT * INTO op FROM users WHERE user_id=(m->>'operatorUserId')::uuid;
  SELECT * INTO sg FROM system_admin_grants WHERE grant_id=(m->>'grantId')::uuid FOR SHARE;
 END IF;
 PERFORM zhiban_login_identifiers.session_guard(p_session,p_user);PERFORM zhiban_login_identifiers.session_guard(p_fresh,p_user);
 at:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF NOT EXISTS(SELECT 1 FROM sessions WHERE token_digest=p_fresh AND user_id=p_user AND created_at>=at-60000) THEN RAISE EXCEPTION 'Identifier proof expired' USING ERRCODE='42501';END IF;
 SELECT * INTO n FROM names WHERE alias=p_alias FOR UPDATE;
 IF n.user_id<>p_user OR n.revision<>p_revision OR n.source_ref IS DISTINCT FROM (m->>'sourceRef')::uuid THEN RAISE EXCEPTION 'Identifier stale' USING ERRCODE='40001';END IF;
 IF (SELECT count(*) FROM events)>=40000 THEN RAISE EXCEPTION 'Identifier capacity' USING ERRCODE='54000';END IF;
 IF p_action='ACCEPT' THEN
  IF (n.state='PENDING' AND target.repository_revision=(m->>'expectedUserRevision')::bigint AND op.status='ACTIVE' AND op.repository_revision=(m->>'operatorRevision')::bigint
   AND sg.user_id=op.user_id AND sg.repository_revision=(m->>'grantRevision')::bigint AND sg.revoked_at IS NULL AND sg.valid_from<=at AND (sg.valid_until IS NULL OR sg.valid_until>at)
   AND (m->>'issuedAt')::bigint<=at AND (m->>'expiresAt')::bigint>at) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Identifier rejected' USING ERRCODE='42501';END IF;
  FOR prior IN SELECT * FROM names WHERE user_id=p_user AND state='ACTIVE' ORDER BY alias FOR UPDATE LOOP
   UPDATE names SET state='RETIRED',revision=revision+1,updated_at=at WHERE alias=prior.alias;
   INSERT INTO events(alias,user_id,action,revision,source_ref,occurred_at,actor_user_id) VALUES(prior.alias,p_user,'RETIRED',prior.revision+1,prior.source_ref,at,p_user);
  END LOOP;
  UPDATE names SET state='ACTIVE',revision=revision+1,updated_at=at WHERE alias=p_alias RETURNING revision INTO v;
 ELSE
  IF n.state='RETIRED' THEN RAISE EXCEPTION 'Identifier stale' USING ERRCODE='40001';END IF;
  UPDATE names SET state='RETIRED',revision=revision+1,updated_at=at WHERE alias=p_alias RETURNING revision INTO v;
 END IF;
 INSERT INTO events(alias,user_id,action,revision,source_ref,occurred_at,actor_user_id) VALUES(p_alias,p_user,CASE WHEN p_action='ACCEPT' THEN 'ACCEPTED' ELSE 'RETIRED' END,v,n.source_ref,at,p_user);
 PERFORM zhiban_login_identifiers.session_guard(p_session,p_user);PERFORM zhiban_login_identifiers.session_guard(p_fresh,p_user);
 at:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF NOT EXISTS(SELECT 1 FROM sessions WHERE token_digest=p_fresh AND created_at>=at-60000) OR (p_action='ACCEPT' AND (at>=(m->>'expiresAt')::bigint OR (sg.valid_until IS NOT NULL AND at>=sg.valid_until))) THEN RAISE EXCEPTION 'Identifier proof expired' USING ERRCODE='42501';END IF;
 RETURN v;
END $$;
CREATE FUNCTION zhiban_login_identifiers.guard_login(p_session text,p_user uuid,p_alias text,p_revision bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,zhiban_identity,zhiban_login_identifiers,pg_temp SET row_security=on AS $$
BEGIN
 IF session_user<>'zhiban_auth_runtime' THEN RAISE EXCEPTION 'Identifier rejected' USING ERRCODE='42501';END IF;
 PERFORM zhiban_login_identifiers.session_guard(p_session,p_user);
 PERFORM 1 FROM names WHERE alias=p_alias AND user_id=p_user AND state='ACTIVE' AND revision=p_revision FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Identifier changed' USING ERRCODE='42501';END IF;
 PERFORM zhiban_login_identifiers.session_guard(p_session,p_user);
END $$;
CREATE FUNCTION zhiban_login_identifiers.reserve(p_keys text[]) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,zhiban_login_identifiers,pg_temp SET row_security=on AS $$
DECLARE at bigint;old buckets%ROWTYPE;v_key text;i integer;lim integer;
BEGIN
 IF session_user<>'zhiban_auth_runtime' OR cardinality(p_keys)<>3 OR (SELECT count(DISTINCT k) FROM unnest(p_keys) k)<>3 OR EXISTS(SELECT 1 FROM unnest(p_keys) k WHERE k IS NULL OR k!~'^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'Identifier budget rejected' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('zhiban-login-identifiers-budget',0));at:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 DELETE FROM buckets WHERE start_at<=at-60000;
 IF (SELECT count(*) FROM buckets)+(SELECT count(*) FROM unnest(p_keys) k WHERE NOT EXISTS(SELECT 1 FROM buckets b WHERE b.key=k))>4096 THEN RETURN false;END IF;
 FOR i IN 1..3 LOOP v_key:=p_keys[i];lim:=CASE i WHEN 1 THEN 100 WHEN 2 THEN 40 ELSE 20 END;SELECT b.* INTO old FROM buckets b WHERE b.key=v_key;IF FOUND AND old.n>=lim THEN RETURN false;END IF;END LOOP;
 FOR v_key IN SELECT unnest(p_keys) LOOP INSERT INTO buckets VALUES(v_key,at,1) ON CONFLICT ON CONSTRAINT buckets_pkey DO UPDATE SET n=buckets.n+1;END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION zhiban_login_identifiers.nomination_status(p_session text,p_operator uuid,p_grant uuid,p_ref uuid) RETURNS TABLE(alias text,user_id uuid,state text,revision text,source_digest text,current_source uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,zhiban_identity,zhiban_login_identifiers,pg_temp SET row_security=on AS $$
DECLARE at bigint;
BEGIN
 IF session_user<>'zhiban_control_runtime' THEN RAISE EXCEPTION 'Identifier rejected' USING ERRCODE='42501';END IF;
 PERFORM zhiban_login_identifiers.session_guard(p_session,p_operator);at:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 PERFORM 1 FROM system_admin_grants WHERE grant_id=p_grant AND user_id=p_operator AND revoked_at IS NULL AND valid_from<=at AND (valid_until IS NULL OR valid_until>at) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Identifier rejected' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT n.alias,n.user_id,n.state,n.revision::text,a.source_digest,n.source_ref FROM approvals a JOIN names n ON n.alias=a.manifest->>'alias' WHERE a.source_ref=p_ref AND a.manifest->>'operatorUserId'=p_operator::text;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA zhiban_login_identifiers FROM PUBLIC,zhiban_runtime,zhiban_academic_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_login_identifiers.nominate(jsonb,text,text) TO zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_login_identifiers.own(text,uuid),zhiban_login_identifiers.mutate(text,text,uuid,text,bigint,text),zhiban_login_identifiers.guard_login(text,uuid,text,bigint),zhiban_login_identifiers.reserve(text[]) TO zhiban_auth_runtime;

GRANT EXECUTE ON FUNCTION zhiban_login_identifiers.nomination_status(text,uuid,uuid,uuid) TO zhiban_control_runtime;

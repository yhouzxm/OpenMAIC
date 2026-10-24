-- Successor: 0001 was already applied in the independent LOCAL reference. Preserve it.
CREATE OR REPLACE FUNCTION zhiban_login_identifiers.nomination_status(p_session text,p_operator uuid,p_grant uuid,p_ref uuid) RETURNS TABLE(alias text,user_id uuid,state text,revision text,source_digest text,current_source uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,zhiban_identity,zhiban_login_identifiers,pg_temp SET row_security=on AS $$
DECLARE at bigint;g system_admin_grants%ROWTYPE;
BEGIN
 IF session_user<>'zhiban_control_runtime' THEN RAISE EXCEPTION 'Identifier rejected' USING ERRCODE='42501';END IF;
 PERFORM zhiban_login_identifiers.session_guard(p_session,p_operator);
 SELECT sg.* INTO g FROM system_admin_grants sg WHERE sg.grant_id=p_grant AND sg.user_id=p_operator FOR SHARE;
 at:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF (g.user_id=p_operator AND g.revoked_at IS NULL AND g.valid_from<=at AND (g.valid_until IS NULL OR g.valid_until>at)) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Identifier rejected' USING ERRCODE='42501';END IF;
 PERFORM zhiban_login_identifiers.session_guard(p_session,p_operator);
 RETURN QUERY SELECT n.alias,n.user_id,n.state,n.revision::text,a.source_digest,n.source_ref FROM approvals a JOIN names n ON n.alias=a.manifest->>'alias' WHERE a.source_ref=p_ref AND a.manifest->>'operatorUserId'=p_operator::text;
END $$;

-- Closed service purpose. Every entry is bound to actual immutable submission and explicit current teacher delegation.
CREATE FUNCTION zhiban_autograde.input_for(p_tenant uuid,p_submission uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE a record;p record;h record;t record;e record;tg record;sg record;v record;q record;u uuid[];m uuid[];now_ms bigint;result jsonb;limits jsonb;objective jsonb;teacher_version bigint;student_version bigint;
BEGIN
 IF session_user<>'zhiban_autograde_worker' OR zhiban_identity.is_uuid_v7(p_tenant) IS DISTINCT FROM true OR zhiban_identity.is_uuid_v7(p_submission) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Service scope rejected' USING ERRCODE='42501'; END IF;
 PERFORM set_config('app.tenant_id',p_tenant::text,true);
 SELECT s.id AS submission_id,s.version AS submission_version,s.answer,t0.id AS attempt_id,t0.membership_id,t0.enrollment_id,t0.started_at,t0.activity_id,t0.activity_version,t0.offering_id,o.course_id INTO a FROM zhiban_learning.submissions s JOIN zhiban_learning.attempts t0 ON t0.tenant_id=s.tenant_id AND t0.id=s.attempt_id JOIN zhiban_academic.offerings o ON o.tenant_id=t0.tenant_id AND o.id=t0.offering_id WHERE s.tenant_id=p_tenant AND s.id=p_submission;
 IF NOT FOUND THEN RAISE EXCEPTION 'Service scope rejected' USING ERRCODE='42501'; END IF;
 SELECT r.* INTO p FROM zhiban_autograde.heads x JOIN zhiban_autograde.policies r ON r.tenant_id=x.tenant_id AND r.id=x.current_policy WHERE x.tenant_id=p_tenant AND x.activity_id=a.activity_id AND x.enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delegation unavailable' USING ERRCODE='42501'; END IF;
 -- Frozen Identity lock order, no credentials/sessions, no new Identity privileges or policies.
 PERFORM tenant_id FROM zhiban_identity.tenants WHERE tenant_id=p_tenant AND status='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delegation unavailable' USING ERRCODE='42501'; END IF;
 m:=ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[p.teacher_id,a.membership_id]) x ORDER BY x);
 u:=ARRAY(SELECT DISTINCT user_id FROM zhiban_identity.memberships WHERE tenant_id=p_tenant AND membership_id=ANY(m) ORDER BY user_id);
 PERFORM user_id FROM zhiban_identity.users WHERE user_id=ANY(u) ORDER BY user_id FOR SHARE;
 -- Frozen owner SELECT policies cannot row-lock scoped Membership/Grant rows.
 -- Short SHARE table locks serialize all child writers without adding any Identity policy or DML privilege.
 -- Never held during model inference; table lock scope is deliberately conservative for this LOCAL first package.
 LOCK TABLE zhiban_identity.memberships IN SHARE MODE;
 LOCK TABLE zhiban_identity.role_grants IN SHARE MODE;
 IF (SELECT count(*) FROM zhiban_identity.memberships mm JOIN zhiban_identity.users uu ON uu.user_id=mm.user_id WHERE mm.tenant_id=p_tenant AND mm.membership_id=ANY(m) AND mm.status='ACTIVE' AND uu.status='ACTIVE')<>cardinality(m) THEN RAISE EXCEPTION 'Delegation unavailable' USING ERRCODE='42501'; END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 SELECT authorization_version INTO teacher_version FROM zhiban_identity.memberships WHERE tenant_id=p_tenant AND membership_id=p.teacher_id;
 SELECT authorization_version INTO student_version FROM zhiban_identity.memberships WHERE tenant_id=p_tenant AND membership_id=a.membership_id;
 IF teacher_version<>p.teacher_auth_version THEN RAISE EXCEPTION 'Delegation changed' USING ERRCODE='42501'; END IF;
 SELECT * INTO tg FROM zhiban_identity.role_grants WHERE tenant_id=p_tenant AND membership_id=p.teacher_id AND grant_id=p.teacher_grant AND role_code='TEACHER' AND revoked_at IS NULL AND valid_from<=now_ms AND (valid_until IS NULL OR valid_until>now_ms) AND ((scope_kind='TENANT' AND scope_id IS NULL) OR(scope_kind='COURSE' AND scope_id=a.course_id) OR(scope_kind='CLASS' AND scope_id=a.offering_id));
 IF NOT FOUND THEN RAISE EXCEPTION 'Delegation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO sg FROM zhiban_identity.role_grants WHERE tenant_id=p_tenant AND membership_id=a.membership_id AND role_code='STUDENT' AND scope_kind='SELF' AND scope_id IS NULL AND revoked_at IS NULL AND valid_from<=now_ms AND (valid_until IS NULL OR valid_until>now_ms) ORDER BY coalesce(valid_until,9223372036854775807) DESC,grant_id LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Recipient unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('progress:'||p_tenant::text||':'||a.offering_id::text,0));
 PERFORM id FROM zhiban_academic.offerings WHERE tenant_id=p_tenant AND id=a.offering_id AND status='OPEN' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Course unavailable' USING ERRCODE='42501'; END IF;
 PERFORM id FROM zhiban_academic.courses WHERE tenant_id=p_tenant AND id=a.course_id AND status<>'ARCHIVED' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Course unavailable' USING ERRCODE='42501'; END IF;
 PERFORM id FROM zhiban_academic.assignments WHERE tenant_id=p_tenant AND offering_id=a.offering_id AND membership_id=p.teacher_id AND status='ACTIVE' AND valid_from<=now_ms AND valid_until IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Assignment unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM zhiban_academic.enrollments WHERE tenant_id=p_tenant AND id=a.enrollment_id AND offering_id=a.offering_id AND membership_id=a.membership_id AND status='ACTIVE' AND valid_from<=now_ms AND valid_from<=a.started_at AND valid_until IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Enrollment unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM zhiban_autograde.heads WHERE tenant_id=p_tenant AND activity_id=a.activity_id AND enabled AND current_policy=p.id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delegation changed' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM zhiban_learning.activities WHERE tenant_id=p_tenant AND id=a.activity_id AND status='PUBLISHED' AND published_version=p.activity_version AND published_version=a.activity_version FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='40001'; END IF;
 PERFORM id FROM zhiban_learning.attempts WHERE tenant_id=p_tenant AND id=a.attempt_id FOR UPDATE;
 IF a.attempt_id IS DISTINCT FROM (SELECT id FROM zhiban_learning.attempts WHERE tenant_id=p_tenant AND activity_id=a.activity_id AND activity_version=a.activity_version AND membership_id=a.membership_id AND enrollment_id=a.enrollment_id ORDER BY attempt_no DESC LIMIT 1) OR a.submission_id IS DISTINCT FROM (SELECT id FROM zhiban_learning.submissions WHERE tenant_id=p_tenant AND attempt_id=a.attempt_id ORDER BY version DESC LIMIT 1) THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO v FROM zhiban_learning.activity_versions WHERE tenant_id=p_tenant AND activity_id=a.activity_id AND version=a.activity_version;
 IF t.activity_type='TEXT_RESPONSE' THEN
  limits:=jsonb_build_array(jsonb_build_object('id','text','type','short_answer','maxPoints',p.max_points,'question',v.prompt));objective:='{}';
  result:=jsonb_build_object('answer',a.answer);
 ELSIF t.activity_type='QUIZ' THEN
  SELECT qv.*,qa.answers,qa.answers_hash,ev.results INTO q FROM zhiban_learning.quiz_versions qv JOIN zhiban_learning.quiz_submission_answers qa ON qa.tenant_id=qv.tenant_id AND qa.activity_id=qv.activity_id AND qa.activity_version=qv.version JOIN zhiban_learning.quiz_evaluations ev ON ev.tenant_id=qa.tenant_id AND ev.submission_id=qa.submission_id JOIN zhiban_learning.quiz_definitions d ON d.tenant_id=qv.tenant_id AND d.activity_id=qv.activity_id WHERE qv.tenant_id=p_tenant AND qv.activity_id=a.activity_id AND qv.version=a.activity_version AND qa.submission_id=a.submission_id AND d.mode='ASSESSED';
  IF NOT FOUND OR q.max_points<>p.max_points THEN RAISE EXCEPTION 'Quiz unavailable' USING ERRCODE='42501'; END IF;
  SELECT jsonb_agg(jsonb_build_object('id',x->>'id','type',x->>'type','maxPoints',round(coalesce((x->>'points')::numeric,1)*100)::integer,'question',x->>'question','reference',x->'answer','guidance',x->>'commentPrompt') ORDER BY ord) INTO limits FROM jsonb_array_elements(q.content->'questions') WITH ORDINALITY x(x,ord);
  -- Objective attribution is derived by question type, never by a model-provided override.
  SELECT coalesce(jsonb_object_agg(l->>'id',to_jsonb(round((r->>'earned')::numeric*100)::integer)),'{}') INTO objective FROM jsonb_array_elements(limits) l JOIN jsonb_array_elements(q.results) r ON r->>'questionId'=l->>'id' WHERE l->>'type'<>'short_answer';
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(limits) l WHERE l->>'type'='short_answer') THEN RAISE EXCEPTION 'No supported AI question' USING ERRCODE='42501'; END IF;
  result:=jsonb_build_object('answers',q.answers,'quizHash',q.content_hash,'answersHash',q.answers_hash);
 ELSE RAISE EXCEPTION 'Activity unsupported' USING ERRCODE='42501'; END IF;
 result:=result||jsonb_build_object('activityId',a.activity_id,'activityVersion',a.activity_version,'offeringId',a.offering_id,'enrollmentId',a.enrollment_id,'membershipId',a.membership_id,'submissionId',a.submission_id,'policyId',p.id,'teacherId',p.teacher_id,'teacherAuthVersion',teacher_version,'studentAuthVersion',student_version,'teacherGrantUntil',tg.valid_until,'studentGrantUntil',sg.valid_until,'title',v.title,'rubric',p.rubric,'provider',p.provider,'model',p.model,'maxPoints',p.max_points,'limits',limits,'objective',objective,'kind',t.activity_type);
 IF octet_length(result::text)>131072 OR jsonb_array_length(limits)>100 THEN RAISE EXCEPTION 'Input limit exceeded' USING ERRCODE='22023'; END IF;
 RETURN result;
END $$;
CREATE FUNCTION zhiban_autograde.prepare(p_tenant uuid,p_submission uuid,p_job uuid,p_secret_hash text,p_event uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE input jsonb;j record;n bigint;
BEGIN
 IF session_user<>'zhiban_autograde_worker' OR (p_secret_hash~'^[a-f0-9]{64}$') IS DISTINCT FROM true OR zhiban_identity.is_uuid_v7(p_job) IS DISTINCT FROM true OR zhiban_identity.is_uuid_v7(p_event) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Service rejected' USING ERRCODE='42501'; END IF;
 input:=zhiban_autograde.input_for(p_tenant,p_submission);
 IF NOT EXISTS(SELECT 1 FROM zhiban_autograde.requests WHERE tenant_id=p_tenant AND submission_id=p_submission AND state='PENDING' AND policy_id=(input->>'policyId')::uuid) THEN RAISE EXCEPTION 'Request delegation changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO j FROM zhiban_autograde.jobs WHERE tenant_id=p_tenant AND submission_id=p_submission AND state IN('RUNNING','APPLIED') FOR UPDATE;
 IF FOUND THEN RETURN jsonb_build_object('id',j.id,'state',j.state,'dispatch',false); END IF;
 IF EXISTS(SELECT 1 FROM zhiban_assessment.grades WHERE tenant_id=p_tenant AND submission_id=p_submission) THEN RAISE EXCEPTION 'Human grade exists' USING ERRCODE='40001'; END IF;
 n:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 INSERT INTO zhiban_autograde.jobs(tenant_id,id,offering_id,submission_id,policy_id,secret_hash,expires_at,state,input,source_digest,created_at) VALUES(p_tenant,p_job,(input->>'offeringId')::uuid,p_submission,(input->>'policyId')::uuid,p_secret_hash,n+120000,'RUNNING',input,encode(sha256(convert_to(input::text,'UTF8')),'hex'),n);
 UPDATE zhiban_autograde.requests SET state='RUNNING',job_id=p_job WHERE tenant_id=p_tenant AND submission_id=p_submission AND state='PENDING';
 IF NOT FOUND THEN RAISE EXCEPTION 'No pending request' USING ERRCODE='40001'; END IF;
 INSERT INTO zhiban_autograde.events VALUES(p_tenant,p_event,p_job,(input->>'activityId')::uuid,'PREPARE','SERVICE',NULL,'formal_ai_grader',jsonb_build_object('authorizer',input->>'teacherId','policy',input->>'policyId'),n);
 RETURN jsonb_build_object('id',p_job,'state','RUNNING','dispatch',true,'input',input);
END $$;
CREATE FUNCTION zhiban_autograde.apply(p_tenant uuid,p_job uuid,p_secret text,p_result jsonb,p_grade uuid,p_publication uuid,p_event uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE j record;fresh jsonb;l jsonb;earned integer;total integer:=0;n bigint;deadline bigint;
BEGIN
 IF session_user<>'zhiban_autograde_worker' OR length(p_secret) IS DISTINCT FROM 43 THEN RAISE EXCEPTION 'Service rejected' USING ERRCODE='42501'; END IF;
 PERFORM set_config('app.tenant_id',p_tenant::text,true);
 SELECT * INTO j FROM zhiban_autograde.jobs WHERE tenant_id=p_tenant AND id=p_job;
 IF NOT FOUND OR j.secret_hash IS DISTINCT FROM encode(sha256(convert_to(p_secret,'UTF8')),'hex') THEN RAISE EXCEPTION 'Service rejected' USING ERRCODE='42501'; END IF;
 -- Current Identity/delegation/source checks happen before the business job lock, preserving the global lock order.
 fresh:=zhiban_autograde.input_for(p_tenant,j.submission_id);
 SELECT * INTO j FROM zhiban_autograde.jobs WHERE tenant_id=p_tenant AND id=p_job FOR UPDATE;
 n:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 deadline:=least(j.expires_at,coalesce((fresh->>'teacherGrantUntil')::bigint,9223372036854775807),coalesce((fresh->>'studentGrantUntil')::bigint,9223372036854775807));
 IF n>=deadline OR j.input<>fresh OR j.source_digest<>encode(sha256(convert_to(fresh::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='40001'; END IF;
 IF j.state='APPLIED' THEN RETURN jsonb_build_object('id',j.id,'state','APPLIED','publicationId',j.publication_id); END IF;
 IF j.state<>'RUNNING' OR EXISTS(SELECT 1 FROM zhiban_assessment.grades WHERE tenant_id=p_tenant AND submission_id=j.submission_id) THEN RAISE EXCEPTION 'Grade changed' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_result)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_result))<>3 OR NOT(p_result?'marks' AND p_result?'feedback' AND p_result?'model') OR jsonb_typeof(p_result->'marks')<>'object' OR length(p_result->>'feedback') NOT BETWEEN 1 AND 2000 OR p_result->'model'->>'provider' IS DISTINCT FROM fresh->>'provider' OR p_result->'model'->>'model' IS DISTINCT FROM fresh->>'model' OR ((p_result->'model'->>'promptSha256')~'^[a-f0-9]{64}$') IS DISTINCT FROM true OR (SELECT count(*) FROM jsonb_object_keys(p_result->'marks'))<>jsonb_array_length(fresh->'limits') THEN RAISE EXCEPTION 'Result rejected' USING ERRCODE='22023'; END IF;
 FOR l IN SELECT * FROM jsonb_array_elements(fresh->'limits') LOOP
  IF jsonb_typeof(p_result->'marks'->(l->>'id')) IS DISTINCT FROM 'number' OR (p_result->'marks'->>(l->>'id'))!~'^[0-9]{1,6}$' THEN RAISE EXCEPTION 'Result rejected' USING ERRCODE='22023'; END IF;
  earned:=(p_result->'marks'->>(l->>'id'))::integer;
  IF earned>(l->>'maxPoints')::integer OR (l->>'type'<>'short_answer' AND (fresh->'objective'->>(l->>'id'))::integer IS DISTINCT FROM earned) THEN RAISE EXCEPTION 'Result rejected' USING ERRCODE='22023'; END IF;
  total:=total+earned;
 END LOOP;
 IF zhiban_identity.is_uuid_v7(p_grade) IS DISTINCT FROM true OR zhiban_identity.is_uuid_v7(p_publication) IS DISTINCT FROM true OR zhiban_identity.is_uuid_v7(p_event) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Result rejected' USING ERRCODE='22023'; END IF;
 INSERT INTO zhiban_assessment.grades(tenant_id,id,submission_id,score_points,max_points,feedback,published_version,revision,updated_by,created_at,updated_at,service_job_id) VALUES(p_tenant,p_grade,j.submission_id,total,(fresh->>'maxPoints')::integer,p_result->>'feedback',1,1,NULL,n,n,p_job);
 INSERT INTO zhiban_assessment.publications(tenant_id,id,grade_id,submission_id,version,score_points,max_points,feedback,reason,published_by,published_at,service_job_id) VALUES(p_tenant,p_publication,p_grade,j.submission_id,1,total,(fresh->>'maxPoints')::integer,p_result->>'feedback',NULL,NULL,n,p_job);
 IF fresh->>'kind'='QUIZ' THEN
  INSERT INTO zhiban_assessment.quiz_grade_details VALUES(p_tenant,p_grade,1,j.submission_id,p_result->'marks','{}');
  INSERT INTO zhiban_assessment.quiz_publication_details VALUES(p_tenant,p_publication,j.submission_id,p_result->'marks','{}');
 END IF;
 UPDATE zhiban_autograde.jobs SET state='APPLIED',revision=revision+1,result=p_result,publication_id=p_publication,finished_at=n WHERE tenant_id=p_tenant AND id=p_job;
 UPDATE zhiban_autograde.requests SET state='DONE' WHERE tenant_id=p_tenant AND submission_id=j.submission_id;
 INSERT INTO zhiban_autograde.events VALUES(p_tenant,p_event,p_job,(fresh->>'activityId')::uuid,'PUBLISH_FORMAL_GRADE','SERVICE',NULL,'formal_ai_grader',jsonb_build_object('publicationId',p_publication,'authorizer',fresh->>'teacherId','policyId',fresh->>'policyId','sourceDigest',j.source_digest,'model',p_result->'model'),n);
 IF floor(extract(epoch FROM clock_timestamp())*1000)::bigint>=deadline THEN RAISE EXCEPTION 'Authorization expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',p_job,'state','APPLIED','publicationId',p_publication);
END $$;
CREATE FUNCTION zhiban_autograde.fail(p_tenant uuid,p_job uuid,p_secret text,p_code text,p_event uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE j record;n bigint;
BEGIN
 IF session_user<>'zhiban_autograde_worker' OR p_code IS NULL OR p_code NOT IN('MODEL_FAILED','AUTHORITY_OR_SOURCE_CHANGED','HOST_STOPPED') OR length(p_secret) IS DISTINCT FROM 43 OR zhiban_identity.is_uuid_v7(p_event) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Service rejected' USING ERRCODE='42501'; END IF;
 PERFORM set_config('app.tenant_id',p_tenant::text,true);
 SELECT * INTO j FROM zhiban_autograde.jobs WHERE tenant_id=p_tenant AND id=p_job FOR UPDATE;
 IF NOT FOUND OR j.secret_hash IS DISTINCT FROM encode(sha256(convert_to(p_secret,'UTF8')),'hex') THEN RAISE EXCEPTION 'Service rejected' USING ERRCODE='42501'; END IF;
 IF j.state<>'RUNNING' THEN RETURN; END IF;
 n:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 UPDATE zhiban_autograde.jobs SET state='FAILED',revision=revision+1,failure=p_code,finished_at=n WHERE tenant_id=p_tenant AND id=p_job;
 UPDATE zhiban_autograde.requests SET state='FAILED' WHERE tenant_id=p_tenant AND submission_id=j.submission_id;
 INSERT INTO zhiban_autograde.events VALUES(p_tenant,p_event,p_job,(j.input->>'activityId')::uuid,'FAIL','SERVICE',NULL,'formal_ai_grader',jsonb_build_object('code',p_code),n);
END $$;
CREATE FUNCTION zhiban_autograde.pending(p_tenant uuid) RETURNS TABLE(submission_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE j record;n bigint;
BEGIN
 IF session_user<>'zhiban_autograde_worker' OR zhiban_identity.is_uuid_v7(p_tenant) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Service rejected' USING ERRCODE='42501'; END IF;
 PERFORM set_config('app.tenant_id',p_tenant::text,true);n:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 FOR j IN SELECT * FROM zhiban_autograde.jobs x WHERE x.tenant_id=p_tenant AND x.state='RUNNING' AND x.expires_at<=n ORDER BY x.id LIMIT 20 FOR UPDATE SKIP LOCKED LOOP
 UPDATE zhiban_autograde.jobs SET state='FAILED',revision=revision+1,failure='EXPIRED',finished_at=n WHERE tenant_id=p_tenant AND id=j.id;
 UPDATE zhiban_autograde.requests r SET state='FAILED' WHERE r.tenant_id=p_tenant AND r.submission_id=j.submission_id;
 INSERT INTO zhiban_autograde.events VALUES(p_tenant,gen_random_uuid(),j.id,(j.input->>'activityId')::uuid,'EXPIRE','SERVICE',NULL,'formal_ai_grader',jsonb_build_object('code','EXPIRED'),n);
 END LOOP;
 RETURN QUERY SELECT r.submission_id FROM zhiban_autograde.requests r WHERE r.tenant_id=p_tenant AND r.state='PENDING' ORDER BY r.created_at,r.submission_id LIMIT 20;
END $$;
CREATE FUNCTION zhiban_autograde.reject_request(p_tenant uuid,p_submission uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE activity uuid;
BEGIN
 IF session_user<>'zhiban_autograde_worker' THEN RAISE EXCEPTION 'Service rejected' USING ERRCODE='42501'; END IF;
 PERFORM set_config('app.tenant_id',p_tenant::text,true);
 UPDATE zhiban_autograde.requests SET state='FAILED' WHERE tenant_id=p_tenant AND submission_id=p_submission AND state='PENDING';
 IF FOUND THEN
 SELECT t.activity_id INTO activity FROM zhiban_learning.submissions s JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id WHERE s.tenant_id=p_tenant AND s.id=p_submission;
 INSERT INTO zhiban_autograde.events VALUES(p_tenant,gen_random_uuid(),NULL,activity,'PREPARE_REFUSED','SERVICE',NULL,'formal_ai_grader',jsonb_build_object('submissionId',p_submission),floor(extract(epoch FROM clock_timestamp())*1000)::bigint);
 END IF;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA zhiban_autograde FROM PUBLIC,zhiban_academic_runtime,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime,zhiban_bridge_runtime,zhiban_autograde_worker;
GRANT EXECUTE ON FUNCTION zhiban_autograde.prepare(uuid,uuid,uuid,text,uuid),zhiban_autograde.apply(uuid,uuid,text,jsonb,uuid,uuid,uuid),zhiban_autograde.fail(uuid,uuid,text,text,uuid) TO zhiban_autograde_worker;
GRANT EXECUTE ON FUNCTION zhiban_autograde.pending(uuid),zhiban_autograde.reject_request(uuid,uuid) TO zhiban_autograde_worker;

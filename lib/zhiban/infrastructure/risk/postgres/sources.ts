/** One projection shared by live queue and locked command revalidation. No answers/draft grades. */
export const riskSources = `WITH settings AS(
 SELECT v.rule_code,v.revision::text AS rule_revision,v.threshold,h.revision::text AS current_revision,h.enabled AS current_enabled
 FROM zhiban_risk.rule_versions v JOIN zhiban_risk.rules h ON h.tenant_id=v.tenant_id AND h.offering_id=v.offering_id AND h.rule_code=v.rule_code
 WHERE v.tenant_id=$1 AND v.offering_id=$2 AND ($4::text IS NULL OR v.rule_code=$4) AND v.revision=coalesce($5::bigint,h.revision)
), roster AS(
 SELECT e.*,p.display_name FROM zhiban_academic.enrollments e LEFT JOIN zhiban_academic.people p ON p.tenant_id=e.tenant_id AND p.membership_id=e.membership_id
 WHERE e.tenant_id=$1 AND e.offering_id=$2 AND ($6::uuid IS NULL OR e.id=$6)
), samples AS(
 SELECT k.rule_code,k.rule_revision,k.threshold,k.current_revision,k.current_enabled,e.id AS enrollment_id,e.membership_id,e.display_name,a.id AS anchor_id,v.version AS anchor_version,v.title,c.id AS case_id,
 CASE WHEN k.rule_code='LOW_SCORE' THEN 'g:'||coalesce(g.id::text,'none') ELSE 'a:'||coalesce(t.id::text,'none') END AS source_key,
 jsonb_build_object('kind','ACTIVITY','activityId',a.id,'version',v.version,'deadlineAt',v.deadline_at,'attemptId',t.id,'attemptNo',t.attempt_no,
 'submissionId',s.id,'submissionVersion',s.version,'submittedAt',s.submitted_at,'publicationId',g.id,'gradeVersion',g.version,'scorePoints',g.score_points,'maxPoints',g.max_points,'publishedAt',g.published_at,
 'currentPublishedVersion',a.published_version,'activityState',a.status,'formal',NOT EXISTS(SELECT 1 FROM zhiban_learning.quiz_definitions q WHERE q.tenant_id=a.tenant_id AND q.activity_id=a.id AND q.mode='PRACTICE'),
 'enrollmentState',e.status,'enrollmentValidFrom',e.valid_from,'enrollmentValidUntil',e.valid_until) AS facts
 FROM settings k CROSS JOIN roster e JOIN zhiban_learning.activities a ON a.tenant_id=$1 AND a.offering_id=$2
 JOIN zhiban_learning.activity_versions v ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=coalesce(nullif($8::integer,0),a.published_version)
 LEFT JOIN zhiban_followup.cases c ON c.tenant_id=a.tenant_id AND c.enrollment_id=e.id AND c.activity_id=a.id AND c.activity_version=v.version
 LEFT JOIN LATERAL(SELECT id,attempt_no FROM zhiban_learning.attempts WHERE tenant_id=$1 AND enrollment_id=e.id AND membership_id=e.membership_id AND activity_id=a.id AND activity_version=v.version ORDER BY attempt_no DESC LIMIT 1)t ON true
 LEFT JOIN LATERAL(SELECT id,version,submitted_at FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=t.id ORDER BY version DESC LIMIT 1)s ON true
 LEFT JOIN LATERAL(SELECT id,version,score_points,max_points,published_at FROM zhiban_assessment.publications WHERE tenant_id=$1 AND submission_id=s.id ORDER BY version DESC LIMIT 1)g ON true
 WHERE k.rule_code IN('OVERDUE','LOW_SCORE') AND ($7::uuid IS NULL OR a.id=$7)
 UNION ALL
 SELECT k.rule_code,k.rule_revision,k.threshold,k.current_revision,k.current_enabled,e.id,e.membership_id,e.display_name,p.id,0,p.title,p.case_id,'p:'||p.revision::text,
 jsonb_build_object('kind','PLAN','planId',p.id,'dueAt',p.due_at,'planState',p.state,'planRevision',p.revision::text,'enrollmentState',e.status,'enrollmentValidFrom',e.valid_from,'enrollmentValidUntil',e.valid_until)
 FROM settings k JOIN zhiban_remediation.plans p ON p.tenant_id=$1 AND p.offering_id=$2 JOIN roster e ON e.id=p.enrollment_id AND e.membership_id=p.membership_id
 WHERE k.rule_code='PLAN_OVERDUE' AND ($7::uuid IS NULL OR p.id=$7)
), observations AS(
 SELECT *,current_enabled AND current_revision=rule_revision AND facts->>'enrollmentState'='ACTIVE' AND (facts->>'enrollmentValidFrom')::bigint<=$3 AND facts->>'enrollmentValidUntil' IS NULL
 AND (rule_code='PLAN_OVERDUE' OR(facts->>'activityState'='PUBLISHED' AND (facts->>'currentPublishedVersion')::integer=anchor_version AND (facts->>'formal')::boolean)) AS eligible
 FROM samples
)`;
export const hitSql = `s.eligible AND CASE s.rule_code
 WHEN 'LOW_SCORE' THEN s.facts->>'publicationId' IS NOT NULL AND (s.facts->>'scorePoints')::numeric*100<s.threshold*(s.facts->>'maxPoints')::numeric
 WHEN 'OVERDUE' THEN s.facts->>'submissionId' IS NULL AND s.facts->>'deadlineAt' IS NOT NULL AND $3-(s.facts->>'deadlineAt')::bigint>=s.threshold::bigint*3600000
 ELSE s.facts->>'planState'='ACTIVE' AND s.facts->>'dueAt' IS NOT NULL AND $3-(s.facts->>'dueAt')::bigint>=s.threshold::bigint*3600000 END`;

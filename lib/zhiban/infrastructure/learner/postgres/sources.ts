/** Whitelisted public provenance only: no answers, keys, draft grades, private risk/followup notes, or self-report conclusions. */
export const learnerSources = `WITH roster AS(
 SELECT * FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND id=$3
), grade_sources AS(
 SELECT 'GRADE'::text AS kind,p.id,
 jsonb_build_object('title',v.title,'provenance','FORMAL_RECORD','activityId',t.activity_id,'activityVersion',t.activity_version,'attemptId',t.id,'submissionId',s.id,'submissionVersion',s.version,'publicationId',p.id,'publicationVersion',p.version,'scorePoints',p.score_points,'maxPoints',p.max_points,'publishedAt',p.published_at,'latestPublicationId',lp.id,'currentActivityVersion',a.published_version,'activityState',a.status,'enrollmentState',e.status) AS snapshot,
 (e.status='ACTIVE' AND e.valid_from<=$4 AND e.valid_until IS NULL AND a.status='PUBLISHED' AND a.published_version=t.activity_version AND lt.id=t.id AND ls.id=s.id AND lp.id=p.id) AS eligible
 FROM roster e JOIN zhiban_learning.attempts t ON t.tenant_id=e.tenant_id AND t.offering_id=e.offering_id AND t.enrollment_id=e.id AND t.membership_id=e.membership_id
 JOIN zhiban_learning.submissions s ON s.tenant_id=t.tenant_id AND s.attempt_id=t.id
 JOIN zhiban_assessment.publications p ON p.tenant_id=s.tenant_id AND p.submission_id=s.id
 JOIN zhiban_learning.activities a ON a.tenant_id=t.tenant_id AND a.id=t.activity_id
 JOIN zhiban_learning.activity_versions v ON v.tenant_id=t.tenant_id AND v.activity_id=t.activity_id AND v.version=t.activity_version
 LEFT JOIN LATERAL(SELECT id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND enrollment_id=e.id AND activity_id=t.activity_id AND activity_version=t.activity_version ORDER BY attempt_no DESC LIMIT 1)lt ON true
 LEFT JOIN LATERAL(SELECT id FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=lt.id ORDER BY version DESC LIMIT 1)ls ON true
 LEFT JOIN LATERAL(SELECT id FROM zhiban_assessment.publications WHERE tenant_id=$1 AND submission_id=ls.id ORDER BY version DESC LIMIT 1)lp ON true
 WHERE NOT EXISTS(SELECT 1 FROM zhiban_learning.quiz_definitions q WHERE q.tenant_id=a.tenant_id AND q.activity_id=a.id AND q.mode='PRACTICE')
), concept_sources AS(
 SELECT 'CONCEPT'::text AS kind,c.id,
 jsonb_build_object('title',c.concept,'provenance','TEACHER_JUDGMENT','revision',c.revision::text,'state',c.state,'explanation',c.explanation,'guidance',c.guidance,'activityId',c.activity_id,'activityVersion',c.activity_version,'publicationId',c.publication_id,'latestPublicationId',lp.id,'sourcePublicationCurrent',lp.id=c.publication_id,'updatedAt',c.updated_at,'enrollmentState',e.status) AS snapshot,
 (e.status='ACTIVE' AND e.valid_from<=$4 AND e.valid_until IS NULL AND c.state<>'RETRACTED') AS eligible
 FROM roster e JOIN zhiban_concept.corrections c ON c.tenant_id=e.tenant_id AND c.offering_id=e.offering_id AND c.enrollment_id=e.id AND c.membership_id=e.membership_id
 LEFT JOIN LATERAL(SELECT id FROM zhiban_assessment.publications WHERE tenant_id=$1 AND submission_id=c.submission_id ORDER BY version DESC LIMIT 1)lp ON true
 WHERE c.published_revision IS NOT NULL
), remediation_sources AS(
 SELECT 'REMEDIATION'::text AS kind,p.id,
 jsonb_build_object('title',p.title,'provenance','TEACHER_PLAN_OR_REVIEW','revision',p.revision::text,'state',p.state,'goal',p.goal,'dueAt',p.due_at,'teacherOutcome',r.value,'teacherReview',r.body,'teacherReviewedAt',r.created_at,'updatedAt',p.updated_at,'enrollmentState',e.status) AS snapshot,
 (e.status='ACTIVE' AND e.valid_from<=$4 AND e.valid_until IS NULL AND p.state<>'CANCELLED') AS eligible
 FROM roster e JOIN zhiban_remediation.plans p ON p.tenant_id=e.tenant_id AND p.offering_id=e.offering_id AND p.enrollment_id=e.id AND p.membership_id=e.membership_id
 LEFT JOIN LATERAL(SELECT value,body,created_at FROM zhiban_remediation.events WHERE tenant_id=$1 AND plan_id=p.id AND action='REVIEW_PLAN' ORDER BY revision DESC LIMIT 1)r ON true
), sources AS(SELECT * FROM grade_sources UNION ALL SELECT * FROM concept_sources UNION ALL SELECT * FROM remediation_sources)
`;

/** Formal, immutable submission evidence. Never selects keys, analyses, drafts or private risk notes. */
export const conceptSources = `WITH samples AS(
 SELECT p.id AS publication_id,p.version AS grade_version,p.score_points,p.max_points,p.published_at,
 t.id AS attempt_id,t.attempt_no,t.activity_id,t.activity_version,t.enrollment_id,t.membership_id,
 s.id AS submission_id,s.version AS submission_version,s.submitted_at,
 a.status AS activity_state,a.published_version,v.title,e.status AS enrollment_state,e.valid_from,e.valid_until,coalesce(n.display_name,'历史成员') AS student_name,
 a.activity_type,qd.review_closed_at,
 CASE WHEN a.activity_type='QUIZ' THEN item->>'id' ELSE '' END AS question_id,
 CASE WHEN a.activity_type='QUIZ' THEN jsonb_build_object('id',item->>'id','type',item->>'type','question',item->>'question','options',item->'options','points',item->'points') ELSE NULL END AS question,
 CASE WHEN a.activity_type='QUIZ' THEN qa.answers->(item->>'id') ELSE to_jsonb(s.answer) END AS answer,
 CASE WHEN a.activity_type='QUIZ' THEN (pd.marks->>(item->>'id'))::integer ELSE p.score_points END AS item_points,
 CASE WHEN a.activity_type='QUIZ' THEN round(coalesce((item->>'points')::numeric,1)*100)::integer ELSE p.max_points END AS item_max,
 lt.id AS latest_attempt_id,ls.id AS latest_submission_id,lp.id AS latest_publication_id,lp.score_points AS latest_score_points,lp.max_points AS latest_max_points,lp.version AS latest_grade_version,
 (a.status='PUBLISHED' AND a.published_version=t.activity_version AND e.status='ACTIVE' AND e.valid_from<=$3 AND e.valid_until IS NULL AND lt.id=t.id AND ls.id=s.id AND lp.id=p.id) AS fresh
 FROM zhiban_assessment.publications p JOIN zhiban_learning.submissions s ON s.tenant_id=p.tenant_id AND s.id=p.submission_id
 JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id
 JOIN zhiban_learning.activities a ON a.tenant_id=t.tenant_id AND a.id=t.activity_id
 JOIN zhiban_learning.activity_versions v ON v.tenant_id=t.tenant_id AND v.activity_id=t.activity_id AND v.version=t.activity_version
 JOIN zhiban_academic.enrollments e ON e.tenant_id=t.tenant_id AND e.id=t.enrollment_id AND e.offering_id=t.offering_id AND e.membership_id=t.membership_id
 LEFT JOIN zhiban_academic.people n ON n.tenant_id=t.tenant_id AND n.membership_id=t.membership_id
 LEFT JOIN zhiban_learning.quiz_definitions qd ON qd.tenant_id=a.tenant_id AND qd.activity_id=a.id
 LEFT JOIN zhiban_learning.quiz_versions qv ON qv.tenant_id=t.tenant_id AND qv.activity_id=t.activity_id AND qv.version=t.activity_version
 LEFT JOIN zhiban_learning.quiz_submission_answers qa ON qa.tenant_id=s.tenant_id AND qa.submission_id=s.id
 LEFT JOIN zhiban_assessment.quiz_publication_details pd ON pd.tenant_id=p.tenant_id AND pd.publication_id=p.id
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN a.activity_type='QUIZ' THEN qv.public_questions ELSE '[null]'::jsonb END) item
 LEFT JOIN LATERAL(SELECT id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND enrollment_id=e.id AND membership_id=e.membership_id AND activity_id=t.activity_id AND activity_version=t.activity_version ORDER BY attempt_no DESC LIMIT 1)lt ON true
 LEFT JOIN LATERAL(SELECT id FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=lt.id ORDER BY version DESC LIMIT 1)ls ON true
 LEFT JOIN LATERAL(SELECT id,score_points,max_points,version FROM zhiban_assessment.publications WHERE tenant_id=$1 AND submission_id=ls.id ORDER BY version DESC LIMIT 1)lp ON true
 WHERE p.tenant_id=$1 AND t.offering_id=$2 AND (qd.mode IS NULL OR qd.mode='ASSESSED') AND ($4::uuid IS NULL OR p.id=$4)
) `;

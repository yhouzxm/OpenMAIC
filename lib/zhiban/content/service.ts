import { randomUUID } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import type {
  ActivityContentRecord,
  CourseResourceRecord,
  DiscussionPostRecord,
  DiscussionTopicRecord,
} from './types';

type Row = Record<string, unknown>;

async function requireManagedCourse(
  client: { query: ZhibanDatabasePool['query'] },
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  const found = await client.query(`SELECT id FROM zhiban.courses WHERE id=$1 AND tenant_id=$2`, [
    courseId,
    principal.tenantId,
  ]);
  if (!found.rows[0]) throw new Error('Course not found');
}

async function requireEnrollment(
  client: { query: ZhibanDatabasePool['query'] },
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  const found = await client.query(
    `SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id
     WHERE e.student_id=$1 AND e.status='enrolled' AND o.course_id=$2 LIMIT 1`,
    [principal.id, courseId],
  );
  if (!found.rows[0]) throw new Error('Course is unavailable');
}

function mapContent(row: Row): ActivityContentRecord {
  return {
    id: row.id as string,
    activityId: row.activity_id as string,
    activityTitle: row.activity_title as string,
    format: row.content_format as ActivityContentRecord['format'],
    body: row.body as string,
    version: Number(row.version),
    status: row.status as ActivityContentRecord['status'],
  };
}

function mapResource(row: Row): CourseResourceRecord {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    resourceType: row.resource_type as CourseResourceRecord['resourceType'],
    url: (row.url as string | null) ?? null,
    fileName: (row.file_name as string | null) ?? null,
    mimeType: (row.mime_type as string | null) ?? null,
    fileSize: row.file_size === null ? null : Number(row.file_size),
    downloadAllowed: Boolean(row.download_allowed),
    aiIndexEnabled: Boolean(row.ai_index_enabled),
    status: row.status as CourseResourceRecord['status'],
    activityIds: (row.activity_ids as string[] | null) ?? [],
    version: Number(row.version),
    versions: Array.isArray(row.versions)
      ? (row.versions as Row[]).map((version) => ({
          id: String(version.id),
          version: Number(version.version),
          fileName: version.fileName ? String(version.fileName) : null,
          createdAt: String(version.createdAt),
        }))
      : [],
  };
}

function mapTopic(row: Row): DiscussionTopicRecord {
  return {
    id: row.id as string,
    activityId: (row.activity_id as string | null) ?? null,
    title: row.title as string,
    description: row.description as string,
    status: row.status as DiscussionTopicRecord['status'],
    pinned: Boolean(row.pinned),
    graded: Boolean(row.graded),
    gradeItemId: row.grade_item_id ? String(row.grade_item_id) : null,
    postCount: Number(row.post_count ?? 0),
  };
}

export async function getTeacherCourseContent(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireManagedCourse(client, principal, courseId);
    const [activities, contents, resources, topics, posts, gradeItems] = await Promise.all([
      client.query<Row>(
        `SELECT a.id,a.title,a.activity_type,ch.title AS chapter_title
         FROM zhiban.course_activities a JOIN zhiban.course_chapters ch ON ch.id=a.chapter_id
         WHERE a.course_id=$1 ORDER BY ch.position,a.position`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT c.*,a.title AS activity_title FROM zhiban.course_activity_contents c
         JOIN zhiban.course_activities a ON a.id=c.activity_id WHERE c.course_id=$1 ORDER BY a.position`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT r.*,COALESCE(array_agg(ar.activity_id::text) FILTER(WHERE ar.activity_id IS NOT NULL),'{}') AS activity_ids,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'version',v.version,'fileName',v.file_name,'createdAt',v.created_at) ORDER BY v.version DESC)
          FROM zhiban.course_resource_versions v WHERE v.resource_id=r.id),'[]'::jsonb) AS versions
         FROM zhiban.course_resources_v2 r LEFT JOIN zhiban.course_activity_resources ar ON ar.resource_id=r.id
         WHERE r.course_id=$1 GROUP BY r.id ORDER BY r.created_at DESC`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT t.*,count(p.id) FILTER(WHERE p.status='published')::int AS post_count
         FROM zhiban.discussion_topics t LEFT JOIN zhiban.discussion_posts p ON p.topic_id=t.id
         WHERE t.course_id=$1 GROUP BY t.id ORDER BY t.pinned DESC,t.created_at DESC`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT p.*,a.display_name FROM zhiban.discussion_posts p JOIN zhiban.accounts a ON a.id=p.author_id
         WHERE p.course_id=$1 ORDER BY p.created_at`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT id,name,max_score FROM zhiban.course_grade_items WHERE course_id=$1 AND status='active' ORDER BY name`,
        [courseId],
      ),
    ]);
    const postMap = new Map<string, DiscussionPostRecord[]>();
    for (const row of posts.rows) {
      const key = row.topic_id as string;
      postMap.set(key, [
        ...(postMap.get(key) ?? []),
        {
          id: row.id as string,
          parentPostId: (row.parent_post_id as string | null) ?? null,
          authorId: row.author_id as string,
          authorName: row.display_name as string,
          content: row.content as string,
          status: row.status as DiscussionPostRecord['status'],
          aiGenerated: Boolean(row.ai_generated),
          createdAt: new Date(row.created_at as string).toISOString(),
        },
      ]);
    }
    return {
      activities: activities.rows.map((row) => ({
        id: row.id as string,
        title: row.title as string,
        type: row.activity_type as string,
        chapterTitle: row.chapter_title as string,
      })),
      contents: contents.rows.map(mapContent),
      resources: resources.rows.map(mapResource),
      topics: topics.rows.map((row) => ({
        ...mapTopic(row),
        posts: postMap.get(row.id as string) ?? [],
      })),
      gradeItems: gradeItems.rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        maxScore: Number(row.max_score),
      })),
    };
  });
}

export async function saveActivityContent(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: {
    activityId: string;
    format: ActivityContentRecord['format'];
    body: string;
    status: ActivityContentRecord['status'];
  },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const activity = await client.query(
      `SELECT id FROM zhiban.course_activities WHERE id=$1 AND course_id=$2`,
      [input.activityId, courseId],
    );
    if (!activity.rows[0]) throw new Error('Activity not found');
    const id = randomUUID();
    const body =
      input.format === 'html'
        ? sanitizeHtml(input.body, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
            allowedAttributes: { a: ['href', 'target', 'rel'], img: ['src', 'alt', 'title'] },
            allowedSchemes: ['http', 'https', 'mailto'],
          })
        : input.body;
    const result = await client.query<Row>(
      `INSERT INTO zhiban.course_activity_contents(id,tenant_id,course_id,activity_id,content_format,body,status,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(tenant_id,activity_id) DO UPDATE SET content_format=excluded.content_format,body=excluded.body,
       status=excluded.status,version=zhiban.course_activity_contents.version+1,updated_by=excluded.updated_by,updated_at=now()
       RETURNING id,version`,
      [
        id,
        principal.tenantId,
        courseId,
        input.activityId,
        input.format,
        body,
        input.status,
        principal.id,
      ],
    );
    return result.rows[0];
  });
}

export async function createLinkResource(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: {
    title: string;
    description: string;
    url: string;
    resourceType: CourseResourceRecord['resourceType'];
    activityIds: string[];
    downloadAllowed: boolean;
    aiIndexEnabled: boolean;
  },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireManagedCourse(client, principal, courseId);
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.course_resources_v2(id,tenant_id,course_id,title,description,resource_type,url,download_allowed,ai_index_enabled,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        principal.tenantId,
        courseId,
        input.title,
        input.description,
        input.resourceType,
        input.url,
        input.downloadAllowed,
        input.aiIndexEnabled,
        principal.id,
      ],
    );
    await linkResourceActivities(client, principal.tenantId, courseId, id, input.activityIds);
    return { id };
  });
}

async function linkResourceActivities(
  client: { query: ZhibanDatabasePool['query'] },
  tenantId: string,
  courseId: string,
  resourceId: string,
  activityIds: string[],
) {
  for (const activityId of [...new Set(activityIds)]) {
    const linked = await client.query(
      `INSERT INTO zhiban.course_activity_resources(tenant_id,course_id,activity_id,resource_id)
       SELECT $1,$2,a.id,$3 FROM zhiban.course_activities a WHERE a.id=$4 AND a.course_id=$2
       ON CONFLICT DO NOTHING RETURNING activity_id`,
      [tenantId, courseId, resourceId, activityId],
    );
    if (!linked.rows[0]) throw new Error('Resource activity is invalid');
  }
}

export async function createFileResource(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: {
    title: string;
    description: string;
    resourceType: CourseResourceRecord['resourceType'];
    fileName: string;
    mimeType: string;
    content: Buffer;
    activityIds: string[];
    downloadAllowed: boolean;
    aiIndexEnabled: boolean;
  },
) {
  if (input.content.length > 15 * 1024 * 1024) throw new Error('资源文件不能超过 15MB');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireManagedCourse(client, principal, courseId);
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.course_resources_v2(id,tenant_id,course_id,title,description,resource_type,file_name,mime_type,file_size,content,download_allowed,ai_index_enabled,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        principal.tenantId,
        courseId,
        input.title,
        input.description,
        input.resourceType,
        input.fileName,
        input.mimeType,
        input.content.length,
        input.content,
        input.downloadAllowed,
        input.aiIndexEnabled,
        principal.id,
      ],
    );
    await linkResourceActivities(client, principal.tenantId, courseId, id, input.activityIds);
    return { id };
  });
}

export async function updateResource(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: {
    id: string;
    title: string;
    description: string;
    status: CourseResourceRecord['status'];
    activityIds: string[];
    downloadAllowed: boolean;
    aiIndexEnabled: boolean;
  },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await snapshotResource(client, principal, courseId, input.id);
    const updated = await client.query(
      `UPDATE zhiban.course_resources_v2 SET title=$1,description=$2,status=$3,download_allowed=$4,
       ai_index_enabled=$5,version=version+1,updated_at=now() WHERE id=$6 AND course_id=$7 RETURNING id`,
      [
        input.title,
        input.description,
        input.status,
        input.downloadAllowed,
        input.aiIndexEnabled,
        input.id,
        courseId,
      ],
    );
    if (!updated.rows[0]) throw new Error('Resource not found');
    await client.query(`DELETE FROM zhiban.course_activity_resources WHERE resource_id=$1`, [
      input.id,
    ]);
    await linkResourceActivities(client, principal.tenantId, courseId, input.id, input.activityIds);
    return { id: input.id };
  });
}

async function snapshotResource(
  client: { query: ZhibanDatabasePool['query'] },
  principal: AuthorizedPrincipal,
  courseId: string,
  resourceId: string,
) {
  await client.query(
    `INSERT INTO zhiban.course_resource_versions
     (id,tenant_id,course_id,resource_id,version,title,description,url,file_name,mime_type,file_size,content,download_allowed,ai_index_enabled,created_by)
     SELECT $1,tenant_id,course_id,id,version,title,description,url,file_name,mime_type,file_size,content,download_allowed,ai_index_enabled,$2
     FROM zhiban.course_resources_v2 WHERE id=$3 AND course_id=$4 ON CONFLICT(resource_id,version) DO NOTHING`,
    [randomUUID(), principal.id, resourceId, courseId],
  );
}

export async function replaceResourceFile(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: { resourceId: string; fileName: string; mimeType: string; content: Buffer },
) {
  if (input.content.length > 15 * 1024 * 1024) throw new Error('资源文件不能超过 15MB');
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await snapshotResource(client, principal, courseId, input.resourceId);
    const result = await client.query(
      `UPDATE zhiban.course_resources_v2 SET file_name=$1,mime_type=$2,file_size=$3,content=$4,url=NULL,
       version=version+1,updated_at=now() WHERE id=$5 AND course_id=$6 RETURNING id,version`,
      [
        input.fileName,
        input.mimeType,
        input.content.length,
        input.content,
        input.resourceId,
        courseId,
      ],
    );
    if (!result.rows[0]) throw new Error('Resource not found');
    return result.rows[0];
  });
}

export async function restoreResourceVersion(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  resourceId: string,
  versionId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await snapshotResource(client, principal, courseId, resourceId);
    const result = await client.query(
      `UPDATE zhiban.course_resources_v2 r SET title=v.title,description=v.description,url=v.url,file_name=v.file_name,
       mime_type=v.mime_type,file_size=v.file_size,content=v.content,download_allowed=v.download_allowed,
       ai_index_enabled=v.ai_index_enabled,version=r.version+1,updated_at=now()
       FROM zhiban.course_resource_versions v WHERE r.id=$1 AND r.course_id=$2 AND v.id=$3 AND v.resource_id=r.id RETURNING r.id,r.version`,
      [resourceId, courseId, versionId],
    );
    if (!result.rows[0]) throw new Error('Resource version not found');
    return result.rows[0];
  });
}

export async function createDiscussionTopic(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: {
    activityId: string | null;
    title: string;
    description: string;
    status: DiscussionTopicRecord['status'];
    pinned: boolean;
    graded: boolean;
    gradeItemId?: string | null;
  },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    if (input.gradeItemId) {
      const gradeItem = await client.query(
        `SELECT id FROM zhiban.course_grade_items WHERE id=$1 AND course_id=$2 AND status='active'`,
        [input.gradeItemId, courseId],
      );
      if (!gradeItem.rows[0]) throw new Error('成绩项不属于当前课程');
    }
    if (input.activityId) {
      const activity = await client.query(
        `SELECT id FROM zhiban.course_activities WHERE id=$1 AND course_id=$2`,
        [input.activityId, courseId],
      );
      if (!activity.rows[0]) throw new Error('Activity not found');
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.discussion_topics(id,tenant_id,course_id,activity_id,title,description,status,pinned,graded,grade_item_id,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        principal.tenantId,
        courseId,
        input.activityId,
        input.title,
        input.description,
        input.status,
        input.pinned,
        input.graded,
        input.gradeItemId ?? null,
        principal.id,
      ],
    );
    return { id };
  });
}

export async function updateDiscussionTopic(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: {
    id: string;
    title: string;
    description: string;
    status: DiscussionTopicRecord['status'];
    pinned: boolean;
    graded: boolean;
    gradeItemId?: string | null;
  },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    if (input.gradeItemId) {
      const gradeItem = await client.query(
        `SELECT id FROM zhiban.course_grade_items WHERE id=$1 AND course_id=$2 AND status='active'`,
        [input.gradeItemId, courseId],
      );
      if (!gradeItem.rows[0]) throw new Error('成绩项不属于当前课程');
    }
    const result = await client.query(
      `UPDATE zhiban.discussion_topics SET title=$1,description=$2,status=$3,pinned=$4,graded=$5,grade_item_id=$6,updated_at=now()
       WHERE id=$7 AND course_id=$8 RETURNING id`,
      [
        input.title,
        input.description,
        input.status,
        input.pinned,
        input.graded,
        input.gradeItemId ?? null,
        input.id,
        courseId,
      ],
    );
    if (!result.rows[0]) throw new Error('Discussion topic not found');
    return { id: input.id };
  });
}

export async function moderateDiscussionPost(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: { postId: string; action: 'hide' | 'restore' | 'delete'; reason: string },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const status =
      input.action === 'restore' ? 'published' : input.action === 'hide' ? 'hidden' : 'deleted';
    const post = await client.query(
      `UPDATE zhiban.discussion_posts SET status=$1,updated_at=now() WHERE id=$2 AND course_id=$3 RETURNING id`,
      [status, input.postId, courseId],
    );
    if (!post.rows[0]) throw new Error('Discussion post not found');
    await client.query(
      `INSERT INTO zhiban.discussion_moderation(id,tenant_id,course_id,post_id,actor_id,action,reason)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        principal.tenantId,
        courseId,
        input.postId,
        principal.id,
        input.action,
        input.reason,
      ],
    );
    return { id: input.postId, status };
  });
}

export async function createTeacherDiscussionPost(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: { topicId: string; parentPostId: string | null; content: string },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const topic = await client.query(
      `SELECT id FROM zhiban.discussion_topics WHERE id=$1 AND course_id=$2 AND status='open'`,
      [input.topicId, courseId],
    );
    if (!topic.rows[0]) throw new Error('Discussion is not open');
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.discussion_posts(id,tenant_id,course_id,topic_id,parent_post_id,author_id,content)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        principal.tenantId,
        courseId,
        input.topicId,
        input.parentPostId,
        principal.id,
        input.content,
      ],
    );
    return { id };
  });
}

export async function scoreDiscussionParticipant(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: { topicId: string; studentId: string; score: number; feedback: string },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const student = await client.query(
      `SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id
       WHERE e.student_id=$1 AND e.status='enrolled' AND o.course_id=$2 LIMIT 1`,
      [input.studentId, courseId],
    );
    if (!student.rows[0]) throw new Error('只能为当前课程学生评分');
    const topic = (
      await client.query<Row>(
        `SELECT grade_item_id,activity_id,graded FROM zhiban.discussion_topics WHERE id=$1 AND course_id=$2`,
        [input.topicId, courseId],
      )
    ).rows[0];
    if (!topic?.graded) throw new Error('该讨论未启用评分');
    await client.query(
      `INSERT INTO zhiban.discussion_scores(id,tenant_id,course_id,topic_id,student_id,score,feedback,graded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,topic_id,student_id)
       DO UPDATE SET score=$6,feedback=$7,graded_by=$8,graded_at=now(),updated_at=now()`,
      [
        randomUUID(),
        principal.tenantId,
        courseId,
        input.topicId,
        input.studentId,
        input.score,
        input.feedback,
        principal.id,
      ],
    );
    if (topic.activity_id)
      await client.query(
        `INSERT INTO zhiban.student_activity_progress(id,tenant_id,course_id,activity_id,student_id,status,progress_percent,score,started_at,completed_at)
         VALUES($1,$2,$3,$4,$5,'completed',100,$6,now(),now()) ON CONFLICT(tenant_id,activity_id,student_id)
         DO UPDATE SET status='completed',progress_percent=100,score=$6,completed_at=now(),updated_at=now()`,
        [
          randomUUID(),
          principal.tenantId,
          courseId,
          topic.activity_id,
          input.studentId,
          input.score,
        ],
      );
    if (topic.grade_item_id)
      await client.query(
        `INSERT INTO zhiban.course_grade_records(id,tenant_id,course_id,grade_item_id,student_id,raw_score,normalized_score,status,source_type,source_id,feedback,graded_by,graded_at)
         VALUES($1,$2,$3,$4,$5,$6,$6,'draft','assessment',$7,$8,$9,now()) ON CONFLICT(tenant_id,grade_item_id,student_id)
         DO UPDATE SET raw_score=$6,normalized_score=$6,source_id=$7,feedback=$8,graded_by=$9,graded_at=now(),updated_at=now() WHERE NOT course_grade_records.is_override`,
        [
          randomUUID(),
          principal.tenantId,
          courseId,
          topic.grade_item_id,
          input.studentId,
          input.score,
          input.topicId,
          input.feedback,
          principal.id,
        ],
      );
    return { topicId: input.topicId, studentId: input.studentId, score: input.score };
  });
}

export async function getStudentCourseContent(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireEnrollment(client, principal, courseId);
    const published = await client.query<{
      snapshot: { modules: Array<{ chapters: Array<{ activities: Array<{ id: string }> }> }> };
    }>(
      `SELECT snapshot FROM zhiban.course_design_versions WHERE course_id=$1 AND status='published' LIMIT 1`,
      [courseId],
    );
    const activityIds =
      published.rows[0]?.snapshot.modules.flatMap((moduleItem) =>
        moduleItem.chapters.flatMap((chapter) => chapter.activities.map((activity) => activity.id)),
      ) ?? [];
    const [contents, resources, topics, posts] = await Promise.all([
      client.query<Row>(
        `SELECT c.*,a.title AS activity_title FROM zhiban.course_activity_contents c
         JOIN zhiban.course_activities a ON a.id=c.activity_id WHERE c.course_id=$1 AND c.status='published'
         AND c.activity_id=ANY($2::uuid[]) ORDER BY a.position`,
        [courseId, activityIds],
      ),
      client.query<Row>(
        `SELECT r.*,COALESCE(array_agg(ar.activity_id::text) FILTER(WHERE ar.activity_id IS NOT NULL),'{}') AS activity_ids
         FROM zhiban.course_resources_v2 r LEFT JOIN zhiban.course_activity_resources ar ON ar.resource_id=r.id
         WHERE r.course_id=$1 AND r.status='published' GROUP BY r.id ORDER BY r.created_at DESC`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT t.*,count(p.id) FILTER(WHERE p.status='published')::int AS post_count
         FROM zhiban.discussion_topics t LEFT JOIN zhiban.discussion_posts p ON p.topic_id=t.id
         WHERE t.course_id=$1 AND t.status IN('open','closed') AND (t.activity_id IS NULL OR t.activity_id=ANY($2::uuid[]))
         GROUP BY t.id ORDER BY t.pinned DESC,t.created_at DESC`,
        [courseId, activityIds],
      ),
      client.query<Row>(
        `SELECT p.*,a.display_name FROM zhiban.discussion_posts p JOIN zhiban.accounts a ON a.id=p.author_id
         JOIN zhiban.discussion_topics t ON t.id=p.topic_id WHERE p.course_id=$1 AND p.status='published'
         AND t.status IN('open','closed') AND (t.activity_id IS NULL OR t.activity_id=ANY($2::uuid[])) ORDER BY p.created_at`,
        [courseId, activityIds],
      ),
    ]);
    const postMap = new Map<string, DiscussionPostRecord[]>();
    for (const row of posts.rows) {
      const post: DiscussionPostRecord = {
        id: row.id as string,
        parentPostId: (row.parent_post_id as string | null) ?? null,
        authorId: row.author_id as string,
        authorName: row.display_name as string,
        content: row.content as string,
        status: row.status as DiscussionPostRecord['status'],
        aiGenerated: Boolean(row.ai_generated),
        createdAt: new Date(row.created_at as string).toISOString(),
      };
      const key = row.topic_id as string;
      postMap.set(key, [...(postMap.get(key) ?? []), post]);
    }
    return {
      contents: contents.rows.map(mapContent),
      resources: resources.rows.map(mapResource),
      topics: topics.rows.map((row) => ({
        ...mapTopic(row),
        posts: postMap.get(row.id as string) ?? [],
      })),
    };
  });
}

export async function createStudentDiscussionPost(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: { topicId: string; parentPostId: string | null; content: string },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireEnrollment(client, principal, courseId);
    const topic = await client.query(
      `SELECT t.id FROM zhiban.discussion_topics t
       WHERE t.id=$1 AND t.course_id=$2 AND t.status='open'
       AND (t.activity_id IS NULL OR EXISTS(
         SELECT 1 FROM zhiban.course_design_versions v,
         LATERAL jsonb_array_elements(v.snapshot->'modules') module_item,
         LATERAL jsonb_array_elements(module_item->'chapters') chapter_item,
         LATERAL jsonb_array_elements(chapter_item->'activities') activity_item
         WHERE v.course_id=t.course_id AND v.status='published'
         AND activity_item->>'id'=t.activity_id::text
       ))`,
      [input.topicId, courseId],
    );
    if (!topic.rows[0]) throw new Error('Discussion is not open');
    if (input.parentPostId) {
      const parent = await client.query(
        `SELECT id FROM zhiban.discussion_posts WHERE id=$1 AND topic_id=$2 AND status='published'`,
        [input.parentPostId, input.topicId],
      );
      if (!parent.rows[0]) throw new Error('Reply target not found');
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.discussion_posts(id,tenant_id,course_id,topic_id,parent_post_id,author_id,content)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        principal.tenantId,
        courseId,
        input.topicId,
        input.parentPostId,
        principal.id,
        input.content,
      ],
    );
    const topicActivity = await client.query<{ activity_id: string | null }>(
      `SELECT activity_id FROM zhiban.discussion_topics WHERE id=$1`,
      [input.topicId],
    );
    const activityId = topicActivity.rows[0]?.activity_id;
    if (activityId)
      await client.query(
        `INSERT INTO zhiban.student_activity_progress(id,tenant_id,course_id,activity_id,student_id,status,progress_percent,started_at,completed_at)
         VALUES($1,$2,$3,$4,$5,'completed',100,now(),now()) ON CONFLICT(tenant_id,activity_id,student_id)
         DO UPDATE SET status='completed',progress_percent=100,completed_at=now(),updated_at=now()`,
        [randomUUID(), principal.tenantId, courseId, activityId, principal.id],
      );
    await client.query(
      `INSERT INTO zhiban.learning_events(id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,payload,occurred_at)
       VALUES($1,$2,$3,$4,'submission',$5,'discussion_posted',$6::jsonb,now()) ON CONFLICT DO NOTHING`,
      [
        randomUUID(),
        principal.tenantId,
        principal.id,
        courseId,
        id,
        JSON.stringify({ topicId: input.topicId, activityId }),
      ],
    );
    return { id };
  });
}

export async function reportDiscussionPost(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: { postId: string; reason: string },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireEnrollment(client, principal, courseId);
    const post = await client.query(
      `SELECT id FROM zhiban.discussion_posts WHERE id=$1 AND course_id=$2`,
      [input.postId, courseId],
    );
    if (!post.rows[0]) throw new Error('Discussion post not found');
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.discussion_moderation(id,tenant_id,course_id,post_id,actor_id,action,reason)
       VALUES($1,$2,$3,$4,$5,'report',$6)`,
      [id, principal.tenantId, courseId, input.postId, principal.id, input.reason],
    );
    return { id };
  });
}

export async function recordStudentContentCompletion(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  activityId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await requireEnrollment(client, principal, courseId);
    const content = await client.query(
      `SELECT 1 FROM zhiban.course_activity_contents c WHERE c.activity_id=$1 AND c.course_id=$2 AND c.status='published'`,
      [activityId, courseId],
    );
    if (!content.rows[0]) throw new Error('Published content not found');
    await client.query(
      `INSERT INTO zhiban.student_activity_progress(id,tenant_id,course_id,activity_id,student_id,status,progress_percent,started_at,completed_at)
       VALUES($1,$2,$3,$4,$5,'completed',100,now(),now()) ON CONFLICT(tenant_id,activity_id,student_id)
       DO UPDATE SET status='completed',progress_percent=100,completed_at=now(),updated_at=now()`,
      [randomUUID(), principal.tenantId, courseId, activityId, principal.id],
    );
    await client.query(
      `INSERT INTO zhiban.learning_events(id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,payload,occurred_at)
       VALUES($1,$2,$3,$4,'system',$5,'course_content_completed',$6::jsonb,now()) ON CONFLICT DO NOTHING`,
      [
        randomUUID(),
        principal.tenantId,
        principal.id,
        courseId,
        randomUUID(),
        JSON.stringify({ activityId }),
      ],
    );
    return { activityId, status: 'completed' };
  });
}

export async function readCourseResource(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  resourceId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const resource = (
      await client.query<{
        id: string;
        course_id: string;
        file_name: string | null;
        mime_type: string | null;
        content: Buffer | null;
        download_allowed: boolean;
      }>(
        `SELECT id,course_id,file_name,mime_type,content,download_allowed FROM zhiban.course_resources_v2
         WHERE id=$1 AND tenant_id=$2 AND status='published'`,
        [resourceId, principal.tenantId],
      )
    ).rows[0];
    if (!resource?.content) throw new Error('Resource file not found');
    if (principal.accountType === 'student') {
      await requireEnrollment(client, principal, resource.course_id);
      if (!resource.download_allowed) throw new Error('Resource download is disabled');
      await client.query(
        `INSERT INTO zhiban.learning_events(id,tenant_id,learner_id,course_id,source_kind,source_id,event_type,payload,occurred_at)
         VALUES($1,$2,$3,$4,'system',$5,'course_resource_opened',$6::jsonb,now()) ON CONFLICT DO NOTHING`,
        [
          randomUUID(),
          principal.tenantId,
          principal.id,
          resource.course_id,
          randomUUID(),
          JSON.stringify({ resourceId }),
        ],
      );
    } else {
      const allowed =
        principal.permissions.includes('course:manage') &&
        principal.grants.some(
          (grant) =>
            grant.permission === 'course:manage' &&
            (grant.scopeType === 'tenant' ||
              grant.scopeType === 'system' ||
              (grant.scopeType === 'course' && grant.scopeId === resource.course_id)),
        );
      if (!allowed) throw new Error('Permission denied');
    }
    return resource;
  });
}

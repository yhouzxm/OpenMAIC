import { randomUUID } from 'node:crypto';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabaseClient, ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import type {
  CourseActivity,
  CourseActivityReference,
  CourseActivityType,
  CourseChapter,
  CourseDesignVersion,
  CourseModule,
  CourseStructure,
} from './types';

type Row = Record<string, unknown>;

function structureItems(modules: CourseModule[]) {
  const items = new Map<string, string>();
  for (const moduleItem of modules) {
    items.set(
      moduleItem.id,
      JSON.stringify([moduleItem.title, moduleItem.description, moduleItem.position]),
    );
    for (const chapter of moduleItem.chapters) {
      items.set(
        chapter.id,
        JSON.stringify([
          chapter.title,
          chapter.description,
          chapter.position,
          chapter.estimatedMinutes,
        ]),
      );
      for (const activity of chapter.activities)
        items.set(
          activity.id,
          JSON.stringify([
            activity.title,
            activity.description,
            activity.activityType,
            activity.referenceId,
            activity.position,
            activity.estimatedMinutes,
            activity.required,
            activity.opensAt,
            activity.closesAt,
            activity.openingRule,
            activity.completionRule,
            activity.prerequisiteActivityIds,
          ]),
        );
    }
  }
  return items;
}

function structureChanges(current: CourseModule[], published: CourseModule[]) {
  const draft = structureItems(current),
    previous = structureItems(published);
  const added = [...draft.keys()].filter((id) => !previous.has(id));
  const removed = [...previous.keys()].filter((id) => !draft.has(id));
  const changed = [...draft.keys()].filter(
    (id) => previous.has(id) && previous.get(id) !== draft.get(id),
  );
  const summary = [
    added.length ? `新增 ${added.length} 项` : '',
    removed.length ? `删除 ${removed.length} 项` : '',
    changed.length ? `修改 ${changed.length} 项` : '',
  ].filter(Boolean);
  return { added: added.length, removed: removed.length, changed: changed.length, summary };
}

async function currentStructure(client: ZhibanDatabaseClient, courseId: string) {
  const [modules, chapters, activities, dependencies] = await Promise.all([
    client.query<Row>(
      `SELECT id,title,description,position FROM zhiban.course_modules WHERE course_id=$1 ORDER BY position,id`,
      [courseId],
    ),
    client.query<Row>(
      `SELECT id,module_id,title,description,position,estimated_minutes FROM zhiban.course_chapters WHERE course_id=$1 ORDER BY position,id`,
      [courseId],
    ),
    client.query<Row>(
      `SELECT id,chapter_id,title,description,activity_type,reference_id,position,estimated_minutes,required,
        opens_at,closes_at,opening_rule,completion_rule FROM zhiban.course_activities WHERE course_id=$1 ORDER BY position,id`,
      [courseId],
    ),
    client.query<Row>(
      `SELECT activity_id,prerequisite_activity_id FROM zhiban.course_activity_dependencies
       WHERE course_id=$1 ORDER BY created_at`,
      [courseId],
    ),
  ]);
  const dependencyMap = new Map<string, string[]>();
  for (const row of dependencies.rows) {
    const key = row.activity_id as string;
    dependencyMap.set(key, [
      ...(dependencyMap.get(key) ?? []),
      row.prerequisite_activity_id as string,
    ]);
  }
  const activityMap = new Map<string, CourseActivity[]>();
  for (const row of activities.rows) {
    const item: CourseActivity = {
      id: row.id as string,
      chapterId: row.chapter_id as string,
      title: row.title as string,
      description: row.description as string,
      activityType: row.activity_type as CourseActivityType,
      referenceId: (row.reference_id as string | null) ?? null,
      position: Number(row.position),
      estimatedMinutes: Number(row.estimated_minutes),
      required: Boolean(row.required),
      opensAt: row.opens_at ? new Date(row.opens_at as string).toISOString() : null,
      closesAt: row.closes_at ? new Date(row.closes_at as string).toISOString() : null,
      openingRule: row.opening_rule as Record<string, unknown>,
      completionRule: row.completion_rule as Record<string, unknown>,
      prerequisiteActivityIds: dependencyMap.get(row.id as string) ?? [],
    };
    const key = row.chapter_id as string;
    activityMap.set(key, [...(activityMap.get(key) ?? []), item]);
  }
  const chapterMap = new Map<string, CourseChapter[]>();
  for (const row of chapters.rows) {
    const item: CourseChapter = {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string,
      position: Number(row.position),
      estimatedMinutes: Number(row.estimated_minutes),
      activities: activityMap.get(row.id as string) ?? [],
    };
    const key = row.module_id as string;
    chapterMap.set(key, [...(chapterMap.get(key) ?? []), item]);
  }
  return modules.rows.map<CourseModule>((row) => ({
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    position: Number(row.position),
    chapters: chapterMap.get(row.id as string) ?? [],
  }));
}

async function assertCourse(client: ZhibanDatabaseClient, tenantId: string, courseId: string) {
  const found = await client.query(`SELECT id FROM zhiban.courses WHERE id=$1 AND tenant_id=$2`, [
    courseId,
    tenantId,
  ]);
  if (!found.rows[0]) throw new Error('Course not found');
}

export async function getTeacherCourseStructure(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await assertCourse(client, principal.tenantId, courseId);
    const [modules, versions, references] = await Promise.all([
      currentStructure(client, courseId),
      client.query<Row>(
        `SELECT v.id,v.version,v.status,v.change_note,v.published_at,v.snapshot,a.display_name
         FROM zhiban.course_design_versions v JOIN zhiban.accounts a ON a.id=v.published_by
         WHERE v.course_id=$1 ORDER BY v.version DESC`,
        [courseId],
      ),
      client.query<Row>(
        `SELECT source.id,source.type,source.title,EXISTS(SELECT 1 FROM zhiban.course_tutor_documents d
           WHERE d.course_id=$1 AND d.status='active' AND d.source_type=source.tutor_type AND d.source_id=source.id) synced FROM (
         SELECT c.id::text,'content' AS type,a.title,'activity_content' tutor_type FROM zhiban.course_activity_contents c
           JOIN zhiban.course_activities a ON a.id=c.activity_id WHERE c.course_id=$1 AND c.status='published'
         UNION ALL SELECT id::text,'resource',title,'course_resource' FROM zhiban.course_resources_v2 WHERE course_id=$1 AND status='published'
         UNION ALL SELECT id::text,'classroom',title,'classroom' FROM zhiban.course_classrooms WHERE course_id=$1 AND status<>'archived'
         UNION ALL SELECT id::text,'pbl',title,'pbl' FROM zhiban.pbl_projects WHERE course_id=$1 AND status<>'archived'
         UNION ALL SELECT id::text,CASE WHEN assessment_type='assignment' THEN 'assignment'
           WHEN assessment_type='practice' THEN 'practice' ELSE 'quiz' END,title,'assignment'
           FROM zhiban.course_assessments WHERE course_id=$1 AND status<>'archived'
         UNION ALL SELECT id::text,'assignment',title,'assignment' FROM zhiban.activity_assignments
           WHERE course_id=$1 AND status<>'archived'
         UNION ALL SELECT id::text,'discussion',title,'discussion' FROM zhiban.discussion_topics WHERE course_id=$1 AND status<>'archived') source
         ORDER BY type,title`,
        [courseId],
      ),
    ]);
    return {
      courseId,
      modules,
      versions: versions.rows.map<CourseDesignVersion>((row) => ({
        id: row.id as string,
        version: Number(row.version),
        status: row.status as CourseDesignVersion['status'],
        changeNote: row.change_note as string,
        publishedAt: new Date(row.published_at as string).toISOString(),
        publishedByName: row.display_name as string,
      })),
      references: references.rows.map<CourseActivityReference>((row) => ({
        id: row.id as string,
        type: row.type as CourseActivityReference['type'],
        title: row.title as string,
        synced: Boolean(row.synced),
      })),
      draftChanges: structureChanges(
        modules,
        (
          versions.rows.find((row) => row.status === 'published')?.snapshot as
            | CourseStructure
            | undefined
        )?.modules ?? [],
      ),
    };
  });
}

export async function createCourseModule(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: { title: string; description: string },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await assertCourse(client, principal.tenantId, courseId);
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.course_modules(id,tenant_id,course_id,title,description,position,created_by)
       VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(max(position),-1)+1 FROM zhiban.course_modules WHERE course_id=$3),$6)`,
      [id, principal.tenantId, courseId, input.title, input.description, principal.id],
    );
    return { id };
  });
}

export async function createCourseChapter(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: { moduleId: string; title: string; description: string; estimatedMinutes: number },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const moduleResult = await client.query(
      `SELECT id FROM zhiban.course_modules WHERE id=$1 AND course_id=$2 AND tenant_id=$3`,
      [input.moduleId, courseId, principal.tenantId],
    );
    if (!moduleResult.rows[0]) throw new Error('Module not found');
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.course_chapters(id,tenant_id,course_id,module_id,title,description,estimated_minutes,position,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(max(position),-1)+1 FROM zhiban.course_chapters WHERE module_id=$4),$8)`,
      [
        id,
        principal.tenantId,
        courseId,
        input.moduleId,
        input.title,
        input.description,
        input.estimatedMinutes,
        principal.id,
      ],
    );
    return { id };
  });
}

export async function createCourseActivity(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: {
    chapterId: string;
    title: string;
    description: string;
    activityType: CourseActivityType;
    referenceId: string | null;
    estimatedMinutes: number;
    required: boolean;
    opensAt: string | null;
    closesAt: string | null;
  },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const chapter = await client.query(
      `SELECT id FROM zhiban.course_chapters WHERE id=$1 AND course_id=$2 AND tenant_id=$3`,
      [input.chapterId, courseId, principal.tenantId],
    );
    if (!chapter.rows[0]) throw new Error('Chapter not found');
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.course_activities(id,tenant_id,course_id,chapter_id,title,description,activity_type,
       reference_id,estimated_minutes,required,opens_at,closes_at,position,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
       (SELECT COALESCE(max(position),-1)+1 FROM zhiban.course_activities WHERE chapter_id=$4),$13)`,
      [
        id,
        principal.tenantId,
        courseId,
        input.chapterId,
        input.title,
        input.description,
        input.activityType,
        input.referenceId,
        input.estimatedMinutes,
        input.required,
        input.opensAt,
        input.closesAt,
        principal.id,
      ],
    );
    return { id };
  });
}

export async function deleteCourseStructureItem(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: { kind: 'module' | 'chapter' | 'activity'; id: string },
) {
  const table = {
    module: 'course_modules',
    chapter: 'course_chapters',
    activity: 'course_activities',
  }[input.kind];
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const affected = await client.query<{ id: string }>(
      input.kind === 'module'
        ? `SELECT a.id FROM zhiban.course_activities a JOIN zhiban.course_chapters ch ON ch.id=a.chapter_id WHERE ch.module_id=$1 AND a.course_id=$2`
        : input.kind === 'chapter'
          ? `SELECT id FROM zhiban.course_activities WHERE chapter_id=$1 AND course_id=$2`
          : `SELECT id FROM zhiban.course_activities WHERE id=$1 AND course_id=$2`,
      [input.id, courseId],
    );
    const activityIds = affected.rows.map((row) => row.id);
    if (activityIds.length) {
      const progress = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM zhiban.student_activity_progress WHERE activity_id=ANY($1::uuid[])`,
        [activityIds],
      );
      if (Number(progress.rows[0]?.count))
        throw new Error('该内容已有学生学习记录，不能删除；可以保留并调整为非必修内容');
      const externalDependency = await client.query(
        `SELECT 1 FROM zhiban.course_activity_dependencies
         WHERE prerequisite_activity_id=ANY($1::uuid[]) AND NOT(activity_id=ANY($1::uuid[])) LIMIT 1`,
        [activityIds],
      );
      if (externalDependency.rows[0])
        throw new Error('该内容仍被其他活动设为前置条件，请先解除依赖');
      await client.query(
        `DELETE FROM zhiban.course_activity_dependencies
         WHERE activity_id=ANY($1::uuid[]) OR prerequisite_activity_id=ANY($1::uuid[])`,
        [activityIds],
      );
    }
    const result = await client.query(
      `DELETE FROM zhiban.${table} WHERE id=$1 AND course_id=$2 AND tenant_id=$3 RETURNING id`,
      [input.id, courseId, principal.tenantId],
    );
    if (!result.rows[0]) throw new Error('Structure item not found');
    return { id: input.id, deleted: true };
  });
}

export async function updateCourseActivity(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: {
    id: string;
    chapterId: string;
    title: string;
    description: string;
    activityType: CourseActivityType;
    referenceId: string | null;
    estimatedMinutes: number;
    required: boolean;
    opensAt: string | null;
    closesAt: string | null;
    openingRule: Record<string, unknown>;
    completionRule: Record<string, unknown>;
    prerequisiteActivityIds: string[];
  },
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const chapter = await client.query(
      `SELECT id FROM zhiban.course_chapters WHERE id=$1 AND course_id=$2 AND tenant_id=$3`,
      [input.chapterId, courseId, principal.tenantId],
    );
    if (!chapter.rows[0]) throw new Error('Target chapter not found');
    if (input.prerequisiteActivityIds.includes(input.id)) throw new Error('活动不能依赖自身');
    const uniqueDependencies = [...new Set(input.prerequisiteActivityIds)];
    if (uniqueDependencies.length) {
      const valid = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM zhiban.course_activities
         WHERE course_id=$1 AND id=ANY($2::uuid[])`,
        [courseId, uniqueDependencies],
      );
      if (Number(valid.rows[0]?.count) !== uniqueDependencies.length)
        throw new Error('前置活动不属于当前课程');
    }
    const result = await client.query(
      `UPDATE zhiban.course_activities SET
       position=CASE WHEN chapter_id=$1 THEN position ELSE
         (SELECT COALESCE(max(other.position),-1)+1 FROM zhiban.course_activities other WHERE other.chapter_id=$1) END,
       chapter_id=$1,title=$2,description=$3,activity_type=$4,
       reference_id=$5,estimated_minutes=$6,required=$7,opens_at=$8,closes_at=$9,opening_rule=$10::jsonb,
       completion_rule=$11::jsonb,status='draft',updated_at=now()
       WHERE id=$12 AND course_id=$13 AND tenant_id=$14 RETURNING id`,
      [
        input.chapterId,
        input.title,
        input.description,
        input.activityType,
        input.referenceId,
        input.estimatedMinutes,
        input.required,
        input.opensAt,
        input.closesAt,
        JSON.stringify(input.openingRule),
        JSON.stringify(input.completionRule),
        input.id,
        courseId,
        principal.tenantId,
      ],
    );
    if (!result.rows[0]) throw new Error('Activity not found');
    await client.query(`DELETE FROM zhiban.course_activity_dependencies WHERE activity_id=$1`, [
      input.id,
    ]);
    for (const prerequisiteId of uniqueDependencies)
      await client.query(
        `INSERT INTO zhiban.course_activity_dependencies(tenant_id,course_id,activity_id,prerequisite_activity_id)
         VALUES($1,$2,$3,$4)`,
        [principal.tenantId, courseId, input.id, prerequisiteId],
      );
    const cyclic = await client.query(
      `WITH RECURSIVE reach(id) AS (
         SELECT prerequisite_activity_id FROM zhiban.course_activity_dependencies WHERE activity_id=$1
         UNION SELECT d.prerequisite_activity_id FROM zhiban.course_activity_dependencies d JOIN reach r ON d.activity_id=r.id
       ) SELECT 1 FROM reach WHERE id=$1 LIMIT 1`,
      [input.id],
    );
    if (cyclic.rows[0]) throw new Error('活动依赖形成循环，请调整前置活动');
    return { id: input.id };
  });
}

export async function updateCourseStructureItem(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: {
    kind: 'module' | 'chapter' | 'activity';
    id: string;
    title: string;
    description: string;
  },
) {
  const table = {
    module: 'course_modules',
    chapter: 'course_chapters',
    activity: 'course_activities',
  }[input.kind];
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query(
      `UPDATE zhiban.${table} SET title=$1,description=$2,status='draft',updated_at=now()
       WHERE id=$3 AND course_id=$4 AND tenant_id=$5 RETURNING id`,
      [input.title, input.description, input.id, courseId, principal.tenantId],
    );
    if (!result.rows[0]) throw new Error('Structure item not found');
    return { id: input.id };
  });
}

export async function moveCourseStructureItem(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: { kind: 'module' | 'chapter' | 'activity'; id: string; direction: 'up' | 'down' },
) {
  const config = {
    module: { table: 'course_modules', parent: 'course_id' },
    chapter: { table: 'course_chapters', parent: 'module_id' },
    activity: { table: 'course_activities', parent: 'chapter_id' },
  }[input.kind];
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const current = (
      await client.query<Row>(
        `SELECT id,position,${config.parent} AS parent_id FROM zhiban.${config.table}
         WHERE id=$1 AND course_id=$2 AND tenant_id=$3 FOR UPDATE`,
        [input.id, courseId, principal.tenantId],
      )
    ).rows[0];
    if (!current) throw new Error('Structure item not found');
    const comparator = input.direction === 'up' ? '<' : '>';
    const order = input.direction === 'up' ? 'DESC' : 'ASC';
    const sibling = (
      await client.query<Row>(
        `SELECT id,position FROM zhiban.${config.table} WHERE ${config.parent}=$1 AND position ${comparator} $2
         ORDER BY position ${order},id ${order} LIMIT 1 FOR UPDATE`,
        [current.parent_id, current.position],
      )
    ).rows[0];
    if (!sibling) return { id: input.id, moved: false };
    await client.query(
      `UPDATE zhiban.${config.table} SET position=$1,updated_at=now() WHERE id=$2`,
      [sibling.position, input.id],
    );
    await client.query(
      `UPDATE zhiban.${config.table} SET position=$1,updated_at=now() WHERE id=$2`,
      [current.position, sibling.id],
    );
    return { id: input.id, moved: true };
  });
}

export async function publishCourseStructure(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  changeNote: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await assertCourse(client, principal.tenantId, courseId);
    const modules = await currentStructure(client, courseId);
    if (!modules.length || !modules.some((module) => module.chapters.length))
      throw new Error('请至少创建一个模块和一个章节后再发布');
    const chapters = modules.flatMap((moduleItem) => moduleItem.chapters);
    if (chapters.some((chapter) => !chapter.activities.length))
      throw new Error('每个章节至少需要一个学习活动，请完善空章节后再发布');
    const activities = chapters.flatMap((chapter) => chapter.activities);
    const requiresReference = new Set(['classroom', 'pbl', 'assignment', 'quiz', 'practice']);
    if (
      activities.some(
        (activity) => requiresReference.has(activity.activityType) && !activity.referenceId,
      )
    )
      throw new Error('课堂、PBL、作业、测验和实训活动必须关联具体内容');
    const availableReferences = await client.query<Row>(
      `SELECT id::text,'classroom' AS type FROM zhiban.course_classrooms WHERE course_id=$1 AND status<>'archived'
       UNION ALL SELECT id::text,'pbl' FROM zhiban.pbl_projects WHERE course_id=$1 AND status<>'archived'
       UNION ALL SELECT id::text,CASE WHEN assessment_type='assignment' THEN 'assignment'
         WHEN assessment_type='practice' THEN 'practice' ELSE 'quiz' END
         FROM zhiban.course_assessments WHERE course_id=$1 AND status<>'archived'
       UNION ALL SELECT id::text,'assignment' FROM zhiban.activity_assignments
         WHERE course_id=$1 AND status<>'archived'
       UNION ALL SELECT c.id::text,'content' FROM zhiban.course_activity_contents c WHERE c.course_id=$1 AND c.status='published'
       UNION ALL SELECT id::text,'resource' FROM zhiban.course_resources_v2 WHERE course_id=$1 AND status='published'
       UNION ALL SELECT id::text,'discussion' FROM zhiban.discussion_topics WHERE course_id=$1 AND status<>'archived'`,
      [courseId],
    );
    const referenceKeys = new Set(availableReferences.rows.map((row) => `${row.type}:${row.id}`));
    if (
      activities.some(
        (activity) =>
          activity.referenceId &&
          requiresReference.has(activity.activityType) &&
          !referenceKeys.has(`${activity.activityType}:${activity.referenceId}`),
      )
    )
      throw new Error('课程结构中存在已删除或类型不匹配的关联内容');
    const openMaicTypes = new Set([
      'openmaic_slide',
      'openmaic_quiz',
      'openmaic_interactive',
      'openmaic_pbl',
      'openmaic_3d',
    ]);
    const openMaicActivities = activities.filter((activity) =>
      openMaicTypes.has(activity.activityType),
    );
    if (openMaicActivities.length) {
      const documents = await client.query<{ activity_id: string }>(
        `SELECT activity_id::text FROM zhiban.openmaic_activity_documents WHERE course_id=$1 AND activity_id=ANY($2::uuid[])`,
        [courseId, openMaicActivities.map((activity) => activity.id)],
      );
      const documented = new Set(documents.rows.map((row) => row.activity_id));
      const missing = openMaicActivities.find((activity) => !documented.has(activity.id));
      if (missing) throw new Error(`OpenMAIC 活动“${missing.title}”尚未创建独立活动内容`);
    }
    for (const activity of activities.filter((item) => item.activityType === 'ai_support')) {
      const settings = (activity.completionRule.aiSupport ?? {}) as Record<string, unknown>;
      const bindings = Array.isArray(settings.sourceBindings)
        ? settings.sourceBindings.map(String)
        : [];
      if (settings.sourceMode === 'selected' && !bindings.length)
        throw new Error(`AI 辅导活动“${activity.title}”设置为仅使用指定资料，但尚未关联内容`);
      if (bindings.some((key) => !referenceKeys.has(key)))
        throw new Error(`AI 辅导活动“${activity.title}”存在已删除或无效的关联资料`);
    }
    if (
      activities.some(
        (activity) => activity.opensAt && activity.closesAt && activity.opensAt > activity.closesAt,
      )
    )
      throw new Error('活动截止时间不能早于开放时间');
    const version = Number(
      (
        await client.query<Row>(
          `SELECT COALESCE(max(version),0)+1 AS version FROM zhiban.course_design_versions WHERE course_id=$1`,
          [courseId],
        )
      ).rows[0].version,
    );
    await client.query(
      `UPDATE zhiban.course_design_versions SET status='superseded' WHERE course_id=$1 AND status='published'`,
      [courseId],
    );
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.course_design_versions(id,tenant_id,course_id,version,status,change_note,snapshot,published_by)
       VALUES($1,$2,$3,$4,'published',$5,$6::jsonb,$7)`,
      [
        id,
        principal.tenantId,
        courseId,
        version,
        changeNote,
        JSON.stringify({ courseId, version, modules }),
        principal.id,
      ],
    );
    await client.query(`UPDATE zhiban.course_modules SET status='published' WHERE course_id=$1`, [
      courseId,
    ]);
    await client.query(`UPDATE zhiban.course_chapters SET status='published' WHERE course_id=$1`, [
      courseId,
    ]);
    await client.query(
      `UPDATE zhiban.course_activities SET status='published' WHERE course_id=$1`,
      [courseId],
    );
    await client.query(
      `UPDATE zhiban.openmaic_activity_documents SET status='published',updated_at=now() WHERE course_id=$1`,
      [courseId],
    );
    return { id, version };
  });
}

async function insertSnapshot(
  client: ZhibanDatabaseClient,
  principal: AuthorizedPrincipal,
  courseId: string,
  modules: CourseModule[],
) {
  await client.query(`DELETE FROM zhiban.course_modules WHERE course_id=$1`, [courseId]);
  for (const moduleItem of modules) {
    await client.query(
      `INSERT INTO zhiban.course_modules(id,tenant_id,course_id,title,description,position,status,created_by)
       VALUES($1,$2,$3,$4,$5,$6,'draft',$7)`,
      [
        moduleItem.id,
        principal.tenantId,
        courseId,
        moduleItem.title,
        moduleItem.description,
        moduleItem.position,
        principal.id,
      ],
    );
    for (const chapter of moduleItem.chapters) {
      await client.query(
        `INSERT INTO zhiban.course_chapters(id,tenant_id,course_id,module_id,title,description,position,estimated_minutes,status,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9)`,
        [
          chapter.id,
          principal.tenantId,
          courseId,
          moduleItem.id,
          chapter.title,
          chapter.description,
          chapter.position,
          chapter.estimatedMinutes,
          principal.id,
        ],
      );
      for (const activity of chapter.activities)
        await client.query(
          `INSERT INTO zhiban.course_activities(id,tenant_id,course_id,chapter_id,title,description,activity_type,reference_id,
           position,estimated_minutes,required,opens_at,closes_at,opening_rule,completion_rule,status,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,'draft',$16)`,
          [
            activity.id,
            principal.tenantId,
            courseId,
            chapter.id,
            activity.title,
            activity.description,
            activity.activityType,
            activity.referenceId,
            activity.position,
            activity.estimatedMinutes,
            activity.required,
            activity.opensAt,
            activity.closesAt,
            JSON.stringify(activity.openingRule),
            JSON.stringify(activity.completionRule),
            principal.id,
          ],
        );
    }
  }
  for (const activity of modules.flatMap((moduleItem) =>
    moduleItem.chapters.flatMap((chapter) => chapter.activities),
  ))
    for (const prerequisiteId of activity.prerequisiteActivityIds ?? [])
      await client.query(
        `INSERT INTO zhiban.course_activity_dependencies(tenant_id,course_id,activity_id,prerequisite_activity_id)
         VALUES($1,$2,$3,$4)`,
        [principal.tenantId, courseId, activity.id, prerequisiteId],
      );
}

export async function restoreCourseStructureVersion(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  versionId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const version = (
      await client.query<{ snapshot: CourseStructure }>(
        `SELECT snapshot FROM zhiban.course_design_versions WHERE id=$1 AND course_id=$2`,
        [versionId, courseId],
      )
    ).rows[0];
    if (!version) throw new Error('Course design version not found');
    const progress = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM zhiban.student_activity_progress WHERE course_id=$1`,
      [courseId],
    );
    if (Number(progress.rows[0]?.count))
      throw new Error(
        '课程已经产生学生学习记录，不能直接恢复旧结构；请复制旧版内容到新草稿后再发布',
      );
    await insertSnapshot(client, principal, courseId, version.snapshot.modules);
    return { restoredFrom: versionId };
  });
}

export async function rollbackPublishedCourseStructureVersion(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  versionId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const source = (
      await client.query<{ snapshot: CourseStructure; version: number }>(
        `SELECT snapshot,version FROM zhiban.course_design_versions WHERE id=$1 AND course_id=$2`,
        [versionId, courseId],
      )
    ).rows[0];
    if (!source) throw new Error('Course design version not found');
    const activityIds = source.snapshot.modules.flatMap((moduleItem) =>
      moduleItem.chapters.flatMap((chapter) => chapter.activities.map((activity) => activity.id)),
    );
    if (activityIds.length) {
      const existing = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM zhiban.course_activities WHERE course_id=$1 AND id=ANY($2::uuid[])`,
        [courseId, activityIds],
      );
      if (Number(existing.rows[0]?.count) !== activityIds.length)
        throw new Error('旧版本包含已被物理删除的活动，无法安全回滚；请从历史版本人工重建缺失活动');
    }
    const nextVersion = Number(
      (
        await client.query<Row>(
          `SELECT COALESCE(max(version),0)+1 AS version FROM zhiban.course_design_versions WHERE course_id=$1`,
          [courseId],
        )
      ).rows[0].version,
    );
    await client.query(
      `UPDATE zhiban.course_design_versions SET status='superseded' WHERE course_id=$1 AND status='published'`,
      [courseId],
    );
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.course_design_versions(id,tenant_id,course_id,version,status,change_note,snapshot,published_by)
       VALUES($1,$2,$3,$4,'published',$5,$6::jsonb,$7)`,
      [
        id,
        principal.tenantId,
        courseId,
        nextVersion,
        `安全回滚自 v${source.version}`,
        JSON.stringify({ ...source.snapshot, version: nextVersion }),
        principal.id,
      ],
    );
    return { id, version: nextVersion, rolledBackFrom: source.version };
  });
}

export async function getStudentCourseStructure(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
): Promise<CourseStructure | null> {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const enrolled = await client.query(
      `SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id
       WHERE e.student_id=$1 AND e.status='enrolled' AND o.course_id=$2 LIMIT 1`,
      [principal.id, courseId],
    );
    if (!enrolled.rows[0]) throw new Error('Course is unavailable');
    const version = (
      await client.query<{ snapshot: CourseStructure; published_at: string }>(
        `SELECT snapshot,published_at FROM zhiban.course_design_versions
         WHERE course_id=$1 AND status='published' ORDER BY version DESC LIMIT 1`,
        [courseId],
      )
    ).rows[0];
    if (!version) return null;
    const progressRows = await client.query<Row>(
      `SELECT activity_id,status,progress_percent,score FROM zhiban.student_activity_progress
       WHERE student_id=$1 AND course_id=$2`,
      [principal.id, courseId],
    );
    const progress = new Map(progressRows.rows.map((row) => [row.activity_id as string, row]));
    const completed = new Set(
      progressRows.rows
        .filter((row) => row.status === 'completed')
        .map((row) => row.activity_id as string),
    );
    const now = Date.now();
    const modules = version.snapshot.modules.map((moduleItem) => ({
      ...moduleItem,
      chapters: moduleItem.chapters.map((chapter) => ({
        ...chapter,
        activities: chapter.activities.map((activity) => {
          const row = progress.get(activity.id);
          const dateAvailable =
            (!activity.opensAt || new Date(activity.opensAt).getTime() <= now) &&
            (!activity.closesAt || new Date(activity.closesAt).getTime() >= now);
          const missingPrerequisite = (activity.prerequisiteActivityIds ?? []).find(
            (id) => !completed.has(id),
          );
          return {
            ...activity,
            progress: {
              status:
                (row?.status as NonNullable<CourseActivity['progress']>['status'] | undefined) ??
                'not_started',
              progressPercent: Number(row?.progress_percent ?? 0),
              score: row?.score === null || row?.score === undefined ? null : Number(row.score),
            },
            available: dateAvailable && !missingPrerequisite,
            unavailableReason: !dateAvailable
              ? '未到开放时间或已过截止时间'
              : missingPrerequisite
                ? '请先完成前置活动'
                : null,
          };
        }),
      })),
    }));
    return {
      ...version.snapshot,
      modules,
      publishedAt: new Date(version.published_at).toISOString(),
    };
  });
}

export async function completeStudentCourseActivity(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  activityId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const structure = await client.query<{ snapshot: CourseStructure }>(
      `SELECT snapshot FROM zhiban.course_design_versions WHERE course_id=$1 AND status='published' LIMIT 1`,
      [courseId],
    );
    const activity = structure.rows[0]?.snapshot.modules
      .flatMap((moduleItem) => moduleItem.chapters)
      .flatMap((chapter) => chapter.activities)
      .find((item) => item.id === activityId);
    if (!activity) throw new Error('Published activity not found');
    const enrolled = await client.query(
      `SELECT 1 FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id
       WHERE e.student_id=$1 AND e.status='enrolled' AND o.course_id=$2 LIMIT 1`,
      [principal.id, courseId],
    );
    if (!enrolled.rows[0]) throw new Error('Course is unavailable');
    const prerequisites = activity.prerequisiteActivityIds ?? [];
    if (prerequisites.length) {
      const completed = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM zhiban.student_activity_progress
         WHERE student_id=$1 AND activity_id=ANY($2::uuid[]) AND status='completed'`,
        [principal.id, prerequisites],
      );
      if (Number(completed.rows[0]?.count) !== prerequisites.length)
        throw new Error('请先完成前置活动');
    }
    const now = Date.now();
    if (
      (activity.opensAt && new Date(activity.opensAt).getTime() > now) ||
      (activity.closesAt && new Date(activity.closesAt).getTime() < now)
    )
      throw new Error('活动当前不可用');
    const id = randomUUID();
    await client.query(
      `INSERT INTO zhiban.student_activity_progress
       (id,tenant_id,course_id,activity_id,student_id,status,progress_percent,started_at,completed_at)
       VALUES($1,$2,$3,$4,$5,'completed',100,now(),now())
       ON CONFLICT(tenant_id,activity_id,student_id) DO UPDATE SET status='completed',progress_percent=100,
       started_at=COALESCE(zhiban.student_activity_progress.started_at,now()),completed_at=now(),updated_at=now()`,
      [id, principal.tenantId, courseId, activityId, principal.id],
    );
    return { activityId, status: 'completed' };
  });
}

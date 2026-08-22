import { randomUUID } from 'node:crypto';
import { makeScene, type Scene, type SceneContent, type Stage } from '@/lib/types/stage';
import { createBlankSlideScene } from '@/lib/edit/slide-defaults';
import type { PPTTextElement, Slide } from '@openmaic/dsl';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';

export async function getTeacherOpenMaicActivityDocument(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  activityId: string,
) {
  return withZhibanTenant(
    pool,
    principal.tenantId,
    async (client) =>
      (
        await client.query<Record<string, unknown>>(
          `SELECT document_id,revision,status,updated_at,jsonb_array_length(scenes)::int scene_count,COALESCE(document_state->>'activityKind',scenes->0->>'type','slide') activity_kind FROM zhiban.openmaic_activity_documents WHERE course_id=$1 AND activity_id=$2`,
          [courseId, activityId],
        )
      ).rows[0] ?? null,
  );
}

export type OpenMaicActivityKind = 'slide' | 'quiz' | 'interactive' | 'pbl' | 'visualization3d';
export type OpenMaicCourseActivityType =
  | 'openmaic_slide'
  | 'openmaic_quiz'
  | 'openmaic_interactive'
  | 'openmaic_pbl'
  | 'openmaic_3d';
export const OPENMAIC_ACTIVITY_KIND_BY_TYPE: Record<
  OpenMaicCourseActivityType,
  OpenMaicActivityKind
> = {
  openmaic_slide: 'slide',
  openmaic_quiz: 'quiz',
  openmaic_interactive: 'interactive',
  openmaic_pbl: 'pbl',
  openmaic_3d: 'visualization3d',
};

function starterScene(
  documentId: string,
  title: string,
  description: string,
  kind: OpenMaicActivityKind,
): Scene {
  const escapedTitle = title
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  const escapedDescription = description
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  if (kind === 'slide') {
    const scene = createBlankSlideScene(documentId, title, 0);
    if (scene.content.type === 'slide') {
      const body =
        escapedDescription || `学习目标：理解并掌握“${escapedTitle}”的核心知识与操作方法。`;
      const elements: PPTTextElement[] = [
        {
          id: `${documentId}_title`,
          type: 'text',
          left: 72,
          top: 68,
          width: 856,
          height: 86,
          rotate: 0,
          defaultFontName: 'Microsoft YaHei',
          defaultColor: '#0f172a',
          lineHeight: 1.2,
          content: `<p><span style="font-size:42px;font-weight:700;color:#0f172a">${escapedTitle}</span></p>`,
        },
        {
          id: `${documentId}_body`,
          type: 'text',
          left: 88,
          top: 190,
          width: 824,
          height: 170,
          rotate: 0,
          defaultFontName: 'Microsoft YaHei',
          defaultColor: '#334155',
          lineHeight: 1.5,
          content: `<p><span style="font-size:24px;color:#334155">${body}</span></p>`,
        },
        {
          id: `${documentId}_guide`,
          type: 'text',
          left: 88,
          top: 400,
          width: 824,
          height: 96,
          rotate: 0,
          defaultFontName: 'Microsoft YaHei',
          defaultColor: '#2563eb',
          lineHeight: 1.4,
          content:
            '<p><span style="font-size:20px;color:#2563eb">学习建议：先观察示例 → 分析关键步骤 → 完成实践任务</span></p>',
        },
      ];
      scene.content.canvas.elements = elements;
    }
    return scene;
  }
  let content: SceneContent;
  if (kind === 'quiz') {
    content = {
      type: 'quiz',
      questions: [
        {
          id: `${documentId}_q1`,
          type: 'single',
          question: '请在此编辑题干',
          options: [
            { value: 'A', label: '选项 A' },
            { value: 'B', label: '选项 B' },
          ],
          answer: ['A'],
          points: 10,
        },
      ],
    };
  } else if (kind === 'interactive') {
    content = {
      type: 'interactive',
      url: '',
      html: `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#eff6ff;color:#0f172a}.card{width:min(680px,80%);padding:40px;border-radius:24px;background:white;box-shadow:0 20px 50px #1e3a8a22}button{background:#2563eb;color:white;border:0;border-radius:10px;padding:12px 20px}</style></head><body><div class="card"><h1>${escapedTitle}</h1><p>${escapedDescription || '请在 OpenMAIC 中编辑本互动网页的 HTML 内容。'}</p><button onclick="this.textContent='互动已完成'">开始互动</button></div></body></html>`,
    };
  } else if (kind === 'visualization3d') {
    content = {
      type: 'interactive',
      url: '',
      widgetType: 'visualization3d',
      widgetConfig: {
        type: 'visualization3d',
        visualizationType: 'custom',
        description: description || title,
        objects: [
          {
            id: 'starter-cube',
            type: 'box',
            name: title,
            material: { type: 'standard', color: '#2563eb' },
            animation: { type: 'rotate', speed: 1, axis: 'y' },
          },
        ],
        interactions: [
          { type: 'orbit', target: 'camera', label: '旋转视角' },
          { type: 'zoom', target: 'camera', label: '缩放' },
        ],
      },
      html: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle,#dbeafe,#0f172a);perspective:800px}.cube{width:180px;height:180px;background:linear-gradient(135deg,#22d3ee,#2563eb);border:3px solid #fff8;border-radius:24px;box-shadow:0 30px 80px #0008;animation:spin 5s linear infinite;display:grid;place-items:center;color:white;font:700 22px system-ui;text-align:center}@keyframes spin{to{transform:rotateX(360deg) rotateY(360deg)}}</style></head><body><div class="cube">${escapedTitle}<br>3D</div></body></html>`,
    };
  } else {
    content = {
      type: 'pbl',
      projectConfig: {
        projectInfo: { title, description: description || '请完成本项目任务' },
        agents: [
          {
            name: '学习者',
            actor_role: '项目执行者',
            role_division: 'development',
            system_prompt: '完成项目任务',
            default_mode: 'idle',
            delay_time: 0,
            env: {},
            is_user_role: true,
            is_active: true,
            is_system_agent: false,
          },
        ],
        issueboard: {
          agent_ids: ['学习者'],
          current_issue_id: `${documentId}_task1`,
          issues: [
            {
              id: `${documentId}_task1`,
              title: '任务一',
              description: description || '请在此编辑项目任务',
              person_in_charge: '学习者',
              participants: ['学习者'],
              notes: '',
              parent_issue: null,
              index: 0,
              is_done: false,
              is_active: true,
              generated_questions: '请先分析任务目标和完成步骤。',
              question_agent_name: 'Tutor',
              judge_agent_name: 'Tutor',
            },
          ],
        },
        chat: { messages: [] },
      },
    };
  }
  return makeScene(
    {
      id: `${documentId}_scene_1`,
      stageId: documentId,
      title,
      order: 0,
      actions: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    content,
  );
}

export async function createOpenMaicActivityDocument(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  activityId: string,
  kind: OpenMaicActivityKind,
  replace = false,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const expectedType = (Object.entries(OPENMAIC_ACTIVITY_KIND_BY_TYPE).find(
      ([, value]) => value === kind,
    )?.[0] ?? 'openmaic_slide') as OpenMaicCourseActivityType;
    const activity = await client.query<{ title: string; description: string }>(
      `SELECT title,description FROM zhiban.course_activities WHERE id=$1 AND course_id=$2 AND activity_type=$3`,
      [activityId, courseId, expectedType],
    );
    if (!activity.rows[0]) throw new Error('请先创建并保存 OpenMAIC 互动活动');
    const existing = await client.query<{ document_id: string; activity_kind: string }>(
      `SELECT document_id,COALESCE(document_state->>'activityKind','slide') activity_kind FROM zhiban.openmaic_activity_documents WHERE activity_id=$1`,
      [activityId],
    );
    if (existing.rows[0] && !replace && existing.rows[0].activity_kind === kind)
      return existing.rows[0];
    const documentId = existing.rows[0]?.document_id ?? `zba_${randomUUID().replaceAll('-', '')}`;
    const now = Date.now();
    const stage: Stage = {
      id: documentId,
      name: activity.rows[0].title,
      description: activity.rows[0].description,
      createdAt: now,
      updatedAt: now,
    };
    const scene = starterScene(
      documentId,
      activity.rows[0].title,
      activity.rows[0].description,
      kind,
    );
    if (existing.rows[0])
      await client.query(
        `UPDATE zhiban.openmaic_activity_documents SET stage=$2::jsonb,scenes=$3::jsonb,document_state=$4::jsonb,revision=revision+1,status='draft',updated_by=$5,updated_at=now() WHERE document_id=$1`,
        [
          documentId,
          JSON.stringify(stage),
          JSON.stringify([scene]),
          JSON.stringify({ activityKind: kind }),
          principal.id,
        ],
      );
    else
      await client.query(
        `INSERT INTO zhiban.openmaic_activity_documents(id,tenant_id,course_id,activity_id,document_id,stage,scenes,document_state,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$9)`,
        [
          randomUUID(),
          principal.tenantId,
          courseId,
          activityId,
          documentId,
          JSON.stringify(stage),
          JSON.stringify([scene]),
          JSON.stringify({ activityKind: kind }),
          principal.id,
        ],
      );
    return { document_id: documentId, activity_kind: kind };
  });
}

export async function deleteOpenMaicActivityDocument(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  activityId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await client.query(
      `DELETE FROM zhiban.openmaic_activity_documents WHERE course_id=$1 AND activity_id=$2`,
      [courseId, activityId],
    );
    return { deleted: true };
  });
}

export async function replaceOpenMaicActivitySlides(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  activityId: string,
  slides: Slide[],
  source: 'pptx' | 'ai',
  generatedStage?: Stage,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const document = await client.query<{ document_id: string; stage: Stage }>(
      `SELECT document_id,stage FROM zhiban.openmaic_activity_documents WHERE course_id=$1 AND activity_id=$2`,
      [courseId, activityId],
    );
    if (!document.rows[0]) throw new Error('请先创建幻灯片活动');
    if (!slides.length) throw new Error('PPT 中没有可导入的幻灯片');
    const documentId = document.rows[0].document_id,
      now = Date.now();
    const stage: Stage = {
      ...(generatedStage ?? document.rows[0].stage),
      id: documentId,
      updatedAt: now,
    };
    const scenes = slides.map((slide, index) =>
      makeScene(
        {
          id: `${documentId}_slide_${index + 1}`,
          stageId: documentId,
          title: `${stage.name || '幻灯片'} ${index + 1}`,
          order: index,
          actions: [],
          createdAt: now,
          updatedAt: now,
        },
        { type: 'slide', canvas: slide },
      ),
    );
    await client.query(
      `UPDATE zhiban.openmaic_activity_documents SET stage=$3::jsonb,scenes=$4::jsonb,document_state=document_state||$5::jsonb,revision=revision+1,status='draft',updated_by=$6,updated_at=now() WHERE course_id=$1 AND activity_id=$2`,
      [
        courseId,
        activityId,
        JSON.stringify(stage),
        JSON.stringify(scenes),
        JSON.stringify({ activityKind: 'slide', slideSource: source }),
        principal.id,
      ],
    );
    return { document_id: documentId, scene_count: scenes.length, source };
  });
}

export async function replaceOpenMaicActivityGeneratedDocument(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  activityId: string,
  stage: Stage,
  scenes: Scene[],
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const document = await client.query<{ document_id: string }>(
      `SELECT document_id FROM zhiban.openmaic_activity_documents WHERE course_id=$1 AND activity_id=$2`,
      [courseId, activityId],
    );
    if (!document.rows[0]) throw new Error('请先创建幻灯片活动');
    const slideScenes = scenes.filter((scene) => scene.content.type === 'slide');
    if (!slideScenes.length) throw new Error('AI 生成结果中没有幻灯片');
    const documentId = document.rows[0].document_id,
      now = Date.now();
    const storedStage: Stage = { ...stage, id: documentId, updatedAt: now };
    const storedScenes = slideScenes.map((scene, index) => ({
      ...scene,
      id: `${documentId}_slide_${index + 1}`,
      stageId: documentId,
      order: index,
      updatedAt: now,
    }));
    await client.query(
      `UPDATE zhiban.openmaic_activity_documents SET stage=$3::jsonb,scenes=$4::jsonb,document_state=document_state||$5::jsonb,revision=revision+1,status='draft',updated_by=$6,updated_at=now() WHERE course_id=$1 AND activity_id=$2`,
      [
        courseId,
        activityId,
        JSON.stringify(storedStage),
        JSON.stringify(storedScenes),
        JSON.stringify({ activityKind: 'slide', slideSource: 'ai' }),
        principal.id,
      ],
    );
    return { document_id: documentId, scene_count: storedScenes.length, source: 'ai' as const };
  });
}

export async function readOpenMaicActivityDocument(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  documentId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const document = (
      await client.query<Record<string, unknown>>(
        `SELECT document_id,course_id::text,activity_id::text,status,stage,scenes,document_state,revision,created_at FROM zhiban.openmaic_activity_documents WHERE document_id=$1`,
        [documentId],
      )
    ).rows[0];
    if (!document) return null;
    const courseId = String(document.course_id);
    const manages =
      principal.permissions.includes('course:manage') ||
      principal.grants.some(
        (grant) =>
          grant.permission === 'course:manage' &&
          (grant.scopeType === 'system' ||
            grant.scopeType === 'tenant' ||
            (grant.scopeType === 'course' && grant.scopeId === courseId)),
      );
    if (manages) return document;
    if (document.status !== 'published') return null;
    const enrollment = await client.query(
      `SELECT 1 FROM zhiban.course_offerings o JOIN zhiban.enrollments e ON e.offering_id=o.id WHERE o.course_id=$1 AND e.student_id=$2 AND e.status='enrolled' LIMIT 1`,
      [courseId, principal.id],
    );
    return enrollment.rows[0] ? document : null;
  });
}

export async function saveOpenMaicActivityDocument(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  documentId: string,
  stage: Stage,
  scenes: Scene[],
  documentState: Record<string, unknown>,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const target = await client.query<{ course_id: string }>(
      `SELECT course_id::text FROM zhiban.openmaic_activity_documents WHERE document_id=$1`,
      [documentId],
    );
    if (!target.rows[0]) return null;
    const courseId = target.rows[0].course_id;
    const allowed =
      principal.permissions.includes('course:manage') ||
      principal.grants.some(
        (grant) =>
          grant.permission === 'course:manage' &&
          (grant.scopeType === 'system' ||
            grant.scopeType === 'tenant' ||
            (grant.scopeType === 'course' && grant.scopeId === courseId)),
      );
    if (!allowed) throw new Error('Permission denied');
    const result = await client.query<{ revision: string }>(
      `UPDATE zhiban.openmaic_activity_documents SET stage=$2::jsonb,scenes=$3::jsonb,document_state=document_state||$4::jsonb,revision=revision+1,updated_by=$5,updated_at=now() WHERE document_id=$1 RETURNING revision::text`,
      [
        documentId,
        JSON.stringify(stage),
        JSON.stringify(scenes),
        JSON.stringify(documentState),
        principal.id,
      ],
    );
    return result.rows[0] ? { revision: Number(result.rows[0].revision) } : null;
  });
}

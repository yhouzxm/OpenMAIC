'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Eye,
  History,
  Pencil,
  Plus,
  Rocket,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  CourseActivity,
  CourseActivityReference,
  CourseActivityType,
  CourseDesignVersion,
  CourseModule,
  CourseStructureChanges,
} from '@/lib/zhiban/curriculum';
import { useImportPptx } from '@/lib/import/use-import-pptx';

type Payload = Record<string, unknown> & { action: string };
type Data = {
  courseId: string;
  modules: CourseModule[];
  versions: CourseDesignVersion[];
  references: CourseActivityReference[];
  draftChanges: CourseStructureChanges;
};
const activityTypes: Array<{ value: CourseActivityType; label: string }> = [
  { value: 'content', label: '图文内容' },
  { value: 'resource', label: '课程资源' },
  { value: 'classroom', label: 'OpenMAIC 课堂' },
  { value: 'pbl', label: 'PBL 项目' },
  { value: 'assignment', label: '作业' },
  { value: 'quiz', label: '测验' },
  { value: 'discussion', label: '讨论' },
  { value: 'ema', label: 'EMA 问卷' },
  { value: 'practice', label: '实训' },
  { value: 'summary', label: '章节总结' },
  { value: 'ai_support', label: 'AI 辅导' },
  { value: 'openmaic_slide', label: '幻灯片' },
  { value: 'openmaic_quiz', label: 'Quiz' },
  { value: 'openmaic_interactive', label: '互动网页' },
  { value: 'openmaic_pbl', label: 'PBL 互动' },
  { value: 'openmaic_3d', label: '3D 互动' },
];
const openMaicActivityTypes = new Set<CourseActivityType>([
  'openmaic_slide',
  'openmaic_quiz',
  'openmaic_interactive',
  'openmaic_pbl',
  'openmaic_3d',
]);

export function CourseStructureDesigner({ courseId }: { courseId: string }) {
  const [data, setData] = useState<Data>({
    courseId,
    modules: [],
    versions: [],
    references: [],
    draftChanges: { added: 0, removed: 0, changed: 0, summary: [] },
  });
  const [busy, setBusy] = useState(false);
  const [editingActivity, setEditingActivity] = useState<CourseActivity | null>(null);
  const [preview, setPreview] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/zhiban/teacher/courses/${courseId}/structure`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '课程结构加载失败');
    setData(body);
  }, [courseId]);
  useEffect(() => {
    void load().catch((error) => toast.error(error.message));
  }, [load]);
  const act = async (payload: Payload, success: string) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/zhiban/teacher/courses/${courseId}/structure`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '操作失败');
      toast.success(success);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  const edit = (
    kind: 'module' | 'chapter' | 'activity',
    item: { id: string; title: string; description: string },
  ) => {
    const title = window.prompt('请输入新标题', item.title)?.trim();
    if (!title) return;
    const description = window.prompt('请输入说明', item.description) ?? item.description;
    void act({ action: 'update', kind, id: item.id, title, description }, '内容已更新');
  };
  const remove = (kind: 'module' | 'chapter' | 'activity', id: string) => {
    if (!window.confirm('删除后，其下级草稿内容也会一并删除。确定继续吗？')) return;
    void act({ action: 'delete', kind, id }, '已删除');
  };
  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-4 border bg-white p-5">
        <div>
          <h2 className="text-xl font-semibold">统一课程结构</h2>
          <p className="mt-1 text-sm text-slate-500">
            按“模块—章节—学习活动”设计课程，发布后学生才能看到新版本。
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setPreview(true)}>
            <Eye className="mr-2 size-4" />
            学生视角预览
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              const note = window.prompt('请输入本次发布说明', '更新课程结构');
              if (note !== null)
                void act({ action: 'publish', changeNote: note }, '课程结构已发布');
            }}
          >
            <Rocket className="mr-2 size-4" /> 发布新版本
          </Button>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3 border bg-white px-4 py-3 text-sm">
        <span className="font-medium">相对当前发布版：</span>
        {data.draftChanges.summary.length ? (
          data.draftChanges.summary.map((item) => (
            <Badge key={item} variant="outline">
              {item}
            </Badge>
          ))
        ) : (
          <span className="text-slate-500">暂无结构变化</span>
        )}
      </section>

      <form
        className="flex gap-2 border bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const title = String(form.get('title') ?? '').trim();
          if (!title) return;
          void act({ action: 'create_module', title, description: '' }, '模块已创建');
          event.currentTarget.reset();
        }}
      >
        <Input name="title" placeholder="新模块名称，例如：模块一 计算机基础" maxLength={200} />
        <Button disabled={busy}>
          <Plus className="mr-2 size-4" />
          新增模块
        </Button>
      </form>

      {data.modules.map((module) => (
        <section key={module.id} className="border bg-white">
          <header className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-3">
            <BookOpen className="size-5 text-blue-600" />
            <h3 className="min-w-0 flex-1 font-semibold">{module.title}</h3>
            <OrderButtons
              busy={busy}
              onMove={(direction) =>
                act({ action: 'move', kind: 'module', id: module.id, direction }, '顺序已调整')
              }
            />
            <Button size="icon" variant="ghost" onClick={() => edit('module', module)}>
              <Pencil className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="text-red-600"
              onClick={() => remove('module', module.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </header>
          <div className="space-y-3 p-4">
            {module.chapters.map((chapter, chapterIndex) => (
              <article key={chapter.id} className="rounded border">
                <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
                  <Badge variant="outline">第 {chapterIndex + 1} 章</Badge>
                  <h4 className="min-w-0 flex-1 font-medium">{chapter.title}</h4>
                  <span className="text-xs text-slate-500">
                    预计 {chapter.estimatedMinutes} 分钟
                  </span>
                  <OrderButtons
                    busy={busy}
                    onMove={(direction) =>
                      act(
                        { action: 'move', kind: 'chapter', id: chapter.id, direction },
                        '顺序已调整',
                      )
                    }
                  />
                  <Button size="icon" variant="ghost" onClick={() => edit('chapter', chapter)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-red-600"
                    onClick={() => remove('chapter', chapter.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="divide-y">
                  {chapter.activities.map((activity) => (
                    <div
                      key={activity.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                    >
                      <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
                        {activityLabel(activity.activityType)}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{activity.title}</p>
                        {activity.description && (
                          <p className="truncate text-xs text-slate-500">{activity.description}</p>
                        )}
                      </div>
                      <span className="text-xs text-slate-500">
                        {activity.required ? '必修' : '选修'} · {activity.estimatedMinutes} 分钟
                      </span>
                      <OrderButtons
                        busy={busy}
                        onMove={(direction) =>
                          act(
                            { action: 'move', kind: 'activity', id: activity.id, direction },
                            '顺序已调整',
                          )
                        }
                      />
                      {activity.activityType === 'content' && (
                        <Button asChild size="sm" variant="outline">
                          <a href={`?contentActivityId=${activity.id}#course-content`}>
                            <BookOpen className="mr-1 size-4" />
                            编辑正文
                          </a>
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setEditingActivity(activity)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-red-600"
                        onClick={() => remove('activity', activity.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  {!chapter.activities.length && (
                    <p className="px-4 py-5 text-center text-sm text-slate-400">暂无学习活动</p>
                  )}
                </div>
                <ActivityForm
                  chapterId={chapter.id}
                  busy={busy}
                  onCreate={(payload) => act(payload, '学习活动已创建')}
                />
              </article>
            ))}
            {!module.chapters.length && (
              <p className="py-4 text-center text-sm text-slate-400">该模块暂无章节</p>
            )}
            <ChapterForm
              moduleId={module.id}
              busy={busy}
              onCreate={(payload) => act(payload, '章节已创建')}
            />
          </div>
        </section>
      ))}
      {!data.modules.length && (
        <div className="border bg-white p-14 text-center text-slate-500">
          请先创建第一个课程模块。
        </div>
      )}

      <section className="border bg-white p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <History className="size-5" />
          发布历史
        </h3>
        <div className="mt-4 space-y-2">
          {data.versions.map((version) => (
            <div
              key={version.id}
              className="flex flex-wrap items-center gap-3 rounded border px-4 py-3 text-sm"
            >
              <Badge variant={version.status === 'published' ? 'default' : 'outline'}>
                v{version.version}
              </Badge>
              <span className="min-w-0 flex-1">
                {version.changeNote || '无发布说明'} · {version.publishedByName} ·{' '}
                {new Date(version.publishedAt).toLocaleString()}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(
                    { action: 'restore', versionId: version.id },
                    `已将 v${version.version} 恢复为当前草稿`,
                  )
                }
              >
                恢复为草稿
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || version.status === 'published'}
                onClick={() => {
                  if (
                    window.confirm(
                      `确定将 v${version.version} 作为新的发布版本吗？当前发布版会保留在历史中。`,
                    )
                  )
                    void act(
                      { action: 'rollback_version', versionId: version.id },
                      `已安全回滚到 v${version.version}`,
                    );
                }}
              >
                回滚并发布
              </Button>
            </div>
          ))}
          {!data.versions.length && (
            <p className="text-sm text-slate-400">尚未发布课程结构版本。</p>
          )}
        </div>
      </section>
      <Dialog
        open={Boolean(editingActivity)}
        onOpenChange={(open) => !open && setEditingActivity(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑学习活动</DialogTitle>
            <DialogDescription>
              设置类型、关联内容、开放规则、完成条件和前置依赖。
            </DialogDescription>
          </DialogHeader>
          {editingActivity && (
            <ActivityEditor
              courseId={courseId}
              activity={editingActivity}
              modules={data.modules}
              references={data.references}
              busy={busy}
              onSave={(payload) => {
                void act(payload, '学习活动已更新').then(() => setEditingActivity(null));
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>学生视角预览（当前草稿）</DialogTitle>
            <DialogDescription>预览不会发布内容，学生仍只能看到当前发布版本。</DialogDescription>
          </DialogHeader>
          <StructurePreview modules={data.modules} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrderButtons({
  busy,
  onMove,
}: {
  busy: boolean;
  onMove: (direction: 'up' | 'down') => void;
}) {
  return (
    <span className="flex">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={busy}
        onClick={() => onMove('up')}
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={busy}
        onClick={() => onMove('down')}
      >
        <ArrowDown className="size-4" />
      </Button>
    </span>
  );
}
function ChapterForm({
  moduleId,
  busy,
  onCreate,
}: {
  moduleId: string;
  busy: boolean;
  onCreate: (payload: Payload) => void;
}) {
  return (
    <form
      className="flex flex-wrap gap-2 rounded bg-slate-50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const title = String(form.get('title') ?? '').trim();
        if (!title) return;
        onCreate({
          action: 'create_chapter',
          moduleId,
          title,
          description: String(form.get('description') ?? '').trim(),
          estimatedMinutes: Number(form.get('minutes')) || 0,
        });
        event.currentTarget.reset();
      }}
    >
      <Input className="min-w-56 flex-1" name="title" placeholder="新增章节名称" />
      <Input className="w-32" name="minutes" type="number" min="0" placeholder="预计分钟" />
      <Button disabled={busy} variant="outline">
        <Plus className="mr-2 size-4" />
        新增章节
      </Button>
    </form>
  );
}
function ActivityForm({
  chapterId,
  busy,
  onCreate,
}: {
  chapterId: string;
  busy: boolean;
  onCreate: (payload: Payload) => void;
}) {
  const [activityType, setActivityType] = useState<CourseActivityType>('content');
  return (
    <form
      className="flex flex-wrap gap-2 border-t bg-blue-50/40 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const title = String(form.get('title') ?? '').trim();
        if (!title) return;
        onCreate({
          action: 'create_activity',
          chapterId,
          title,
          description: String(form.get('description') ?? '').trim(),
          activityType: String(form.get('type')),
          referenceId: null,
          estimatedMinutes: Number(form.get('minutes')) || 0,
          required: true,
          opensAt: null,
          closesAt: null,
        });
        event.currentTarget.reset();
        setActivityType('content');
      }}
    >
      <Input className="min-w-48 flex-1" name="title" placeholder="新增学习活动" />
      <select
        name="type"
        value={activityType}
        onChange={(event) => setActivityType(event.target.value as CourseActivityType)}
        className="h-9 rounded border bg-white px-3 text-sm"
      >
        {activityTypes.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      {openMaicActivityTypes.has(activityType) && (
        <Input
          className="min-w-64 flex-[2]"
          name="description"
          placeholder="输入本活动的知识要点或内容说明"
        />
      )}
      <Input className="w-28" name="minutes" type="number" min="0" placeholder="分钟" />
      <Button disabled={busy} size="sm">
        <Plus className="mr-2 size-4" />
        添加活动
      </Button>
    </form>
  );
}
function activityLabel(value: CourseActivityType) {
  return activityTypes.find((item) => item.value === value)?.label ?? value;
}

function ActivityEditor({
  courseId,
  activity,
  modules,
  references,
  busy,
  onSave,
}: {
  courseId: string;
  activity: CourseActivity;
  modules: CourseModule[];
  references: CourseActivityReference[];
  busy: boolean;
  onSave: (payload: Payload) => void;
}) {
  const [selectedType, setSelectedType] = useState<CourseActivityType>(activity.activityType);
  const allActivities = modules.flatMap((moduleItem) =>
    moduleItem.chapters.flatMap((chapter) => chapter.activities),
  );
  const currentReference = activity.referenceId
    ? `${activity.activityType}:${activity.referenceId}`
    : '';
  const requiresSingleReference = ['classroom', 'pbl', 'assignment', 'quiz', 'practice'].includes(
    selectedType,
  );
  const matchingReferences = references.filter((item) => item.type === selectedType);
  return (
    <form
      className="grid gap-4 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const selectedReference = String(form.get('reference') ?? '');
        const [, referenceId] = selectedReference.split(':', 2);
        const opensAt = String(form.get('opensAt') ?? '');
        const closesAt = String(form.get('closesAt') ?? '');
        const prerequisiteActivityIds = form.getAll('prerequisite').map(String);
        onSave({
          action: 'update_activity',
          id: activity.id,
          chapterId: String(form.get('chapterId')),
          title: String(form.get('title') ?? '').trim(),
          description: String(form.get('description') ?? ''),
          activityType: String(form.get('activityType')),
          referenceId: referenceId || null,
          estimatedMinutes: Number(form.get('estimatedMinutes')) || 0,
          required: form.get('required') === 'on',
          opensAt: opensAt ? new Date(opensAt).toISOString() : null,
          closesAt: closesAt ? new Date(closesAt).toISOString() : null,
          openingRule: {
            type: prerequisiteActivityIds.length ? 'prerequisite' : opensAt ? 'date' : 'always',
          },
          completionRule: {
            type: String(form.get('completionType') ?? 'manual'),
            ...(String(form.get('activityType')) === 'ai_support'
              ? {
                  aiSupport: {
                    learningObjective: String(form.get('aiLearningObjective') ?? '').trim(),
                    openingPrompt: String(form.get('aiOpeningPrompt') ?? '').trim(),
                    keyPoints: String(form.get('aiKeyPoints') ?? '')
                      .split('\n')
                      .map((item) => item.trim())
                      .filter(Boolean),
                    guidanceMode: String(form.get('aiGuidanceMode') ?? 'socratic'),
                    knowledgeScope: String(form.get('aiKnowledgeScope') ?? 'course_only'),
                    answerBoundary: String(form.get('aiAnswerBoundary') ?? '').trim(),
                    minimumTurns: Number(form.get('aiMinimumTurns')) || 1,
                    maximumTurns: Number(form.get('aiMaximumTurns')) || 8,
                    requireReflection: form.get('aiRequireReflection') === 'on',
                    generateSummary: form.get('aiGenerateSummary') === 'on',
                    teacherReview: form.get('aiTeacherReview') === 'on',
                    sourceMode: String(form.get('aiSourceMode') ?? 'current_chapter'),
                    sourceBindings: form.getAll('aiSourceBinding').map(String),
                  },
                }
              : {}),
            ...(openMaicActivityTypes.has(String(form.get('activityType')) as CourseActivityType)
              ? {
                  openmaicInteraction: {
                    completionEvent: String(form.get('openmaicCompletionEvent') ?? 'scene_viewed'),
                    minimumScore: Number(form.get('openmaicMinimumScore')) || 0,
                    maxAttempts: Number(form.get('openmaicMaxAttempts')) || 0,
                  },
                }
              : {}),
          },
          prerequisiteActivityIds,
        });
      }}
    >
      <Field label="活动标题">
        <Input name="title" defaultValue={activity.title} required maxLength={240} />
      </Field>
      <Field label="所在章节">
        <select
          name="chapterId"
          defaultValue={activity.chapterId}
          className="h-9 w-full rounded border bg-white px-3 text-sm"
        >
          {modules
            .flatMap((moduleItem) => moduleItem.chapters)
            .map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title}
              </option>
            ))}
        </select>
      </Field>
      <Field label="活动类型">
        <select
          name="activityType"
          defaultValue={activity.activityType}
          onChange={(event) => setSelectedType(event.target.value as CourseActivityType)}
          className="h-9 w-full rounded border bg-white px-3 text-sm"
        >
          {activityTypes.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>
      {requiresSingleReference && (
        <Field label={`关联${activityLabel(selectedType)}`}>
          <select
            name="reference"
            defaultValue={currentReference}
            className="h-9 w-full rounded border bg-white px-3 text-sm"
          >
            <option value="">请选择已创建的{activityLabel(selectedType)}</option>
            {matchingReferences.map((item) => (
              <option key={`${item.type}-${item.id}`} value={`${item.type}:${item.id}`}>
                {activityLabel(item.type)}：{item.title}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="预计学习时长（分钟）">
        <Input
          name="estimatedMinutes"
          type="number"
          min="0"
          defaultValue={activity.estimatedMinutes}
        />
      </Field>
      <Field label="完成条件">
        <select
          name="completionType"
          defaultValue={String(activity.completionRule.type ?? 'manual')}
          className="h-9 w-full rounded border bg-white px-3 text-sm"
        >
          <option value="manual">学生确认完成</option>
          <option value="view">打开内容即完成</option>
          <option value="reference_completed">关联业务完成后自动完成</option>
        </select>
      </Field>
      <Field label="开放时间">
        <Input
          name="opensAt"
          type="datetime-local"
          defaultValue={localDateTime(activity.opensAt)}
        />
      </Field>
      <Field label="截止时间">
        <Input
          name="closesAt"
          type="datetime-local"
          defaultValue={localDateTime(activity.closesAt)}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input name="required" type="checkbox" defaultChecked={activity.required} />
        必修活动
      </label>
      <div className="md:col-span-2">
        <Field label="活动说明">
          <textarea
            name="description"
            defaultValue={activity.description}
            rows={3}
            className="w-full rounded border p-3 text-sm"
            maxLength={10000}
          />
        </Field>
      </div>
      {selectedType === 'ai_support' && (
        <AiSupportSettings activity={activity} references={references} />
      )}
      {openMaicActivityTypes.has(selectedType) && (
        <OpenMaicActivitySettings courseId={courseId} activity={activity} />
      )}
      {selectedType === 'content' && (
        <div className="rounded border border-blue-200 bg-blue-50 p-4 text-sm md:col-span-2">
          <p className="font-medium text-blue-800">图文正文在“内容、资源与讨论”中管理</p>
          <p className="mt-1 text-slate-600">
            先保存当前活动，再点击活动列表中的“编辑正文”，为该活动编写、预览和发布内容。图文内容不需要设置关联
            ID。
          </p>
        </div>
      )}
      {selectedType === 'resource' && (
        <div className="rounded border bg-slate-50 p-4 text-sm text-slate-600 md:col-span-2">
          课程资源在“内容、资源与讨论”中上传和管理，可为活动配置多个资源，不使用通用单一关联。
        </div>
      )}
      {selectedType === 'discussion' && (
        <div className="rounded border bg-slate-50 p-4 text-sm text-slate-600 md:col-span-2">
          讨论主题在“内容、资源与讨论”中创建并绑定活动，不使用通用单一关联。
        </div>
      )}
      <div className="md:col-span-2">
        <p className="mb-2 text-sm font-medium">前置活动（可多选）</p>
        <div className="grid max-h-40 gap-2 overflow-y-auto rounded border p-3 md:grid-cols-2">
          {allActivities
            .filter((item) => item.id !== activity.id)
            .map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  name="prerequisite"
                  type="checkbox"
                  value={item.id}
                  defaultChecked={activity.prerequisiteActivityIds.includes(item.id)}
                />
                {item.title}
              </label>
            ))}
          {allActivities.length <= 1 && (
            <span className="text-sm text-slate-400">暂无可选前置活动</span>
          )}
        </div>
      </div>
      <div className="flex justify-end md:col-span-2">
        <Button disabled={busy}>保存活动设置</Button>
      </div>
    </form>
  );
}

type AiSupportRule = {
  learningObjective?: string;
  openingPrompt?: string;
  keyPoints?: string[];
  guidanceMode?: string;
  knowledgeScope?: string;
  answerBoundary?: string;
  minimumTurns?: number;
  maximumTurns?: number;
  requireReflection?: boolean;
  generateSummary?: boolean;
  teacherReview?: boolean;
  sourceMode?: string;
  sourceBindings?: string[];
};

type OpenMaicRule = { completionEvent?: string; minimumScore?: number; maxAttempts?: number };
type OpenMaicActivityKind = 'slide' | 'quiz' | 'interactive' | 'pbl' | 'visualization3d';
const openMaicKinds: Array<{ value: OpenMaicActivityKind; label: string; detail: string }> = [
  { value: 'slide', label: '幻灯片', detail: '使用 OpenMAIC 画布编辑图文、媒体和讲解动作' },
  { value: 'quiz', label: 'Quiz', detail: '直接创建可编辑题目、选项、答案和解析' },
  { value: 'interactive', label: '互动网页', detail: '内嵌 HTML 或外部网页互动内容' },
  { value: 'pbl', label: 'PBL', detail: '直接启动 OpenMAIC 项目角色、任务板和对话工作区' },
  {
    value: 'visualization3d',
    label: '3D',
    detail: '创建 visualization3d 互动场景，支持旋转和缩放',
  },
];

function OpenMaicActivitySettings({
  courseId,
  activity,
}: {
  courseId: string;
  activity: CourseActivity;
}) {
  const value = (activity.completionRule.openmaicInteraction ?? {}) as OpenMaicRule;
  const [document, setDocument] = useState<{
    document_id: string;
    revision: number;
    status: string;
    scene_count: number;
    activity_kind: OpenMaicActivityKind;
  } | null>(null);
  const kindByType: Partial<Record<CourseActivityType, OpenMaicActivityKind>> = {
    openmaic_slide: 'slide',
    openmaic_quiz: 'quiz',
    openmaic_interactive: 'interactive',
    openmaic_pbl: 'pbl',
    openmaic_3d: 'visualization3d',
  };
  const kind = kindByType[activity.activityType] ?? 'slide';
  const [creating, setCreating] = useState(false);
  const {
    importing: importingPptx,
    fileInputRef: pptxInputRef,
    triggerFileSelect: choosePptx,
    handleFileChange: importPptx,
  } = useImportPptx({
    onImported: (slides) => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/zhiban/teacher/courses/${courseId}/openmaic-activity`,
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ activityId: activity.id, source: 'pptx', slides }),
            },
          );
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? 'PPT 导入失败');
          setDocument((current) =>
            current
              ? {
                  ...current,
                  revision: current.revision + 1,
                  scene_count: body.scene_count,
                  activity_kind: 'slide',
                  status: 'draft',
                }
              : current,
          );
          toast.success(`已导入 ${body.scene_count} 页 PPT 到当前活动`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'PPT 导入失败');
        }
      })();
    },
  });
  useEffect(() => {
    void fetch(
      `/api/zhiban/teacher/courses/${courseId}/openmaic-activity?activityId=${activity.id}`,
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        setDocument(body.document);
      })
      .catch((error) => toast.error(error.message ?? '活动内容加载失败'));
  }, [activity.id, courseId]);
  const create = async (replace = false) => {
    if (replace && !window.confirm('更换活动类型将覆盖当前 OpenMAIC 活动内容，是否继续？')) return;
    setCreating(true);
    try {
      const response = await fetch(`/api/zhiban/teacher/courses/${courseId}/openmaic-activity`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activityId: activity.id, activityKind: kind, replace }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setDocument({
        document_id: body.document_id,
        revision: (document?.revision ?? 0) + 1,
        status: 'draft',
        scene_count: 1,
        activity_kind: kind,
      });
      toast.success(
        `OpenMAIC ${openMaicKinds.find((item) => item.value === kind)?.label} 活动已${replace ? '替换' : '创建'}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };
  return (
    <fieldset className="grid gap-4 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4 md:col-span-2 md:grid-cols-2">
      <legend className="px-2 font-semibold text-indigo-800">
        {activityLabel(activity.activityType)}内容设置
      </legend>
      <p className="-mt-2 text-xs text-slate-500 md:col-span-2">
        该活动拥有独立文档、编辑历史和学生运行状态，不依赖 OpenMAIC 课堂。
      </p>
      {kind === 'slide' && (
        <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
          <div className="rounded-lg border border-violet-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 size-5 text-violet-600" />
              <div className="flex-1">
                <p className="font-semibold">AI 生成幻灯片</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  进入 OpenMAIC 原有生成流程，设置主题、资料、大纲和模型，生成后自动回写本活动。
                </p>
                <Button asChild type="button" size="sm" className="mt-3" disabled={!document}>
                  <a
                    href={`/?zhibanCourseId=${encodeURIComponent(courseId)}&zhibanCourseName=${encodeURIComponent('智伴课程')}&zhibanActivityId=${encodeURIComponent(activity.id)}&zhibanActivityTitle=${encodeURIComponent(activity.title)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    AI 生成
                  </a>
                </Button>
                {!document && (
                  <p className="mt-2 text-xs text-amber-600">请先创建幻灯片活动文档。</p>
                )}
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-sky-200 bg-white p-4">
            <input
              ref={pptxInputRef}
              type="file"
              accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              onChange={importPptx}
              className="hidden"
            />
            <div className="flex items-start gap-3">
              <Upload className="mt-0.5 size-5 text-sky-600" />
              <div className="flex-1">
                <p className="font-semibold">教师上传 PPTX</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  将 PPTX 每一页转换为 OpenMAIC 可编辑幻灯片，导入后仍可使用 Agent 继续修改。
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  disabled={!document || importingPptx}
                  onClick={choosePptx}
                >
                  {importingPptx ? '正在解析 PPTX…' : '选择 PPTX 文件'}
                </Button>
                {!document && (
                  <p className="mt-2 text-xs text-amber-600">请先创建幻灯片活动文档。</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="rounded border bg-white p-4 md:col-span-2">
        {document ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <p className="font-medium">{activityLabel(activity.activityType)}内容已创建</p>
              <p className="text-xs text-slate-500">
                版本 {document.revision} · {document.scene_count} 个 Scene · {document.status}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={creating}
              onClick={() => void create(true)}
            >
              重置活动内容
            </Button>
            <Button asChild type="button">
              <a href={`/classroom/${document.document_id}`} target="_blank" rel="noreferrer">
                编辑活动内容
              </a>
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <p className="font-medium">尚未创建活动内容</p>
              <p className="text-xs text-slate-500">保存活动后系统会自动创建对应内容。</p>
            </div>
            <Button type="button" disabled={creating} onClick={() => void create()}>
              {creating ? '正在创建…' : '创建活动内容'}
            </Button>
          </div>
        )}
      </div>
      <Field label="完成条件">
        <select
          name="openmaicCompletionEvent"
          defaultValue={value.completionEvent ?? 'scene_viewed'}
          className="h-9 rounded border bg-white px-3 text-sm"
        >
          <option value="scene_viewed">打开场景即完成</option>
          <option value="quiz_completed">Quiz 提交后完成</option>
          <option value="interaction">完成一次互动后完成</option>
          <option value="minimum_score">达到指定分数</option>
        </select>
      </Field>
      <Field label="最低分数（仅分数条件）">
        <Input
          name="openmaicMinimumScore"
          type="number"
          min="0"
          max="100"
          defaultValue={value.minimumScore ?? 0}
        />
      </Field>
      <Field label="最多尝试次数（0 为不限）">
        <Input
          name="openmaicMaxAttempts"
          type="number"
          min="0"
          max="100"
          defaultValue={value.maxAttempts ?? 0}
        />
      </Field>
    </fieldset>
  );
}

function AiSupportSettings({
  activity,
  references,
}: {
  activity: CourseActivity;
  references: CourseActivityReference[];
}) {
  const value = (activity.completionRule.aiSupport ?? {}) as AiSupportRule;
  const [bindings, setBindings] = useState<string[]>(value.sourceBindings ?? []);
  const toggle = (key: string) =>
    setBindings((items) =>
      items.includes(key) ? items.filter((item) => item !== key) : [...items, key],
    );
  const move = (index: number, direction: -1 | 1) =>
    setBindings((items) => {
      const target = index + direction;
      if (target < 0 || target >= items.length) return items;
      const next = [...items],
        [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  const referenceMap = new Map(references.map((item) => [`${item.type}:${item.id}`, item]));
  return (
    <fieldset className="grid gap-4 rounded-lg border border-blue-200 bg-blue-50/50 p-4 md:col-span-2 md:grid-cols-2">
      <legend className="px-2 font-semibold text-blue-800">AI 辅导活动设置</legend>
      <p className="-mt-2 text-xs text-slate-500 md:col-span-2">
        这里定义本次辅导的教学脚本；课程知识、Tutor 人设和模型仍在“智能体中心”统一管理。
      </p>
      <div className="md:col-span-2">
        <Field label="辅导目标">
          <textarea
            name="aiLearningObjective"
            defaultValue={value.learningObjective}
            rows={2}
            required
            className="w-full rounded border bg-white p-3 text-sm"
            placeholder="例如：学生能够解释绝对引用与相对引用的区别，并能在公式中正确使用。"
            maxLength={2000}
          />
        </Field>
      </div>
      <div className="md:col-span-2">
        <Field label="Tutor 开场引导语">
          <textarea
            name="aiOpeningPrompt"
            defaultValue={value.openingPrompt}
            rows={2}
            className="w-full rounded border bg-white p-3 text-sm"
            placeholder="例如：先说说你在复制公式时遇到了什么现象？"
            maxLength={2000}
          />
        </Field>
      </div>
      <div className="md:col-span-2">
        <Field label="核心知识点（每行一个）">
          <textarea
            name="aiKeyPoints"
            defaultValue={(value.keyPoints ?? []).join('\n')}
            rows={4}
            className="w-full rounded border bg-white p-3 text-sm"
            placeholder={'相对引用的变化规律\n绝对引用中 $ 符号的作用\n混合引用的典型场景'}
            maxLength={5000}
          />
        </Field>
      </div>
      <Field label="引导方式">
        <select
          name="aiGuidanceMode"
          defaultValue={value.guidanceMode ?? 'socratic'}
          className="h-9 rounded border bg-white px-3 text-sm"
        >
          <option value="socratic">启发式追问</option>
          <option value="step_by_step">分步讲解</option>
          <option value="example_driven">案例驱动</option>
          <option value="diagnose_then_scaffold">先诊断再搭建支架</option>
        </select>
      </Field>
      <Field label="知识范围">
        <select
          name="aiKnowledgeScope"
          defaultValue={value.knowledgeScope ?? 'course_only'}
          className="h-9 rounded border bg-white px-3 text-sm"
        >
          <option value="course_only">仅限本课程资料</option>
          <option value="course_first">课程资料优先，可补充通用知识</option>
        </select>
      </Field>
      <div className="md:col-span-2">
        <Field label="辅导资料范围">
          <select
            name="aiSourceMode"
            defaultValue={value.sourceMode ?? 'current_chapter'}
            className="h-9 rounded border bg-white px-3 text-sm"
          >
            <option value="course">使用整个课程知识库</option>
            <option value="current_chapter">优先当前章节，再使用课程知识库</option>
            <option value="selected">仅使用下方指定资料</option>
            <option value="selected_first">指定资料优先，再使用当前章节和课程知识库</option>
          </select>
        </Field>
      </div>
      <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
        <div className="rounded border bg-white p-3">
          <p className="mb-2 text-sm font-medium">可关联内容</p>
          <div className="max-h-60 space-y-1 overflow-y-auto">
            {references.map((reference) => {
              const key = `${reference.type}:${reference.id}`,
                selected = bindings.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(key)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm ${selected ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50'}`}
                >
                  <input type="checkbox" checked={selected} readOnly />
                  <span className="min-w-0 flex-1 truncate">
                    {activityLabel(reference.type)}：{reference.title}
                  </span>
                  <Badge
                    variant="outline"
                    className={
                      reference.synced ? 'border-emerald-200 text-emerald-700' : 'text-amber-700'
                    }
                  >
                    {reference.synced ? '已同步' : '待同步'}
                  </Badge>
                </button>
              );
            })}
            {!references.length && (
              <p className="py-4 text-center text-sm text-slate-400">暂无可关联内容。</p>
            )}
          </div>
        </div>
        <div className="rounded border bg-white p-3">
          <p className="mb-2 text-sm font-medium">检索优先级（从上到下）</p>
          <div className="max-h-60 space-y-2 overflow-y-auto">
            {bindings.map((key, index) => {
              const reference = referenceMap.get(key);
              return (
                <div key={key} className="flex items-center gap-2 rounded border px-2 py-2 text-sm">
                  <input type="hidden" name="aiSourceBinding" value={key} />
                  <span className="w-5 text-center text-xs text-slate-400">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {reference
                      ? `${activityLabel(reference.type)}：${reference.title}`
                      : `已失效：${key}`}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label="提高优先级"
                  >
                    <ArrowUp className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={index === bindings.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label="降低优先级"
                  >
                    <ArrowDown className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => toggle(key)}
                    aria-label="移除资料"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              );
            })}
            {!bindings.length && (
              <p className="py-4 text-center text-sm text-slate-400">从左侧选择一个或多个资料。</p>
            )}
          </div>
        </div>
      </div>
      <Field label="最少有效轮次">
        <Input
          name="aiMinimumTurns"
          type="number"
          min="1"
          max="20"
          defaultValue={value.minimumTurns ?? 2}
        />
      </Field>
      <Field label="最多辅导轮次">
        <Input
          name="aiMaximumTurns"
          type="number"
          min="1"
          max="40"
          defaultValue={value.maximumTurns ?? 8}
        />
      </Field>
      <div className="md:col-span-2">
        <Field label="回答边界与教师要求">
          <textarea
            name="aiAnswerBoundary"
            defaultValue={value.answerBoundary}
            rows={3}
            className="w-full rounded border bg-white p-3 text-sm"
            placeholder="例如：不得直接给出作业最终公式；必须先让学生说明思路；资料不足时建议联系教师。"
            maxLength={5000}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-5 text-sm md:col-span-2">
        <label className="flex items-center gap-2">
          <input
            name="aiRequireReflection"
            type="checkbox"
            defaultChecked={value.requireReflection ?? true}
          />
          结束前要求学生反思
        </label>
        <label className="flex items-center gap-2">
          <input
            name="aiGenerateSummary"
            type="checkbox"
            defaultChecked={value.generateSummary ?? true}
          />
          生成学习小结
        </label>
        <label className="flex items-center gap-2">
          <input
            name="aiTeacherReview"
            type="checkbox"
            defaultChecked={value.teacherReview ?? false}
          />
          异常或未解决问题需教师查看
        </label>
      </div>
    </fieldset>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function StructurePreview({ modules }: { modules: CourseModule[] }) {
  return (
    <div className="space-y-3">
      {modules.map((moduleItem, moduleIndex) => (
        <section key={moduleItem.id} className="rounded border">
          <h3 className="bg-slate-50 px-4 py-3 font-semibold">
            模块 {moduleIndex + 1}：{moduleItem.title}
          </h3>
          <div className="divide-y">
            {moduleItem.chapters.map((chapter, chapterIndex) => (
              <div key={chapter.id} className="p-4">
                <h4 className="font-medium">
                  第 {chapterIndex + 1} 章　{chapter.title}
                </h4>
                <div className="mt-3 space-y-2 pl-4">
                  {chapter.activities.map((activity) => (
                    <div
                      key={activity.id}
                      className="flex items-center gap-2 rounded bg-slate-50 px-3 py-2 text-sm"
                    >
                      <Badge variant="outline">{activityLabel(activity.activityType)}</Badge>
                      <span className="flex-1">{activity.title}</span>
                      <span className="text-xs text-slate-500">
                        {activity.required ? '必修' : '选修'} · {activity.estimatedMinutes} 分钟
                      </span>
                    </div>
                  ))}
                  {!chapter.activities.length && <p className="text-sm text-slate-400">暂无活动</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {!modules.length && (
        <p className="py-10 text-center text-slate-500">当前草稿暂无课程结构。</p>
      )}
    </div>
  );
}

function localDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value),
    offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

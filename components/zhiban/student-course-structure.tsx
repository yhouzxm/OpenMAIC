'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, CheckCircle2, ChevronDown, Clock, LockKeyhole } from 'lucide-react';
import { toast } from 'sonner';
import { Streamdown } from 'streamdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CourseActivity, CourseActivityType, CourseStructure } from '@/lib/zhiban/curriculum';
import type { ActivityContentRecord } from '@/lib/zhiban/content';

const labels: Record<CourseActivityType, string> = {
  content: '图文内容',
  resource: '课程资源',
  classroom: 'OpenMAIC 课堂',
  pbl: 'PBL 项目',
  assignment: '作业',
  quiz: '测验',
  discussion: '讨论',
  ema: 'EMA 问卷',
  practice: '实训',
  summary: '章节总结',
  ai_support: 'AI 辅导',
  openmaic_slide: '幻灯片',
  openmaic_quiz: 'Quiz',
  openmaic_interactive: '互动网页',
  openmaic_pbl: 'PBL 互动',
  openmaic_3d: '3D 互动',
};
const openMaicActivityTypes = new Set<CourseActivityType>([
  'openmaic_slide',
  'openmaic_quiz',
  'openmaic_interactive',
  'openmaic_pbl',
  'openmaic_3d',
]);

export function StudentCourseStructure({ courseId }: { courseId: string }) {
  const [structure, setStructure] = useState<CourseStructure | null | undefined>(undefined);
  const [contents, setContents] = useState<ActivityContentRecord[]>([]);
  const [expandedContentId, setExpandedContentId] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch(`/api/zhiban/student/courses/${courseId}/structure`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '课程目录加载失败');
    setStructure(body.structure);
  }, [courseId]);
  useEffect(() => {
    void Promise.all([
      fetch(`/api/zhiban/student/courses/${courseId}/structure`),
      fetch(`/api/zhiban/student/courses/${courseId}/content`),
    ])
      .then(async ([structureResponse, contentResponse]) => {
        const structureBody = await structureResponse.json();
        const contentBody = await contentResponse.json();
        if (!structureResponse.ok) throw new Error(structureBody.error ?? '课程目录加载失败');
        if (!contentResponse.ok) throw new Error(contentBody.error ?? '课程内容加载失败');
        setStructure(structureBody.structure);
        setContents(contentBody.contents ?? []);
      })
      .catch((error) => toast.error(error.message));
  }, [courseId]);
  const complete = async (activityId: string) => {
    const response = await fetch(`/api/zhiban/student/courses/${courseId}/structure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activityId }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '操作失败');
    toast.success('学习活动已完成');
    await load();
  };
  const completeContent = async (activityId: string) => {
    const response = await fetch(`/api/zhiban/student/courses/${courseId}/content`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'complete_content', activityId }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '操作失败');
    toast.success('该内容已完成');
    await load();
  };
  if (structure === undefined)
    return <div className="border bg-white p-8 text-center text-slate-500">正在加载课程目录…</div>;
  if (!structure)
    return (
      <div className="border bg-white p-8 text-center text-slate-500">教师尚未发布课程结构。</div>
    );
  return (
    <section className="min-w-0 overflow-hidden border bg-white p-2 sm:p-5">
      <div className="space-y-4">
        {structure.modules.map((module, moduleIndex) => (
          <details key={module.id} open={moduleIndex === 0} className="group rounded border">
            <summary className="flex cursor-pointer list-none items-center gap-2 bg-slate-50 px-3 py-3 sm:gap-3 sm:px-4 sm:py-4">
              <ChevronDown className="size-4 transition group-open:rotate-180" />
              <BookOpen className="size-5 text-blue-600" />
              <span className="min-w-0 flex-1 break-words font-semibold">{module.title}</span>
              <span className="ml-auto text-xs text-slate-500">{module.chapters.length} 章</span>
            </summary>
            <div className="divide-y">
              {module.chapters.map((chapter, chapterIndex) => (
                <div key={chapter.id} className="p-2 sm:p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">第 {chapterIndex + 1} 章</Badge>
                    <h3 className="font-medium">{chapter.title}</h3>
                    <span className="ml-auto flex items-center gap-1 text-xs text-slate-500">
                      <Clock className="size-3" />
                      预计 {chapter.estimatedMinutes} 分钟
                    </span>
                  </div>
                  <div className="space-y-2 sm:pl-2 md:pl-8">
                    {chapter.activities.map((activity) => (
                      <StudentActivity
                        key={activity.id}
                        courseId={courseId}
                        activity={activity}
                        content={contents.find((item) => item.activityId === activity.id)}
                        contentExpanded={expandedContentId === activity.id}
                        onToggleContent={() =>
                          setExpandedContentId((current) => current === activity.id ? null : activity.id)
                        }
                        onCompleteContent={() =>
                          void completeContent(activity.id).catch((error) => toast.error(error.message))
                        }
                        onComplete={() =>
                          void complete(activity.id).catch((error) => toast.error(error.message))
                        }
                      />
                    ))}
                    {!chapter.activities.length && (
                      <p className="text-sm text-slate-400">本章暂无学习活动。</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function StudentActivity({
  activity,
  courseId,
  content,
  contentExpanded,
  onToggleContent,
  onCompleteContent,
  onComplete,
}: {
  activity: CourseActivity;
  courseId: string;
  content?: ActivityContentRecord;
  contentExpanded: boolean;
  onToggleContent: () => void;
  onCompleteContent: () => void;
  onComplete: () => void;
}) {
  const available = activity.available ?? false;
  const completed = activity.progress?.status === 'completed';
  const href = activityHref(activity, courseId);
  return (
    <div className="min-w-0 overflow-hidden rounded bg-slate-50">
    <div className="flex flex-wrap items-center gap-2 px-2 py-3 text-sm sm:gap-3 sm:px-3">
      {completed ? (
        <CheckCircle2 className="size-4 text-emerald-600" />
      ) : available ? (
        <CheckCircle2 className="size-4 text-slate-400" />
      ) : (
        <LockKeyhole className="size-4 text-amber-500" />
      )}
      <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
        {labels[activity.activityType]}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{activity.title}</p>
        {activity.description && (
          <p className="mt-1 text-xs text-slate-500">{activity.description}</p>
        )}
      </div>
      <span className="w-full text-xs text-slate-500 sm:w-auto">
        {activity.required ? '必修' : '选修'} · {activity.estimatedMinutes} 分钟
      </span>
      {completed && (
        <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">已完成</Badge>
      )}
      {!available ? (
        <span className="text-xs text-amber-600">{activity.unavailableReason || '尚未开放'}</span>
      ) : activity.activityType === 'content' ? (
        <Button size="sm" variant="outline" disabled={!content} onClick={onToggleContent}>
          {contentExpanded ? '收起内容' : content ? '查看内容' : '内容未发布'}
        </Button>
      ) : href ? (
        <Button asChild size="sm" variant="outline">
          <Link href={href}>开始学习</Link>
        </Button>
      ) : (
        !completed && (
          <Button size="sm" variant="outline" onClick={onComplete}>
            标记完成
          </Button>
        )
      )}
      {available &&
        href &&
        !completed &&
        String(activity.completionRule.type ?? 'manual') === 'manual' && (
          <Button size="sm" onClick={onComplete}>
            确认完成
          </Button>
        )}
    </div>
    {contentExpanded && content && (
      <article className="max-w-full overflow-x-auto border-t bg-white p-3 [overflow-wrap:anywhere] [&_img]:h-auto [&_img]:max-w-full [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto sm:p-5">
        {content.format === 'markdown' ? (
          <div className="text-sm leading-7 text-slate-700"><Streamdown>{content.body}</Streamdown></div>
        ) : content.format === 'html' ? (
          <div className="text-sm leading-7 text-slate-700" dangerouslySetInnerHTML={{ __html: content.body }} />
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{content.body}</div>
        )}
        {!completed && <Button size="sm" className="mt-4" onClick={onCompleteContent}>完成本节学习</Button>}
      </article>
    )}
    </div>
  );
}
function activityHref(activity: CourseActivity, courseId: string) {
  if (activity.activityType === 'content') return null;
  if (openMaicActivityTypes.has(activity.activityType))
    return `/zhiban/student/courses/${courseId}/activities/${activity.id}`;
  if (activity.activityType === 'ai_support') return `?activityId=${activity.id}#course-tutor`;
  if (activity.activityType === 'classroom')
    return `/zhiban/student/classroom/${activity.referenceId}`;
  if (activity.activityType === 'pbl') return '/zhiban/student/pbl';
  if (activity.activityType === 'assignment' || activity.activityType === 'quiz')
    return '/zhiban/student/grades';
  return null;
}

'use client';

import Link from 'next/link';
import { ArrowRight, CheckCircle2, LockKeyhole, Map, Route } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { KNOWLEDGE_STATIONS } from '@/lib/zhiban/learning-center/registry';
import type { LearningCenterAccessState } from '@/lib/zhiban/learning-center/access';
import {
  emptyLearningCenterProgress,
  type LearningCenterProgress,
} from '@/lib/zhiban/learning-center';
import {
  createMechatronicsPblDefinition,
  MECHATRONICS_PROJECT_STAGES,
} from '@/lib/zhiban/scene-orchestration';

const localKey = (courseId: string) => `zhiban-learning-center:${courseId}`;

export function LearningCenter({
  courseId,
  previewMode,
}: {
  courseId: string;
  previewMode?: 'teacher';
}) {
  const [progress, setProgress] = useState<LearningCenterProgress>(() =>
    emptyLearningCenterProgress(courseId),
  );
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<LearningCenterAccessState>();
  const basePath = previewMode
    ? `/zhiban/teacher/courses/${courseId}/learning-center`
    : `/zhiban/student/courses/${courseId}/learning-center`;
  const courseHomePath = previewMode
    ? `/zhiban/teacher/courses/${courseId}`
    : `/zhiban/student/courses/${courseId}`;
  const project = createMechatronicsPblDefinition(courseId);

  useEffect(() => {
    let active = true;
    void fetch(`/api/zhiban/student/courses/${courseId}/learning-center`)
      .then(async (response) => {
        if (!response.ok) throw new Error('progress');
        const body = (await response.json()) as {
          progress?: LearningCenterProgress;
          access?: LearningCenterAccessState;
        };
        if (active && body.progress) setProgress(body.progress);
        if (active && body.access) setAccess(body.access);
      })
      .catch(() => {
        try {
          const cached = localStorage.getItem(localKey(courseId));
          if (active && cached) setProgress(JSON.parse(cached) as LearningCenterProgress);
        } catch {
          /* local fallback is optional */
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [courseId]);

  const completedStations = KNOWLEDGE_STATIONS.filter(
    (station) => progress.stations[station.id]?.status === 'completed',
  ).length;
  const currentStationId = access?.currentStationId;
  return (
    <main className="space-y-5" data-testid="learning-center">
      <header className="rounded-xl border bg-gradient-to-r from-[#071b48] via-[#123d71] to-[#0f766e] p-6 text-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href={courseHomePath}
              className="text-sm text-blue-100 hover:underline"
            >
              ← 返回课程首页
            </Link>
            <div className="mt-4 flex items-center gap-3">
              <Map className="size-7" />
              <div>
                <p className="text-sm text-blue-100">智伴·创学</p>
                <h1 className="text-2xl font-semibold">
                  AI驱动的机电一体化智能诊断与虚拟实训交互课件
                </h1>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-50">
              沿信号链学机理，循证据链做诊断。按照“认知—感知—控制—执行—诊断—实训—提升”逐步完成学习任务。
            </p>
            <div className="mt-4 rounded-lg border border-white/15 bg-white/10 p-3">
              <p className="text-sm font-medium">工程任务：{project.title}</p>
              <p className="mt-1 text-xs leading-5 text-blue-100">{project.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {MECHATRONICS_PROJECT_STAGES.map((stage) => (
                  <span key={stage.stationId} className="rounded-full bg-white/15 px-3 py-1 text-xs">
                    {stage.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-lg bg-white/15 px-4 py-3 text-sm backdrop-blur">
            <b>
              {completedStations} / {KNOWLEDGE_STATIONS.length}
            </b>
            <span className="ml-2 text-blue-100">学习站已完成</span>
          </div>
        </div>
      </header>
      {previewMode && (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          教师预览：可查看任意学习站；预览操作不会写入学生学习记录、画像或班级统计。
        </p>
      )}
      {access?.mode === 'review_demo' && (
        <p className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          评审演示：已授权快速预览学习路径；所有实训与评价数据仍按真实流程记录。
        </p>
      )}
      <section className="rounded-xl border bg-white p-5">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Route className="size-5 text-blue-600" />
            <h2 className="font-semibold">学习路径</h2>
          </div>
          {loading && <span className="text-xs text-slate-500">正在恢复学习进度…</span>}
        </div>
        <div className="relative grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {KNOWLEDGE_STATIONS.map((station, index) => {
            const item = progress.stations[station.id];
            const decision = access?.stations[station.id];
            const enabled = decision?.allowed ?? station.id === 'station-01-system';
            const locked = !enabled;
            const targetPath = `${basePath}/${station.id}`;
            const prerequisite = decision?.prerequisiteStationId;
            return (
              <article
                key={station.id}
                className={`relative rounded-xl border p-4 transition ${enabled ? 'border-blue-200 bg-blue-50/50 hover:-translate-y-0.5 hover:shadow-md' : 'border-slate-200 bg-slate-50'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <Badge variant={enabled ? 'default' : 'outline'}>
                    {String(index + 1).padStart(2, '0')}
                  </Badge>
                  {item?.status === 'completed' ? (
                    <CheckCircle2 className="size-5 text-emerald-600" />
                  ) : locked ? (
                    <LockKeyhole className="size-4 text-slate-400" />
                  ) : (
                    <span className="text-xs text-slate-500">
                      {station.id === currentStationId
                        ? '当前学习'
                        : item?.status === 'in_progress'
                          ? '学习中'
                          : '可进入'}
                    </span>
                  )}
                </div>
                <h3 className="mt-4 font-semibold">{station.title}</h3>
                <p className="mt-2 min-h-10 text-sm leading-5 text-slate-600">
                  {station.objective}
                </p>
                <div className="mt-4 h-2 overflow-hidden rounded bg-slate-200">
                  <div
                    className="h-full rounded bg-blue-600 transition-all"
                    style={{ width: `${item?.progressPercent ?? 0}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">进度 {item?.progressPercent ?? 0}%</p>
                {enabled ? (
                  <Button asChild size="sm" className="mt-4 w-full">
                    <Link href={targetPath}>
                      {item?.status === 'completed'
                        ? '再次进入'
                        : station.id === currentStationId || item?.status === 'in_progress'
                          ? '继续学习'
                          : '进入学习'}
                      <ArrowRight className="ml-1 size-4" />
                    </Link>
                  </Button>
                ) : (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs text-slate-500">{decision?.reason ?? '完成上一学习站后解锁'}</p>
                    <Button asChild size="sm" variant="outline" className="w-full">
                      <Link href={prerequisite ? `${basePath}/${prerequisite}` : basePath}>
                        前往上一站
                      </Link>
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
      {!progress.persistenceAvailable && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          学习记录服务暂时不可用，当前进度会先保存在本机，恢复后可继续同步。
        </p>
      )}
    </main>
  );
}
